/**
 * W-4 email-send queue — ส่งแคมเปญที่ตั้งเวลา/สั่งส่งผ่านคิว (idempotent ต่อผู้รับด้วย EmailSend; publisher ตรวจ kill switch เอง)
 * ไม่ใช้ AI ใน worker · แจ้งเตือนเมื่อส่งไม่สำเร็จรอบสุดท้าย
 */
import type { Job } from 'bullmq';
import { PrismaClient, notify } from '@fbpm/database';
import { sendCampaign, type EmailDeps } from '@fbpm/email-core';
import { EMAIL_JOBS } from '@fbpm/shared';

export function buildWorkerEmailDeps(prisma: PrismaClient, authSecret: string, env: NodeJS.ProcessEnv = process.env): EmailDeps {
  const mock = env.EMAIL_MOCK_BASE_URL?.replace(/\/+$/, '');
  return { prisma, authSecret, appUrl: env.APP_URL ?? 'http://localhost:3000', sendEnabled: (env.EMAIL_SEND_ENABLED ?? '').toLowerCase() === 'true' || env.EMAIL_SEND_ENABLED === '1', providerBaseUrl: mock, sendDelayMs: mock ? 0 : 60 };
}

export function createEmailHandlers(ctx: { prisma: PrismaClient; deps: EmailDeps; authSecret: string; log: (msg: string, extra?: Record<string, unknown>) => void }) {
  const { prisma, deps, authSecret, log } = ctx;
  async function handleSend(job: Job<{ campaignId: string; requestId?: string }>): Promise<unknown> {
    if (job.name !== EMAIL_JOBS.sendCampaign) return { skipped: job.name };
    const { campaignId, requestId = `job-${job.id}` } = job.data;
    const c = await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: { status: true, subject: true, workspaceId: true } });
    if (!c) return { skipped: 'campaign missing' };
    if (!['SCHEDULED', 'APPROVED', 'SENDING', 'SEND_FAILED'].includes(c.status)) return { skipped: `status ${c.status}` };
    const outcome = await sendCampaign(deps, campaignId, { requestId, scheduledSend: true });
    log('email campaign outcome', { campaignId, ...outcome, requestId, attempt: job.attemptsMade + 1 });
    if (outcome.status === 'FAILED') {
      const last = !outcome.retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (last) await notify(prisma, authSecret, c.workspaceId, { type: 'publish_failed', severity: 'bad', title: `ส่งอีเมลตามเวลาไม่สำเร็จ: ${c.subject ?? ''}`, body: outcome.reason ?? `ส่งไม่ครบ ${outcome.failed} ฉบับ`, href: '/email', resourceType: 'emailCampaign', resourceId: campaignId, dedupeKey: `email_failed:${campaignId}` }).catch(() => undefined);
      if (outcome.retryable) throw new Error(outcome.reason ?? 'ส่งไม่ครบ — ลองใหม่');   // BullMQ retry; sender กันซ้ำต่อผู้รับเอง
    }
    return outcome;
  }
  return { handleSend };
}
