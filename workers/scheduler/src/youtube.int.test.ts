/** Worker integration — YouTube queues + maintenance กับ mock YouTube (ต้องมี DATABASE_URL + REDIS_URL) — ไม่แตะช่องจริง */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Queue, type Job } from 'bullmq';
import { PrismaClient, encryptSecret } from '@fbpm/database';
import { startMockYouTube } from '@fbpm/youtube-core';
import { JOBS, YT_QUEUES } from '@fbpm/shared';
import { redisConnectionFromUrl } from './queues';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;

run('worker youtube + maintenance jobs', () => {
  let yt: Awaited<ReturnType<typeof startMockYouTube>>; let prisma: PrismaClient; let mod: typeof import('./main'); let uploadQ: Queue; let analyticsQ: Queue; let syncQ: Queue;
  const SECRET = 'worker-yt-test-secret-at-least-32-characters!!';
  let ws = ''; let userId = ''; let channelId = ''; let contentId = ''; let staleId = ''; let connId = '';
  const job = <T,>(data: T, name: string, attemptsMade = 0) => ({ id: `j-${Math.random().toString(36).slice(2)}`, name, data, attemptsMade, opts: { attempts: 3 } } as unknown as Job<T>);
  beforeAll(async () => {
    yt = await startMockYouTube();
    Object.assign(process.env, { YOUTUBE_MOCK_BASE_URL: yt.url, GOOGLE_CLIENT_ID: 'gclient', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_OAUTH_REDIRECT_URI: 'http://127.0.0.1:4000/youtube/oauth/callback', YOUTUBE_API_KEY: 'APIKEY_OK', YOUTUBE_UPLOAD_ENABLED: 'true', AUTH_SECRET: SECRET, MEDIA_DIR: mkdtempSync(join(tmpdir(), 'yt-worker-')) });
    mod = await import('./main'); prisma = new PrismaClient();
    const connection = redisConnectionFromUrl(process.env.REDIS_URL!);
    uploadQ = new Queue(YT_QUEUES.upload, { connection }); analyticsQ = new Queue(YT_QUEUES.analytics, { connection }); syncQ = new Queue(YT_QUEUES.sync, { connection });
    const user = await prisma.user.create({ data: { email: `ytworker-${Date.now()}@test.local`, name: 'W', passwordHash: 'x' } }); userId = user.id;
    const w = await prisma.workspace.create({ data: { name: 'W', slug: `ytw-${Date.now()}` } }); ws = w.id;
    const client = await prisma.client.create({ data: { workspaceId: ws, name: 'C' } });
    const brand = await prisma.brand.create({ data: { clientId: client.id, name: 'B' } });
    const conn = await prisma.googleConnection.create({ data: { workspaceId: ws, userId, providerUserId: 'google-user-1', email: 'owner@example.com', accessTokenEncrypted: encryptSecret('ACCESS_OK', SECRET), refreshTokenEncrypted: encryptSecret('REFRESH_OK', SECRET), tokenExpiresAt: new Date(Date.now() + 3_600_000), scopes: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'] } }); connId = conn.id;
    const ch = await prisma.youTubeChannel.create({ data: { brandId: brand.id, googleConnectionId: conn.id, youtubeChannelId: 'UC_TEST_CHANNEL', accessMode: 'OAUTH', title: 'เกษตรก้าวหน้า', uploadsPlaylistId: 'UU_TEST_CHANNEL', policy: { defaultPrivacy: 'private' } } }); channelId = ch.id;
    const path = join(process.env.MEDIA_DIR!, 'clip.mp4'); writeFileSync(path, Buffer.alloc(512 * 1024, 3));
    const asset = await prisma.mediaAsset.create({ data: { workspaceId: ws, kind: 'video', path, mimeType: 'video/mp4', bytes: 512 * 1024 } });
    const c = await prisma.contentItem.create({ data: { platform: 'YOUTUBE', youtubeChannelId: channelId, status: 'APPROVED', ytStatus: 'UPLOAD_PENDING', title: 'คลิปทดสอบ', createdById: userId, youtubeMeta: { create: { title: 'ยูเรียใส่กี่กิโล', description: 'd', tags: ['ปุ๋ย'], privacyStatus: 'private', madeForKids: false, videoAssetId: asset.id } } } }); contentId = c.id;
    const st = await prisma.contentItem.create({ data: { platform: 'YOUTUBE', youtubeChannelId: channelId, status: 'PUBLISHING', ytStatus: 'UPLOADING', title: 'ค้าง', createdById: userId, youtubeMeta: { create: { title: 'ค้าง', madeForKids: false } } } }); staleId = st.id;
    await prisma.contentItem.update({ where: { id: staleId }, data: { updatedAt: new Date(Date.now() - 10 * 3_600_000) } });
  }, 30_000);
  afterAll(async () => {
    for (const q of [uploadQ, analyticsQ, syncQ]) { await q.drain(true).catch(() => undefined); await q.close(); }
    await prisma.workspace.deleteMany({ where: { id: ws } }); await prisma.user.deleteMany({ where: { id: userId } }); await prisma.$disconnect(); yt.server.close();
  });

  it('sync job: quick + videos imports via uploads playlist; sync-all fans out per channel; quotaExceeded skips without throwing', async () => {
    const r = await mod.yt.handleSync(job({ channelId, stage: 'all' }, JOBS.ytSyncChannel)) as { quick: boolean; videos: { imported: number }; analytics: { videos: number } };
    expect(r.quick).toBe(true); expect(r.videos.imported).toBe(4); expect(r.analytics.videos).toBe(4);
    expect(yt.state.requests.some(x => x.includes('/search'))).toBe(false);
    const all = await mod.yt.handleSync(job({ stage: 'quick' }, JOBS.ytSyncAll)) as { enqueued: number }; expect(all.enqueued).toBeGreaterThanOrEqual(1);
    yt.state.quotaExceeded = true;
    const q = await mod.yt.handleSync(job({ channelId, stage: 'videos' }, JOBS.ytSyncChannel)) as { skipped?: string }; expect(q.skipped).toBe('quotaExceeded');
    yt.state.quotaExceeded = false;
    const n = await prisma.notification.findFirst({ where: { workspaceId: ws, title: { contains: 'โควตา' } } }); expect(n).not.toBeNull();
  });

  it('upload job: resumable upload once, schedules processing check; check → READY schedules same-age metric jobs; re-run is idempotent', async () => {
    const r = await mod.yt.handleUpload(job({ contentId }, JOBS.ytUpload)) as { status: string; youtubeVideoId: string };
    expect(r.status).toBe('UPLOADED'); expect(yt.state.uploads).toHaveLength(1); expect(yt.state.uploads[0]!.received).toBe(512 * 1024);
    const proc = await uploadQ.getJob(`ytproc-${contentId}-1`); expect(proc).toBeTruthy(); expect(await proc!.getState()).toBe('delayed'); await proc!.remove();
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: contentId } })).ytStatus).toBe('PROCESSING');
    const again = await mod.yt.handleUpload(job({ contentId }, JOBS.ytUpload)) as { skipped?: string }; expect(again.skipped).toMatch(/PROCESSING/); expect(yt.state.uploads).toHaveLength(1);
    const chk = await mod.yt.handleUpload(job({ contentId, attempt: 1 }, JOBS.ytCheckProcessing)) as { state: string };
    expect(chk.state).toBe('READY');
    const c = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentId } }); expect(c.ytStatus).toBe('PUBLISHED'); expect(c.externalPostId).toBe(r.youtubeVideoId);
    const v = await prisma.youTubeVideo.findFirstOrThrow({ where: { channelId, youtubeVideoId: r.youtubeVideoId } }); expect(v.source).toBe('app');
    for (const h of [1, 24, 72, 168, 672]) { const j = await analyticsQ.getJob(`ytmetrics-${v.id}-${h}h`); expect(j, `metrics job ${h}h`).toBeTruthy(); await j!.remove(); }
    const m = await mod.yt.handleAnalytics(job({ videoId: v.id, afterHours: 24 }, JOBS.ytCollectVideoMetrics)) as { ok: boolean }; expect(m.ok).toBe(true);
    const snaps = await prisma.youTubeVideoMetricSnapshot.findMany({ where: { videoId: v.id, window: 'FIRST_24H' } }); expect(snaps.length).toBeGreaterThanOrEqual(1);
  });

  it('upload job: kill switch → SKIPPED without touching YouTube; missing file → FAILED not retryable', async () => {
    const asset = await prisma.mediaAsset.create({ data: { workspaceId: ws, kind: 'video', path: join(process.env.MEDIA_DIR!, 'missing.mp4'), mimeType: 'video/mp4', bytes: 1 } });
    const c2 = await prisma.contentItem.create({ data: { platform: 'YOUTUBE', youtubeChannelId: channelId, status: 'APPROVED', ytStatus: 'UPLOAD_PENDING', title: 'x', youtubeMeta: { create: { title: 'x', madeForKids: false, videoAssetId: asset.id } } } });
    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { uploadsPaused: true } });
    const s = await mod.yt.handleUpload(job({ contentId: c2.id }, JOBS.ytUpload)) as { status: string; reason: string }; expect(s.status).toBe('SKIPPED'); expect(s.reason).toMatch(/kill switch/);
    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { uploadsPaused: false } });
    const f = await mod.yt.handleUpload(job({ contentId: c2.id }, JOBS.ytUpload)) as { status: string; retryable: boolean }; expect(f.status).toBe('FAILED'); expect(f.retryable).toBe(false);
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: c2.id } })).ytStatus).toBe('UPLOAD_FAILED'); expect(yt.state.uploads).toHaveLength(1);
  });

  it('comments job syncs comments for the channel', async () => {
    const r = await mod.yt.handleComments(job({ channelId }, JOBS.ytSyncComments)) as { imported: number; updated: number };
    expect(r.imported + r.updated).toBe(5);
  });

  it('maintenance: stale UPLOADING → UPLOAD_FAILED + notification; token check flags Google ERROR; cleanup runs and never touches audit/snapshots', async () => {
    const st = await mod.maintenance.staleUploads(); expect(st.failed).toBeGreaterThanOrEqual(1);
    const c = await prisma.contentItem.findUniqueOrThrow({ where: { id: staleId } }); expect(c.ytStatus).toBe('UPLOAD_FAILED'); expect(c.lastError).toMatch(/ค้าง/);
    expect(await prisma.notification.findFirst({ where: { workspaceId: ws, dedupeKey: `yt-stale:${staleId}` } })).not.toBeNull();
    await prisma.googleConnection.update({ where: { id: connId }, data: { status: 'ERROR', lastError: 'invalid_grant' } });
    const tc = await mod.maintenance.tokenCheck(); expect(tc.googleError).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.findFirst({ where: { workspaceId: ws, type: 'reconnect_required', resourceId: connId } })).not.toBeNull();
    await prisma.googleConnection.update({ where: { id: connId }, data: { status: 'ACTIVE' } });
    const auditBefore = await prisma.auditLog.count({ where: { workspaceId: ws } }); const snapsBefore = await prisma.youTubeVideoMetricSnapshot.count({ where: { video: { channelId } } });
    await prisma.notification.create({ data: { workspaceId: ws, type: 'info', title: 'old', readAt: new Date(Date.now() - 200 * 86_400_000) } });
    const cl = await mod.maintenance.cleanup(); expect(cl.notifications).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { workspaceId: ws } })).toBe(auditBefore); expect(await prisma.youTubeVideoMetricSnapshot.count({ where: { video: { channelId } } })).toBe(snapsBefore);
  });
});
