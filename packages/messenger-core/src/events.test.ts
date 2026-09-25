import { describe, expect, it } from 'vitest';
import { inWindow, messengerEvents, WINDOW_MS } from './events';
import { MetaMessenger } from './meta';
const now = Date.now();
const message = { sender: { id: 'customer' }, recipient: { id: 'page' }, timestamp: now, message: { mid: 'm1', text: 'ราคาเท่าไหร่คะ' } };
const envelope = (event: unknown, object = 'page') => ({ object, entry: [{ id: 'page', messaging: [event] }] });
describe('Messenger normalization and response window', () => {
  it('preserves message ID, timestamp, PSID and Thai text', () => { expect(messengerEvents(envelope(message), now)[0]).toMatchObject({ mid: 'm1', psid: 'customer', text: 'ราคาเท่าไหร่คะ', at: new Date(now), echo: false }); });
  it('does not treat delivery/read/postback events as new customer text', () => { expect(messengerEvents(envelope({ ...message, message: undefined, read: { watermark: now } }), now)).toEqual([]); });
  it('rejects wrong object, page recipient, missing ID and future timestamps', () => { for (const e of [envelope(message, 'instagram'), envelope({ ...message, recipient: { id: 'other' } }), envelope({ ...message, message: { text: 'hello' } }), envelope({ ...message, timestamp: now + 120000 })]) expect(messengerEvents(e, now)).toEqual([]); });
  it('marks attachments for text clarification rather than claiming to read them', () => { expect(messengerEvents(envelope({ ...message, message: { mid: 'photo', attachments: [{ type: 'image' }] } }), now)[0]?.unsupported).toBe(true); });
  it('keeps echoes distinct from incoming messages', () => { expect(messengerEvents(envelope({ ...message, sender: { id: 'page' }, recipient: { id: 'customer' }, message: { ...message.message, is_echo: true, app_id: 123 } }), now)[0]).toMatchObject({ echo: true, psid: 'customer', appId: '123' }); });
  it('closes the standard window and rejects dates far in the future', () => { expect(inWindow(new Date(now - 1000), now)).toBe(true); expect(inWindow(new Date(now - WINDOW_MS), now)).toBe(false); expect(inWindow(new Date(now + WINDOW_MS), now)).toBe(false); expect(inWindow(null, now)).toBe(false); });
  it('rejects mock Meta origins outside tests', () => { expect(() => new MetaMessenger({ testBaseUrl: 'http://127.0.0.1' })).toThrow('test mode'); });
});
