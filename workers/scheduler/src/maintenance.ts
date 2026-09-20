/**
 * Maintenance queues (§46 maintenance / AGENTS_YOUTUBE §66 youtube-maintenance)
 * - cleanup รายวัน: ลบข้อมูลชั่วคราวที่หมดอายุ (session, invite/reset ที่หมดอายุหรือใช้แล้ว, notification ที่อ่านแล้ว, AiTaskLog/ApiUsage/SyncRun เก่า)
 *   **ไม่ลบ** AuditLog, metric snapshot, report — เป็นประวัติที่รายงานอ้างอิง
 * - token check ทุก 12 ชม.: Facebook user token ใกล้หมดอายุ / เพจ token INVALID / Google connection ERROR → แจ้งเตือน (dedupe รายวัน)
 * - stale uploads รายชั่วโมง: upload ที่ค้าง UPLOADING/UPLOAD_PENDING นานเกิน → UPLOAD_FAILED (retry ได้จากหน้า Content Lab) · PROCESSING นานเกิน → ตรวจใหม่
 */
import type { Queue, Job } from 'bullmq';
import { PrismaClient, notify } from '@fbpm/database';
import { JOBS } from '@fbpm/shared';

export const RETENTION = { aiTaskLogDays: 180, apiUsageDays: 90, syncRunDays: 90, readNotificationDays: 90, expiredLinkDays: 30, staleUploadHours: 6, staleProcessingHours: 24, tokenWarnDays: 7 } as const;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

export interface MaintenanceContext { prisma: PrismaClient; authSecret: string; ytUploadQueue: Queue; log: (msg: string, extra?: Record<string, unknown>) => void }

export function createMaintenanceHandlers(ctx: MaintenanceContext) {
  const { prisma, authSecret, ytUploadQueue, log } = ctx;

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

  async function handle(job: Job): Promise<unknown> {
    if (job.name === JOBS.maintenanceCleanup) return cleanup();
    if (job.name === JOBS.maintenanceTokenCheck) return tokenCheck();
    if (job.name === JOBS.ytStaleUploads) return staleUploads();
    return { skipped: job.name };
  }
  return { cleanup, tokenCheck, staleUploads, handle };
}

export async function registerMaintenanceSchedulers(maintenance: Queue, ytMaintenance: Queue): Promise<void> {
  await maintenance.upsertJobScheduler('maintenance-cleanup-daily', { pattern: '0 4 * * *' }, { name: JOBS.maintenanceCleanup, data: {} });
  await maintenance.upsertJobScheduler('maintenance-token-check-12h', { every: 12 * 3_600_000 }, { name: JOBS.maintenanceTokenCheck, data: {} });
  await ytMaintenance.upsertJobScheduler('yt-stale-uploads-1h', { every: 3_600_000 }, { name: JOBS.ytStaleUploads, data: {} });
}
