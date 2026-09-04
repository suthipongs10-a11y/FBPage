import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { pageInWorkspace } from '@fbpm/database';
import { FacebookApiError, toSnapshot, type FacebookService, type MetricAvailability } from '@fbpm/facebook-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { decryptSecret } from '../common/crypto';
import { FACEBOOK } from './facebook.provider';
import { rethrowGraph } from './graph-errors';

export interface SyncResult { imported: number; updated: number; total: number; availability: MetricAvailability; syncedAt: Date }

/** ดึงข้อมูลเพจ + โพสต์ย้อนหลัง + บันทึก metric snapshot (§46 facebook-sync, §60) — ค่าที่อ่านไม่ได้เป็น null */
@Injectable()
export class SyncService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(FACEBOOK) private readonly fb: FacebookService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async pageToken(workspaceId: string, pageId: string): Promise<{ id: string; facebookPageId: string; token: string }> {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, facebookPageId: true, pageAccessTokenEncrypted: true, disconnectedAt: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    if (page.disconnectedAt || !page.pageAccessTokenEncrypted) throw new UnprocessableEntityException('เพจนี้ถูกตัดการเชื่อมต่อแล้ว — เชื่อมต่อใหม่ก่อน');
    return { id: page.id, facebookPageId: page.facebookPageId, token: decryptSecret(page.pageAccessTokenEncrypted, this.env.AUTH_SECRET) };
  }

  async syncPage(workspaceId: string, pageId: string, opts: { days?: number; limit?: number } = {}): Promise<SyncResult> {
    const { facebookPageId, token } = await this.pageToken(workspaceId, pageId);
    const days = opts.days ?? 90;
    const since = new Date(Date.now() - days * 86_400_000);
    try {
      const details = await this.fb.getPage(facebookPageId, token);
      const { posts, availability } = await this.fb.getPosts(facebookPageId, token, { since, limit: opts.limit ?? 200 });
      const capturedAt = new Date();
      let imported = 0; let updated = 0;
      for (const p of posts) {
        const fields = { message: p.message, mediaType: p.mediaType, permalink: p.permalink, publishedAt: p.createdTime, rawData: p.raw as unknown as Prisma.InputJsonValue, syncStatus: 'OK' };
        const existing = await this.prisma.facebookPost.findUnique({ where: { pageId_facebookPostId: { pageId, facebookPostId: p.id } }, select: { id: true } });
        const row = existing
          ? await this.prisma.facebookPost.update({ where: { id: existing.id }, data: fields, select: { id: true } })
          : await this.prisma.facebookPost.create({ data: { pageId, facebookPostId: p.id, source: 'imported', ...fields }, select: { id: true } });
        if (existing) updated++; else imported++;
        await this.prisma.postMetricSnapshot.create({ data: { postId: row.id, capturedAt, metrics: toSnapshot(p.metrics) as Prisma.InputJsonValue, apiVersion: this.env.META_GRAPH_API_VERSION } });
      }
      await this.prisma.facebookPage.update({
        where: { id: pageId },
        data: { name: details.name, username: details.username, category: details.category, pictureUrl: details.pictureUrl, link: details.link, fanCount: details.fanCount, profile: details.raw as Prisma.InputJsonValue, lastSyncedAt: capturedAt, lastSyncError: null, tokenStatus: 'VALID', lastValidatedAt: capturedAt },
      });
      return { imported, updated, total: posts.length, availability, syncedAt: capturedAt };
    } catch (e) {
      const msg = e instanceof FacebookApiError ? e.userMessage : e instanceof Error ? e.message : String(e);
      await this.prisma.facebookPage.update({ where: { id: pageId }, data: { lastSyncError: msg.slice(0, 500), ...(e instanceof FacebookApiError && e.isTokenError && { tokenStatus: 'INVALID' }) } });
      rethrowGraph(e);
    }
  }
}
