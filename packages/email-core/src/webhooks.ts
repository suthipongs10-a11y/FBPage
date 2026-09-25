/**
 * Webhook events (W-4) — บันทึก EmailEvent, อัปเดต EmailSend/ผู้รับ (bounce → BOUNCED, spam → COMPLAINED, unsubscribe → UNSUBSCRIBED), นับสถิติแคมเปญ
 * ค่าที่ผู้ให้บริการไม่รายงาน = null ห้ามเป็น 0 — นับเฉพาะเมื่อมีเหตุการณ์อย่างน้อย 1 รายการของชนิดนั้นในแคมเปญ
 */
import type { Prisma, PrismaClient } from '@fbpm/database';
import type { NormalizedEvent } from './types';

const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, OPENED: 3, CLICKED: 4, BOUNCED: 9, COMPLAINED: 9, FAILED: 9, SKIPPED: 9 };
const STATUS_FOR: Record<string, string> = { delivered: 'DELIVERED', opened: 'OPENED', clicked: 'CLICKED', bounced: 'BOUNCED', complained: 'COMPLAINED', failed: 'FAILED' };

export async function applyEmailEvents(prisma: PrismaClient, provider: string, events: NormalizedEvent[]): Promise<{ applied: number; unmatched: number; campaigns: string[] }> {
  let applied = 0, unmatched = 0; const touched = new Set<string>();
  for (const ev of events) {
    const send = ev.sendId ? await prisma.emailSend.findUnique({ where: { id: ev.sendId }, select: { id: true, campaignId: true, status: true, subscriberId: true, subscriber: { select: { email: true } } } })
      : ev.providerMessageId ? await prisma.emailSend.findFirst({ where: { providerMessageId: ev.providerMessageId }, select: { id: true, campaignId: true, status: true, subscriberId: true, subscriber: { select: { email: true } } } }) : null;
    const campaignId = send?.campaignId ?? ev.campaignId ?? null;
    if (campaignId && !(await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: { id: true } }))) { unmatched++; continue; }
    await prisma.emailEvent.create({ data: { campaignId, provider, type: ev.type, email: ev.email ?? send?.subscriber.email ?? null, providerMessageId: ev.providerMessageId, payload: ev.raw as Prisma.InputJsonValue, occurredAt: ev.occurredAt } });
    if (!send) { unmatched++; continue; }
    touched.add(send.campaignId); applied++;
    const next = STATUS_FOR[ev.type];
    if (next && (RANK[next] ?? 0) > (RANK[send.status] ?? 0) && !['BOUNCED', 'COMPLAINED', 'FAILED'].includes(send.status)) await prisma.emailSend.update({ where: { id: send.id }, data: { status: next } });
    if (ev.type === 'bounced') await prisma.emailSubscriber.update({ where: { id: send.subscriberId }, data: { status: 'BOUNCED', bouncedAt: ev.occurredAt } });
    if (ev.type === 'complained') await prisma.emailSubscriber.update({ where: { id: send.subscriberId }, data: { status: 'COMPLAINED', unsubscribedAt: ev.occurredAt } });
    if (ev.type === 'unsubscribed') await prisma.emailSubscriber.updateMany({ where: { id: send.subscriberId, status: 'SUBSCRIBED' }, data: { status: 'UNSUBSCRIBED', unsubscribedAt: ev.occurredAt } });
  }
  for (const id of touched) await recomputeCampaignStats(prisma, id);
  return { applied, unmatched, campaigns: [...touched] };
}

/** สถิติจากเหตุการณ์ (นับผู้รับไม่ซ้ำต่อชนิด) — null เมื่อยังไม่มีเหตุการณ์ชนิดนั้นเลย */
export async function recomputeCampaignStats(prisma: PrismaClient, campaignId: string): Promise<void> {
  const [events, unsubs] = await Promise.all([
    prisma.emailEvent.findMany({ where: { campaignId }, select: { type: true, email: true, providerMessageId: true } }),
    prisma.emailSend.count({ where: { campaignId, subscriber: { status: 'UNSUBSCRIBED', unsubscribedAt: { not: null } } } }),
  ]);
  const uniq = (type: string) => { const s = new Set(events.filter(e => e.type === type).map(e => e.providerMessageId ?? e.email ?? '')); return s.size ? s.size : null; };
  await prisma.emailCampaign.update({ where: { id: campaignId }, data: { deliveredCount: uniq('delivered'), openedCount: uniq('opened'), clickedCount: uniq('clicked'), bouncedCount: uniq('bounced'), complainedCount: uniq('complained'), unsubscribedCount: unsubs || (uniq('unsubscribed') ?? null) } });
}
