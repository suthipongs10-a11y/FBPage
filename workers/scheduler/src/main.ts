/**
 * Scheduler / Publisher / Metric collector worker (§46, §47, §48)
 * - facebook-publish: เผยแพร่ ContentItem ตามเวลา (idempotent ผ่าน ExternalOperation, ตรวจ kill switch ทุกครั้ง)
 * - facebook-sync: ซิงก์เพจ + งานรอบ 6 ชม. ซิงก์ทุกเพจที่ยังเชื่อมต่อ
 * - analytics: เก็บ metric โพสต์หลังเผยแพร่ 24/72 ชม.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { PrismaClient } from '@fbpm/database';
import { FacebookService, PageNotSyncable, collectPostMetrics, publishContent, syncPage, type SyncDeps } from '@fbpm/facebook-core';
import { JOBS, QUEUES, redisConnectionFromUrl } from './queues';

const REDIS_URL = process.env.REDIS_URL; const AUTH_SECRET = process.env.AUTH_SECRET;
if (!REDIS_URL) { console.error('REDIS_URL is required'); process.exit(1); }
if (!AUTH_SECRET || AUTH_SECRET.length < 32) { console.error('AUTH_SECRET (>=32 chars) is required to decrypt page tokens'); process.exit(1); }
const connection = redisConnectionFromUrl(REDIS_URL);
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), svc: 'worker-scheduler', msg, ...extra }));

const prisma = new PrismaClient();
const fb = new FacebookService({ version: process.env.META_GRAPH_API_VERSION, baseUrl: process.env.META_GRAPH_BASE_URL });
const deps: SyncDeps = { prisma, fb, authSecret: AUTH_SECRET, apiVersion: process.env.META_GRAPH_API_VERSION ?? 'v26.0' };
const analyticsQueue = new Queue(QUEUES.analytics, { connection });
const syncQueue = new Queue(QUEUES.facebookSync, { connection });

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
  if (outcome.status === 'FAILED' && outcome.retryable) throw new Error(outcome.error);   // ให้ BullMQ retry ตาม backoff — publisher กันซ้ำเองด้วย ExternalOperation
  return outcome;
}

export async function handleSync(job: Job<{ pageId?: string; days?: number }>): Promise<unknown> {
  if (job.name === JOBS.syncAllPages) {
    const pages = await prisma.facebookPage.findMany({ where: { disconnectedAt: null, tokenStatus: 'VALID' }, select: { id: true } });
    for (const p of pages) await syncQueue.add(JOBS.syncPage, { pageId: p.id, days: 7 }, { jobId: `sync-${p.id}-${Math.floor(Date.now() / 3_600_000)}`, attempts: 2 });
    return { enqueued: pages.length };
  }
  if (!job.data.pageId) return { skipped: 'no pageId' };
  try { const r = await syncPage(deps, job.data.pageId, { days: job.data.days ?? 7 }); log('page synced', { pageId: job.data.pageId, ...r }); return r; }
  catch (e) { if (e instanceof PageNotSyncable) return { skipped: e.message }; throw e; }
}

export async function handleAnalytics(job: Job<{ postId: string }>): Promise<unknown> {
  if (job.name !== JOBS.collectPostMetrics) return { skipped: job.name };
  try { const r = await collectPostMetrics(deps, job.data.postId); log('post metrics collected', { postId: job.data.postId, ...r }); return r; }
  catch (e) { if (e instanceof PageNotSyncable) return { skipped: e.message }; throw e; }
}

const ack = async (job: Job): Promise<{ acknowledged: true }> => { log('job received (no processor yet)', { queue: job.queueName, name: job.name, id: job.id }); return { acknowledged: true }; };
const processors: Record<string, (job: Job) => Promise<unknown>> = { [QUEUES.facebookPublish]: handlePublish, [QUEUES.facebookSync]: handleSync, [QUEUES.analytics]: handleAnalytics };

async function main(): Promise<void> {
  const workers = Object.values(QUEUES).map(name => {
    const w = new Worker(name, processors[name] ?? ack, { connection, concurrency: name === QUEUES.facebookPublish ? 1 : 4 });
    w.on('failed', (job, err) => log('job failed', { queue: name, id: job?.id, name: job?.name, attempt: job?.attemptsMade, error: err.message }));
    w.on('error', err => log('worker error', { queue: name, error: err.message }));
    return w;
  });
  // งานรอบ: ซิงก์ทุกเพจทุก 6 ชั่วโมง (retry-safe — แค่เพิ่ม snapshot)
  await syncQueue.upsertJobScheduler('sync-all-pages-6h', { every: 6 * 3_600_000 }, { name: JOBS.syncAllPages, data: {} });
  log('worker started', { queues: Object.values(QUEUES), graph: process.env.META_GRAPH_BASE_URL ?? 'graph.facebook.com' });
  const shutdown = async (signal: string): Promise<void> => { log('shutting down', { signal }); await Promise.all(workers.map(w => w.close())); await prisma.$disconnect(); process.exit(0); };
  process.on('SIGINT', () => void shutdown('SIGINT')); process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
if (require.main === module) void main();
