/**
 * Campaign sender (W-4) — ส่งแคมเปญที่ APPROVED/SCHEDULED ผ่านผู้ให้บริการ กันซ้ำต่อผู้รับด้วย EmailSend (unique campaignId+subscriberId)
 * ใช้ทั้ง API ("ส่งตอนนี้") และ worker (ตั้งเวลา) — ตรวจ kill switch ทุกครั้ง: EMAIL_SEND_ENABLED, workspace.automationPaused, account.sendingPaused
 * ส่งให้เฉพาะสถานะ SUBSCRIBED; ทุกฉบับมีลิงก์ยกเลิกรับ; API key ถอดรหัสเฉพาะตอนส่ง
 */
import type { PrismaClient } from '@fbpm/database';
import { decryptSecret } from '@fbpm/database';
import type { EmailProviderId } from '@fbpm/shared';
import { createProvider } from './providers';
import { renderEmail } from './render';
import { EmailError, type BulkMailProvider, type ProviderOptions } from './types';

export interface EmailDeps { prisma: PrismaClient; authSecret: string; appUrl: string; sendEnabled: boolean; providerBaseUrl?: string; providerFactory?: (id: EmailProviderId, opts: ProviderOptions) => BulkMailProvider; sendDelayMs?: number; fetchImpl?: typeof fetch; now?: () => Date }
export type SendOutcome = { status: 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED'; reason?: string; sent: number; failed: number; skipped: number; retryable: boolean; total: number };

const SENDABLE = ['APPROVED', 'SCHEDULED', 'SENDING', 'SEND_FAILED'];
export const unsubscribeUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/+$/, '')}/api/email/u/${token}`;

export function providerForAccount(d: EmailDeps, acc: { provider: string; apiKeyEnc: string }): BulkMailProvider {
  const factory = d.providerFactory ?? createProvider;
  return factory(acc.provider as EmailProviderId, { apiKey: decryptSecret(acc.apiKeyEnc, d.authSecret), baseUrl: d.providerBaseUrl, fetchImpl: d.fetchImpl });
}

/** เหตุผลที่ห้ามส่งตอนนี้ — null = ส่งได้ */
export async function sendBlockReason(d: EmailDeps, campaignId: string): Promise<string | null> {
  const c = await d.prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: { status: true, subject: true, bodyHtml: true, list: { select: { archivedAt: true, fromEmail: true } }, workspace: { select: { automationPaused: true, emailProvider: { select: { status: true, sendingPaused: true } } } } } });
  if (!c) return 'ไม่พบแคมเปญ';
  if (!SENDABLE.includes(c.status)) return `สถานะ ${c.status} ส่งไม่ได้ — ต้องอนุมัติก่อน`;
  if (!d.sendEnabled) return 'ระบบยังไม่เปิดให้ส่งอีเมลการตลาด (EMAIL_SEND_ENABLED ไม่ได้ตั้งเป็น true)';
  if (c.workspace.automationPaused) return 'ระบบอัตโนมัติของ workspace ถูกหยุดไว้ (สวิตช์ฉุกเฉิน)';
  if (!c.workspace.emailProvider) return 'ยังไม่ได้ตั้งค่าผู้ให้บริการส่งอีเมล (Brevo/Resend)';
  if (c.workspace.emailProvider.sendingPaused) return 'การส่งอีเมลถูกหยุดไว้';
  if (c.workspace.emailProvider.status === 'AUTH_FAILED') return 'API key ของผู้ให้บริการใช้ไม่ได้ — ตั้งค่าใหม่ก่อน';
  if (c.list.archivedAt) return 'รายชื่อผู้รับถูกเก็บถาวรแล้ว';
  if (!c.subject || !c.bodyHtml) return 'แคมเปญต้องมีหัวเรื่องและเนื้อหา';
  return null;
}

export async function sendCampaign(d: EmailDeps, campaignId: string, _opts: { requestId: string; scheduledSend?: boolean } = { requestId: 'n/a' }): Promise<SendOutcome> {
  const blocked = await sendBlockReason(d, campaignId);
  if (blocked) return { status: 'SKIPPED', reason: blocked, sent: 0, failed: 0, skipped: 0, retryable: false, total: 0 };
  const c = await d.prisma.emailCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { id: true, subject: true, preheader: true, bodyHtml: true, bodyText: true, list: { select: { id: true, fromEmail: true, fromName: true, replyTo: true, brand: { select: { name: true } } } }, workspace: { select: { emailProvider: { select: { id: true, provider: true, apiKeyEnc: true } } } } } });
  const acc = c.workspace.emailProvider!; const now = d.now ?? (() => new Date());
  await d.prisma.emailCampaign.update({ where: { id: campaignId }, data: { status: 'SENDING', startedAt: now(), lastError: null } });
  // สร้างแถว EmailSend ให้ผู้รับที่ยังสมัครอยู่ทุกคน (skipDuplicates → รอบ retry ไม่สร้างซ้ำ)
  const subs = await d.prisma.emailSubscriber.findMany({ where: { listId: c.list.id, status: 'SUBSCRIBED' }, select: { id: true } });
  if (subs.length) await d.prisma.emailSend.createMany({ data: subs.map(s => ({ campaignId, subscriberId: s.id })), skipDuplicates: true });
  const total = await d.prisma.emailSend.count({ where: { campaignId } });
  await d.prisma.emailCampaign.update({ where: { id: campaignId }, data: { recipientCount: total } });

  const provider = providerForAccount(d, acc);
  const pending = await d.prisma.emailSend.findMany({ where: { campaignId, status: { in: ['QUEUED', 'FAILED'] } }, select: { id: true, status: true, error: true, subscriber: { select: { id: true, email: true, name: true, status: true, unsubscribeToken: true } } }, orderBy: { createdAt: 'asc' } });
  let sent = 0, failed = 0, skipped = 0, retryable = false, authFailed: string | null = null;
  for (const s of pending) {
    if (s.status === 'FAILED' && s.error?.startsWith('[final]')) { failed++; continue; }
    if (s.subscriber.status !== 'SUBSCRIBED') { await d.prisma.emailSend.update({ where: { id: s.id }, data: { status: 'SKIPPED', error: `ผู้รับสถานะ ${s.subscriber.status}` } }); skipped++; continue; }
    const r = renderEmail({ bodyHtml: c.bodyHtml!, bodyText: c.bodyText, subject: c.subject!, preheader: c.preheader, subscriber: s.subscriber, unsubscribeUrl: unsubscribeUrl(d.appUrl, s.subscriber.unsubscribeToken), fromName: c.list.fromName, brandName: c.list.brand.name });
    try {
      const out = await provider.send({ to: { email: s.subscriber.email, name: s.subscriber.name }, from: { email: c.list.fromEmail, name: c.list.fromName }, replyTo: c.list.replyTo, subject: r.subject, html: r.html, text: r.text, campaignId, sendId: s.id, listUnsubscribeUrl: unsubscribeUrl(d.appUrl, s.subscriber.unsubscribeToken) });
      await d.prisma.emailSend.update({ where: { id: s.id }, data: { status: 'SENT', providerMessageId: out.messageId, sentAt: now(), error: null } }); sent++;
    } catch (e) {
      const err = e instanceof EmailError ? e : new EmailError(e instanceof Error ? e.message : String(e), 'unknown');
      if (err.code === 'auth') { authFailed = err.message; await d.prisma.emailSend.update({ where: { id: s.id }, data: { status: 'FAILED', error: err.message.slice(0, 300) } }); failed++; break; }
      const final = err.code === 'invalid' || err.code === 'blocked';
      if (!final) retryable = true;
      await d.prisma.emailSend.update({ where: { id: s.id }, data: { status: 'FAILED', error: `${final ? '[final] ' : ''}${err.message}`.slice(0, 300) } }); failed++;
      if (err.code === 'quota') { retryable = true; break; }   // หยุดรอบนี้ ให้ retry ทีหลัง
    }
    if (d.sendDelayMs) await new Promise(r => setTimeout(r, d.sendDelayMs));
  }
  const totals = await d.prisma.emailSend.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } });
  const count = (st: string) => totals.find(t => t.status === st)?._count._all ?? 0;
  const sentAll = count('SENT') + count('DELIVERED') + count('OPENED') + count('CLICKED') + count('BOUNCED') + count('COMPLAINED'); const failedAll = count('FAILED'); const queued = count('QUEUED');
  if (authFailed) await d.prisma.emailProviderAccount.update({ where: { id: acc.id }, data: { status: 'AUTH_FAILED', lastError: authFailed.slice(0, 500) } });
  const done = !authFailed && !retryable && queued === 0;
  const status = authFailed || (retryable && !done) ? 'SEND_FAILED' : 'SENT';
  await d.prisma.emailCampaign.update({ where: { id: campaignId }, data: { status, sentCount: sentAll, failedCount: failedAll, ...(status === 'SENT' && { sentAt: now() }), lastError: authFailed ?? (retryable ? 'ส่งไม่ครบ — บางฉบับส่งไม่สำเร็จ (จะลองใหม่)' : failedAll ? `${failedAll} ฉบับถูกผู้ให้บริการปฏิเสธ (ที่อยู่ไม่ถูกต้อง)` : null) } });
  return { status: authFailed ? 'FAILED' : status === 'SENT' ? (failedAll ? 'PARTIAL' : 'SENT') : 'FAILED', reason: authFailed ?? undefined, sent, failed, skipped, retryable: !!retryable && !authFailed, total };
}
