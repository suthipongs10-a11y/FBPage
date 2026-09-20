import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { brandInWorkspace, pageInWorkspace } from '@fbpm/database';
import { pageCompleteness, type FacebookService, type MetricSnapshot } from '@fbpm/facebook-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { encryptSecret } from '../common/crypto';
import { FACEBOOK } from './facebook.provider';
import { ConnectionsService } from './connections.service';
import { SyncService } from './sync.service';
import { rethrowGraph } from './graph-errors';
import type { ConnectPageDto, UpdatePageDto } from './dto';

const PAGE_SELECT = {
  id: true, brandId: true, connectionId: true, facebookPageId: true, name: true, username: true, category: true, pictureUrl: true, link: true, fanCount: true,
  tokenStatus: true, tasks: true, automationLevel: true, publishingPaused: true, timezone: true, connectedAt: true, lastSyncedAt: true, lastSyncError: true, lastValidatedAt: true, disconnectedAt: true, commentsStatus: true, commentsSyncedAt: true,
  brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
  _count: { select: { posts: true } },
} as const;

/** เพจที่เชื่อมกับแบรนด์ — ทุก lookup ผ่าน pageInWorkspace (§57); page token ไม่เคยอยู่ใน select */
@Injectable()
export class PagesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(FACEBOOK) private readonly fb: FacebookService,
    @Inject(ENV) private readonly env: Env,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConnectionsService) private readonly connections: ConnectionsService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  list(workspaceId: string) {
    return this.prisma.facebookPage.findMany({ where: pageInWorkspace(workspaceId), orderBy: [{ disconnectedAt: 'asc' }, { connectedAt: 'desc' }], select: PAGE_SELECT });
  }

  async get(workspaceId: string, pageId: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { ...PAGE_SELECT, profile: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [posts30d, latest] = await Promise.all([
      this.prisma.facebookPost.count({ where: { pageId, publishedAt: { gte: since30 } } }),
      this.prisma.postMetricSnapshot.findFirst({ where: { post: { pageId } }, orderBy: { capturedAt: 'desc' }, select: { metrics: true, capturedAt: true } }),
    ]);
    const m = (latest?.metrics ?? null) as MetricSnapshot | null;
    const availability = m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.value !== null])) : null;
    const { profile, ...rest } = page;
    return { ...rest, profile, completeness: pageCompleteness((profile as Record<string, unknown> | null) ?? {}), stats: { posts30d, availability, lastCapturedAt: latest?.capturedAt ?? null } };
  }

  /** ผูกเพจจากบัญชีที่เชื่อมไว้เข้ากับแบรนด์ แล้วดึงประวัติ 90 วันทันที */
  async connect(workspaceId: string, userId: string, brandId: string, dto: ConnectPageDto, requestId: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id: brandId, ...brandInWorkspace(workspaceId) }, select: { id: true } });
    if (!brand) throw new NotFoundException('ไม่พบแบรนด์');
    const userToken = await this.connections.userToken(workspaceId, dto.connectionId);
    const pages = await this.fb.listPages(userToken).catch(rethrowGraph);
    const p = pages.find(x => x.id === dto.facebookPageId);
    if (!p) throw new NotFoundException('ไม่พบเพจนี้ในบัญชี Facebook ที่เชื่อมไว้ — ตรวจว่าบัญชีเป็นแอดมินของเพจ');
    const dup = await this.prisma.facebookPage.findFirst({ where: { facebookPageId: p.id, disconnectedAt: null, brandId: { not: brandId }, ...pageInWorkspace(workspaceId) }, select: { brand: { select: { name: true } } } });
    if (dup) throw new ConflictException(`เพจนี้เชื่อมกับแบรนด์ "${dup.brand.name}" อยู่แล้ว — ตัดการเชื่อมต่อจากแบรนด์เดิมก่อน`);
    const details = await this.fb.getPage(p.id, p.accessToken).catch(rethrowGraph);
    const data = {
      connectionId: dto.connectionId, name: details.name, username: details.username, category: details.category ?? p.category, pictureUrl: details.pictureUrl ?? p.pictureUrl, link: details.link, fanCount: details.fanCount,
      pageAccessTokenEncrypted: encryptSecret(p.accessToken, this.env.AUTH_SECRET), tokenStatus: 'VALID', tasks: p.tasks, profile: details.raw as Prisma.InputJsonValue,
      lastValidatedAt: new Date(), disconnectedAt: null, lastSyncError: null,
    };
    const page = await this.prisma.facebookPage.upsert({ where: { brandId_facebookPageId: { brandId, facebookPageId: p.id } }, create: { brandId, facebookPageId: p.id, ...data }, update: data, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: 'facebook.page.connect', resourceType: 'facebookPage', resourceId: page.id, after: { facebookPageId: p.id, name: details.name, brandId, tasks: p.tasks }, requestId });
    const initialSync = await this.sync.syncPage(workspaceId, page.id, { days: 90 }).then(r => ({ ok: true as const, ...r })).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    return { ...(await this.get(workspaceId, page.id)), initialSync };
  }

  async update(workspaceId: string, userId: string, pageId: string, dto: UpdatePageDto, requestId: string) {
    const before = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { automationLevel: true, publishingPaused: true, timezone: true } });
    if (!before) throw new NotFoundException('ไม่พบเพจ');
    const page = await this.prisma.facebookPage.update({ where: { id: pageId }, data: dto, select: PAGE_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'facebook.page.update', resourceType: 'facebookPage', resourceId: pageId, before, after: dto, requestId });
    return page;
  }

  async validate(workspaceId: string, pageId: string) {
    const { facebookPageId, token } = await this.sync.pageToken(workspaceId, pageId);
    const r = await this.fb.validatePageToken(facebookPageId, token);
    await this.prisma.facebookPage.update({ where: { id: pageId }, data: { tokenStatus: r.valid ? 'VALID' : 'INVALID', lastValidatedAt: new Date(), ...(r.valid ? { lastSyncError: null } : { lastSyncError: r.error ?? null }) } });
    return r;
  }

  async runSync(workspaceId: string, userId: string, pageId: string, days: number | undefined, requestId: string) {
    const r = await this.sync.syncPage(workspaceId, pageId, { days });
    await this.audit.log({ workspaceId, userId, action: 'facebook.page.sync', resourceType: 'facebookPage', resourceId: pageId, after: { days: days ?? 90, imported: r.imported, updated: r.updated, availability: r.availability }, requestId });
    return r;
  }

  /** ตัดการเชื่อมต่อ: ลบ page token, เก็บโพสต์/metric ไว้เป็นประวัติ */
  async disconnect(workspaceId: string, userId: string, pageId: string, requestId: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, name: true, facebookPageId: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    await this.prisma.facebookPage.update({ where: { id: pageId }, data: { pageAccessTokenEncrypted: '', tokenStatus: 'DISCONNECTED', disconnectedAt: new Date(), publishingPaused: true } });
    await this.audit.log({ workspaceId, userId, action: 'facebook.page.disconnect', resourceType: 'facebookPage', resourceId: pageId, before: { name: page.name, facebookPageId: page.facebookPageId }, requestId });
    return { ok: true };
  }

  async posts(workspaceId: string, pageId: string, limit = 50) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    const rows = await this.prisma.facebookPost.findMany({
      where: { pageId }, orderBy: { publishedAt: 'desc' }, take: Math.min(200, Math.max(1, limit)),
      select: { id: true, facebookPostId: true, message: true, mediaType: true, permalink: true, publishedAt: true, source: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { metrics: true, capturedAt: true } } },
    });
    return rows.map(({ snapshots, ...r }) => ({ ...r, metrics: (snapshots[0]?.metrics ?? null) as MetricSnapshot | null, capturedAt: snapshots[0]?.capturedAt ?? null }));
  }
}
