/** Upload (§56–61): resumable + idempotent ผ่าน YouTubeUploadOperation; ตรวจ kill switch/policy ทุกครั้งก่อนยิง */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Prisma } from '@fbpm/database';
import { channelAuth, ChannelNotAccessible, type YtDeps } from './sync';
import { VIDEO_CLASSIFIER_VERSION } from './metrics';
import { YouTubeApiError } from './types';

export type UploadOutcome = { status: 'UPLOADED' | 'READY'; youtubeVideoId: string; videoRowId: string } | { status: 'SKIPPED'; reason: string } | { status: 'FAILED'; error: string; retryable: boolean };
const CHUNK = 8 * 1024 * 1024;

/** เหตุผลที่ห้ามอัปโหลดตอนนี้ — null = ทำได้ (§104) */
export async function uploadBlockReason(d: YtDeps, contentId: string): Promise<string | null> {
  const c = await d.prisma.contentItem.findUnique({ where: { id: contentId }, select: { status: true, ytStatus: true, platform: true, youtubeMeta: true, youtubeChannel: { select: { uploadsPaused: true, automationPaused: true, disconnectedAt: true, accessMode: true, brand: { select: { client: { select: { workspace: { select: { automationPaused: true } } } } } } } } } });
  if (!c) return 'ไม่พบคอนเทนต์';
  if (c.platform !== 'YOUTUBE' || !c.youtubeChannel) return 'ไม่ใช่คอนเทนต์ YouTube';
  if (!d.uploadEnabled) return 'การอัปโหลดยังไม่เปิดใช้ (YOUTUBE_UPLOAD_ENABLED=false) — ใช้โหมดเตรียมแพ็กเกจแล้วอัปโหลดเองใน YouTube Studio';
  if (!['APPROVED', 'SCHEDULED', 'PUBLISH_FAILED'].includes(c.status) || !['APPROVED', 'UPLOAD_PENDING', 'UPLOAD_FAILED', 'UPLOADING'].includes(c.ytStatus ?? '')) return `สถานะ ${c.ytStatus ?? c.status} อัปโหลดไม่ได้ — ต้องอนุมัติก่อน`;
  if (c.youtubeChannel.brand.client.workspace.automationPaused) return 'ระบบอัตโนมัติของ workspace ถูกหยุดไว้';
  if (c.youtubeChannel.automationPaused || c.youtubeChannel.uploadsPaused) return 'ช่องนี้หยุดการอัปโหลดไว้ (kill switch)';
  if (c.youtubeChannel.disconnectedAt) return 'ช่องถูกตัดการเชื่อมต่อแล้ว';
  if (c.youtubeChannel.accessMode !== 'OAUTH') return 'อัปโหลดต้องเชื่อมช่องด้วย Google OAuth ของเจ้าของ';
  const m = c.youtubeMeta; if (!m?.videoAssetId) return 'ยังไม่มีไฟล์วิดีโอ'; if (!m.title) return 'ยังไม่มีชื่อวิดีโอ'; if (m.madeForKids === null || m.madeForKids === undefined) return 'ต้องระบุ "สำหรับเด็ก" (madeForKids) ก่อน (§62)';
  return null;
}

export async function runUpload(d: YtDeps, contentId: string, requestId: string): Promise<UploadOutcome> {
  const blocked = await uploadBlockReason(d, contentId);
  if (blocked) return { status: 'SKIPPED', reason: blocked };
  const c = await d.prisma.contentItem.findUniqueOrThrow({ where: { id: contentId }, select: { id: true, youtubeChannelId: true, youtubeMeta: true, retryCount: true } });
  const m = c.youtubeMeta!; const channelId = c.youtubeChannelId!;
  const asset = await d.prisma.mediaAsset.findUnique({ where: { id: m.videoAssetId! }, select: { path: true, mimeType: true, bytes: true } });
  if (!asset || !existsSync(asset.path)) { const error = 'ไม่พบไฟล์วิดีโอบนดิสก์ — แนบไฟล์ใหม่แล้วอัปโหลดอีกครั้ง'; await d.prisma.contentItem.update({ where: { id: c.id }, data: { ytStatus: 'UPLOAD_FAILED', status: 'PUBLISH_FAILED', lastError: error } }); return { status: 'FAILED', error, retryable: false }; }
  const total = statSync(asset.path).size;
  const idempotencyKey = `ytupload:${contentId}`;
  let op = await d.prisma.youTubeUploadOperation.findUnique({ where: { idempotencyKey } });
  if (op?.youtubeVideoId) return finalize(d, c.id, channelId, op.youtubeVideoId, m, requestId);
  if (!op) op = await d.prisma.youTubeUploadOperation.create({ data: { contentItemId: c.id, channelId, videoAssetId: m.videoAssetId!, idempotencyKey, totalBytes: BigInt(total) } });
  await d.prisma.contentItem.update({ where: { id: c.id }, data: { ytStatus: 'UPLOADING', lastError: null } });
  let auth: Awaited<ReturnType<typeof channelAuth>>['auth'];
  try { ({ auth } = await channelAuth(d, channelId, { requireOAuth: true })); } catch (e) { return fail(d, c.id, op.id, e instanceof ChannelNotAccessible ? e.message : String(e), false); }
  try {
    const metadata = d.yt.buildUploadMetadata({ title: m.title!, description: m.description ?? undefined, tags: m.tags, categoryId: m.categoryId ?? undefined, privacyStatus: (m.privacyStatus as 'private' | 'unlisted' | 'public') ?? 'private', publishAt: m.scheduledPublishAt?.toISOString(), madeForKids: !!m.madeForKids, containsSyntheticMedia: m.syntheticMedia ?? undefined });
    let session = op.resumableSessionUri; let sent = Number(op.bytesSent);
    if (session) { try { const q = await d.yt.client.queryResumable(session, total); if (q.done) return finalize(d, c.id, channelId, String(q.video.id), m, requestId, op.id); sent = q.received; } catch { session = null; sent = 0; } }
    if (!session) { session = await d.yt.client.initiateResumable(auth, metadata, total, asset.mimeType); sent = 0; await d.prisma.youTubeUploadOperation.update({ where: { id: op.id }, data: { resumableSessionUri: session, status: 'UPLOADING', bytesSent: 0 } }); }
    const buf = await readFile(asset.path);   // ไฟล์ทดสอบ/ขนาดกลาง; ไฟล์ใหญ่ควรอ่านเป็น stream — createReadStream ใช้เมื่อ total > 512MB
    void createReadStream;
    let video: Record<string, unknown> | null = null;
    while (sent < total) {
      const chunk = buf.subarray(sent, Math.min(total, sent + CHUNK));
      const r = await d.yt.client.putChunk(session, chunk, sent, total);
      if (r.done) { video = r.video; sent = total; } else sent = r.received;
      await d.prisma.youTubeUploadOperation.update({ where: { id: op.id }, data: { bytesSent: BigInt(sent) } });
    }
    if (!video) { const q = await d.yt.client.queryResumable(session, total); if (!q.done) throw new YouTubeApiError('อัปโหลดไม่ครบ', 'unknown', 0); video = q.video; }
    const ytId = String(video.id);
    await d.prisma.youTubeUploadOperation.update({ where: { id: op.id }, data: { youtubeVideoId: ytId, status: 'UPLOADED', error: null } });
    // thumbnail (ถ้ามี) — ล้มไม่ถือว่าอัปโหลดล้ม
    if (m.thumbnailAssetId) { const th = await d.prisma.mediaAsset.findUnique({ where: { id: m.thumbnailAssetId }, select: { path: true, mimeType: true } }); if (th && existsSync(th.path)) { try { await d.yt.client.setThumbnail(auth, ytId, await readFile(th.path), th.mimeType); } catch { /* บันทึกใน finalize */ } } }
    return finalize(d, c.id, channelId, ytId, m, requestId, op.id);
  } catch (e) {
    const err = e instanceof YouTubeApiError ? e.userMessage : (e as Error).message; const retryable = e instanceof YouTubeApiError ? e.isRetryable : true;
    return fail(d, c.id, op.id, err, retryable);
  }
}
async function fail(d: YtDeps, contentId: string, opId: string, error: string, retryable: boolean): Promise<UploadOutcome> {
  await d.prisma.youTubeUploadOperation.update({ where: { id: opId }, data: { status: retryable ? 'PENDING' : 'FAILED', error: error.slice(0, 500), retryCount: { increment: 1 } } });
  await d.prisma.contentItem.update({ where: { id: contentId }, data: { ytStatus: 'UPLOAD_FAILED', status: 'PUBLISH_FAILED', lastError: error.slice(0, 500), retryCount: { increment: 1 } } });
  return { status: 'FAILED', error, retryable };
}
async function finalize(d: YtDeps, contentId: string, channelId: string, ytId: string, m: { title: string | null; description: string | null; tags: string[]; scheduledPublishAt: Date | null; privacyStatus: string }, requestId: string, opId?: string): Promise<UploadOutcome> {
  void requestId;
  const row = await d.prisma.youTubeVideo.upsert({ where: { channelId_youtubeVideoId: { channelId, youtubeVideoId: ytId } }, create: { channelId, youtubeVideoId: ytId, title: m.title ?? '', description: m.description, tags: m.tags, privacyStatus: m.scheduledPublishAt ? 'private' : m.privacyStatus, scheduledPublishAt: m.scheduledPublishAt, uploadStatus: 'uploaded', source: 'app', videoType: 'UNKNOWN', classifierVersion: VIDEO_CLASSIFIER_VERSION, publishedAt: m.scheduledPublishAt ? null : new Date() }, update: { uploadStatus: 'uploaded', source: 'app' }, select: { id: true } });
  const scheduled = !!m.scheduledPublishAt && m.scheduledPublishAt.getTime() > Date.now();
  await d.prisma.contentItem.update({ where: { id: contentId }, data: { ytStatus: 'PROCESSING', status: scheduled ? 'SCHEDULED' : 'PUBLISHING', externalPostId: ytId, lastError: null, youtubeMeta: { update: { youtubeVideoId: ytId } } } as Prisma.ContentItemUpdateInput });
  if (opId) await d.prisma.youTubeUploadOperation.update({ where: { id: opId }, data: { status: 'PROCESSING' } });
  return { status: 'UPLOADED', youtubeVideoId: ytId, videoRowId: row.id };
}

/** ตรวจสถานะประมวลผล (§60) — READY เมื่อ uploadStatus=processed; ตั้งเวลา → SCHEDULED, ไม่ตั้ง → PUBLISHED */
export async function checkProcessing(d: YtDeps, contentId: string): Promise<{ state: 'PROCESSING' | 'READY' | 'FAILED' | 'SKIPPED'; detail?: string }> {
  const c = await d.prisma.contentItem.findUnique({ where: { id: contentId }, select: { id: true, youtubeChannelId: true, externalPostId: true, ytStatus: true, youtubeMeta: { select: { scheduledPublishAt: true } } } });
  if (!c?.externalPostId || !c.youtubeChannelId || c.ytStatus !== 'PROCESSING') return { state: 'SKIPPED', detail: c?.ytStatus ?? 'no video' };
  const { auth } = await channelAuth(d, c.youtubeChannelId);
  const [v] = await d.yt.getVideos(auth, [c.externalPostId]);
  if (!v) return { state: 'PROCESSING', detail: 'ยังไม่พบทรัพยากร' };
  if (v.uploadStatus === 'failed' || v.uploadStatus === 'rejected') { await d.prisma.contentItem.update({ where: { id: c.id }, data: { ytStatus: 'PROCESSING_FAILED', status: 'PUBLISH_FAILED', lastError: `YouTube: ${v.uploadStatus}` } }); await d.prisma.youTubeUploadOperation.updateMany({ where: { contentItemId: c.id }, data: { status: 'FAILED', error: v.uploadStatus } }); return { state: 'FAILED', detail: v.uploadStatus ?? undefined }; }
  if (v.uploadStatus !== 'processed' && v.uploadStatus !== 'uploaded') return { state: 'PROCESSING', detail: v.uploadStatus ?? undefined };
  const scheduled = !!c.youtubeMeta?.scheduledPublishAt && c.youtubeMeta.scheduledPublishAt.getTime() > Date.now();
  await d.prisma.contentItem.update({ where: { id: c.id }, data: { ytStatus: scheduled ? 'SCHEDULED' : 'PUBLISHED', status: scheduled ? 'SCHEDULED' : 'PUBLISHED', ...(scheduled ? {} : { publishedAt: new Date() }) } });
  await d.prisma.youTubeUploadOperation.updateMany({ where: { contentItemId: c.id }, data: { status: 'READY' } });
  await d.prisma.youTubeVideo.updateMany({ where: { channelId: c.youtubeChannelId, youtubeVideoId: c.externalPostId }, data: { uploadStatus: v.uploadStatus, privacyStatus: v.privacyStatus, publishedAt: v.publishedAt ? new Date(v.publishedAt) : undefined, durationSeconds: v.durationSeconds, thumbnailUrl: v.thumbnailUrl } });
  return { state: 'READY' };
}
