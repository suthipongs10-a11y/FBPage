/**
 * Scheduler / Publisher / Metric collector worker (§46, §47, §48)
 * - facebook-publish: เผยแพร่ ContentItem ตามเวลา (idempotent ผ่าน ExternalOperation, ตรวจ kill switch ทุกครั้ง)
 * - facebook-sync: ซิงก์เพจ + งานรอบ 6 ชม. ซิงก์ทุกเพจที่ยังเชื่อมต่อ
 * - analytics: เก็บ metric โพสต์หลังเผยแพร่ 24/72 ชม.
 * - youtube-*: ดู ./youtube.ts · maintenance / youtube-maintenance: ดู ./maintenance.ts
 */
import { Queue, Worker, type Job } from 'bullmq';
import { PrismaClient, mailerFromEnv, notify, setNotifyMailer } from '@fbpm/database';
import { FacebookService, PageNotSyncable, collectPostMetrics, publishContent, syncComments, syncPage, type SyncDeps } from '@fbpm/facebook-core';
import type { SocialEvent } from '@fbpm/shared';
import { JOBS, QUEUES, redisConnectionFromUrl } from './queues';
import { YT_QUEUES, buildWorkerYtDeps, createYtHandlers, registerYtSchedulers } from './youtube';
import { createMaintenanceHandlers, registerMaintenanceSchedulers } from './maintenance';
import { buildWorkerWebDeps, createWebHandlers, registerWebSchedulers } from './web';
import { WEB_QUEUES } from '@fbpm/shared';

const REDIS_URL = process.env.REDIS_URL; const AUTH_SECRET = process.env.AUTH_SECRET;
if (!REDIS_URL) { console.error('REDIS_URL is required'); process.exit(1); }
if (!AUTH_SECRET || AUTH_SECRET.length < 32) { console.error('AUTH_SECRET (>=32 chars) is required to decrypt page tokens'); process.exit(1); }
const connection = redisConnectionFromUrl(REDIS_URL);
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), svc: 'worker-scheduler', msg, ...extra }));

const prisma = new PrismaClient();
setNotifyMailer(mailerFromEnv(process.env), process.env.APP_URL ?? 'http://localhost:3000');   // อีเมลเหตุการณ์สำคัญ (ถ้าตั้ง SMTP_*)
const fb = new FacebookService({ version: process.env.META_GRAPH_API_VERSION, baseUrl: process.env.META_GRAPH_BASE_URL });
const deps: SyncDeps = { prisma, fb, authSecret: AUTH_SECRET, apiVersion: process.env.META_GRAPH_API_VERSION ?? 'v26.0' };
const analyticsQueue = new Queue(QUEUES.analytics, { connection });
const syncQueue = new Queue(QUEUES.facebookSync, { connection });
const ytQueues = { upload: new Queue(YT_QUEUES.upload, { connection }), sync: new Queue(YT_QUEUES.sync, { connection }), analytics: new Queue(YT_QUEUES.analytics, { connection }), comments: new Queue(YT_QUEUES.comments, { connection }) };
const ytBuilt = buildWorkerYtDeps(prisma, AUTH_SECRET);
export const yt = createYtHandlers({ prisma, deps: ytBuilt.deps, quota: ytBuilt.quota, authSecret: AUTH_SECRET, queues: ytQueues, log });
const maintenanceQueue = new Queue(QUEUES.maintenance, { connection }); const ytMaintenanceQueue = new Queue(YT_QUEUES.maintenance, { connection });
export const maintenance = createMaintenanceHandlers({ prisma, authSecret: AUTH_SECRET, ytUploadQueue: ytQueues.upload, log });
const webQueues = { monitor: new Queue(WEB_QUEUES.monitor, { connection }), daily: new Queue(WEB_QUEUES.daily, { connection }) };
export const web = createWebHandlers({ prisma, deps: buildWorkerWebDeps(prisma, AUTH_SECRET), authSecret: AUTH_SECRET, queues: webQueues, log });

export async function handlePublish(job: Job<{ contentId: string; requestId?: string }>): Promise<unknown> {
  const { contentId, requestId = `job-${job.id}` } = job.data;
  const c = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { status: true, scheduledAt: true } });
  if (!c) return { skipped: 'content missing' };
  if (!['SCHEDULED', 'PUBLISHING', 'PUBLISH_FAILED'].includes(c.status)) return { skipped: `status ${c.status}` };
  const outcome = await publishContent(deps, contentId, { requestId, scheduledPublish: true });
  log('publish outcome', { contentId, ...outcome, requestId, attempt: job.attemptsMade + 1 });
  if (outcome.status === 'PUBLISHED') {
    for (const h of [24, 72]) await analyticsQueue.add(JOBS.collectPostMetrics, { postId: outcome.postId, afterHours: h, requestId }, { jobId: `metrics-${outcome.postId}-${h}h`, delay: h * 3_600_000, attempts: 3, backoff: { type: 'exponential', delay: 300_000 } });
  }
  if (outcome.status === 'FAILED') {
    const ws = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { title: true, caption: true, page: { select: { brand: { select: { client: { select: { workspaceId: true } } } } } } } });
    const last = !outcome.retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (ws?.page && last) await notify(prisma, AUTH_SECRET!, ws.page.brand.client.workspaceId, { type: 'publish_failed', severity: 'bad', title: `โพสต์ตามเวลาไม่สำเร็จ: ${ws.title ?? (ws.caption ?? '').slice(0, 40)}`, body: outcome.error, href: '/content', resourceType: 'contentItem', resourceId: contentId, dedupeKey: `publish_failed:${contentId}` }).catch(() => undefined);
    if (outcome.retryable) throw new Error(outcome.error);   // ให้ BullMQ retry ตาม backoff — publisher กันซ้ำเองด้วย ExternalOperation
  }
  return outcome;
}

export async function handleSync(job: Job<{ pageId?: string; days?: number }>): Promise<unknown> {
  if (job.name === JOBS.syncAllPages) {
    const pages = await prisma.facebookPage.findMany({ where: { disconnectedAt: null, tokenStatus: 'VALID' }, select: { id: true } });
    for (const p of pages) await syncQueue.add(JOBS.syncPage, { pageId: p.id, days: 7 }, { jobId: `sync-${p.id}-${Math.floor(Date.now() / 3_600_000)}`, attempts: 2 });
    return { enqueued: pages.length };
  }
  if (!job.data.pageId) return { skipped: 'no pageId' };
  if (job.name === JOBS.syncComments) {
    try { const r = await syncComments(deps, job.data.pageId, { days: job.data.days ?? 7, postIds: (job.data as { postIds?: string[] }).postIds }); log('comments synced', { pageId: job.data.pageId, ...r }); return r; }
    catch (e) { if (e instanceof PageNotSyncable) return { skipped: e.message }; throw e; }
  }
  try {
    const r = await syncPage(deps, job.data.pageId, { days: job.data.days ?? 7 }); log('page synced', { pageId: job.data.pageId, ...r });
    const p = await prisma.facebookPage.findUnique({ where: { id: job.data.pageId }, select: { commentsStatus: true } });
    if (p && p.commentsStatus !== 'NO_PERMISSION') await syncComments(deps, job.data.pageId, { days: 7 }).catch(() => undefined);   // คอมเมนต์ตามรอบ ถ้ามีสิทธิ์
    return r;
  } catch (e) {
    if (e instanceof PageNotSyncable) return { skipped: e.message };
    const page = await prisma.facebookPage.findUnique({ where: { id: job.data.pageId }, select: { name: true, tokenStatus: true, brand: { select: { client: { select: { workspaceId: true } } } } } });
    if (page?.tokenStatus === 'INVALID') await notify(prisma, AUTH_SECRET!, page.brand.client.workspaceId, { type: 'reconnect_required', severity: 'bad', title: `เพจ ${page.name} ต้องเชื่อมต่อใหม่`, body: 'token ของเพจใช้ไม่ได้แล้ว — วาง token ใหม่ในหน้าเพจ', href: '/pages', resourceType: 'facebookPage', resourceId: job.data.pageId, dedupeKey: `token:${job.data.pageId}` }).catch(() => undefined);
    throw e;
  }
}

export async function handleAnalytics(job: Job<{ postId: string }>): Promise<unknown> {
  if (job.name !== JOBS.collectPostMetrics) return { skipped: job.name };
  try { const r = await collectPostMetrics(deps, job.data.postId); log('post metrics collected', { postId: job.data.postId, ...r }); return r; }
  catch (e) { if (e instanceof PageNotSyncable) return { skipped: e.message }; throw e; }
}

/** Webhook events (§14): normalize แล้ว → ซิงก์เฉพาะส่วนที่เปลี่ยน ไม่รัน AI ตรงนี้ */
export async function handleWebhook(job: Job<SocialEvent>): Promise<unknown> {
  const ev = job.data;
  const pages = await prisma.facebookPage.findMany({ where: { facebookPageId: ev.facebookPageId, disconnectedAt: null }, select: { id: true, commentsStatus: true } });
  if (!pages.length) return { skipped: 'page not connected' };
  for (const p of pages) {
    if (ev.type === 'COMMENT_CREATED') {
      const post = ev.postId ? await prisma.facebookPost.findFirst({ where: { pageId: p.id, facebookPostId: ev.postId }, select: { id: true } }) : null;
      if (!post) await syncQueue.add(JOBS.syncPage, { pageId: p.id, days: 3 }, { jobId: `sync-${p.id}-wh-${Math.floor(Date.now() / 60_000)}`, attempts: 2 });
      await syncQueue.add(JOBS.syncComments, { pageId: p.id, days: 3, ...(post && { postIds: [post.id] }) }, { jobId: `synccomments-${p.id}-${ev.commentId}`, attempts: 2, delay: post ? 0 : 30_000 });
    } else if (ev.type === 'POST_UPDATED') {
      await syncQueue.add(JOBS.syncPage, { pageId: p.id, days: 3 }, { jobId: `sync-${p.id}-wh-${Math.floor(Date.now() / 60_000)}`, attempts: 2 });
    } else if (ev.type === 'TOKEN_ERROR') {
      await prisma.facebookPage.update({ where: { id: p.id }, data: { tokenStatus: 'INVALID', lastSyncError: ev.reason } });
    }
  }
  log('webhook event handled', { type: ev.type, facebookPageId: ev.facebookPageId, pages: pages.length });
  return { handled: ev.type, pages: pages.length };
}

const ack = async (job: Job): Promise<{ acknowledged: true }> => { log('job received (no processor yet)', { queue: job.queueName, name: job.name, id: job.id }); return { acknowledged: true }; };
const processors: Record<string, (job: Job) => Promise<unknown>> = {
  [QUEUES.facebookPublish]: handlePublish, [QUEUES.facebookSync]: handleSync, [QUEUES.analytics]: handleAnalytics, [QUEUES.facebookWebhook]: handleWebhook as (job: Job) => Promise<unknown>,
  [QUEUES.maintenance]: maintenance.handle, [YT_QUEUES.maintenance]: maintenance.handle,
  [WEB_QUEUES.monitor]: web.handleMonitor as (job: Job) => Promise<unknown>, [WEB_QUEUES.daily]: web.handleDaily as (job: Job) => Promise<unknown>,
  [YT_QUEUES.upload]: yt.handleUpload as (job: Job) => Promise<unknown>, [YT_QUEUES.sync]: yt.handleSync as (job: Job) => Promise<unknown>, [YT_QUEUES.analytics]: yt.handleAnalytics as (job: Job) => Promise<unknown>, [YT_QUEUES.comments]: yt.handleComments as (job: Job) => Promise<unknown>,
};
const ALL_QUEUES = [...Object.values(QUEUES), ...Object.values(YT_QUEUES), ...Object.values(WEB_QUEUES)];

async function main(): Promise<void> {
  const workers = ALL_QUEUES.map(name => {
    const w = new Worker(name, processors[name] ?? ack, { connection, concurrency: name === QUEUES.facebookPublish || name === YT_QUEUES.upload ? 1 : 4 });
    w.on('failed', (job, err) => log('job failed', { queue: name, id: job?.id, name: job?.name, attempt: job?.attemptsMade, error: err.message }));
    w.on('error', err => log('worker error', { queue: name, error: err.message }));
    return w;
  });
  // งานรอบ: ซิงก์ทุกเพจทุก 6 ชั่วโมง (retry-safe — แค่เพิ่ม snapshot)
  await syncQueue.upsertJobScheduler('sync-all-pages-6h', { every: 6 * 3_600_000 }, { name: JOBS.syncAllPages, data: {} });
  await registerYtSchedulers(ytQueues.sync);
  await registerMaintenanceSchedulers(maintenanceQueue, ytMaintenanceQueue);
  await registerWebSchedulers(webQueues.monitor, webQueues.daily);
  log('worker started', { queues: ALL_QUEUES, graph: process.env.META_GRAPH_BASE_URL ?? 'graph.facebook.com', youtube: process.env.YOUTUBE_MOCK_BASE_URL ?? 'googleapis.com', youtubeUpload: ytBuilt.deps.uploadEnabled });
  const shutdown = async (signal: string): Promise<void> => { log('shutting down', { signal }); await Promise.all(workers.map(w => w.close())); await prisma.$disconnect(); process.exit(0); };
  process.on('SIGINT', () => void shutdown('SIGINT')); process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
if (require.main === module) void main();
