/** Integration — W-4 email marketing กับ mock ผู้ให้บริการ (Brevo) + mock AI: ตั้งค่า provider → รายชื่อ + consent → AI ร่าง → อนุมัติ → ส่ง (กันซ้ำ, ข้ามคนยกเลิก) → webhook → ลิงก์ยกเลิกรับสาธารณะ · ไม่ส่งอีเมลจริง */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockAi } from '@fbpm/ai-core';
import { MOCK_BREVO_KEY, startMockEmailProvider } from '@fbpm/email-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie, ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text };
  } };
  return c;
}

run('email marketing (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient;
  let mail: Awaited<ReturnType<typeof startMockEmailProvider>>; let ai: Awaited<ReturnType<typeof startMockAi>>;
  const stamp = Date.now(); const A = { email: `em-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' }; const B = { email: `em-b-${stamp}@test.local`, name: 'Bob', password: 'bob-password-12345' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>; let ws = ''; let wsB = ''; let brand = ''; let listId = ''; let campaignId = ''; let unsubToken = '';
  beforeAll(async () => {
    mail = await startMockEmailProvider(); ai = await startMockAi();
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    Object.assign(process.env, { EMAIL_MOCK_BASE_URL: mail.url, EMAIL_SEND_ENABLED: 'true', APP_URL: 'http://127.0.0.1:3000' });
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${ws}/clients`, { name: 'ฟ้าแดง' });
    brand = (await a.http('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'ฟ้าแดง คลีนนิ่ง', industry: 'บริการทำความสะอาด', primaryCTA: 'ทักแชท', website: 'https://fadaeng.example' })).json.id;
    await a.http('POST', `/workspaces/${ws}/brands/${brand}/knowledge`, { type: 'service', title: 'ล้างแอร์', content: 'บริการล้างแอร์บ้าน นัดล่วงหน้า 1 วัน' });
    const aiConn = (await a.http('POST', `/workspaces/${ws}/ai/connections`, { preset: 'custom', label: 'Mock AI', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['m-content', 'm-fast'] })).json.id;
    await a.http('PUT', `/workspaces/${ws}/ai/roles`, { roles: { content: { connectionId: aiConn, model: 'm-content' }, fast: { connectionId: aiConn, model: 'm-fast' } } });
  }, 40_000);
  afterAll(async () => {
    for (const k of ['EMAIL_MOCK_BASE_URL', 'EMAIL_SEND_ENABLED']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: { in: [ws, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } }); await prisma.$disconnect();
    await app.close(); mail.server.close(); ai.server.close();
  });

  it('configures Brevo (key encrypted + verified, never echoed), bad key → AUTH_FAILED', async () => {
    const bad = await a.http('PUT', `/workspaces/${ws}/email/provider`, { provider: 'brevo', apiKey: 'xkeysib-WRONG-KEY-000' });
    expect(bad.status, bad.text).toBe(200); expect(bad.json.account.status).toBe('AUTH_FAILED');
    const ok = await a.http('PUT', `/workspaces/${ws}/email/provider`, { provider: 'brevo', apiKey: MOCK_BREVO_KEY, webhookSecret: 'hook-secret-1' });
    expect(ok.json.account.status).toBe('OK'); expect(ok.json.account.accountEmail).toBe('agency@example.com'); expect(ok.json.account.keyHint).toBe('…O-OK'); expect(ok.json.account.webhookConfigured).toBe(true); expect(ok.json.webhookPath).toBe(`/api/email/webhooks/brevo/${ws}`);
    expect(JSON.stringify(ok.json)).not.toContain(MOCK_BREVO_KEY); expect(JSON.stringify(ok.json)).not.toContain('hook-secret');
  });
  it('creates a list and imports subscribers only with confirmed consent; duplicates/unsubscribed are not re-opened', async () => {
    const l = await a.http('POST', `/workspaces/${ws}/email/lists`, { brandId: brand, name: 'ลูกค้าฟ้าแดง', fromEmail: 'news@fadaeng.test', fromName: 'ฟ้าแดง คลีนนิ่ง', consentText: 'ยินยอมรับข่าวสารทางอีเมล' });
    expect(l.status, l.text).toBe(201); listId = l.json.id;
    const noConsent = await a.http('POST', `/workspaces/${ws}/email/lists/${listId}/subscribers/import`, { subscribers: [{ email: 'x@test.local' }], consentSource: 'ฟอร์มหน้าร้าน' }); expect(noConsent.status).toBe(400);
    const imp = await a.http('POST', `/workspaces/${ws}/email/lists/${listId}/subscribers/import`, { consentConfirmed: true, consentSource: 'ฟอร์มหน้าร้าน 2026-08', subscribers: [{ email: 'Somchai@Test.local', name: 'สมชาย' }, { email: 'suda@test.local', name: 'สุดา' }, { email: 'bounce@invalid.test', name: 'บาวน์' }, { email: 'somchai@test.local' }] });
    expect(imp.status, imp.text).toBe(200); expect(imp.json.added).toBe(3); expect(imp.json.duplicates).toBe(1); expect(imp.json.list.counts.subscribed).toBe(3);
    const subs = await a.http('GET', `/workspaces/${ws}/email/lists/${listId}/subscribers`); const suda = subs.json.find((s: { email: string }) => s.email === 'suda@test.local');
    expect((await a.http('PATCH', `/workspaces/${ws}/email/lists/${listId}/subscribers/${suda.id}`, { status: 'UNSUBSCRIBED' })).status).toBe(200);
    const again = await a.http('POST', `/workspaces/${ws}/email/lists/${listId}/subscribers/import`, { consentConfirmed: true, consentSource: 'x', subscribers: [{ email: 'suda@test.local' }] }); expect(again.json.skippedUnsubscribed).toBe(1);
    expect((await a.http('GET', `/workspaces/${ws}/email/lists/${listId}`)).json.counts).toMatchObject({ subscribed: 2, unsubscribed: 1 });
  });
  it('AI drafts the newsletter from brand knowledge; reviewer blocks [ต้องยืนยัน]; approve; send skips unsubscribed and records failures honestly', async () => {
    const c = await a.http('POST', `/workspaces/${ws}/email/campaigns`, { listId, name: 'ข่าวเดือนกันยา' }); expect(c.status, c.text).toBe(201); campaignId = c.json.id;
    ai.state.replies.push({ text: JSON.stringify({ subject: 'ล้างแอร์ก่อนหน้าฝน — นัดล่วงหน้า 1 วัน', subjectAlternatives: ['แอร์สะอาด บ้านเย็น'], preheader: 'เคล็ดลับดูแลแอร์', bodyHtml: '<p>สวัสดี {{name}}</p><p>บริการล้างแอร์บ้าน นัดล่วงหน้า 1 วัน ราคา [ต้องยืนยัน: ราคาต่อเครื่อง]</p><p><a href="https://fadaeng.example">ทักแชท</a></p><p><a href="{{unsubscribe_url}}">ยกเลิกรับ</a></p>', bodyText: 'สวัสดี {{name}}', missingInfo: ['ราคาต่อเครื่อง'], notes: [] }) });
    const g = await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/generate`, { goal: 'ชวนล้างแอร์' });
    expect(g.status, g.text).toBe(200); expect(g.json.subject).toContain('ล้างแอร์'); expect(g.json.aiNotes.missingInfo).toEqual(['ราคาต่อเครื่อง']);
    expect(JSON.stringify(ai.state.requests.at(-1)!.messages)).toContain('นัดล่วงหน้า 1 วัน');
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    const nr = await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/submit`, {}); expect(nr.json.status).toBe('NEEDS_REVISION');
    const fix = await a.http('PATCH', `/workspaces/${ws}/email/campaigns/${campaignId}`, { bodyHtml: '<p>สวัสดี {{name}}</p><p>บริการล้างแอร์บ้าน นัดล่วงหน้า 1 วัน</p><p><a href="https://fadaeng.example">ทักแชท</a></p><p><a href="{{unsubscribe_url}}">ยกเลิกรับ</a></p>' }); expect(fix.json.status).toBe('NEEDS_REVISION');
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    const s = await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/submit`, {}); expect(s.status, s.text).toBe(200); expect(s.json.status).toBe('READY_FOR_APPROVAL');
    expect((await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/send`, {})).status).toBe(409);   // ยังไม่อนุมัติ
    expect((await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/approve`, {})).json.status).toBe('APPROVED');
    expect((await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/test-send`, { to: 'outsider@test.local' })).status).toBe(403);
    const t = await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/test-send`, { to: A.email }); expect(t.status, t.text).toBe(200); expect(mail.state.messages.at(-1)!.subject).toContain('[ทดสอบ]');
    const sent = await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/send`, {});
    expect(sent.status, sent.text).toBe(200); expect(sent.json.outcome).toMatchObject({ status: 'PARTIAL', sent: 1, failed: 1, skipped: 0, total: 2 }); expect(sent.json.campaign.status).toBe('SENT'); expect(sent.json.campaign.sentCount).toBe(1); expect(sent.json.campaign.failedCount).toBe(1);
    expect(sent.json.campaign.openedCount).toBeNull();   // ไม่มี webhook → ไม่ใช่ 0
    const msg = mail.state.messages.filter(m => m.subject.startsWith('ล้างแอร์')); expect(msg).toHaveLength(1); expect(msg[0]!.to).toBe('somchai@test.local'); expect(msg[0]!.html).toContain('สวัสดี สมชาย'); expect(msg[0]!.html).toMatch(/\/api\/email\/u\/[A-Za-z0-9_-]+/); expect(msg[0]!.headers['List-Unsubscribe']).toContain('/api/email/u/');
    unsubToken = /\/api\/email\/u\/([A-Za-z0-9_-]+)/.exec(msg[0]!.html)![1]!;
    // ส่งซ้ำ (เช่น retry) → ไม่ส่งซ้ำให้คนเดิม
    await prisma.emailCampaign.update({ where: { id: campaignId }, data: { status: 'SEND_FAILED' } });
    const re = await a.http('POST', `/workspaces/${ws}/email/campaigns/${campaignId}/send`, {}); expect(re.json.outcome.sent).toBe(0); expect(mail.state.messages.filter(m => m.subject.startsWith('ล้างแอร์'))).toHaveLength(1);
    const st = await a.http('GET', `/workspaces/${ws}/email/campaigns/${campaignId}/stats`); expect(st.json.sends).toMatchObject({ SENT: 1, FAILED: 1 });
  });
  it('webhook (token-protected) updates delivery/open stats and bounces the subscriber; public unsubscribe link works without a session', async () => {
    const mid = mail.state.messages.find(m => m.to === 'somchai@test.local' && m.subject.startsWith('ล้างแอร์'))!.id;
    const ev = [{ event: 'delivered', email: 'somchai@test.local', 'message-id': mid, tags: [`campaign:${campaignId}`], ts_event: Math.floor(Date.now() / 1000) }, { event: 'opened', email: 'somchai@test.local', 'message-id': mid, ts_event: Math.floor(Date.now() / 1000) }];
    const anon = client(base);
    expect((await anon.http('POST', `/email/webhooks/brevo/${ws}`, ev)).status).toBe(403);   // ไม่มี token
    const ok = await anon.http('POST', `/email/webhooks/brevo/${ws}?token=hook-secret-1`, ev); expect(ok.status, ok.text).toBe(200); expect(ok.json.applied).toBe(2);
    let c = await a.http('GET', `/workspaces/${ws}/email/campaigns/${campaignId}`); expect(c.json.deliveredCount).toBe(1); expect(c.json.openedCount).toBe(1); expect(c.json.clickedCount).toBeNull();
    await anon.http('POST', `/email/webhooks/brevo/${ws}?token=hook-secret-1`, { event: 'hard_bounce', email: 'somchai@test.local', 'message-id': mid, ts_event: Math.floor(Date.now() / 1000) });
    const subs = await a.http('GET', `/workspaces/${ws}/email/lists/${listId}/subscribers`); expect(subs.json.find((s: { email: string }) => s.email === 'somchai@test.local').status).toBe('BOUNCED');
    c = await a.http('GET', `/workspaces/${ws}/email/campaigns/${campaignId}`); expect(c.json.bouncedCount).toBe(1);
    const page = await fetch(`${base}/email/u/${unsubToken}`); expect(page.status).toBe(200); expect(await page.text()).toContain('ยกเลิกรับอีเมล');
    expect((await fetch(`${base}/email/u/nope`).then(r => r.text()))).toContain('ไม่พบลิงก์');
    const sum = await a.http('GET', `/workspaces/${ws}/email/summary`); expect(sum.json.sent).toBe(1); expect(sum.json.lists).toBe(1);
  });
  it('tenant isolation + kill switch: paused provider blocks sending with a clear reason', async () => {
    expect((await b.http('GET', `/workspaces/${wsB}/email/campaigns/${campaignId}`)).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsB}/email/lists/${listId}`)).status).toBe(404);
    expect((await b.http('POST', `/email/webhooks/brevo/${wsB}?token=x`, [])).status).toBe(404);
    const c2 = await a.http('POST', `/workspaces/${ws}/email/campaigns`, { listId, name: 'สอง', subject: 'สอง', bodyHtml: '<p>x {{unsubscribe_url}}</p>' });
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    await a.http('POST', `/workspaces/${ws}/email/campaigns/${c2.json.id}/submit`, {}); await a.http('POST', `/workspaces/${ws}/email/campaigns/${c2.json.id}/approve`, {});
    await a.http('PATCH', `/workspaces/${ws}/email/provider/pause`, { sendingPaused: true });
    const blocked = await a.http('POST', `/workspaces/${ws}/email/campaigns/${c2.json.id}/send`, {}); expect(blocked.status).toBe(422); expect(blocked.json.message).toContain('หยุด');
    await a.http('PATCH', `/workspaces/${ws}/email/provider/pause`, { sendingPaused: false });
    const audit = await prisma.auditLog.findMany({ where: { workspaceId: ws } }); expect(JSON.stringify(audit)).not.toContain(MOCK_BREVO_KEY);
  });
});
