/**
 * Publisher (§47, §48, §92) — เผยแพร่ ContentItem ที่ APPROVED/SCHEDULED ไปยังเพจ แบบกันซ้ำด้วย ExternalOperation
 * ใช้ทั้งจาก API ("โพสต์ตอนนี้") และ worker (งานตั้งเวลา) — ตรวจ kill switch ทุกครั้งก่อนยิงจริง
 */
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@fbpm/database';
import type { PhotoPostInput } from './facebook.service';
import { FacebookApiError } from './graph-client';
import { loadPageToken, type SyncDeps } from './sync';

export type PublishOutcome =
  | { status: 'PUBLISHED'; externalId: string; permalink: string; postId: string; duplicateRecovered: boolean }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; error: string; retryable: boolean };

const PUBLISHABLE = ['APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISH_FAILED'];

/** เหตุผลที่ห้ามโพสต์ตอนนี้ (kill switch / สิทธิ์ / token) — null = โพสต์ได้ */
export async function publishBlockReason(prisma: PrismaClient, contentId: string): Promise<string | null> {
  const c = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { status: true, page: { select: { publishingPaused: true, tokenStatus: true, tasks: true, disconnectedAt: true, brand: { select: { client: { select: { workspace: { select: { automationPaused: true } } } } } } } } } });
  if (!c) return 'ไม่พบคอนเทนต์';
  if (!c.page) return 'คอนเทนต์นี้ไม่ได้ผูกกับเพจ Facebook (publisher ของ YouTube แยกต่างหาก)';
  if (!PUBLISHABLE.includes(c.status)) return `สถานะ ${c.status} เผยแพร่ไม่ได้ — ต้องอนุมัติก่อน`;
  if (c.page.brand.client.workspace.automationPaused) return 'ระบบอัตโนมัติของ workspace ถูกหยุดไว้ (สวิตช์ฉุกเฉิน)';
  if (c.page.publishingPaused) return 'เพจนี้ถูกหยุดการโพสต์ไว้';
  if (c.page.disconnectedAt) return 'เพจถูกตัดการเชื่อมต่อแล้ว';
  if (c.page.tokenStatus !== 'VALID') return 'token ของเพจใช้ไม่ได้ — เชื่อมต่อใหม่ก่อน';
  if (!c.page.tasks.includes('CREATE_CONTENT')) return 'บัญชีที่เชื่อมไม่มีสิทธิ์ CREATE_CONTENT บนเพจนี้';
  return null;
}

export async function publishContent(d: SyncDeps, contentId: string, _opts: { requestId: string; scheduledPublish?: boolean } = { requestId: 'n/a' }): Promise<PublishOutcome> {
  const blocked = await publishBlockReason(d.prisma, contentId);
  if (blocked) return { status: 'SKIPPED', reason: blocked };
  const c0 = await d.prisma.contentItem.findUniqueOrThrow({ where: { id: contentId }, select: { id: true, updatedAt: true, pageId: true, caption: true, hashtags: true, mediaPaths: true, status: true, retryCount: true, publishedPostId: true, externalPostId: true, scheduledAt: true, page: { select: { brand: { select: { client: { select: { workspaceId: true } } } } } } } });
  if (!c0.pageId || !c0.page) return { status: 'SKIPPED', reason: 'ไม่ได้ผูกกับเพจ Facebook' };
  const c = { ...c0, pageId: c0.pageId, page: c0.page };
  const workspaceId = c.page.brand.client.workspaceId;
  const message = [c.caption ?? '', c.hashtags.length ? c.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ') : ''].filter(Boolean).join('\n\n').trim();
  if (!message && !c.mediaPaths.length) return { status: 'FAILED', error: 'ไม่มีข้อความหรือรูปให้โพสต์', retryable: false };
  const idempotencyKey = `publish:${contentId}`;
  const requestHash = createHash('sha256').update(JSON.stringify({ pageId: c.pageId, message, media: c.mediaPaths })).digest('hex');

  // §48: เคยสร้างโพสต์ไปแล้ว → ไม่ยิงซ้ำ แค่ปิดสถานะให้ตรง
  const existingOp = await d.prisma.externalOperation.findUnique({ where: { idempotencyKey } });
  if (existingOp?.externalId) return finalize(d, c.id, c.pageId, existingOp.externalId, message, true);
  // Legacy PENDING and interrupted claims are ambiguous. Never guess ownership
  // from matching captions and never issue a second write without reconciliation.
  if (existingOp) return { status: 'SKIPPED', reason: 'RECONCILIATION_REQUIRED: ตรวจผลที่ Facebook ก่อนส่งอีกครั้ง' };
  const { facebookPageId, token } = await loadPageToken(d, c.pageId);
  const op = await d.prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))::text`;
    if (await tx.externalOperation.findUnique({ where: { idempotencyKey } })) return null;
    // CAS also rejects edits made after this invocation read the approved draft.
    const claimed = await tx.contentItem.updateMany({ where: { id: c.id, updatedAt: c.updatedAt, status: { in: ['APPROVED', 'SCHEDULED', 'PUBLISH_FAILED'] } }, data: { status: 'PUBLISHING', lastError: null } });
    if (!claimed.count) return null;
    return tx.externalOperation.create({ data: { workspaceId, provider: 'facebook', operationType: 'publish-post', idempotencyKey, requestHash, status: 'IN_FLIGHT' } });
  });
  if (!op) return { status: 'SKIPPED', reason: 'มีคำขอเผยแพร่อยู่แล้ว หรือเนื้อหาถูกแก้ไข' };
  try {
    const photos: PhotoPostInput['photos'] = c.mediaPaths.map(p => (/^https?:\/\//.test(p) ? { url: p } : p));
    const r = photos.length ? await d.fb.createPhotoPost(facebookPageId, token, { message, photos }) : await d.fb.createPost(facebookPageId, token, { message });
    await d.prisma.externalOperation.update({ where: { id: op.id }, data: { externalId: r.externalId, status: 'SUCCEEDED', error: null } });
    return finalize(d, c.id, c.pageId, r.externalId, message, false);
  } catch (e) {
    const err = e instanceof FacebookApiError && (e.isTokenError || e.isPermissionError) ? e.userMessage : 'RECONCILIATION_REQUIRED: ไม่ยืนยันผลการส่ง กรุณาตรวจสอบที่ Facebook';
    const retryable = false;
    await d.prisma.externalOperation.updateMany({ where: { id: op.id, externalId: null }, data: { status: 'UNKNOWN', error: err } });
    await d.prisma.contentItem.update({ where: { id: c.id }, data: { status: 'PUBLISH_FAILED', retryCount: { increment: 1 }, lastError: err.slice(0, 500) } });
    if (e instanceof FacebookApiError && e.isTokenError) await d.prisma.facebookPage.update({ where: { id: c.pageId }, data: { tokenStatus: 'INVALID' } });
    return { status: 'FAILED', error: err, retryable };
  }
}

async function finalize(d: SyncDeps, contentId: string, pageId: string, externalId: string, message: string, duplicateRecovered: boolean): Promise<PublishOutcome> {
  const permalink = `https://www.facebook.com/${externalId}`;
  const post = await d.prisma.facebookPost.upsert({
    where: { pageId_facebookPostId: { pageId, facebookPostId: externalId } },
    create: { pageId, facebookPostId: externalId, message, permalink, publishedAt: new Date(), source: 'app', mediaType: 'status' },
    update: { source: 'app' }, select: { id: true },
  });
  await d.prisma.contentItem.update({ where: { id: contentId }, data: { status: 'PUBLISHED', publishedPostId: post.id, externalPostId: externalId, publishedAt: new Date(), lastError: null } as Prisma.ContentItemUncheckedUpdateInput });
  return { status: 'PUBLISHED', externalId, permalink, postId: post.id, duplicateRecovered };
}
