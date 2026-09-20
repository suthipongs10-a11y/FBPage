/**
 * ซิงก์เพจ + โพสต์ + metric snapshot — ใช้ร่วมกันระหว่าง API (กดซิงก์) และ worker (ซิงก์ตามรอบ / เก็บ metric หลังโพสต์) (§46, §60)
 */
import type { Prisma, PrismaClient } from '@fbpm/database';
import { decryptSecret } from '@fbpm/database';
import type { FacebookService } from './facebook.service';
import { FacebookApiError } from './graph-client';
import { toSnapshot, type MetricAvailability } from './metrics';

export interface SyncDeps { prisma: PrismaClient; fb: FacebookService; authSecret: string; apiVersion: string }
export interface SyncPageResult { imported: number; updated: number; total: number; availability: MetricAvailability; syncedAt: Date }
export class PageNotSyncable extends Error { constructor(msg: string) { super(msg); this.name = 'PageNotSyncable'; } }

/** page token ที่ถอดรหัสแล้ว — ใช้ภายในเซิร์ฟเวอร์เท่านั้น */
export async function loadPageToken(d: Pick<SyncDeps, 'prisma' | 'authSecret'>, pageId: string): Promise<{ id: string; facebookPageId: string; token: string; name: string }> {
  const page = await d.prisma.facebookPage.findUnique({ where: { id: pageId }, select: { id: true, name: true, facebookPageId: true, pageAccessTokenEncrypted: true, disconnectedAt: true } });
  if (!page) throw new PageNotSyncable('ไม่พบเพจ');
  if (page.disconnectedAt || !page.pageAccessTokenEncrypted) throw new PageNotSyncable('เพจนี้ถูกตัดการเชื่อมต่อแล้ว — เชื่อมต่อใหม่ก่อน');
  return { id: page.id, name: page.name, facebookPageId: page.facebookPageId, token: decryptSecret(page.pageAccessTokenEncrypted, d.authSecret) };
}

export async function syncPage(d: SyncDeps, pageId: string, opts: { days?: number; limit?: number } = {}): Promise<SyncPageResult> {
  const { facebookPageId, token } = await loadPageToken(d, pageId);
  const since = new Date(Date.now() - (opts.days ?? 90) * 86_400_000);
  try {
    const details = await d.fb.getPage(facebookPageId, token);
    const { posts, availability } = await d.fb.getPosts(facebookPageId, token, { since, limit: opts.limit ?? 200 });
    const capturedAt = new Date();
    let imported = 0; let updated = 0;
    for (const p of posts) {
      const fields = { message: p.message, mediaType: p.mediaType, permalink: p.permalink, publishedAt: p.createdTime, rawData: p.raw as unknown as Prisma.InputJsonValue, syncStatus: 'OK' };
      const existing = await d.prisma.facebookPost.findUnique({ where: { pageId_facebookPostId: { pageId, facebookPostId: p.id } }, select: { id: true } });
      const row = existing
        ? await d.prisma.facebookPost.update({ where: { id: existing.id }, data: fields, select: { id: true } })
        : await d.prisma.facebookPost.create({ data: { pageId, facebookPostId: p.id, source: 'imported', ...fields }, select: { id: true } });
      if (existing) updated++; else imported++;
      await d.prisma.postMetricSnapshot.create({ data: { postId: row.id, capturedAt, metrics: toSnapshot(p.metrics) as Prisma.InputJsonValue, apiVersion: d.apiVersion } });
    }
    await d.prisma.facebookPage.update({
      where: { id: pageId },
      data: { name: details.name, username: details.username, category: details.category, pictureUrl: details.pictureUrl, link: details.link, fanCount: details.fanCount, profile: details.raw as Prisma.InputJsonValue, lastSyncedAt: capturedAt, lastSyncError: null, tokenStatus: 'VALID', lastValidatedAt: capturedAt },
    });
    return { imported, updated, total: posts.length, availability, syncedAt: capturedAt };
  } catch (e) {
    const msg = e instanceof FacebookApiError ? e.userMessage : e instanceof Error ? e.message : String(e);
    await d.prisma.facebookPage.update({ where: { id: pageId }, data: { lastSyncError: msg.slice(0, 500), ...(e instanceof FacebookApiError && e.isTokenError && { tokenStatus: 'INVALID' }) } });
    throw e;
  }
}

/** เก็บ metric ของโพสต์เดียว (หลังเผยแพร่ 24 ชม./72 ชม. §31 "Metrics collected") */
export async function collectPostMetrics(d: SyncDeps, postId: string): Promise<{ ok: boolean; availability?: MetricAvailability }> {
  const post = await d.prisma.facebookPost.findUnique({ where: { id: postId }, select: { id: true, pageId: true, facebookPostId: true, publishedAt: true } });
  if (!post) return { ok: false };
  const { facebookPageId, token } = await loadPageToken(d, post.pageId);
  const since = post.publishedAt ? new Date(post.publishedAt.getTime() - 60_000) : undefined;
  const { posts, availability } = await d.fb.getPosts(facebookPageId, token, { since, limit: 50 });
  const p = posts.find(x => x.id === post.facebookPostId);
  if (!p) return { ok: false, availability };
  await d.prisma.postMetricSnapshot.create({ data: { postId: post.id, capturedAt: new Date(), metrics: toSnapshot(p.metrics) as Prisma.InputJsonValue, apiVersion: d.apiVersion } });
  return { ok: true, availability };
}
