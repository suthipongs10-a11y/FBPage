/**
 * Publisher (§47, §48, §92) — เผยแพร่ ContentItem ที่ APPROVED/SCHEDULED ไปยังเพจ แบบกันซ้ำด้วย ExternalOperation
 * ใช้ทั้งจาก API ("โพสต์ตอนนี้") และ worker (งานตั้งเวลา) — ตรวจ kill switch ทุกครั้งก่อนยิงจริง
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
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
/** ignoreStatus: ตรวจเฉพาะเพจ/สิทธิ์/สวิตช์ฉุกเฉิน — ใช้ตรวจล่วงหน้าก่อนอนุมัติ (ตอนนั้นสถานะยังไม่ใช่ APPROVED) */
export async function publishBlockReason(prisma: PrismaClient, contentId: string, o: { ignoreStatus?: boolean } = {}): Promise<string | null> {
  const c = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { status: true, page: { select: { publishingPaused: true, tokenStatus: true, tasks: true, disconnectedAt: true, brand: { select: { client: { select: { workspace: { select: { automationPaused: true } } } } } } } } } });
  if (!c) return 'ไม่พบคอนเทนต์';
  if (!c.page) return 'คอนเทนต์นี้ไม่ได้ผูกกับเพจ Facebook (publisher ของ YouTube แยกต่างหาก)';
  if (!o.ignoreStatus && !PUBLISHABLE.includes(c.status)) return `สถานะ ${c.status} เผยแพร่ไม่ได้ — ต้องอนุมัติก่อน`;
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
  const c0 = await d.prisma.contentItem.findUniqueOrThrow({ where: { id: contentId }, select: { id: true, updatedAt: true, pageId: true, caption: true, hashtags: true, mediaPaths: true, contentType: true, status: true, retryCount: true, publishedPostId: true, externalPostId: true, scheduledAt: true, page: { select: { brand: { select: { client: { select: { workspaceId: true } } } } } } } });
  if (!c0.pageId || !c0.page) return { status: 'SKIPPED', reason: 'ไม่ได้ผูกกับเพจ Facebook' };
  const c = { ...c0, pageId: c0.pageId, page: c0.page };
  const workspaceId = c.page.brand.client.workspaceId;
  const message = [c.caption ?? '', c.hashtags.length ? c.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ') : ''].filter(Boolean).join('\n\n').trim();
  if (!message && !c.mediaPaths.length) return { status: 'FAILED', error: 'ไม่มีข้อความหรือรูปให้โพสต์', retryable: false };
  const idempotencyKey = `publish:${contentId}`;
  const requestHash = createHash('sha256').update(JSON.stringify({ pageId: c.pageId, message, media: c.mediaPaths })).digest('hex');

  // §48: เคยสร้างโพสต์ไปแล้ว → ไม่ยิงซ้ำ แค่ปิดสถานะให้ตรง
  const existingOp = await d.prisma.externalOperation.findUnique({ where: { idempotencyKey } });
  if (existingOp?.externalId) return finalize(d, c.id, c.pageId, existingOp.externalId, message, true, c.contentType === 'reel' ? 'reel' : undefined);
  // Legacy PENDING and interrupted claims are ambiguous. Never guess ownership
  // from matching captions and never issue a second write without reconciliation.
  // FAILED = รู้แน่ว่า Facebook ไม่ได้สร้างโพสต์ (ปฏิเสธชัดเจน หรือผู้ใช้ตรวจแล้วยืนยันว่าไม่มี) → ส่งใหม่ได้
  if (existingOp && existingOp.status !== 'FAILED') return { status: 'SKIPPED', reason: 'RECONCILIATION_REQUIRED: ตรวจผลที่ Facebook ก่อนส่งอีกครั้ง' };
  const { facebookPageId, token } = await loadPageToken(d, c.pageId);
  const op = await d.prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))::text`;
    const prior = await tx.externalOperation.findUnique({ where: { idempotencyKey } });
    if (prior && (prior.status !== 'FAILED' || prior.externalId)) return null;
    // CAS also rejects edits made after this invocation read the approved draft.
    const claimed = await tx.contentItem.updateMany({ where: { id: c.id, updatedAt: c.updatedAt, status: { in: ['APPROVED', 'SCHEDULED', 'PUBLISH_FAILED'] } }, data: { status: 'PUBLISHING', lastError: null } });
    if (!claimed.count) return null;
    if (prior) return tx.externalOperation.update({ where: { id: prior.id }, data: { requestHash, status: 'IN_FLIGHT', error: null } });
    return tx.externalOperation.create({ data: { workspaceId, provider: 'facebook', operationType: 'publish-post', idempotencyKey, requestHash, status: 'IN_FLIGHT' } });
  });
  if (!op) return { status: 'SKIPPED', reason: 'มีคำขอเผยแพร่อยู่แล้ว หรือเนื้อหาถูกแก้ไข' };
  let r: { externalId: string };
  const reel = c.contentType === 'reel';
  try {
    // ไฟล์ในเครื่องต้องอยู่ในโฟลเดอร์สื่อของระบบเท่านั้น — กันการอ้าง path อื่นของเซิร์ฟเวอร์แล้วส่งไฟล์นั้นขึ้น Facebook
    const local = c.mediaPaths.filter(p => !/^https?:\/\//.test(p));
    const outside = local.find(p => !insideMediaDir(p));
    if (outside) throw new Error(`ไฟล์สื่ออยู่นอกโฟลเดอร์สื่อของระบบ: ${outside.split(/[\\/]/).pop()}`);
    if (reel) {
      const video = local.find(p => /\.(mp4|mov)$/i.test(p));
      if (!video) throw new Error('Reels ต้องแนบไฟล์คลิป (.mp4/.mov) ก่อนโพสต์');
      r = await d.fb.createReel(facebookPageId, token, { video: await readFile(video), description: message });
    } else {
      const photos: PhotoPostInput['photos'] = c.mediaPaths.map(p => (/^https?:\/\//.test(p) ? { url: p } : p));
      r = photos.length ? await d.fb.createPhotoPost(facebookPageId, token, { message, photos }) : await d.fb.createPost(facebookPageId, token, { message });
    }
  } catch (e) {
    const f = classifyPublishError(e);
    const err = f.message;
    const retryable = f.definite && e instanceof FacebookApiError && e.isRateLimited;
    // definite = Facebook ไม่ได้สร้างโพสต์แน่นอน → FAILED (ส่งใหม่ได้) · ไม่แน่ใจ → UNKNOWN (ต้องตรวจที่ Facebook ก่อน กันโพสต์ซ้ำ)
    await d.prisma.externalOperation.updateMany({ where: { id: op.id, externalId: null }, data: { status: f.definite ? 'FAILED' : 'UNKNOWN', error: err } });
    await d.prisma.contentItem.update({ where: { id: c.id }, data: { status: 'PUBLISH_FAILED', retryCount: { increment: 1 }, lastError: err.slice(0, 500) } });
    if (e instanceof FacebookApiError && e.isTokenError) await d.prisma.facebookPage.update({ where: { id: c.pageId }, data: { tokenStatus: 'INVALID' } });
    return { status: 'FAILED', error: err, retryable };
  }
  // โพสต์เกิดขึ้นแล้ว — ถ้าบันทึกฐานข้อมูลล้มตรงนี้ op จะค้าง IN_FLIGHT = ต้องตรวจก่อนส่งซ้ำ (ไม่มีทางโพสต์ซ้ำ)
  await d.prisma.externalOperation.update({ where: { id: op.id }, data: { externalId: r.externalId, status: 'SUCCEEDED', error: null } });
  return finalize(d, c.id, c.pageId, r.externalId, message, false, reel ? 'reel' : undefined);
}

/**
 * แยก "Facebook ปฏิเสธชัดเจน" (ไม่มีโพสต์เกิดขึ้น ส่งใหม่ได้) ออกจาก "ไม่รู้ผล" (อาจโพสต์ไปแล้ว ห้ามส่งซ้ำจนกว่าจะตรวจ)
 * และเก็บข้อความจริงจาก Facebook ไว้ให้ผู้ใช้เห็นว่าติดอะไร (ข้อความ error ของ Graph ไม่มี token)
 */
export function classifyPublishError(e: unknown): { definite: boolean; message: string } {
  if (e instanceof FacebookApiError) {
    if (e.isTokenError || e.isPermissionError) return { definite: true, message: `${e.userMessage} (${e.message}${e.code != null ? `, code ${e.code}` : ''})`.slice(0, 500) };
    // Graph ตอบ error JSON กลับมา (4xx) = คำขอถูกปฏิเสธ ไม่ได้สร้างโพสต์ — ยกเว้น code 1/2 (ข้อผิดพลาดฝั่ง Facebook ที่อาจทำไปแล้ว)
    const rejected = e.httpStatus >= 400 && e.httpStatus < 500 && e.code != null && e.code !== 1 && e.code !== 2;
    if (rejected) return { definite: true, message: `Facebook ปฏิเสธโพสต์: ${e.message} (code ${e.code}${e.subcode ? `/${e.subcode}` : ''})`.slice(0, 500) };
    return { definite: false, message: `RECONCILIATION_REQUIRED: ไม่ยืนยันผลการส่ง กรุณาตรวจสอบที่ Facebook (${e.message})`.slice(0, 500) };
  }
  // ผิดพลาดในเครื่องก่อนยิง Facebook (เช่น หาไฟล์รูปไม่เจอ) → ยังไม่มีอะไรไปถึงเพจ
  return { definite: true, message: `เตรียมโพสต์ไม่สำเร็จ: ${(e as Error)?.message ?? String(e)}`.slice(0, 500) };
}

async function finalize(d: SyncDeps, contentId: string, pageId: string, externalId: string, message: string, duplicateRecovered: boolean, mediaType = 'status'): Promise<PublishOutcome> {
  const permalink = mediaType === 'reel' ? `https://www.facebook.com/reel/${externalId}` : `https://www.facebook.com/${externalId}`;
  const post = await d.prisma.facebookPost.upsert({
    where: { pageId_facebookPostId: { pageId, facebookPostId: externalId } },
    create: { pageId, facebookPostId: externalId, message, permalink, publishedAt: new Date(), source: 'app', mediaType },
    update: { source: 'app' }, select: { id: true },
  });
  await d.prisma.contentItem.update({ where: { id: contentId }, data: { status: 'PUBLISHED', publishedPostId: post.id, externalPostId: externalId, publishedAt: new Date(), lastError: null } as Prisma.ContentItemUncheckedUpdateInput });
  return { status: 'PUBLISHED', externalId, permalink, postId: post.id, duplicateRecovered };
}

/** path อยู่ใต้ MEDIA_DIR (ค่าเดียวกับ API/worker) */
export function insideMediaDir(p: string, mediaDir = process.env.MEDIA_DIR ?? './data/media'): boolean {
  const root = resolve(mediaDir);
  const full = resolve(p);
  return full === root || full.startsWith(root + sep);
}
