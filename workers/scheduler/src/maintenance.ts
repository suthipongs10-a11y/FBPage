/**
 * Maintenance queues (§46 maintenance / AGENTS_YOUTUBE §66 youtube-maintenance)
 * - cleanup รายวัน: ลบข้อมูลชั่วคราวที่หมดอายุ (session, invite/reset ที่หมดอายุหรือใช้แล้ว, notification ที่อ่านแล้ว, AiTaskLog/ApiUsage/SyncRun เก่า)
 *   **ไม่ลบ** AuditLog, metric snapshot, report — เป็นประวัติที่รายงานอ้างอิง
 * - token check ทุก 12 ชม.: Facebook user token ใกล้หมดอายุ / เพจ token INVALID / Google connection ERROR → แจ้งเตือน (dedupe รายวัน)
 * - เตือนโพสต์ชุมชน YouTube ทุก 10 นาที: ร่างที่ถึงเวลาแล้ว → แจ้งเตือนครั้งเดียว (ระบบไม่โพสต์เอง — ไม่มี API)
 * - ตรวจโพสต์ตั้งเวลาทุก 15 นาที + ตอนเริ่ม worker: โพสต์ Facebook สถานะ SCHEDULED ที่ไม่มีงานในคิว (Redis หาย / ย้ายเครื่อง / กู้ backup) → ใส่คิวใหม่ด้วย jobId เดิม
 * - สรุปคอมเมนต์/แชทใหม่ทาง LINE ทุก 30 นาที (เฉพาะ workspace ที่ตั้ง LINE OA และมีคนผูกไว้ · เงียบ 22:00–07:00)
 * - stale uploads รายชั่วโมง: upload ที่ค้าง UPLOADING/UPLOAD_PENDING นานเกิน → UPLOAD_FAILED (retry ได้จากหน้า Content Lab) · PROCESSING นานเกิน → ตรวจใหม่
 */
import type { Queue, Job } from 'bullmq';
import { PrismaClient, lineInboxDigest, notify } from '@fbpm/database';
import { JOBS, publishJobId } from '@fbpm/shared';

export const RETENTION = { aiTaskLogDays: 180, apiUsageDays: 90, syncRunDays: 90, readNotificationDays: 90, expiredLinkDays: 30, lineDeliveryDays: 90, staleUploadHours: 6, staleProcessingHours: 24, tokenWarnDays: 7 } as const;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

export interface MaintenanceContext { prisma: PrismaClient; authSecret: string; ytUploadQueue: Queue; publishQueue?: Queue; log: (msg: string, extra?: Record<string, unknown>) => void }

export function createMaintenanceHandlers(ctx: MaintenanceContext) {
  const { prisma, authSecret, ytUploadQueue, publishQueue, log } = ctx;

  async function cleanup(): Promise<Record<string, number>> {
    const now = new Date();
    const r = {
      sessions: (await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })).count,
      invites: (await prisma.workspaceInvite.deleteMany({ where: { OR: [{ expiresAt: { lt: daysAgo(RETENTION.expiredLinkDays) } }, { acceptedAt: { lt: daysAgo(RETENTION.expiredLinkDays) } }] } })).count,
      resets: (await prisma.passwordReset.deleteMany({ where: { OR: [{ expiresAt: { lt: daysAgo(RETENTION.expiredLinkDays) } }, { usedAt: { lt: daysAgo(RETENTION.expiredLinkDays) } }] } })).count,
      notifications: (await prisma.notification.deleteMany({ where: { readAt: { lt: daysAgo(RETENTION.readNotificationDays) } } })).count,
      aiTaskLogs: (await prisma.aiTaskLog.deleteMany({ where: { createdAt: { lt: daysAgo(RETENTION.aiTaskLogDays) } } })).count,
      ytApiUsage: (await prisma.youTubeApiUsage.deleteMany({ where: { calledAt: { lt: daysAgo(RETENTION.apiUsageDays) } } })).count,
      ytSyncRuns: (await prisma.youTubeSyncRun.deleteMany({ where: { startedAt: { lt: daysAgo(RETENTION.syncRunDays) } } })).count,
      portalInvites: (await prisma.clientPortalInvite.deleteMany({ where: { OR: [{ expiresAt: { lt: daysAgo(RETENTION.expiredLinkDays) } }, { acceptedAt: { lt: daysAgo(RETENTION.expiredLinkDays) } }] } })).count,
      lineLinkCodes: (await prisma.lineLinkCode.deleteMany({ where: { expiresAt: { lt: daysAgo(1) } } })).count,
      lineDeliveries: (await prisma.lineDelivery.deleteMany({ where: { createdAt: { lt: daysAgo(RETENTION.lineDeliveryDays) } } })).count,
    };
    log('maintenance cleanup', r); return r;
  }

  async function tokenCheck(): Promise<{ facebookExpiring: number; pagesInvalid: number; googleError: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const fb = await prisma.facebookConnection.findMany({ where: { status: 'ACTIVE', tokenExpiresAt: { not: null, lt: daysAgo(-RETENTION.tokenWarnDays) } }, select: { id: true, workspaceId: true, providerUserName: true, tokenExpiresAt: true } });
    for (const c of fb) await notify(prisma, authSecret, c.workspaceId, { type: 'reconnect_required', severity: 'warn', title: `token Facebook ของ ${c.providerUserName ?? 'บัญชี'} จะหมดอายุ ${c.tokenExpiresAt!.toLocaleDateString('th-TH')}`, body: 'วาง token ใหม่หรือเชื่อมต่อใหม่ก่อนหมดอายุ เพื่อไม่ให้การซิงก์/โพสต์ตามเวลาหยุด', href: '/pages', resourceType: 'facebookConnection', resourceId: c.id, dedupeKey: `fbtoken-expiring:${c.id}:${day}` }).catch(() => undefined);
    const pages = await prisma.facebookPage.findMany({ where: { disconnectedAt: null, tokenStatus: 'INVALID' }, select: { id: true, name: true, brand: { select: { client: { select: { workspaceId: true } } } } } });
    for (const p of pages) await notify(prisma, authSecret, p.brand.client.workspaceId, { type: 'reconnect_required', severity: 'bad', title: `เพจ ${p.name} ต้องเชื่อมต่อใหม่`, body: 'token ของเพจใช้ไม่ได้แล้ว — วาง token ใหม่ในหน้าเพจ', href: '/pages', resourceType: 'facebookPage', resourceId: p.id, dedupeKey: `token:${p.id}` }).catch(() => undefined);
    const google = await prisma.googleConnection.findMany({ where: { status: 'ERROR', channels: { some: { disconnectedAt: null } } }, select: { id: true, workspaceId: true, email: true, lastError: true } });
    for (const g of google) await notify(prisma, authSecret, g.workspaceId, { type: 'reconnect_required', severity: 'bad', title: `บัญชี Google ${g.email ?? ''} ต้องเชื่อมต่อใหม่`, body: g.lastError ?? undefined, href: '/youtube', resourceType: 'googleConnection', resourceId: g.id, dedupeKey: `google-reconnect:${g.id}:${day}` }).catch(() => undefined);
    const r = { facebookExpiring: fb.length, pagesInvalid: pages.length, googleError: google.length }; log('maintenance token check', r); return r;
  }

  async function staleUploads(): Promise<{ failed: number; recheck: number }> {
    const stale = await prisma.contentItem.findMany({ where: { platform: 'YOUTUBE', ytStatus: { in: ['UPLOADING', 'UPLOAD_PENDING'] }, updatedAt: { lt: hoursAgo(RETENTION.staleUploadHours) } }, select: { id: true, youtubeMeta: { select: { title: true } }, youtubeChannel: { select: { brand: { select: { client: { select: { workspaceId: true } } } } } } } });
    for (const c of stale) {
      const msg = `อัปโหลดค้างเกิน ${RETENTION.staleUploadHours} ชม. — ระบบหยุดงานนี้ กด "อัปโหลด" ใหม่ได้ (resume จาก session เดิม)`;
      await prisma.contentItem.update({ where: { id: c.id }, data: { ytStatus: 'UPLOAD_FAILED', status: 'PUBLISH_FAILED', lastError: msg } });
      await prisma.youTubeUploadOperation.updateMany({ where: { contentItemId: c.id, status: { in: ['PENDING', 'UPLOADING'] } }, data: { error: msg } });
      const ws = c.youtubeChannel?.brand.client.workspaceId; if (ws) await notify(prisma, authSecret, ws, { type: 'publish_failed', severity: 'bad', title: `อัปโหลด YouTube ค้าง: ${c.youtubeMeta?.title ?? ''}`, body: msg, href: '/youtube/content', resourceType: 'contentItem', resourceId: c.id, dedupeKey: `yt-stale:${c.id}` }).catch(() => undefined);
    }
    const processing = await prisma.contentItem.findMany({ where: { platform: 'YOUTUBE', ytStatus: 'PROCESSING', updatedAt: { lt: hoursAgo(RETENTION.staleProcessingHours) } }, select: { id: true } });
    for (const c of processing) await ytUploadQueue.add(JOBS.ytCheckProcessing, { contentId: c.id, requestId: `maintenance-${Date.now()}`, attempt: 1 }, { jobId: `ytproc-${c.id}-m${Math.floor(Date.now() / 3_600_000)}`, attempts: 2 });
    const r = { failed: stale.length, recheck: processing.length }; log('maintenance stale uploads', r); return r;
  }

  async function communityReminders(): Promise<{ reminded: number }> {
    const due = await prisma.youTubeCommunityDraft.findMany({ where: { status: 'DRAFT', remindedAt: null, scheduledAt: { lte: new Date() } }, take: 200, select: { id: true, text: true, channel: { select: { title: true, brand: { select: { client: { select: { workspaceId: true } } } } } } } });
    for (const d of due) {
      await notify(prisma, authSecret, d.channel.brand.client.workspaceId, { type: 'info', severity: 'warn', title: `ถึงเวลาโพสต์ชุมชน YouTube: ${d.channel.title}`, body: d.text.slice(0, 140), href: '/youtube/community', resourceType: 'youTubeCommunityDraft', resourceId: d.id, dedupeKey: `yt-community:${d.id}` }).catch(() => undefined);
      await prisma.youTubeCommunityDraft.update({ where: { id: d.id }, data: { remindedAt: new Date() } });
    }
    const r = { reminded: due.length }; if (due.length) log('youtube community reminders', r); return r;
  }

  /**
   * งานตั้งเวลาอยู่ใน Redis (BullMQ delayed job) — ถ้า Redis หาย/ย้ายเครื่อง/กู้ backup ฐานข้อมูลยังบอก SCHEDULED แต่ไม่มีใครโพสต์
   * → ใส่คิวใหม่ด้วย jobId เดิม (ไม่ซ้ำกับงานที่มีอยู่) · เลยเวลาแล้วก็รันทันที — publisher กันโพสต์ซ้ำเองด้วย ExternalOperation
   */
  async function reconcileSchedules(): Promise<{ checked: number; requeued: number; overdue: number }> {
    if (!publishQueue) return { checked: 0, requeued: 0, overdue: 0 };
    const items = await prisma.contentItem.findMany({ where: { platform: 'FACEBOOK', status: 'SCHEDULED', scheduledAt: { not: null } }, select: { id: true, scheduledAt: true }, take: 2000 });
    let requeued = 0; let overdue = 0;
    for (const c of items) {
      if (await publishQueue.getJob(publishJobId(c.id))) continue;
      const delay = Math.max(0, c.scheduledAt!.getTime() - Date.now()); if (!delay) overdue++;
      await publishQueue.add(JOBS.publishContent, { contentId: c.id, requestId: `reconcile-${Date.now()}`, scheduled: true }, { jobId: publishJobId(c.id), delay, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
      requeued++;
    }
    const r = { checked: items.length, requeued, overdue }; if (requeued) log('schedule reconcile: re-queued missing publish jobs', r); return r;
  }

  async function lineDigest() {
    const r = await lineInboxDigest(prisma, authSecret); if (r.sent) log('line inbox digest', r); return r;
  }

  async function handle(job: Job): Promise<unknown> {
    if (job.name === JOBS.maintenanceCleanup) return cleanup();
    if (job.name === JOBS.maintenanceTokenCheck) return tokenCheck();
    if (job.name === JOBS.ytStaleUploads) return staleUploads();
    if (job.name === JOBS.ytCommunityReminders) return communityReminders();
    if (job.name === JOBS.scheduleReconcile) return reconcileSchedules();
    if (job.name === JOBS.lineInboxDigest) return lineDigest();
    return { skipped: job.name };
  }
  return { cleanup, tokenCheck, staleUploads, communityReminders, reconcileSchedules, lineDigest, handle };
}

export async function registerMaintenanceSchedulers(maintenance: Queue, ytMaintenance: Queue): Promise<void> {
  await maintenance.upsertJobScheduler('maintenance-cleanup-daily', { pattern: '0 4 * * *' }, { name: JOBS.maintenanceCleanup, data: {} });
  await maintenance.upsertJobScheduler('schedule-reconcile-15m', { every: 15 * 60_000 }, { name: JOBS.scheduleReconcile, data: {} });
  await maintenance.upsertJobScheduler('line-inbox-digest-30m', { every: 30 * 60_000 }, { name: JOBS.lineInboxDigest, data: {} });
  await maintenance.upsertJobScheduler('maintenance-token-check-12h', { every: 12 * 3_600_000 }, { name: JOBS.maintenanceTokenCheck, data: {} });
  await ytMaintenance.upsertJobScheduler('yt-stale-uploads-1h', { every: 3_600_000 }, { name: JOBS.ytStaleUploads, data: {} });
  await ytMaintenance.upsertJobScheduler('yt-community-reminders-10m', { every: 10 * 60_000 }, { name: JOBS.ytCommunityReminders, data: {} });
}
