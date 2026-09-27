/**
 * ห้องข่าว — แหล่งข่าว (RSS/คำค้น) → ดึงหัวข้อ → AI (บทบาท research) คัดเรื่องที่น่าสนใจ → AI (บทบาท content) เขียนโพสต์ของเพจเอง
 * → การ์ดหัวข่าว → ส่งรออนุมัติ (ไม่โพสต์เองเด็ดขาด; โพสต์ผ่านประตูอนุมัติ/ตั้งเวลาเดิมของคอนเทนต์)
 * กฎ: เก็บแค่หัวข้อ/เกริ่น/ลิงก์เป็นหลักฐาน · เขียนใหม่ทั้งหมด ห้ามลอก · อ้างที่มาเสมอ · ห้ามใช้รูปของสำนักข่าว · คีย์ค้นเว็บเข้ารหัส
 */
import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { brandInWorkspace, pageInWorkspace } from '@fbpm/database';
import { WebError, canonicalNewsUrl, downloadImage, fetchFeed, isPrivateHost, normalizeTitle, pexelsSearch, sha256, tavilySearch, type FeedEntry } from '@fbpm/web-core';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { ContentService } from '../content/content.service';
import { readFile } from 'node:fs/promises';
import { MediaService } from '../media/media.service';
import { MediaGenService } from '../media/media-gen.service';
import { decryptSecret, encryptSecret } from '../common/crypto';
import type { CreateSourceDto, DraftDto, ExternalProvider, SuggestSourcesDto, ListItemsDto, SearchProviderDto, ShortlistDto, UpdateSourceDto } from './dto';

export const NEWS_SHORTLIST_PROMPT = 'news-shortlist-v1';
export const NEWS_WRITER_PROMPT = 'news-writer-v1';
const MAX_AGE_DAYS = 7;           // ข่าวเก่ากว่านี้ไม่เก็บ
const TITLE_DEDUPE_DAYS = 14;     // หัวข้อเดียวกันภายในช่วงนี้ถือว่าซ้ำ
const PROVIDER_SELECT = { provider: true, keyHint: true, status: true, lastError: true, verifiedAt: true, callCount: true, updatedAt: true } as const;
const SOURCE_SELECT = { id: true, brandId: true, kind: true, label: true, url: true, query: true, enabled: true, lastFetchedAt: true, lastError: true, lastNewCount: true, createdAt: true } as const;
const ITEM_SELECT = { id: true, brandId: true, sourceId: true, url: true, title: true, snippet: true, sourceName: true, publishedAt: true, fetchedAt: true, status: true, score: true, angle: true, contentId: true } as const;

const RISK = ['LOW', 'HIGH'] as const;
const suggestOut = z.object({ sources: z.array(z.object({ label: z.string().min(1).max(80), query: z.string().min(2).max(200) })).max(20) });
const sha256Buf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const shortlistOut = z.object({ picks: z.array(z.object({ id: z.string(), score: z.number().int().min(0).max(100), headlineTh: z.string().min(1).max(160), why: z.string().max(400), category: z.string().max(40), risk: z.enum(RISK), riskReasons: z.array(z.string().max(200)).max(6).default([]) })).max(20) });
const writerOut = z.object({
  title: z.string().min(1).max(120),
  caption: z.string().min(40).max(2500),
  hashtags: z.array(z.string().max(40)).max(5).default([]),
  card: z.object({ kicker: z.string().max(24).optional(), headline: z.string().min(1).max(100), sub: z.string().max(150).optional() }),
  risk: z.enum(RISK),
  riskReasons: z.array(z.string().max(200)).max(6).default([]),
  needsCheck: z.array(z.string().max(200)).max(8).default([]),
  /** คำสั่งภาพประกอบภาษาอังกฤษ (เชิงสัญลักษณ์ ไม่มีคนจริง ไม่มีตัวอักษร) */
  imagePrompt: z.string().max(600).optional(),
  /** คำค้นภาพถ่ายภาษาอังกฤษ 2–5 คำ สำหรับคลังภาพ (สิ่งของ/สถานที่/บรรยากาศ ไม่ใช่ชื่อคน) */
  photoQuery: z.string().max(80).optional(),
});
type WriterOut = z.infer<typeof writerOut>;

const RISK_RULES = 'risk = HIGH เมื่อ: อาชญากรรม/ความรุนแรง/การเสียชีวิต/อุบัติเหตุที่มีผู้เสียหาย, การเมือง, สถาบันพระมหากษัตริย์, ศาสนา, สุขภาพ/การแพทย์/ยา, การเงิน/การลงทุน, ระบุตัวบุคคลธรรมดา, ข่าวลือที่ยังไม่ยืนยัน, ภัยพิบัติที่มีผู้เสียชีวิต — นอกนั้น LOW';

@Injectable()
export class NewsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AiGatewayService) private readonly ai: AiGatewayService,
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(MediaGenService) private readonly gen: MediaGenService,
  ) {}

  private get mock() { return this.env.WEB_MOCK_BASE_URL?.replace(/\/+$/, ''); }
  private async brand(workspaceId: string, brandId: string) {
    const b = await this.prisma.brand.findFirst({ where: { id: brandId, ...brandInWorkspace(workspaceId) }, select: { id: true, name: true, description: true, industry: true, targetAudience: true, toneOfVoice: true, preferredLanguage: true } });
    if (!b) throw new NotFoundException('ไม่พบแบรนด์');
    return b;
  }

  // ---------- คีย์ผู้ให้บริการภายนอก (tavily = ค้นข่าว, pexels = คลังภาพถ่าย) ----------
  async getProvider(workspaceId: string, provider: ExternalProvider = 'tavily') {
    const a = await this.prisma.searchProviderAccount.findUnique({ where: { workspaceId_provider: { workspaceId, provider } }, select: PROVIDER_SELECT });
    return a ? { configured: true, ...a } : { configured: false, provider };
  }

  async setProvider(workspaceId: string, userId: string, dto: SearchProviderDto, requestId: string) {
    const provider = dto.provider;
    const data = { apiKeyEnc: encryptSecret(dto.apiKey, this.env.AUTH_SECRET), keyHint: `…${dto.apiKey.slice(-4)}`, status: 'UNKNOWN', lastError: null, verifiedAt: null };
    await this.prisma.searchProviderAccount.upsert({ where: { workspaceId_provider: { workspaceId, provider } }, create: { workspaceId, provider, ...data }, update: data });
    // ทดสอบด้วยคำขอเดียว (ใช้โควตา 1 ครั้ง) — คีย์ผิดต้องรู้ตอนนี้ ไม่ใช่ตอนใช้งานจริงรอบแรก
    try {
      if (provider === 'pexels') await this.stockSearch(workspaceId, 'nature', 1); else await this.search(workspaceId, 'ข่าวล่าสุด', 1);
      await this.prisma.searchProviderAccount.update({ where: { workspaceId_provider: { workspaceId, provider } }, data: { status: 'OK', verifiedAt: new Date() } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.searchProviderAccount.update({ where: { workspaceId_provider: { workspaceId, provider } }, data: { status: e instanceof WebError && e.code === 'forbidden' ? 'AUTH_FAILED' : 'ERROR', lastError: msg.slice(0, 300) } });
    }
    await this.audit.log({ workspaceId, userId, action: 'news.search_provider.set', resourceType: 'searchProviderAccount', after: { provider }, requestId });
    return this.getProvider(workspaceId, provider);
  }

  async removeProvider(workspaceId: string, userId: string, provider: ExternalProvider, requestId: string) {
    await this.prisma.searchProviderAccount.deleteMany({ where: { workspaceId, provider } });
    await this.audit.log({ workspaceId, userId, action: 'news.search_provider.remove', resourceType: 'searchProviderAccount', after: { provider }, requestId });
    return { ok: true };
  }

  private async providerKey(workspaceId: string, provider: ExternalProvider, missing: string) {
    const a = await this.prisma.searchProviderAccount.findUnique({ where: { workspaceId_provider: { workspaceId, provider } }, select: { apiKeyEnc: true } });
    if (!a) throw new UnprocessableEntityException(missing);
    await this.prisma.searchProviderAccount.update({ where: { workspaceId_provider: { workspaceId, provider } }, data: { callCount: { increment: 1 } } });
    return decryptSecret(a.apiKeyEnc, this.env.AUTH_SECRET);
  }
  private async search(workspaceId: string, query: string, maxResults = 10) {
    const key = await this.providerKey(workspaceId, 'tavily', 'ยังไม่ได้ตั้งคีย์ค้นเว็บ (Tavily) — ตั้งที่หน้าห้องข่าว');
    return tavilySearch(key, query, { baseUrl: this.mock ? `${this.mock}/tavily` : undefined, maxResults, days: 3 });
  }
  /** ค้นเว็บผ่าน Tavily ให้โมดูลอื่น (โต๊ะค้นคว้า) — news = ข่าวล่าสุด, general = ความรู้ทั่วไป */
  async searchWeb(workspaceId: string, query: string, o: { maxResults?: number; topic?: 'news' | 'general'; days?: number } = {}) {
    const key = await this.providerKey(workspaceId, 'tavily', 'ยังไม่ได้ตั้งคีย์ค้นเว็บ (Tavily) — ตั้งที่หน้าห้องข่าว หรือเลือกโหมด "ให้ AI ค้นเอง"');
    return tavilySearch(key, query, { baseUrl: this.mock ? `${this.mock}/tavily` : undefined, maxResults: o.maxResults ?? 6, topic: o.topic ?? 'news', days: o.days ?? 7 });
  }
  private async stockSearch(workspaceId: string, query: string, perPage = 8) {
    const key = await this.providerKey(workspaceId, 'pexels', 'ยังไม่ได้ตั้งคีย์คลังภาพ (Pexels) — ตั้งที่หน้าห้องข่าว');
    return pexelsSearch(key, query, { baseUrl: this.mock ? `${this.mock}/pexels` : undefined, perPage });
  }

  /** ภาพถ่ายจริงจากคลังภาพฟรีที่ตรงบรรยากาศเรื่อง → บันทึกเป็นไฟล์ + MediaAsset(kind stock) พร้อมเครดิต */
  async stockPhoto(workspaceId: string, userId: string, contentId: string, query: string, used: Set<string>) {
    const photos = await this.stockSearch(workspaceId, query);
    const pick = photos.find(p => !used.has(p.id));
    if (!pick) throw new UnprocessableEntityException(`ไม่พบภาพในคลังสำหรับ "${query}"`);
    const img = await downloadImage(pick.imageUrl, { allowPrivate: this.env.WEB_ALLOW_PRIVATE_TARGETS });
    const dir = resolve(this.env.MEDIA_DIR, workspaceId); mkdirSync(dir, { recursive: true });
    const path = join(dir, `stock-${pick.provider}-${pick.id}-${Date.now()}.${img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg'}`);
    await writeFile(path, img.bytes);
    const asset = await this.prisma.mediaAsset.create({ data: { workspaceId, contentId, kind: 'stock', path, mimeType: img.mimeType, width: pick.width || null, height: pick.height || null, bytes: img.bytes.byteLength, sha256: sha256Buf(img.bytes), meta: { provider: pick.provider, photoId: pick.id, pageUrl: pick.pageUrl, photographer: pick.photographer, photographerUrl: pick.photographerUrl, query } as Prisma.InputJsonValue, createdById: userId }, select: { id: true, path: true, mimeType: true } });
    return { asset, bytes: img.bytes, mimeType: img.mimeType, credit: `${pick.photographer} / Pexels`, photoId: pick.id };
  }

  // ---------- แหล่งข่าว ----------
  async listSources(workspaceId: string, brandId: string) {
    await this.brand(workspaceId, brandId);
    return this.prisma.newsSource.findMany({ where: { brandId, workspaceId }, orderBy: { createdAt: 'asc' }, select: SOURCE_SELECT });
  }

  async createSource(workspaceId: string, userId: string, brandId: string, dto: CreateSourceDto, requestId: string) {
    await this.brand(workspaceId, brandId);
    if (dto.kind === 'RSS') this.assertUrl(dto.url);
    if (await this.prisma.newsSource.count({ where: { brandId } }) >= 30) throw new UnprocessableEntityException('แหล่งข่าวต่อแบรนด์ได้สูงสุด 30 แหล่ง');
    const s = await this.prisma.newsSource.create({ data: { workspaceId, brandId, kind: dto.kind, label: dto.label, url: dto.kind === 'RSS' ? dto.url : null, query: dto.kind === 'SEARCH' ? dto.query : null }, select: SOURCE_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'news.source.create', resourceType: 'newsSource', resourceId: s.id, after: { kind: s.kind, label: s.label, url: s.url, query: s.query }, requestId });
    return s;
  }

  /** ให้ AI (บทบาท research) คิดคำค้นข่าวตามแนวเพจ → เพิ่มเป็นแหล่งแบบค้นเว็บ (ข้ามคำที่มีอยู่แล้ว) — ผู้ใช้ปิด/ลบทีหลังได้ */
  async suggestSources(workspaceId: string, userId: string, brandId: string, dto: SuggestSourcesDto, requestId: string) {
    const b = await this.brand(workspaceId, brandId);
    const existing = await this.prisma.newsSource.findMany({ where: { brandId }, select: { query: true, label: true } });
    const room = 30 - existing.length;
    if (room <= 0) throw new UnprocessableEntityException('แหล่งข่าวต่อแบรนด์ได้สูงสุด 30 แหล่ง — ลบแหล่งที่ไม่ใช้ก่อน');
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'news.suggest_sources', role: 'research', requestId, promptVersion: 'news-sources-v1', override: dto.modelOverride ?? null, resourceType: 'brand', resourceId: brandId }, {
      system: 'คุณคือบรรณาธิการที่วางแผนหาข่าวให้เพจ Facebook ภาษาไทย คิดคำค้นข่าวสำหรับเครื่องมือค้นข่าวล่าสุด (ผลลัพธ์ 3 วันล่าสุด) ให้ได้ข่าวหลากหลายที่ตรงกับคนอ่านของเพจ ผสมภาษาอังกฤษ (ได้ข่าวต่างประเทศมากกว่า) และภาษาไทย คำค้นสั้น 2–6 คำ เฉพาะเจาะจงพอจะได้ข่าวจริง ห้ามคำค้นเกี่ยวกับการเมือง สถาบัน ศาสนา หรือเจาะจงตัวบุคคล',
      prompt: `เพจ/แบรนด์: ${b.name}\nแนวเพจ: ${b.description ?? b.industry ?? '-'}\nกลุ่มผู้อ่าน: ${b.targetAudience ?? 'คนไทยทั่วไป'}${dto.focus ? `\nเน้นเพิ่ม: ${dto.focus}` : ''}\nคำค้นที่มีอยู่แล้ว (ห้ามซ้ำ): ${existing.map(e => e.query ?? e.label).join(', ') || '-'}\nขอ ${Math.min(dto.count, room)} คำค้น`,
      schemaDescription: '{ "sources": [{ "label": "ชื่อหมวดภาษาไทยสั้น ๆ", "query": "คำค้น" }] }',
      validate: v => suggestOut.parse(v), maxTokens: 1500,
    });
    const seen = new Set(existing.map(e => (e.query ?? '').toLowerCase().trim()));
    const created = [];
    for (const x of out.result.data.sources.slice(0, Math.min(dto.count, room))) {
      const q = x.query.trim(); if (!q || seen.has(q.toLowerCase())) continue; seen.add(q.toLowerCase());
      created.push(await this.prisma.newsSource.create({ data: { workspaceId, brandId, kind: 'SEARCH', label: x.label.slice(0, 80), query: q.slice(0, 200) }, select: SOURCE_SELECT }));
    }
    await this.audit.log({ workspaceId, userId, action: 'news.source.suggest', resourceType: 'brand', resourceId: brandId, after: { added: created.length, provider: out.provider, model: out.model }, requestId });
    return { added: created.length, sources: created, provider: out.provider, model: out.model };
  }

  async updateSource(workspaceId: string, userId: string, id: string, dto: UpdateSourceDto, requestId: string) {
    const s = await this.prisma.newsSource.findFirst({ where: { id, workspaceId }, select: { id: true, kind: true } });
    if (!s) throw new NotFoundException('ไม่พบแหล่งข่าว');
    if (dto.url) { if (s.kind !== 'RSS') throw new BadRequestException('แหล่งแบบคำค้นไม่มี URL'); this.assertUrl(dto.url); }
    if (dto.query && s.kind !== 'SEARCH') throw new BadRequestException('แหล่งแบบ RSS ไม่มีคำค้น');
    const out = await this.prisma.newsSource.update({ where: { id }, data: dto, select: SOURCE_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'news.source.update', resourceType: 'newsSource', resourceId: id, after: dto, requestId });
    return out;
  }

  async deleteSource(workspaceId: string, userId: string, id: string, requestId: string) {
    const r = await this.prisma.newsSource.deleteMany({ where: { id, workspaceId } });
    if (!r.count) throw new NotFoundException('ไม่พบแหล่งข่าว');
    await this.audit.log({ workspaceId, userId, action: 'news.source.delete', resourceType: 'newsSource', resourceId: id, requestId });
    return { ok: true };
  }

  private assertUrl(url: string) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new BadRequestException('รองรับเฉพาะลิงก์ http/https');
    if (!this.env.WEB_ALLOW_PRIVATE_TARGETS && isPrivateHost(u.hostname)) throw new BadRequestException('ไม่อนุญาตเป้าหมายในเครือข่ายภายใน');
  }

  // ---------- ดึงข่าว ----------
  /** ดึงทุกแหล่งที่เปิดอยู่ของแบรนด์ทีละแหล่ง (เว้น 1 วินาทีระหว่างคำขอ) แล้วเก็บเฉพาะข่าวใหม่ที่ไม่ซ้ำ */
  async fetchBrand(workspaceId: string, userId: string, brandId: string, requestId: string) {
    await this.brand(workspaceId, brandId);
    const sources = await this.prisma.newsSource.findMany({ where: { brandId, workspaceId, enabled: true }, orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, label: true, url: true, query: true } });
    if (!sources.length) throw new UnprocessableEntityException('ยังไม่มีแหล่งข่าวที่เปิดใช้ — เพิ่ม RSS หรือคำค้นก่อน');
    const results: { sourceId: string; label: string; found: number; added: number; error: string | null }[] = [];
    for (const [i, s] of sources.entries()) {
      if (i > 0 && !this.mock) await new Promise(r => setTimeout(r, 1000));
      let entries: FeedEntry[] = []; let error: string | null = null;
      try {
        if (s.kind === 'RSS' && s.url) entries = (await fetchFeed(s.url, { allowPrivate: this.env.WEB_ALLOW_PRIVATE_TARGETS, timeoutMs: 15_000 })).entries;
        else if (s.kind === 'SEARCH' && s.query) entries = await this.search(workspaceId, s.query, 10);
      } catch (e) { error = (e instanceof Error ? e.message : String(e)).slice(0, 300); }
      const added = error ? 0 : await this.store(workspaceId, brandId, s.id, entries);
      await this.prisma.newsSource.update({ where: { id: s.id }, data: { lastFetchedAt: new Date(), lastError: error, ...(error ? {} : { lastNewCount: added }) } });
      results.push({ sourceId: s.id, label: s.label, found: entries.length, added, error });
    }
    const added = results.reduce((n, r) => n + r.added, 0);
    await this.audit.log({ workspaceId, userId, action: 'news.fetch', resourceType: 'brand', resourceId: brandId, after: { sources: results.length, added, failed: results.filter(r => r.error).length }, requestId });
    return { added, sources: results };
  }

  private async store(workspaceId: string, brandId: string, sourceId: string, entries: FeedEntry[]): Promise<number> {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    const rows: Prisma.NewsItemCreateManyInput[] = []; const seenUrl = new Set<string>(); const seenTitle = new Set<string>();
    for (const e of entries) {
      if (e.publishedAt && e.publishedAt.getTime() < cutoff) continue;
      let canon: string; try { canon = canonicalNewsUrl(e.url); } catch { continue; }
      const urlHash = sha256(canon); const titleHash = sha256(normalizeTitle(e.title));
      if (seenUrl.has(urlHash) || seenTitle.has(titleHash)) continue;
      seenUrl.add(urlHash); seenTitle.add(titleHash);
      rows.push({ workspaceId, brandId, sourceId, url: e.url, urlHash, titleHash, title: e.title, snippet: e.snippet, sourceName: e.sourceName?.slice(0, 120) ?? null, publishedAt: e.publishedAt });
    }
    if (!rows.length) return 0;
    // หัวข้อเดียวกันที่เคยเก็บไว้แล้ว (คนละลิงก์/คนละแหล่ง) ภายใน 14 วัน ถือว่าซ้ำ
    const dupTitles = new Set((await this.prisma.newsItem.findMany({ where: { brandId, titleHash: { in: rows.map(r => r.titleHash) }, fetchedAt: { gte: new Date(Date.now() - TITLE_DEDUPE_DAYS * 86_400_000) } }, select: { titleHash: true } })).map(r => r.titleHash));
    const fresh = rows.filter(r => !dupTitles.has(r.titleHash));
    if (!fresh.length) return 0;
    const r = await this.prisma.newsItem.createMany({ data: fresh, skipDuplicates: true });
    return r.count;
  }

  // ---------- กล่องข่าว ----------
  async listItems(workspaceId: string, q: ListItemsDto) {
    await this.brand(workspaceId, q.brandId);
    const items = await this.prisma.newsItem.findMany({
      where: { brandId: q.brandId, workspaceId, ...(q.status ? { status: q.status } : { status: { not: 'DISMISSED' } }) },
      orderBy: q.status === 'SHORTLISTED' ? [{ score: 'desc' }, { fetchedAt: 'desc' }] : [{ fetchedAt: 'desc' }], take: q.limit, select: ITEM_SELECT,
    });
    const ids = items.map(i => i.contentId).filter((x): x is string => !!x);
    const [contents, assets] = ids.length ? await Promise.all([
      this.prisma.contentItem.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, title: true, caption: true, scheduledAt: true, scheduledLocal: true, publishedAt: true, pageId: true, aiNotes: true, lastError: true } }),
      this.prisma.mediaAsset.findMany({ where: { workspaceId, contentId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { id: true, contentId: true } }),
    ]) : [[], []];
    const imageOf = new Map<string, string>(); for (const a of assets) if (a.contentId && !imageOf.has(a.contentId)) imageOf.set(a.contentId, a.id);
    const byId = new Map(contents.map(c => [c.id, { ...c, imageAssetId: imageOf.get(c.id) ?? null }]));
    return items.map(i => ({ ...i, content: i.contentId ? byId.get(i.contentId) ?? null : null }));
  }

  async updateItem(workspaceId: string, userId: string, id: string, status: 'NEW' | 'SHORTLISTED' | 'DISMISSED', requestId: string) {
    const i = await this.prisma.newsItem.findFirst({ where: { id, workspaceId }, select: { id: true, status: true } });
    if (!i) throw new NotFoundException('ไม่พบข่าว');
    if (i.status === 'DRAFTED') throw new UnprocessableEntityException('ข่าวนี้เขียนเป็นโพสต์แล้ว — จัดการที่ตัวโพสต์แทน');
    const out = await this.prisma.newsItem.update({ where: { id }, data: { status }, select: ITEM_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'news.item.status', resourceType: 'newsItem', resourceId: id, before: { status: i.status }, after: { status }, requestId });
    return out;
  }

  // ---------- AI คัดข่าว (บทบาท research) ----------
  async shortlist(workspaceId: string, userId: string, brandId: string, dto: ShortlistDto, requestId: string) {
    const b = await this.brand(workspaceId, brandId);
    const candidates = await this.prisma.newsItem.findMany({ where: { brandId, workspaceId, status: 'NEW', fetchedAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }, orderBy: [{ publishedAt: 'desc' }, { fetchedAt: 'desc' }], take: 40, select: { id: true, title: true, snippet: true, sourceName: true, publishedAt: true } });
    if (!candidates.length) return { picked: 0, items: [] };
    const ids = new Set(candidates.map(c => c.id));
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'news.shortlist', role: 'research', requestId, promptVersion: NEWS_SHORTLIST_PROMPT, override: dto.modelOverride ?? null, resourceType: 'brand', resourceId: brandId }, {
      system: `คุณคือบรรณาธิการข่าวของเพจ Facebook ภาษาไทย คัดข่าวที่คนดูเพจนี้จะหยุดอ่าน แชร์ หรือคอมเมนต์ (แปลก น่าทึ่ง ใกล้ตัว มีอารมณ์ร่วม มีประโยชน์) ข้ามข่าวประชาสัมพันธ์ ข่าวซ้ำประเด็น และข่าวที่ข้อมูลน้อยเกินจะเขียนได้ ประเมินจากหัวข้อ/เกริ่นที่ให้เท่านั้น ห้ามเดาเนื้อข่าวเพิ่ม ${RISK_RULES}`,
      prompt: `เพจ/แบรนด์: ${b.name}\nแนวเพจ: ${b.description ?? b.industry ?? '-'}\nกลุ่มผู้อ่าน: ${b.targetAudience ?? 'คนไทยทั่วไป'}\nเลือกได้ไม่เกิน ${dto.max} ข่าว เรียงจากน่าสนใจที่สุด\n\nข่าวที่มี:\n${candidates.map(c => JSON.stringify({ id: c.id, title: c.title, source: c.sourceName, publishedAt: c.publishedAt?.toISOString() ?? null, snippet: c.snippet?.slice(0, 300) ?? null })).join('\n')}`,
      schemaDescription: '{ "picks": [{ "id": string (ต้องเป็น id จากรายการ), "score": 0-100, "headlineTh": "หัวข้อภาษาไทยแบบเพจ ≤ 120 ตัวอักษร", "why": "ทำไมคนจะสนใจ", "category": "หมวด เช่น ต่างประเทศ/สัตว์/วิทยาศาสตร์/สังคม", "risk": "LOW"|"HIGH", "riskReasons": [string] }] }',
      validate: v => shortlistOut.parse(v), maxTokens: 3000,
    });
    const picks = out.result.data.picks.filter(p => ids.has(p.id)).slice(0, dto.max);
    for (const p of picks) {
      await this.prisma.newsItem.update({ where: { id: p.id }, data: { status: 'SHORTLISTED', score: p.score, angle: { headlineTh: p.headlineTh, why: p.why, category: p.category, risk: p.risk, riskReasons: p.riskReasons } } });
    }
    await this.audit.log({ workspaceId, userId, action: 'news.shortlist', resourceType: 'brand', resourceId: brandId, after: { candidates: candidates.length, picked: picks.length, provider: out.provider, model: out.model }, requestId });
    return { picked: picks.length, provider: out.provider, model: out.model, costUsd: out.costUsd, items: await this.prisma.newsItem.findMany({ where: { id: { in: picks.map(p => p.id) } }, orderBy: { score: 'desc' }, select: ITEM_SELECT }) };
  }

  // ---------- AI เขียนโพสต์ (บทบาท content) → การ์ด → รออนุมัติ ----------
  async draft(workspaceId: string, userId: string, itemId: string, dto: DraftDto, requestId: string) {
    const item = await this.prisma.newsItem.findFirst({ where: { id: itemId, workspaceId }, select: { id: true, brandId: true, status: true, title: true, snippet: true, url: true, sourceName: true, publishedAt: true, angle: true, contentId: true } });
    if (!item) throw new NotFoundException('ไม่พบข่าว');
    if (item.status === 'DRAFTED' && item.contentId) throw new UnprocessableEntityException('ข่าวนี้เขียนเป็นโพสต์ไปแล้ว');
    const page = await this.prisma.facebookPage.findFirst({ where: { id: dto.pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, name: true, brandId: true, disconnectedAt: true } });
    if (!page || page.disconnectedAt) throw new NotFoundException('ไม่พบเพจ');
    if (page.brandId !== item.brandId) throw new BadRequestException('เพจนี้ไม่ได้อยู่ในแบรนด์เดียวกับข่าว');
    const b = await this.brand(workspaceId, item.brandId);
    const prohibited = await this.prisma.brandKnowledgeItem.findMany({ where: { brandId: b.id, active: true, type: { in: ['brand_voice', 'prohibited_claim'] } }, take: 10, select: { type: true, title: true, content: true } });
    const angle = (item.angle ?? null) as { headlineTh?: string; why?: string; category?: string } | null;
    const source = item.sourceName ?? new URL(item.url).hostname.replace(/^www\./, '');

    const out = await this.ai.structured({ workspaceId, userId, taskType: 'news.write', role: 'content', requestId, promptVersion: NEWS_WRITER_PROMPT, override: dto.modelOverride ?? null, resourceType: 'newsItem', resourceId: item.id }, {
      system: [
        `คุณคือนักเขียนข่าวของเพจ Facebook "${page.name}" เขียนภาษาไทยให้อ่านลื่น ดึงดูดตั้งแต่บรรทัดแรก (hook) เล่าเป็นเรื่อง แบ่งย่อหน้าสั้น อ่านบนมือถือง่าย ใช้อีโมจิได้พอประมาณ`,
        'กฎเหล็ก:',
        '1) ใช้ข้อเท็จจริงจากข้อมูลที่ให้เท่านั้น ห้ามเติมตัวเลข ชื่อคน สถานที่ วันที่ หรือคำพูดที่ไม่มีในข้อมูล ถ้าจำเป็นต้องมีแต่ไม่รู้ ให้เขียน [ต้องยืนยัน: ...] และใส่ในรายการ needsCheck',
        '2) เขียนใหม่ด้วยสำนวนของเพจทั้งหมด ห้ามคัดลอกประโยคจากต้นทางเกิน 8 คำติดกัน และห้ามแปลตรงตัวทั้งย่อหน้า',
        '3) ข่าวอาชญากรรม/อุบัติเหตุ: ห้ามระบุชื่อ-นามสกุลบุคคลธรรมดา ใช้ "ผู้ต้องหา" "ผู้เสียหาย" ห้ามตัดสินว่าใครผิดก่อนศาล ห้ามบรรยายความรุนแรงเกินจำเป็น',
        '4) ห้ามพาดหัวหลอกให้คลิก (clickbait) ที่เนื้อหาไม่ตรงหัวข้อ ห้ามสร้างความตื่นตระหนก',
        '5) ไม่ต้องใส่บรรทัดที่มา/ลิงก์ ระบบจะต่อท้ายให้เอง · ปิดท้ายด้วยคำถามชวนคอมเมนต์ 1 ประโยค',
        `6) ${RISK_RULES}`,
        'card = ข้อความบนการ์ดภาพ 1080×1080: kicker = หมวดสั้น ๆ, headline = พาดหัวสั้นกระชับ ≤ 90 ตัวอักษร ใช้ *คำ* เน้นสีได้ 1 จุด, sub = สรุปหนึ่งประโยค',
        'photoQuery = คำค้นภาพถ่ายภาษาอังกฤษ 2–5 คำสำหรับคลังภาพฟรี เช่น "baby elephant rescue", "space station plants" — เป็นสิ่งของ/สัตว์/สถานที่/บรรยากาศ ห้ามชื่อคน ห้ามคำรุนแรง',
        'imagePrompt = คำสั่งวาดภาพประกอบเป็นภาษาอังกฤษ ≤ 400 ตัวอักษร: ภาพเชิงสัญลักษณ์/บรรยากาศของเรื่อง ห้ามมีบุคคลจริงที่ระบุตัวได้ ห้ามจำลองภาพเหตุการณ์จริงให้ดูเหมือนภาพข่าว ห้ามตัวอักษร โลโก้ เลือด หรือความรุนแรง',
      ].join('\n'),
      prompt: [
        `ข่าวต้นทาง (ใช้เป็นข้อมูลเท่านั้น): ${JSON.stringify({ title: item.title, snippet: item.snippet, source, publishedAt: item.publishedAt?.toISOString() ?? null })}`,
        angle ? `มุมที่บรรณาธิการเลือก: ${JSON.stringify(angle)}` : '',
        `แบรนด์: ${b.name} · แนวเพจ: ${b.description ?? '-'} · น้ำเสียง: ${b.toneOfVoice ?? 'เป็นกันเอง น่าเชื่อถือ'}`,
        prohibited.length ? `ข้อกำหนดของแบรนด์:\n${prohibited.map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 300)}`).join('\n')}` : '',
        dto.hint ? `คำแนะนำเพิ่มเติม: ${dto.hint}` : '',
      ].filter(Boolean).join('\n\n'),
      schemaDescription: '{ "title": "ชื่อเรื่องภายใน ≤ 100", "caption": "โพสต์เต็ม", "hashtags": [≤ 5 คำ ไม่ต้องมี #], "card": { "kicker"?: string ≤ 24, "headline": string ≤ 90, "sub"?: string ≤ 140 }, "risk": "LOW"|"HIGH", "riskReasons": [string], "needsCheck": [string], "photoQuery": string, "imagePrompt": string }',
      validate: v => writerOut.parse(v), maxTokens: 3500,
    });
    const w: WriterOut = out.result.data;
    const needsCheck = [...new Set([...w.needsCheck, ...[...w.caption.matchAll(/\[ต้องยืนยัน[^\]]*\]/g)].map(m => m[0])])];
    const caption = `${w.caption.trim()}\n\nที่มา: ${source}\n${item.url}`;
    const notes = { news: { itemId: item.id, url: item.url, source }, risk: w.risk, riskReasons: w.riskReasons, needsCheck };
    const content = await this.content.create(workspaceId, userId, { pageId: page.id, contentType: 'post', title: w.title, caption, hashtags: w.hashtags.map(h => h.replace(/^#/, '')), mediaBrief: `การ์ดหัวข่าว: ${w.card.headline}`, mediaPaths: [], objective: 'engagement', contentPillar: 'ข่าว' }, requestId, { provider: out.provider, model: out.model, promptVersion: NEWS_WRITER_PROMPT, notes });
    // ภาพประกอบ: stock = ภาพถ่ายจริงจากคลังภาพฟรี (การ์ดใช้ภาพ + แนบภาพเต็มเป็นรูปที่ 2), ai = ภาพจาก AI · ล้มเหลวก็ยังได้การ์ดตัวอักษร พร้อมแจ้งเหตุ
    const errMsg = (e: unknown) => (e as Error & { response?: { message?: string } }).response?.message ?? (e as Error).message;
    const source2 = dto.imageSource ?? (dto.aiImage ? 'ai' : 'none');
    let photo: string | undefined; let photoLabel: string | undefined; let imageError: string | null = null; let stockPath: string | null = null; let credit: string | null = null;
    if (source2 === 'stock') {
      try {
        const q = (w.photoQuery || angle?.category || item.title).slice(0, 80);
        const st = await this.stockPhoto(workspaceId, userId, content.id, q, new Set());
        photo = MediaGenService.dataUrl(st.bytes, st.mimeType); photoLabel = `ภาพ: ${st.credit}`; stockPath = st.asset.path; credit = st.credit;
      } catch (e) { imageError = errMsg(e); }
    } else if (source2 === 'ai') {
      try {
        const g = await this.gen.generate(workspaceId, userId, { contentId: content.id, prompt: w.imagePrompt || `Symbolic editorial illustration about: ${angle?.headlineTh ?? item.title}`, attach: false, override: dto.imageOverride ?? null, idempotencyKey: `news-${item.id}` }, requestId);
        photo = MediaGenService.dataUrl(await readFile(g.asset.path), g.asset.mimeType); photoLabel = 'ภาพประกอบจาก AI';
      } catch (e) { imageError = errMsg(e); }
    }
    // การ์ดหัวข่าว — เรนเดอร์ไม่ได้ (ไม่มี Chromium) ก็ยังได้ร่าง แจ้งเหตุให้เห็น
    let cardError: string | null = null;
    try {
      await this.media.renderCard(workspaceId, userId, content.id, { template: 'news', data: { theme: dto.theme, kicker: w.card.kicker ?? angle?.category ?? 'ข่าว', title: w.card.headline, sub: w.card.sub, footer: `ที่มา: ${source}`, brand: page.name.slice(0, 60), photo, photoLabel }, attach: true }, requestId, { provider: out.provider, model: out.model });
    } catch (e) { cardError = errMsg(e); }
    // การ์ด + ภาพถ่ายเต็มใบ = โพสต์หลายรูป (การ์ดขึ้นก่อน) · เครดิตช่างภาพต่อท้ายโพสต์
    if (stockPath) {
      await this.prisma.contentItem.update({ where: { id: content.id }, data: { mediaPaths: { push: stockPath }, contentType: 'photo', caption: `${caption}
ภาพประกอบ: ${credit}` } });
    }
    const submitted = await this.content.submit(workspaceId, userId, content.id, requestId);
    await this.prisma.newsItem.update({ where: { id: item.id }, data: { status: 'DRAFTED', contentId: content.id } });
    await this.audit.log({ workspaceId, userId, action: 'news.draft', resourceType: 'newsItem', resourceId: item.id, after: { contentId: content.id, pageId: page.id, risk: w.risk, needsCheck: needsCheck.length, cardError, imageError, imageSource: source2, hasPhoto: !!photo, provider: out.provider, model: out.model }, requestId });
    return { content: submitted, risk: w.risk, riskReasons: w.riskReasons, needsCheck, cardError, imageError, imageSource: source2, hasPhoto: !!photo, aiImage: source2 === 'ai' && !!photo, provider: out.provider, model: out.model, costUsd: out.costUsd };
  }
}
