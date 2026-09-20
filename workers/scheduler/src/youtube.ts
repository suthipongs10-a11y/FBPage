/**
 * YouTube queues (AGENTS_YOUTUBE §63–66, §104, §123)
 * - youtube-upload: resumable upload (idempotent ผ่าน YouTubeUploadOperation) + ตรวจ processing เป็นรอบ
 * - youtube-sync: progressive sync รายช่อง + งานรอบรายวันทุกช่องที่ยังเชื่อมต่อ (quota-aware: quick ทุก 6 ชม., videos/analytics วันละครั้ง)
 * - youtube-analytics: เก็บ metric ตามหน้าต่างอายุเท่ากัน (+1h/+24h/+72h/+7d/+28d)
 * - youtube-comments: ซิงก์คอมเมนต์รายช่อง
 * ห้ามเรียก AI ในนี้ (§12) — worker ทำแค่ I/O กับ YouTube และฐานข้อมูล
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Queue, type Job } from 'bullmq';
import { PrismaClient, notify } from '@fbpm/database';
import { ChannelNotAccessible, GoogleAuth, YouTubeAnalyticsService, YouTubeApiError, YouTubeClient, YouTubeService, checkProcessing, collectVideoMetrics, runUpload, syncAnalytics, syncChannelSnapshot, syncComments, syncPlaylists, syncVideos, type QuotaRecorder, type YtDeps } from '@fbpm/youtube-core';
import { JOBS, YT_QUEUES } from '@fbpm/shared';

interface QuotaCtx { workspaceId: string; channelId?: string; requestId?: string }
/** บันทึก quota ต่อคำขอลง YouTubeApiUsage — ผูก workspace/ช่องผ่าน AsyncLocalStorage (งานหลายชิ้นรันพร้อมกันได้) */
export class WorkerQuotaLedger implements QuotaRecorder {
  private readonly als = new AsyncLocalStorage<QuotaCtx>();
  constructor(private readonly prisma: PrismaClient) {}
  scope<T>(ctx: QuotaCtx, fn: () => Promise<T>): Promise<T> { return this.als.run(ctx, fn); }
  async record(r: { api: string; method: string; units: number; success: boolean }): Promise<void> {
    const ctx = this.als.getStore(); if (!ctx) return;
    await this.prisma.youTubeApiUsage.create({ data: { workspaceId: ctx.workspaceId, channelId: ctx.channelId ?? null, api: r.api, method: r.method, quotaUnitsEstimated: r.units, success: r.success, requestId: ctx.requestId ?? null } }).catch(() => undefined);
  }
}

export function buildWorkerYtDeps(prisma: PrismaClient, authSecret: string, env: NodeJS.ProcessEnv = process.env): { deps: YtDeps; quota: WorkerQuotaLedger } {
  const quota = new WorkerQuotaLedger(prisma);
  const mock = env.YOUTUBE_MOCK_BASE_URL?.replace(/\/+$/, '');
  const client = new YouTubeClient({ ...(mock && { dataBaseUrl: `${mock}/youtube/v3`, analyticsBaseUrl: `${mock}/analytics`, uploadBaseUrl: `${mock}/upload` }), quota });
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI
    ? new GoogleAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI, ...(mock && { authBaseUrl: `${mock}/auth`, tokenUrl: `${mock}/token`, tokenInfoUrl: `${mock}/tokeninfo`, revokeUrl: `${mock}/revoke` }) }) : null;
  const deps: YtDeps = { prisma, yt: new YouTubeService(client), analytics: new YouTubeAnalyticsService(client), google, authSecret, apiKey: env.YOUTUBE_API_KEY, uploadEnabled: (env.YOUTUBE_UPLOAD_ENABLED ?? 'false').toLowerCase() === 'true', mediaDir: env.MEDIA_DIR ?? './data/media' };
  return { deps, quota };
}

export interface YtWorkerContext { prisma: PrismaClient; deps: YtDeps; quota: WorkerQuotaLedger; authSecret: string; queues: { upload: Queue; sync: Queue; analytics: Queue; comments: Queue }; log: (msg: string, extra?: Record<string, unknown>) => void }

const MAX_PROCESSING_CHECKS = 36;   // 36 × 5 นาที = 3 ชม.

async function channelWorkspace(prisma: PrismaClient, channelId: string): Promise<{ workspaceId: string; title: string } | null> {
  const ch = await prisma.youTubeChannel.findUnique({ where: { id: channelId }, select: { title: true, brand: { select: { client: { select: { workspaceId: true } } } } } });
  return ch ? { workspaceId: ch.brand.client.workspaceId, title: ch.title } : null;
}

export function createYtHandlers(ctx: YtWorkerContext) {
  const { prisma, deps, quota, authSecret, queues, log } = ctx;

  async function handleUpload(job: Job<{ contentId: string; requestId?: string; attempt?: number }>): Promise<unknown> {
    const { contentId, requestId = `job-${job.id}` } = job.data;
    const c = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { ytStatus: true, youtubeChannelId: true, externalPostId: true, youtubeMeta: { select: { title: true, scheduledPublishAt: true } } } });
    if (!c || !c.youtubeChannelId) return { skipped: 'content missing' };
    const ws = await channelWorkspace(prisma, c.youtubeChannelId); if (!ws) return { skipped: 'channel missing' };
    const scoped = <T,>(fn: () => Promise<T>) => quota.scope({ workspaceId: ws.workspaceId, channelId: c.youtubeChannelId!, requestId }, fn);

    if (job.name === JOBS.ytCheckProcessing) {
      const attempt = job.data.attempt ?? 1;
      const r = await scoped(() => checkProcessing(deps, contentId));
      log('yt processing check', { contentId, ...r, attempt });
      if (r.state === 'PROCESSING') {
        if (attempt >= MAX_PROCESSING_CHECKS) return { state: 'PROCESSING', gaveUp: true };
        await queues.upload.add(JOBS.ytCheckProcessing, { contentId, requestId, attempt: attempt + 1 }, { jobId: `ytproc-${contentId}-${attempt + 1}`, delay: 5 * 60_000, attempts: 2 });
      }
      if (r.state === 'READY' && c.externalPostId) {
        const v = await prisma.youTubeVideo.findFirst({ where: { channelId: c.youtubeChannelId, youtubeVideoId: c.externalPostId }, select: { id: true } });
        if (v) await scheduleVideoMetrics(v.id, requestId);
        await notify(prisma, authSecret, ws.workspaceId, { type: 'info', severity: 'info', title: `YouTube: ${c.youtubeMeta?.title ?? 'วิดีโอ'} พร้อมแล้ว${c.youtubeMeta?.scheduledPublishAt ? ' (ตั้งเวลาเผยแพร่ไว้)' : ''}`, href: '/youtube/content', resourceType: 'contentItem', resourceId: contentId, dedupeKey: `yt-ready:${contentId}` }).catch(() => undefined);
      }
      if (r.state === 'FAILED') await notify(prisma, authSecret, ws.workspaceId, { type: 'publish_failed', severity: 'bad', title: `YouTube ประมวลผลวิดีโอไม่สำเร็จ: ${c.youtubeMeta?.title ?? ''}`, body: r.detail, href: '/youtube/content', resourceType: 'contentItem', resourceId: contentId, dedupeKey: `yt-proc:${contentId}` }).catch(() => undefined);
      return r;
    }

    if (!['UPLOAD_PENDING', 'UPLOAD_FAILED', 'UPLOADING'].includes(c.ytStatus ?? '')) return { skipped: `status ${c.ytStatus}` };
    const outcome = await scoped(() => runUpload(deps, contentId, requestId));
    log('yt upload outcome', { contentId, ...outcome, requestId, attempt: job.attemptsMade + 1 });
    if (outcome.status === 'UPLOADED') await queues.upload.add(JOBS.ytCheckProcessing, { contentId, requestId, attempt: 1 }, { jobId: `ytproc-${contentId}-1`, delay: 60_000, attempts: 2 });
    if (outcome.status === 'READY') { await scheduleVideoMetrics(outcome.videoRowId, requestId); }
    if (outcome.status === 'FAILED') {
      const last = !outcome.retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (last) await notify(prisma, authSecret, ws.workspaceId, { type: 'publish_failed', severity: 'bad', title: `อัปโหลด YouTube ไม่สำเร็จ: ${c.youtubeMeta?.title ?? ''}`, body: outcome.error, href: '/youtube/content', resourceType: 'contentItem', resourceId: contentId, dedupeKey: `yt-upload-failed:${contentId}` }).catch(() => undefined);
      if (outcome.retryable) throw new Error(outcome.error);   // BullMQ retry — runUpload resume จาก session เดิม (idempotent)
    }
    return outcome;
  }

  async function scheduleVideoMetrics(videoId: string, requestId: string): Promise<void> {
    for (const h of [1, 24, 72, 24 * 7, 24 * 28]) await queues.analytics.add(JOBS.ytCollectVideoMetrics, { videoId, requestId, afterHours: h }, { jobId: `ytmetrics-${videoId}-${h}h`, delay: h * 3_600_000, attempts: 3, backoff: { type: 'exponential', delay: 600_000 } });
  }

  async function handleSync(job: Job<{ channelId?: string; stage?: string; requestId?: string; maxVideos?: number; days?: number }>): Promise<unknown> {
    if (job.name === JOBS.ytSyncAll) {
      const stage = job.data.stage ?? 'quick';
      const channels = await prisma.youTubeChannel.findMany({ where: { disconnectedAt: null, status: 'ACTIVE' }, select: { id: true } });
      for (const ch of channels) await queues.sync.add(JOBS.ytSyncChannel, { channelId: ch.id, stage }, { jobId: `ytsync-${ch.id}-${stage}-${Math.floor(Date.now() / 3_600_000)}`, attempts: 2 });
      return { enqueued: channels.length, stage };
    }
    const { channelId, stage = 'all', requestId = `job-${job.id}` } = job.data;
    if (!channelId) return { skipped: 'no channelId' };
    const ws = await channelWorkspace(prisma, channelId); if (!ws) return { skipped: 'channel missing' };
    const out: Record<string, unknown> = {};
    try {
      await quota.scope({ workspaceId: ws.workspaceId, channelId, requestId }, async () => {
        if (stage === 'quick' || stage === 'all' || stage === 'daily') { await syncChannelSnapshot(deps, channelId); out.quick = true; }
        if (stage === 'videos' || stage === 'all' || stage === 'daily') out.videos = await syncVideos(deps, channelId, { maxVideos: job.data.maxVideos ?? 30 });
        if (stage === 'history') out.videos = await syncVideos(deps, channelId, { maxVideos: job.data.maxVideos ?? 500, full: true });
        if (stage === 'analytics' || stage === 'all' || stage === 'daily') out.analytics = await syncAnalytics(deps, channelId, { days: job.data.days ?? 28 });
        if (stage === 'comments' || stage === 'all') out.comments = await syncComments(deps, channelId, { maxVideos: 20 }).catch(e => ({ skipped: e instanceof YouTubeApiError ? e.userMessage : String(e) }));
        if (stage === 'playlists' || stage === 'all') out.playlists = await syncPlaylists(deps, channelId).catch(e => ({ skipped: e instanceof YouTubeApiError ? e.userMessage : String(e) }));
      });
      log('yt channel synced', { channelId, stage, ...JSON.parse(JSON.stringify(out)) });
      return out;
    } catch (e) {
      if (e instanceof ChannelNotAccessible) {
        if (e.reason === 'RECONNECT') await notify(prisma, authSecret, ws.workspaceId, { type: 'reconnect_required', severity: 'bad', title: `ช่อง YouTube ${ws.title} ต้องเชื่อมต่อ Google ใหม่`, body: e.message, href: '/youtube', resourceType: 'youtubeChannel', resourceId: channelId, dedupeKey: `yt-reconnect:${channelId}` }).catch(() => undefined);
        return { skipped: e.message };
      }
      if (e instanceof YouTubeApiError && e.code === 'quotaExceeded') {
        await notify(prisma, authSecret, ws.workspaceId, { type: 'info', severity: 'warn', title: 'โควตา YouTube API หมดวันนี้', body: e.userMessage, href: '/youtube', dedupeKey: `yt-quota:${new Date().toISOString().slice(0, 10)}` }).catch(() => undefined);
        return { skipped: 'quotaExceeded' };   // ไม่ retry — รอ reset เที่ยงคืน Pacific
      }
      throw e;
    }
  }

  async function handleAnalytics(job: Job<{ videoId: string; requestId?: string; afterHours?: number }>): Promise<unknown> {
    if (job.name !== JOBS.ytCollectVideoMetrics) return { skipped: job.name };
    const v = await prisma.youTubeVideo.findUnique({ where: { id: job.data.videoId }, select: { channelId: true } }); if (!v) return { skipped: 'video missing' };
    const ws = await channelWorkspace(prisma, v.channelId); if (!ws) return { skipped: 'channel missing' };
    const window = job.data.afterHours === undefined ? undefined : job.data.afterHours <= 24 ? 'FIRST_24H' : job.data.afterHours <= 72 ? 'FIRST_72H' : job.data.afterHours <= 24 * 7 ? 'FIRST_7D' : job.data.afterHours <= 24 * 28 ? 'FIRST_28D' : 'LIFETIME';
    try { const r = await quota.scope({ workspaceId: ws.workspaceId, channelId: v.channelId, requestId: job.data.requestId }, () => collectVideoMetrics(deps, job.data.videoId, window)); log('yt video metrics collected', { videoId: job.data.videoId, window, ...r }); return r; }
    catch (e) { if (e instanceof ChannelNotAccessible || (e instanceof YouTubeApiError && e.code === 'quotaExceeded')) return { skipped: e.message }; throw e; }
  }

  async function handleComments(job: Job<{ channelId: string; requestId?: string; videoIds?: string[] }>): Promise<unknown> {
    const ws = await channelWorkspace(prisma, job.data.channelId); if (!ws) return { skipped: 'channel missing' };
    try { const r = await quota.scope({ workspaceId: ws.workspaceId, channelId: job.data.channelId, requestId: job.data.requestId }, () => syncComments(deps, job.data.channelId, { videoIds: job.data.videoIds, maxVideos: 20 })); log('yt comments synced', { channelId: job.data.channelId, ...r }); return r; }
    catch (e) { if (e instanceof ChannelNotAccessible || e instanceof YouTubeApiError) return { skipped: e.message }; throw e; }
  }

  return { handleUpload, handleSync, handleAnalytics, handleComments };
}

/** งานรอบ: quick ทุก 6 ชม. (1 unit/ช่อง) + daily videos/analytics ตี 3 UTC (ประหยัด quota §21) */
export async function registerYtSchedulers(sync: Queue): Promise<void> {
  await sync.upsertJobScheduler('yt-sync-all-quick-6h', { every: 6 * 3_600_000 }, { name: JOBS.ytSyncAll, data: { stage: 'quick' } });
  await sync.upsertJobScheduler('yt-sync-all-daily', { pattern: '0 3 * * *' }, { name: JOBS.ytSyncAll, data: { stage: 'daily' } });
}
export { YT_QUEUES };
