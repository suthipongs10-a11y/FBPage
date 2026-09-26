/**
 * ห้องข่าวอัตโนมัติ (N-4) — ต่อแบรนด์: ดึงทุก N ชั่วโมง → AI คัด → เขียนร่างวันละไม่เกิน X เรื่อง → รออนุมัติ
 * ไม่โพสต์เองเด็ดขาด (ผู้ใช้เลือก "รออนุมัติ 1 คลิก") · เคารพสวิตช์ฉุกเฉิน automationPaused ของ workspace
 * รันในโปรเซส API (ต้องใช้ Chromium เรนเดอร์การ์ดและบริการคอนเทนต์ชุดเดียวกับการกดเอง) กันรันซ้อนด้วย Redis lock
 */
import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { brandInWorkspace, pageInWorkspace } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { isValidTimeZone, localToUtc } from '../content/tz';
import { NewsService } from './news.service';
import type { AutomationDto } from './dto';

const TICK_MS = 5 * 60_000;
const LOCK_KEY = 'news-automation:lock';
const DEFAULT_SLOTS = ['09:00', '12:30', '19:00'];
const AUTO_SELECT = { brandId: true, enabled: true, pageId: true, fetchEveryHours: true, draftsPerDay: true, minScore: true, skipHighRisk: true, aiImage: true, theme: true, postingSlots: true, lastRunAt: true, lastFetchAt: true, lastResult: true, lastError: true, updatedAt: true } as const;

/** วันที่ (YYYY-MM-DD) ในเขตเวลา tz */
const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

@Injectable()
export class NewsAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('NewsAutomation');
  private timer: NodeJS.Timeout | null = null; private first: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NewsService) private readonly news: NewsService,
  ) {}

  onModuleInit() {
    if (this.env.APP_ENV === 'test' || !this.env.NEWS_AUTOMATION_ENABLED) return;
    const run = () => { void this.tick().catch(e => this.log.error(`tick ล้ม: ${(e as Error).message}`)); };
    this.first = setTimeout(run, 60_000); this.timer = setInterval(run, TICK_MS);
  }
  onModuleDestroy() { if (this.first) clearTimeout(this.first); if (this.timer) clearInterval(this.timer); }

  // ---------- ตั้งค่า ----------
  async get(workspaceId: string, brandId: string) {
    const b = await this.prisma.brand.findFirst({ where: { id: brandId, ...brandInWorkspace(workspaceId) }, select: { id: true } });
    if (!b) throw new NotFoundException('ไม่พบแบรนด์');
    return this.prisma.newsAutomation.findUnique({ where: { brandId }, select: AUTO_SELECT });
  }

  async set(workspaceId: string, userId: string, brandId: string, dto: AutomationDto, requestId: string) {
    const b = await this.prisma.brand.findFirst({ where: { id: brandId, ...brandInWorkspace(workspaceId) }, select: { id: true } });
    if (!b) throw new NotFoundException('ไม่พบแบรนด์');
    const page = await this.prisma.facebookPage.findFirst({ where: { id: dto.pageId, ...pageInWorkspace(workspaceId) }, select: { brandId: true, disconnectedAt: true } });
    if (!page || page.disconnectedAt) throw new NotFoundException('ไม่พบเพจ');
    if (page.brandId !== brandId) throw new BadRequestException('เพจนี้ไม่ได้อยู่ในแบรนด์นี้');
    const slots = [...new Set(dto.postingSlots)].sort();
    const data = { enabled: dto.enabled, pageId: dto.pageId, fetchEveryHours: dto.fetchEveryHours, draftsPerDay: dto.draftsPerDay, minScore: dto.minScore, skipHighRisk: dto.skipHighRisk, aiImage: dto.aiImage, theme: dto.theme, postingSlots: slots.length ? slots : DEFAULT_SLOTS, createdById: userId };
    const out = await this.prisma.newsAutomation.upsert({ where: { brandId }, create: { workspaceId, brandId, ...data }, update: data, select: AUTO_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'news.automation.set', resourceType: 'brand', resourceId: brandId, after: data, requestId });
    return out;
  }

  /** ช่องเวลาว่างถัดไปของเพจ (ตามช่องเวลาของแบรนด์ ไม่ชนโพสต์ที่ตั้งเวลาไว้แล้ว) — ใช้เป็นค่าเริ่มต้นตอนกดอนุมัติ */
  async nextSlot(workspaceId: string, pageId: string, now = new Date()) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, brandId: true, timezone: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    const [ws, auto] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } }),
      this.prisma.newsAutomation.findUnique({ where: { brandId: page.brandId }, select: { postingSlots: true } }),
    ]);
    const tz = page.timezone && isValidTimeZone(page.timezone) ? page.timezone : ws.timezone;
    const slots = (auto?.postingSlots.length ? auto.postingSlots : DEFAULT_SLOTS).slice().sort();
    const taken = new Set((await this.prisma.contentItem.findMany({ where: { pageId, status: { in: ['SCHEDULED', 'PUBLISHING'] }, scheduledAt: { gte: now } }, select: { scheduledLocal: true } })).map(c => c.scheduledLocal?.slice(0, 16)));
    for (let day = 0; day < 30; day++) {
      const date = localDate(new Date(now.getTime() + day * 86_400_000), tz);
      for (const slot of slots) {
        const local = `${date}T${slot}`;
        if (localToUtc(local, tz).getTime() < now.getTime() + 15 * 60_000 || taken.has(local)) continue;
        return { scheduledLocal: local, timezone: tz, slots };
      }
    }
    return { scheduledLocal: null, timezone: tz, slots };
  }

  // ---------- รอบอัตโนมัติ ----------
  /** วนทุกแบรนด์ที่เปิดไว้และถึงรอบ — คืนผลรายแบรนด์ (ใช้ใน test ด้วย) */
  async tick(now = new Date()) {
    const lockId = randomUUID();
    if (this.redis.status === 'wait') await this.redis.connect().catch(() => undefined);
    const got = await this.redis.set(LOCK_KEY, lockId, 'EX', 20 * 60, 'NX').catch(() => null);
    if (got !== 'OK') return { skipped: 'locked' as const, runs: [] };
    try {
      const autos = await this.prisma.newsAutomation.findMany({ where: { enabled: true, workspace: { automationPaused: false } }, select: { id: true, workspaceId: true, brandId: true, fetchEveryHours: true, lastFetchAt: true } });
      const runs: { brandId: string; result: unknown }[] = [];
      for (const a of autos) {
        if (a.lastFetchAt && now.getTime() - a.lastFetchAt.getTime() < a.fetchEveryHours * 3_600_000 - 60_000) continue;
        runs.push({ brandId: a.brandId, result: await this.runOne(a.workspaceId, a.brandId, now) });
      }
      return { skipped: null, runs };
    } finally {
      if ((await this.redis.get(LOCK_KEY).catch(() => null)) === lockId) await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  /** หนึ่งรอบของแบรนด์: ดึง → คัด → เขียนร่างตามโควตาที่เหลือของวัน */
  async runOne(workspaceId: string, brandId: string, now = new Date()) {
    const a = await this.prisma.newsAutomation.findUnique({ where: { brandId }, select: { ...AUTO_SELECT, createdById: true, workspaceId: true } });
    if (!a || a.workspaceId !== workspaceId) throw new NotFoundException('ยังไม่ได้ตั้งค่าอัตโนมัติของแบรนด์นี้');
    const rid = `news-auto-${randomUUID()}`; const uid = a.createdById;
    const result = { fetched: 0, shortlisted: 0, drafted: 0, draftedToday: 0, errors: [] as string[] };
    const note = (step: string, e: unknown) => result.errors.push(`${step}: ${((e as Error & { response?: { message?: string } }).response?.message ?? (e as Error).message).slice(0, 200)}`);

    try { result.fetched = (await this.news.fetchBrand(workspaceId, uid, brandId, rid)).added; } catch (e) { note('ดึงข่าว', e); }

    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
    const dayStart = localToUtc(`${localDate(now, ws.timezone)}T00:00`, ws.timezone);
    result.draftedToday = await this.prisma.newsItem.count({ where: { brandId, status: 'DRAFTED', updatedAt: { gte: dayStart } } });
    let remaining = Math.max(0, a.draftsPerDay - result.draftedToday);

    if (remaining > 0) {
      if (await this.prisma.newsItem.count({ where: { brandId, status: 'NEW' } })) {
        try { result.shortlisted = (await this.news.shortlist(workspaceId, uid, brandId, { max: Math.min(10, remaining * 2) }, rid)).picked; } catch (e) { note('คัดข่าว', e); }
      }
      const picks = await this.prisma.newsItem.findMany({ where: { brandId, status: 'SHORTLISTED', score: { gte: a.minScore } }, orderBy: [{ score: 'desc' }, { fetchedAt: 'desc' }], take: 30, select: { id: true, angle: true } });
      for (const p of picks) {
        if (remaining <= 0) break;
        if (a.skipHighRisk && (p.angle as { risk?: string } | null)?.risk === 'HIGH') continue;
        try {
          await this.news.draft(workspaceId, uid, p.id, { pageId: a.pageId, theme: a.theme, aiImage: a.aiImage }, rid);
          result.drafted++; remaining--;
        } catch (e) { note('เขียนโพสต์', e); if (/งบ|เพดาน|ยังไม่ได้ตั้งค่า AI|ไม่ได้ตั้ง/.test(result.errors.at(-1) ?? '')) break; }
      }
    }
    await this.prisma.newsAutomation.update({ where: { brandId }, data: { lastRunAt: now, lastFetchAt: now, lastResult: result as unknown as Prisma.InputJsonValue, lastError: result.errors[0] ?? null } });
    await this.audit.log({ workspaceId, userId: uid, action: 'news.automation.run', resourceType: 'brand', resourceId: brandId, after: result as unknown as Prisma.InputJsonValue, requestId: rid });
    return result;
  }
}
