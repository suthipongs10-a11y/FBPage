/**
 * สรุปคอมเมนต์/แชทใหม่ส่ง LINE (worker ทุก 30 นาที) — docs/LINE_PORTAL.md
 * เจ้าของธุรกิจ: สรุปเฉพาะร้านตัวเอง + ลิงก์พอร์ทัล · ทีม: ข้อความเดียวรวมทุกลูกค้า
 * ช่วงเงียบ 22:00–07:00 ตามเขตเวลาของ workspace ไม่ส่ง และไม่ขยับเวลาอ้างอิง → เช้ามาได้สรุปของทั้งคืนในข้อความเดียว
 * ไม่มีอะไรใหม่ = ไม่ส่ง (ไม่เปลืองโควต้าข้อความของ OA)
 */
import type { PrismaClient } from '../generated/client';
import { portalLink, sendLineTo, teamLink, wantsType } from './notify';

const FIRST_LOOKBACK_MS = 2 * 3_600_000;
const MAX_LOOKBACK_MS = 24 * 3_600_000;   // เพิ่งผูก LINE หลังปิดไปนาน — ไม่ขุดของเก่าเกินวัน
export const QUIET_HOURS = { from: 22, to: 7 } as const;

export function localHour(now: Date, timeZone: string): number {
  try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now)); } catch { return now.getUTCHours(); }
}
export const inQuietHours = (hour: number) => hour >= QUIET_HOURS.from || hour < QUIET_HOURS.to;

interface ClientDigest { clientId: string; name: string; comments: number; pending: number; messages: number; people: number; needsAttention: number; samples: string[] }
const clip = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

export function digestLines(d: ClientDigest): string[] {
  return [
    ...(d.comments ? [`• คอมเมนต์ใหม่ ${d.comments}${d.pending ? ` (ยังไม่ได้ตอบ ${d.pending})` : ''}`] : []),
    ...(d.messages ? [`• ข้อความแชทใหม่ ${d.messages} จาก ${d.people} คน`] : []),
    ...(d.needsAttention ? [`• แชทที่ต้องให้คนตอบ ${d.needsAttention}`] : []),
  ];
}

export async function lineInboxDigest(prisma: PrismaClient, authSecret: string, opts: { now?: Date; ignoreQuietHours?: boolean; fetchImpl?: typeof fetch } = {}): Promise<{ workspaces: number; clients: number; sent: number; skippedQuiet: number }> {
  const now = opts.now ?? new Date(); const out = { workspaces: 0, clients: 0, sent: 0, skippedQuiet: 0 };
  const channels = await prisma.lineChannel.findMany({ select: { workspaceId: true, workspace: { select: { timezone: true } } } });
  for (const ch of channels) {
    const ws = ch.workspaceId;
    const recipients = (await prisma.lineRecipient.findMany({ where: { workspaceId: ws, active: true }, select: { id: true, lineUserId: true, clientId: true, types: true } })).filter(r => wantsType(r, 'inbox_digest'));
    if (!recipients.length) continue;
    if (!opts.ignoreQuietHours && inQuietHours(localHour(now, ch.workspace.timezone))) { out.skippedQuiet++; continue; }
    out.workspaces++;
    const clients = await prisma.client.findMany({ where: { workspaceId: ws, status: 'ACTIVE' }, select: { id: true, name: true, inboxDigestAt: true } });
    const digests: ClientDigest[] = [];
    for (const c of clients) {
      const since = new Date(Math.max(c.inboxDigestAt?.getTime() ?? now.getTime() - FIRST_LOOKBACK_MS, now.getTime() - MAX_LOOKBACK_MS));
      const page = { brand: { clientId: c.id, client: { workspaceId: ws } } };
      const [comments, messages, needsAttention] = await Promise.all([
        prisma.pageComment.findMany({ where: { page, createdAt: { gt: since, lte: now }, isHidden: false }, orderBy: { createdTime: 'desc' }, take: 500, select: { fromId: true, fromName: true, message: true, replyStatus: true, resolvedAt: true, page: { select: { facebookPageId: true } } } }),
        prisma.messengerMessage.findMany({ where: { direction: 'IN', createdAt: { gt: since, lte: now }, conversation: { page } }, take: 1000, select: { conversationId: true } }),
        prisma.messengerConversation.count({ where: { page, needsAttention: true } }),
      ]);
      await prisma.client.update({ where: { id: c.id }, data: { inboxDigestAt: now } });
      const theirs = comments.filter(x => !x.fromId || x.fromId !== x.page.facebookPageId);   // ไม่นับคำตอบของเพจเอง
      if (!theirs.length && !messages.length) continue;
      const pending = theirs.filter(x => x.replyStatus !== 'SENT' && !x.resolvedAt);
      digests.push({ clientId: c.id, name: c.name, comments: theirs.length, pending: pending.length, messages: messages.length, people: new Set(messages.map(m => m.conversationId)).size, needsAttention, samples: pending.slice(0, 2).map(x => `“${clip(x.message, 70)}” — ${clip(x.fromName, 20) || 'ผู้ใช้'}`) });
    }
    if (!digests.length) continue;
    out.clients += digests.length;
    for (const d of digests) {
      const owners = recipients.filter(r => r.clientId === d.clientId); if (!owners.length) continue;
      const text = [`💬 ${d.name}: มีความเคลื่อนไหวใหม่`, ...digestLines(d), ...(d.samples.length ? ['', ...d.samples] : []), '', `👉 ${portalLink(d.clientId, 'inbox_digest')}`].join('\n');
      out.sent += (await sendLineTo(prisma, authSecret, ws, owners, () => text, undefined, opts.fetchImpl)).sent;
    }
    const team = recipients.filter(r => !r.clientId);
    if (team.length) {
      const text = ['💬 สรุปคอมเมนต์/แชทใหม่', ...digests.slice(0, 15).flatMap(d => ['', `[${d.name}]`, ...digestLines(d)]), ...(digests.length > 15 ? ['', `…และอีก ${digests.length - 15} ลูกค้า`] : []), '', `👉 ${teamLink('/comments')}`].join('\n');
      out.sent += (await sendLineTo(prisma, authSecret, ws, team, () => text, undefined, opts.fetchImpl)).sent;
    }
  }
  return out;
}
