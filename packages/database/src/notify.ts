/**
 * Notification helper (§65) — ใช้ร่วมกันระหว่าง API และ worker: บันทึกในแอป (dedupe) + ส่งต่อ webhook ภายนอกถ้าตั้งไว้
 * transport แยกจากการสร้างเหตุการณ์: ฝั่ง domain เรียก notify() อย่างเดียว
 */
import type { PrismaClient } from '../generated/client';
import { decryptSecret } from './crypto';
import type { Mailer } from './mail';
import { linePush } from './line';

export type NotificationType = 'approval_required' | 'publish_failed' | 'reconnect_required' | 'hot_lead' | 'report_ready' | 'ai_budget' | 'comments_permission' | 'inbox_digest' | 'client_decision' | 'info';
/** clientId ไม่ใส่ก็ได้ — notify หาเองจาก resourceType/resourceId (ใช้ส่ง LINE ถึงเจ้าของธุรกิจของลูกค้ารายนั้น) */
export interface NotifyInput { type: NotificationType; severity?: 'info' | 'warn' | 'bad'; title: string; body?: string; href?: string; resourceType?: string; resourceId?: string; dedupeKey?: string; clientId?: string | null }

/** อีเมลแจ้งเตือน (ถ้าตั้ง SMTP): เฉพาะ severity 'bad' / approval_required / hot_lead ถึง owner+admin ของ workspace — ตั้งครั้งเดียวตอน boot ของ API/worker */
let mailHook: { mailer: Mailer; appUrl: string } | null = null;
export function setNotifyMailer(mailer: Mailer | null, appUrl: string): void { mailHook = mailer ? { mailer, appUrl } : null; linkBase = appUrl.replace(/\/+$/, ''); }
/** URL หน้าเว็บสำหรับลิงก์ในข้อความ LINE — API/worker ตั้งตอน boot */
let linkBase = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
export function setNotifyAppUrl(appUrl: string): void { linkBase = appUrl.replace(/\/+$/, ''); }
export const emailWorthy = (i: NotifyInput): boolean => i.severity === 'bad' || i.type === 'approval_required' || i.type === 'hot_lead';
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
async function emailMembers(prisma: PrismaClient, workspaceId: string, input: NotifyInput): Promise<void> {
  if (!mailHook || !emailWorthy(input)) return;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, members: { where: { role: { in: ['owner', 'admin'] } }, select: { user: { select: { email: true } } } } } });
  const to = ws?.members.map(m => m.user.email).filter(Boolean) ?? []; if (!ws || !to.length) return;
  const link = input.href ? `${mailHook.appUrl}${input.href}` : mailHook.appUrl;
  await mailHook.mailer.send({ to, subject: `[${ws.name}] ${input.title}`, text: [input.title, '', input.body ?? '', '', `เปิดระบบ: ${link}`].join('\n'), html: `<p><b>${esc(input.title)}</b></p>${input.body ? `<p>${esc(input.body)}</p>` : ''}<p><a href="${link}">เปิดระบบ</a></p><p style="color:#888;font-size:12px">${esc(ws.name)} · AI Page Manager</p>` });
}

/** ลูกค้าเจ้าของ resource (Client → Brand → เพจ/ช่อง) — null ถ้าไม่ผูกกับลูกค้ารายใด */
export async function resolveClientId(prisma: PrismaClient, input: Pick<NotifyInput, 'clientId' | 'resourceType' | 'resourceId'>): Promise<string | null> {
  if (input.clientId !== undefined) return input.clientId;
  const id = input.resourceId; if (!id) return null;
  const viaPage = { page: { select: { brand: { select: { clientId: true } } } } } as const;
  try {
    switch (input.resourceType) {
      case 'client': return id;
      case 'facebookPage': return (await prisma.facebookPage.findUnique({ where: { id }, select: { brand: { select: { clientId: true } } } }))?.brand.clientId ?? null;
      case 'lead': return (await prisma.lead.findUnique({ where: { id }, select: viaPage }))?.page?.brand.clientId ?? null;
      case 'pageComment': return (await prisma.pageComment.findUnique({ where: { id }, select: viaPage }))?.page.brand.clientId ?? null;
      case 'messengerConversation': return (await prisma.messengerConversation.findUnique({ where: { id }, select: viaPage }))?.page.brand.clientId ?? null;
      case 'youtubeChannel': return (await prisma.youTubeChannel.findUnique({ where: { id }, select: { brand: { select: { clientId: true } } } }))?.brand.clientId ?? null;
      case 'contentItem': { const c = await prisma.contentItem.findUnique({ where: { id }, select: { ...viaPage, youtubeChannel: { select: { brand: { select: { clientId: true } } } } } }); return c?.page?.brand.clientId ?? c?.youtubeChannel?.brand.clientId ?? null; }
      default: return null;
    }
  } catch { return null; }
}

export async function notify(prisma: PrismaClient, authSecret: string, workspaceId: string, input: NotifyInput): Promise<{ id: string; created: boolean }> {
  const clientId = await resolveClientId(prisma, input);
  const data = { workspaceId, type: input.type, severity: input.severity ?? 'info', title: input.title, body: input.body ?? null, href: input.href ?? null, resourceType: input.resourceType ?? null, resourceId: input.resourceId ?? null, dedupeKey: input.dedupeKey ?? null, clientId };
  let id: string; const created = true;
  if (input.dedupeKey) {
    const existing = await prisma.notification.findUnique({ where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: input.dedupeKey } }, select: { id: true, readAt: true } });
    if (existing) {
      // ซ้ำ: ถ้าอ่านแล้วให้เด้งกลับมาใหม่ (unread) แต่ไม่ส่ง webhook ซ้ำ
      await prisma.notification.update({ where: { id: existing.id }, data: { ...data, readAt: null, createdAt: new Date() } });
      return { id: existing.id, created: false };
    }
    id = (await prisma.notification.create({ data, select: { id: true } })).id;
  } else id = (await prisma.notification.create({ data, select: { id: true } })).id;
  void dispatchWebhook(prisma, authSecret, workspaceId, input).catch(() => undefined);
  void emailMembers(prisma, workspaceId, input).catch(() => undefined);
  void dispatchLine(prisma, authSecret, workspaceId, { ...input, clientId }, id).catch(() => undefined);
  return { id, created };
}

// ---------- LINE ----------
/** ชนิดแจ้งเตือนเริ่มต้น — ทีมได้ทุกเรื่องสำคัญ · เจ้าของธุรกิจได้เฉพาะเรื่องของร้านตัวเอง */
export const LINE_TEAM_DEFAULT: NotificationType[] = ['approval_required', 'publish_failed', 'reconnect_required', 'hot_lead', 'report_ready', 'ai_budget', 'comments_permission', 'inbox_digest', 'client_decision'];
export const LINE_CLIENT_DEFAULT: NotificationType[] = ['hot_lead', 'inbox_digest', 'approval_required', 'report_ready'];
export const LINE_CLIENT_ALLOWED: NotificationType[] = ['hot_lead', 'inbox_digest', 'approval_required', 'report_ready', 'publish_failed'];
const PORTAL_TAB: Partial<Record<NotificationType, string>> = { approval_required: 'approvals', hot_lead: 'leads', inbox_digest: 'inbox', report_ready: 'reports' };
export const lineMaxPerDay = (): number => Math.max(1, Number(process.env.LINE_MAX_PUSH_PER_DAY ?? 30) || 30);
export const portalLink = (clientId: string, type?: NotificationType) => `${linkBase}/portal/${clientId}${type && PORTAL_TAB[type] ? `?tab=${PORTAL_TAB[type]}` : ''}`;
export const teamLink = (href?: string | null) => `${linkBase}${href ?? '/'}`;

interface Recipient { id: string; lineUserId: string; clientId: string | null; types: string[] }
export const wantsType = (r: Pick<Recipient, 'clientId' | 'types'>, type: NotificationType): boolean => {
  if (r.clientId && !LINE_CLIENT_ALLOWED.includes(type)) return false;   // เจ้าของธุรกิจไม่รับเรื่องภายในทีม (token/งบ AI ฯลฯ)
  return r.types.length ? r.types.includes(type) : (r.clientId ? LINE_CLIENT_DEFAULT : LINE_TEAM_DEFAULT).includes(type);
};

/** ส่งข้อความ LINE ถึงผู้รับหลายคน — เคารพเพดานต่อวัน · บันทึก LineDelivery ทุกครั้ง · ไม่ throw */
export async function sendLineTo(prisma: PrismaClient, authSecret: string, workspaceId: string, recipients: Recipient[], textFor: (r: Recipient) => string, notificationId?: string, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 }; if (!recipients.length) return out;
  const ch = await prisma.lineChannel.findUnique({ where: { workspaceId }, select: { accessTokenEncrypted: true } }); if (!ch) return out;
  const token = decryptSecret(ch.accessTokenEncrypted, authSecret);
  const since = new Date(); since.setHours(0, 0, 0, 0);
  for (const r of recipients) {
    const used = await prisma.lineDelivery.count({ where: { recipientId: r.id, kind: 'push', status: 'SENT', createdAt: { gte: since } } });
    if (used >= lineMaxPerDay()) { out.skipped++; await prisma.lineDelivery.create({ data: { workspaceId, recipientId: r.id, notificationId, kind: 'push', status: 'SKIPPED', error: 'daily_cap' } }); continue; }
    const res = await linePush(token, r.lineUserId, textFor(r), fetchImpl);
    if (res.ok) out.sent++; else out.failed++;
    await prisma.lineDelivery.create({ data: { workspaceId, recipientId: r.id, notificationId, kind: 'push', status: res.ok ? 'SENT' : 'FAILED', error: res.ok ? null : res.error ?? `HTTP ${res.status}` } });
    // ผู้ใช้บล็อก OA / เลิกเป็นเพื่อน → LINE ตอบ 400/403 — ปิดผู้รับไว้ ไม่ยิงซ้ำทุกครั้ง
    if (!res.ok && (res.status === 400 || res.status === 403)) await prisma.lineRecipient.update({ where: { id: r.id }, data: { active: false } }).catch(() => undefined);
  }
  return out;
}

/** แจ้งเตือนในแอป → LINE: ทีม (clientId null) ได้ทุกลูกค้า · เจ้าของธุรกิจได้เฉพาะเรื่องของลูกค้าตัวเอง */
export async function dispatchLine(prisma: PrismaClient, authSecret: string, workspaceId: string, input: NotifyInput & { clientId: string | null }, notificationId?: string, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; skipped: number; failed: number }> {
  const has = await prisma.lineChannel.count({ where: { workspaceId } }); if (!has) return { sent: 0, skipped: 0, failed: 0 };
  const all = await prisma.lineRecipient.findMany({ where: { workspaceId, active: true, OR: [{ clientId: null }, ...(input.clientId ? [{ clientId: input.clientId }] : [])] }, select: { id: true, lineUserId: true, clientId: true, types: true } });
  const recipients = all.filter(r => wantsType(r, input.type));
  if (!recipients.length) return { sent: 0, skipped: 0, failed: 0 };
  const clientName = input.clientId ? (await prisma.client.findUnique({ where: { id: input.clientId }, select: { name: true } }))?.name : null;
  const icon = input.severity === 'bad' ? '⚠️' : input.type === 'hot_lead' ? '🔥' : input.type === 'approval_required' ? '✅' : input.type === 'client_decision' ? '🙋' : input.type === 'inbox_digest' ? '💬' : '🔔';
  return sendLineTo(prisma, authSecret, workspaceId, recipients, r => [
    `${icon} ${!r.clientId && clientName ? `[${clientName}] ` : ''}${input.title}`,
    ...(input.body ? [input.body.slice(0, 600)] : []),
    '', `👉 ${r.clientId ? portalLink(r.clientId, input.type) : teamLink(input.href)}`,
  ].join('\n'), notificationId, fetchImpl);
}

/** ส่ง JSON ไป webhook ของ workspace (Discord/Slack/LINE Notify ผ่านตัวกลาง/ระบบของลูกค้า) — ล้มเงียบ ไม่กระทบงานหลัก */
export async function dispatchWebhook(prisma: PrismaClient, authSecret: string, workspaceId: string, input: NotifyInput, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, notifyWebhookEncrypted: true } });
  if (!ws?.notifyWebhookEncrypted) return false;
  const url = decryptSecret(ws.notifyWebhookEncrypted, authSecret);
  const text = `[${ws.name}] ${input.title}${input.body ? `\n${input.body}` : ''}${input.href ? `\n${input.href}` : ''}`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    // รูปแบบครอบคลุม Discord (content), Slack (text) และ webhook ทั่วไป (title/body/...)
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, text, title: input.title, body: input.body ?? null, href: input.href ?? null, type: input.type, severity: input.severity ?? 'info', workspace: ws.name }), signal: ctl.signal });
    return res.ok;
  } catch { return false; } finally { clearTimeout(timer); }
}
