/**
 * ผู้ส่งงานเข้าคิว BullMQ (§46) — API ไม่ประมวลผลเอง แค่ enqueue; worker (workers/scheduler) เป็นผู้รัน
 * jobId กำหนดจากทรัพยากร (publish:<contentId>) เพื่อกันงานซ้ำ (§48)
 */
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EMAIL_JOBS, EMAIL_QUEUES, JOBS, QUEUES, WEB_JOBS, WEB_QUEUES, YT_QUEUES, emailSendJobId, publishJobId, webPublishJobId, ytUploadJobId } from '@fbpm/shared';
import { ENV, type Env } from '../config/env';

function connectionFromUrl(url: string) {
  const u = new URL(url); const db = u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined;
  return { host: u.hostname, port: Number(u.port) || 6379, ...(u.password && { password: decodeURIComponent(u.password) }), ...(Number.isFinite(db) && { db }), ...(u.protocol === 'rediss:' && { tls: {} }) };
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly publish: Queue; readonly sync: Queue; readonly analytics: Queue;
  readonly ytUpload: Queue; readonly ytSync: Queue; readonly ytAnalytics: Queue; readonly ytComments: Queue;
  readonly webPublish: Queue; readonly emailSend: Queue;
  constructor(@Inject(ENV) env: Env) {
    const connection = connectionFromUrl(env.REDIS_URL);
    const mk = (name: string) => new Queue(name, { connection, defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000 } });
    this.publish = mk(QUEUES.facebookPublish); this.sync = mk(QUEUES.facebookSync); this.analytics = mk(QUEUES.analytics);
    this.ytUpload = mk(YT_QUEUES.upload); this.ytSync = mk(YT_QUEUES.sync); this.ytAnalytics = mk(YT_QUEUES.analytics); this.ytComments = mk(YT_QUEUES.comments);
    this.webPublish = mk(WEB_QUEUES.publish); this.emailSend = mk(EMAIL_QUEUES.send);
  }

  // ---------- งานตั้งเวลาแบบทั่วไป (W-3 WordPress / W-4 อีเมล) — jobId ต่อทรัพยากร กันซ้ำ ----------
  private async replaceDelayed(queue: Queue, jobId: string, name: string, data: Record<string, unknown>, runAt: Date | undefined, backoffMs: number): Promise<string> {
    await this.cancelJob(queue, jobId);
    const delay = runAt ? Math.max(0, runAt.getTime() - Date.now()) : 0;
    const job = await queue.add(name, data, { jobId, delay, attempts: 3, backoff: { type: 'exponential', delay: backoffMs } });
    return job.id ?? jobId;
  }
  private async cancelJob(queue: Queue, jobId: string): Promise<boolean> {
    const job = await queue.getJob(jobId); if (!job) return false;
    if ((await job.getState()) === 'active') return false;
    await job.remove(); return true;
  }
  private async jobState(queue: Queue, jobId: string): Promise<{ state: string; processedOn: number | null; failedReason: string | null } | null> {
    const job = await queue.getJob(jobId); if (!job) return null;
    return { state: await job.getState(), processedOn: job.processedOn ?? null, failedReason: job.failedReason ?? null };
  }
  scheduleWebPublish(contentId: string, runAt: Date, requestId: string) { return this.replaceDelayed(this.webPublish, webPublishJobId(contentId), WEB_JOBS.publishContent, { contentId, requestId, scheduled: true }, runAt, 120_000); }
  cancelWebPublish(contentId: string) { return this.cancelJob(this.webPublish, webPublishJobId(contentId)); }
  webPublishJobState(contentId: string) { return this.jobState(this.webPublish, webPublishJobId(contentId)); }
  scheduleEmailSend(campaignId: string, runAt: Date | undefined, requestId: string) { return this.replaceDelayed(this.emailSend, emailSendJobId(campaignId), EMAIL_JOBS.sendCampaign, { campaignId, requestId, scheduled: !!runAt }, runAt, 300_000); }
  cancelEmailSend(campaignId: string) { return this.cancelJob(this.emailSend, emailSendJobId(campaignId)); }
  emailSendJobState(campaignId: string) { return this.jobState(this.emailSend, emailSendJobId(campaignId)); }

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

  // ---------- YouTube (AGENTS_YOUTUBE §63–66) ----------
  /** ส่งงานอัปโหลด — jobId = ytupload-<contentId> กันซ้ำ; ถ้ามีงานเดิมค้าง (ไม่ active) แทนที่ */
  async enqueueYtUpload(contentId: string, requestId: string, runAt?: Date): Promise<string> {
    const id = ytUploadJobId(contentId);
    await this.cancelYtUpload(contentId);
    const delay = runAt ? Math.max(0, runAt.getTime() - Date.now()) : 0;
    const job = await this.ytUpload.add(JOBS.ytUpload, { contentId, requestId }, { jobId: id, delay, attempts: 3, backoff: { type: 'exponential', delay: 120_000 } });
    return job.id ?? id;
  }

  async cancelYtUpload(contentId: string): Promise<boolean> {
    const job = await this.ytUpload.getJob(ytUploadJobId(contentId));
    if (!job) return false;
    if ((await job.getState()) === 'active') return false;
    await job.remove(); return true;
  }

  async ytUploadJobState(contentId: string): Promise<{ state: string; processedOn: number | null; failedReason: string | null } | null> {
    const job = await this.ytUpload.getJob(ytUploadJobId(contentId));
    if (!job) return null;
    return { state: await job.getState(), processedOn: job.processedOn ?? null, failedReason: job.failedReason ?? null };
  }

  /** ตรวจสถานะ processing ของวิดีโอที่อัปโหลดแล้ว (ทุก 5 นาที จนกว่าจะ processed/failed — worker เป็นผู้ re-enqueue) */
  async scheduleYtProcessingCheck(contentId: string, requestId: string, attempt = 1): Promise<void> {
    await this.ytUpload.add(JOBS.ytCheckProcessing, { contentId, requestId, attempt }, { jobId: `ytproc-${contentId}-${attempt}`, delay: 5 * 60_000, attempts: 2 });
  }

  /** เก็บ metric ตามหน้าต่างอายุเท่ากัน (§42) — +1h/+24h/+72h/+7d/+28d */
  async scheduleYtMetricCollection(videoId: string, requestId: string): Promise<void> {
    for (const h of [1, 24, 72, 24 * 7, 24 * 28]) await this.ytAnalytics.add(JOBS.ytCollectVideoMetrics, { videoId, requestId, afterHours: h }, { jobId: `ytmetrics-${videoId}-${h}h`, delay: h * 3_600_000, attempts: 3, backoff: { type: 'exponential', delay: 600_000 } });
  }

  async enqueueYtSync(channelId: string, stage: string, requestId: string): Promise<void> {
    await this.ytSync.add(JOBS.ytSyncChannel, { channelId, stage, requestId }, { jobId: `ytsync-${channelId}-${stage}-${Math.floor(Date.now() / 60_000)}`, attempts: 2 });
  }

  async enqueueYtComments(channelId: string, requestId: string): Promise<void> {
    await this.ytComments.add(JOBS.ytSyncComments, { channelId, requestId }, { jobId: `ytcomments-${channelId}-${Math.floor(Date.now() / 60_000)}`, attempts: 2 });
  }

  async onModuleDestroy(): Promise<void> { await Promise.all([this.publish, this.sync, this.analytics, this.ytUpload, this.ytSync, this.ytAnalytics, this.ytComments, this.webPublish, this.emailSend].map((q) => q.close())); }
}
