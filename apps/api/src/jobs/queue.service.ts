/**
 * ผู้ส่งงานเข้าคิว BullMQ (§46) — API ไม่ประมวลผลเอง แค่ enqueue; worker (workers/scheduler) เป็นผู้รัน
 * jobId กำหนดจากทรัพยากร (publish:<contentId>) เพื่อกันงานซ้ำ (§48)
 */
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOBS, QUEUES, publishJobId } from '@fbpm/shared';
import { ENV, type Env } from '../config/env';

function connectionFromUrl(url: string) {
  const u = new URL(url); const db = u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined;
  return { host: u.hostname, port: Number(u.port) || 6379, ...(u.password && { password: decodeURIComponent(u.password) }), ...(Number.isFinite(db) && { db }), ...(u.protocol === 'rediss:' && { tls: {} }) };
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly publish: Queue; readonly sync: Queue; readonly analytics: Queue;
  constructor(@Inject(ENV) env: Env) {
    const connection = connectionFromUrl(env.REDIS_URL);
    const mk = (name: string) => new Queue(name, { connection, defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000 } });
    this.publish = mk(QUEUES.facebookPublish); this.sync = mk(QUEUES.facebookSync); this.analytics = mk(QUEUES.analytics);
  }

  /** ตั้งเวลาเผยแพร่ — งานเดิมของคอนเทนต์นี้ (ถ้ามี) ถูกแทนที่ */
  async schedulePublish(contentId: string, runAt: Date, requestId: string): Promise<string> {
    const id = publishJobId(contentId);
    await this.cancelPublish(contentId);
    const delay = Math.max(0, runAt.getTime() - Date.now());
    const job = await this.publish.add(JOBS.publishContent, { contentId, requestId, scheduled: true }, { jobId: id, delay, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
    return job.id ?? id;
  }

  async cancelPublish(contentId: string): Promise<boolean> {
    const job = await this.publish.getJob(publishJobId(contentId));
    if (!job) return false;
    const state = await job.getState();
    if (state === 'active') return false;   // กำลังยิงอยู่ ยกเลิกไม่ได้แล้ว
    await job.remove(); return true;
  }

  async publishJobState(contentId: string): Promise<{ state: string; processedOn: number | null; failedReason: string | null } | null> {
    const job = await this.publish.getJob(publishJobId(contentId));
    if (!job) return null;
    return { state: await job.getState(), processedOn: job.processedOn ?? null, failedReason: job.failedReason ?? null };
  }

  /** เก็บ metric หลังเผยแพร่ (24 ชม. และ 72 ชม.) — retry-safe เพราะแค่เพิ่ม snapshot */
  async scheduleMetricCollection(postId: string, requestId: string): Promise<void> {
    for (const h of [24, 72]) await this.analytics.add(JOBS.collectPostMetrics, { postId, requestId, afterHours: h }, { jobId: `metrics-${postId}-${h}h`, delay: h * 3_600_000, attempts: 3, backoff: { type: 'exponential', delay: 300_000 } });
  }

  async enqueueSync(pageId: string, days: number, requestId: string): Promise<void> {
    await this.sync.add(JOBS.syncPage, { pageId, days, requestId }, { jobId: `sync-${pageId}-${Math.floor(Date.now() / 60_000)}`, attempts: 2 });
  }

  async onModuleDestroy(): Promise<void> { await Promise.all([this.publish.close(), this.sync.close(), this.analytics.close()]); }
}
