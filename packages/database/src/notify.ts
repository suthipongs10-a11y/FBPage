/**
 * Notification helper (§65) — ใช้ร่วมกันระหว่าง API และ worker: บันทึกในแอป (dedupe) + ส่งต่อ webhook ภายนอกถ้าตั้งไว้
 * transport แยกจากการสร้างเหตุการณ์: ฝั่ง domain เรียก notify() อย่างเดียว
 */
import type { PrismaClient } from '@prisma/client';
import { decryptSecret } from './crypto';
import type { Mailer } from './mail';

export type NotificationType = 'approval_required' | 'publish_failed' | 'reconnect_required' | 'hot_lead' | 'report_ready' | 'ai_budget' | 'comments_permission' | 'info';
export interface NotifyInput { type: NotificationType; severity?: 'info' | 'warn' | 'bad'; title: string; body?: string; href?: string; resourceType?: string; resourceId?: string; dedupeKey?: string }

/** อีเมลแจ้งเตือน (ถ้าตั้ง SMTP): เฉพาะ severity 'bad' / approval_required / hot_lead ถึง owner+admin ของ workspace — ตั้งครั้งเดียวตอน boot ของ API/worker */
let mailHook: { mailer: Mailer; appUrl: string } | null = null;
export function setNotifyMailer(mailer: Mailer | null, appUrl: string): void { mailHook = mailer ? { mailer, appUrl } : null; }
export const emailWorthy = (i: NotifyInput): boolean => i.severity === 'bad' || i.type === 'approval_required' || i.type === 'hot_lead';
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
async function emailMembers(prisma: PrismaClient, workspaceId: string, input: NotifyInput): Promise<void> {
  if (!mailHook || !emailWorthy(input)) return;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, members: { where: { role: { in: ['owner', 'admin'] } }, select: { user: { select: { email: true } } } } } });
  const to = ws?.members.map(m => m.user.email).filter(Boolean) ?? []; if (!ws || !to.length) return;
  const link = input.href ? `${mailHook.appUrl}${input.href}` : mailHook.appUrl;
  await mailHook.mailer.send({ to, subject: `[${ws.name}] ${input.title}`, text: [input.title, '', input.body ?? '', '', `เปิดระบบ: ${link}`].join('\n'), html: `<p><b>${esc(input.title)}</b></p>${input.body ? `<p>${esc(input.body)}</p>` : ''}<p><a href="${link}">เปิดระบบ</a></p><p style="color:#888;font-size:12px">${esc(ws.name)} · AI Page Manager</p>` });
}

export async function notify(prisma: PrismaClient, authSecret: string, workspaceId: string, input: NotifyInput): Promise<{ id: string; created: boolean }> {
  const data = { workspaceId, type: input.type, severity: input.severity ?? 'info', title: input.title, body: input.body ?? null, href: input.href ?? null, resourceType: input.resourceType ?? null, resourceId: input.resourceId ?? null, dedupeKey: input.dedupeKey ?? null };
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
  return { id, created };
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
