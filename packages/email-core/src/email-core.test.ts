import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrevoProvider, ResendProvider, createProvider } from './providers';
import { renderEmail, htmlToText } from './render';
import { MOCK_BREVO_KEY, MOCK_RESEND_KEY, MOCK_SVIX_SECRET, startMockEmailProvider } from './mock-provider';
import { unsubscribeUrl } from './sender';

describe('render (W-4)', () => {
  it('fills placeholders, escapes names, and always includes an unsubscribe link', () => {
    const r = renderEmail({ bodyHtml: '<p>สวัสดี {{name}}</p>', subject: 'โปร {{name}}', subscriber: { email: 'a@b.test', name: '<b>สมชาย</b>' }, unsubscribeUrl: 'https://app/api/email/u/tok', fromName: 'ฟ้าแดง' });
    expect(r.html).toContain('สวัสดี &lt;b&gt;สมชาย&lt;/b&gt;'); expect(r.html).toContain('https://app/api/email/u/tok'); expect(r.html).toContain('ยกเลิกรับอีเมล'); expect(r.subject).toBe('โปร <b>สมชาย</b>'); expect(r.text).toContain('ยกเลิกรับอีเมล: https://app/api/email/u/tok');
    const custom = renderEmail({ bodyHtml: '<p>x</p><a href="{{unsubscribe_url}}">ออก</a>', subject: 's', subscriber: { email: 'a@b.test' }, unsubscribeUrl: 'U', fromName: 'f' });
    expect(custom.html).toContain('href="U"'); expect(custom.html).not.toContain('คุณได้รับอีเมลนี้');
    expect(htmlToText('<h1>หัว</h1><p>ย่อหน้า &amp; อีก</p>')).toBe('หัว\nย่อหน้า & อีก');
    expect(unsubscribeUrl('http://localhost:3000/', 't1')).toBe('http://localhost:3000/api/email/u/t1');
  });
});

describe('providers against the mock (no real email)', () => {
  let m: Awaited<ReturnType<typeof startMockEmailProvider>>;
  beforeAll(async () => { m = await startMockEmailProvider(); });
  afterAll(() => m.server.close());
  const msg = (to: string, sendId = 's1') => ({ to: { email: to, name: 'ลูกค้า' }, from: { email: 'news@fadaeng.test', name: 'ฟ้าแดง' }, replyTo: null, subject: 'สวัสดี', html: '<p>hi</p>', text: 'hi', campaignId: 'c1', sendId, listUnsubscribeUrl: 'http://app/api/email/u/t' });

  it('Brevo: verify, send with List-Unsubscribe + tags, auth failure and invalid recipient map to error codes', async () => {
    const p = new BrevoProvider({ apiKey: MOCK_BREVO_KEY, baseUrl: m.url });
    expect((await p.verify()).accountEmail).toBe('agency@example.com');
    const r = await p.send(msg('ok@example.test')); expect(r.messageId).toMatch(/^brevo-msg-/);
    const sent = m.state.messages.at(-1)!; expect(sent.headers['List-Unsubscribe']).toContain('http://app/api/email/u/t'); expect(sent.tags).toEqual(['campaign:c1', 'send:s1']);
    await expect(p.send(msg('bounce@invalid.test'))).rejects.toMatchObject({ code: 'invalid' });
    await expect(new BrevoProvider({ apiKey: 'bad', baseUrl: m.url }).verify()).rejects.toMatchObject({ code: 'auth' });
    m.state.failNext = 1; await expect(p.send(msg('ok@example.test'))).rejects.toMatchObject({ code: 'network' });
  });
  it('Brevo webhook: token check via header, event mapping, tags → campaign/send', () => {
    const p = new BrevoProvider({ apiKey: 'x' });
    const body = JSON.stringify({ event: 'hard_bounce', email: 'a@b.test', 'message-id': 'brevo-msg-1', tags: ['campaign:c1', 'send:s1'], ts_event: 1_700_000_000 });
    expect(() => p.parseWebhook({}, body, 'secret')).toThrow(/token/);
    const ev = p.parseWebhook({ 'x-webhook-token': 'secret' }, body, 'secret'); expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ type: 'bounced', email: 'a@b.test', campaignId: 'c1', sendId: 's1', providerMessageId: 'brevo-msg-1' });
    expect(p.parseWebhook({}, JSON.stringify({ event: 'request' }), null)).toHaveLength(0);
  });
  it('Resend: verify lists verified domains, send returns id, Svix signature is enforced', async () => {
    const p = createProvider('resend', { apiKey: MOCK_RESEND_KEY, baseUrl: m.url }) as ResendProvider;
    expect((await p.verify()).detail).toContain('news.example.com');
    const r = await p.send(msg('ok@example.test', 's2')); expect(r.messageId).toMatch(/^resend-msg-/);
    expect(m.state.messages.at(-1)!.tags).toEqual([{ name: 'campaign', value: 'c1' }, { name: 'send', value: 's2' }]);
    const body = JSON.stringify({ type: 'email.opened', created_at: new Date().toISOString(), data: { email_id: r.messageId, to: ['ok@example.test'], tags: { campaign: 'c1', send: 's2' } } });
    expect(() => p.parseWebhook({ 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,bad' }, body, MOCK_SVIX_SECRET)).toThrow(/ลายเซ็น/);
    const ev = p.parseWebhook(m.svixHeaders(body), body, MOCK_SVIX_SECRET); expect(ev[0]).toMatchObject({ type: 'opened', sendId: 's2', providerMessageId: r.messageId });
    expect(p.parseWebhook({}, JSON.stringify({ type: 'email.sent' }), null)).toHaveLength(0);
  });
});
