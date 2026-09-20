import { z } from 'zod';

const id = z.string().min(1).max(256);
const eventSchema = z.object({
  sender: z.object({ id }), recipient: z.object({ id }), timestamp: z.number().int().positive(),
  message: z.object({ mid: id, text: z.string().optional(), is_echo: z.boolean().optional(), metadata: z.string().optional(), app_id: z.union([z.string(), z.number()]).optional(), attachments: z.array(z.unknown()).optional() }),
});
export interface MessengerEvent { pageId: string; psid: string; mid: string; text: string; echo: boolean; metadata?: string; appId?: string; at: Date; unsupported: boolean }

/** Only actual message events open the response window. Delivery/read receipts do not. */
export function messengerEvents(body: unknown, now = Date.now()): MessengerEvent[] {
  const envelope = z.object({ object: z.literal('page'), entry: z.array(z.object({ id, messaging: z.array(z.unknown()).optional() })).max(100) }).safeParse(body);
  if (!envelope.success) return [];
  const result: MessengerEvent[] = [];
  for (const entry of envelope.data.entry) for (const raw of (entry.messaging ?? []).slice(0, 100)) {
    const parsed = eventSchema.safeParse(raw); if (!parsed.success) continue;
    const e = parsed.data; const echo = e.message.is_echo === true;
    if (e.timestamp > now + 60_000 || (echo ? e.sender.id : e.recipient.id) !== entry.id) continue;
    if (!echo && e.sender.id === entry.id) continue;
    const text = e.message.text ?? '';
    if (!text && !e.message.attachments?.length) continue;
    result.push({ pageId: entry.id, psid: echo ? e.recipient.id : e.sender.id, mid: e.message.mid, text: text.slice(0, 6000), echo, metadata: e.message.metadata, appId: e.message.app_id === undefined ? undefined : String(e.message.app_id), at: new Date(e.timestamp), unsupported: !text || text.length > 6000 || !!e.message.attachments?.length });
  }
  return result;
}

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const inWindow = (at: Date | null, now = Date.now()) => !!at && at.getTime() <= now + 60_000 && now - at.getTime() < WINDOW_MS - 5000;
export const MESSENGER_QUEUE = 'messenger';
