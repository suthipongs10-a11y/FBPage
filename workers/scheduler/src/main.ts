/**
 * Scheduler worker — Phase 1: เปิดคิวหลักและรอรับงาน ยังไม่มี processor จริง
 * (การเผยแพร่จริง + idempotency มาใน Phase "Scheduler / Publisher" ตาม §73)
 */
import { Worker, type Job } from 'bullmq';
import { QUEUES, redisConnectionFromUrl } from './queues';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) { console.error('REDIS_URL is required'); process.exit(1); }
const connection = redisConnectionFromUrl(REDIS_URL);

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), svc: 'worker-scheduler', msg, ...extra }));

// Phase 1: ทุกคิวมี processor ที่แค่บันทึกว่าได้รับงาน — ทุกงานต้อง retry-safe (§46)
const handler = async (job: Job): Promise<{ acknowledged: true }> => {
  log('job received', { queue: job.queueName, id: job.id, name: job.name, attempt: job.attemptsMade + 1, requestId: job.data?.requestId });
  return { acknowledged: true };
};

const workers = Object.values(QUEUES).map(name => {
  const w = new Worker(name, handler, { connection, concurrency: name === QUEUES.facebookPublish ? 1 : 4 });
  w.on('failed', (job, err) => log('job failed', { queue: name, id: job?.id, error: err.message }));
  w.on('error', err => log('worker error', { queue: name, error: err.message }));
  return w;
});
log('worker started', { queues: Object.values(QUEUES) });

const shutdown = async (signal: string): Promise<void> => {
  log('shutting down', { signal });
  await Promise.all(workers.map(w => w.close()));
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
