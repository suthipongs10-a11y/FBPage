/** Integration — อีเมล (§65) กับ mock SMTP: ตั้งค่า/ทดสอบ, คำเชิญ, ลืมรหัสผ่าน, แจ้งเตือนสำคัญถึง owner — ไม่ส่งอีเมลจริง */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, notify, startMockSmtp } from '@fbpm/database';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text };
  } };
  return c;
}
/** ถอด body base64 ของอีเมลเป็นข้อความ (text part แรก) */
const decodeText = (raw: string) => { const m = /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)(\r\n--|\r\n\r\n|$)/.exec(raw); return m ? Buffer.from(m[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8') : ''; };

run('email (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient; let smtp: Awaited<ReturnType<typeof startMockSmtp>>;
  const stamp = Date.now(); const A = { email: `mail-${stamp}@test.local`, name: 'Owner', password: 'owner-password-123' };
  let a: ReturnType<typeof client>; let ws = '';
  beforeAll(async () => {
    smtp = await startMockSmtp();
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'mailer@test.local', SMTP_PASS: 'secret', SMTP_FROM: 'AI Page Manager <no-reply@test.local>', SMTP_ALLOW_INSECURE: 'true' });
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id;
  }, 30_000);
  afterAll(async () => {
    for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_ALLOW_INSECURE']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: ws } }); await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@test.local` } } }); await prisma.$disconnect(); await app.close(); smtp.server.close();
  });

  it('settings report SMTP configured (host/from only, never password) and a test mail goes through AUTH + DATA', async () => {
    const s = await a.http('GET', `/workspaces/${ws}/notifications/email`);
    expect(s.status).toBe(200); expect(s.json.configured).toBe(true); expect(s.json.host).toBe('127.0.0.1'); expect(s.text).not.toContain('secret');
    const r = await a.http('POST', `/workspaces/${ws}/notifications/email/test`, {});
    expect(r.status, r.text).toBe(200); expect(r.json.ok).toBe(true);
    expect(smtp.state.messages).toHaveLength(1); expect(smtp.state.messages[0]!.to).toEqual([A.email]); expect(smtp.state.messages[0]!.subject).toContain('ทดสอบ'); expect(smtp.state.messages[0]!.from).toBe('no-reply@test.local');
  });
  it('invite with email is delivered with the one-time link; wrong SMTP credentials fail honestly without breaking the invite', async () => {
    const inv = await a.http('POST', `/workspaces/${ws}/invites`, { role: 'editor', email: `invitee-${stamp}@test.local` });
    expect(inv.status, inv.text).toBe(201); expect(inv.json.emailed).toBe(true); expect(inv.json.url).toContain('/invite/');
    const m = smtp.state.messages.at(-1)!; expect(m.to).toEqual([`invitee-${stamp}@test.local`]); expect(decodeText(m.raw)).toContain(inv.json.url);
    smtp.state.rejectAuth = true;
    const inv2 = await a.http('POST', `/workspaces/${ws}/invites`, { role: 'viewer', email: `invitee2-${stamp}@test.local` });
    expect(inv2.status).toBe(201); expect(inv2.json.emailed).toBe(false); expect(inv2.json.url).toContain('/invite/');   // ลิงก์ยังใช้ได้ คัดลอกส่งเองได้
    smtp.state.rejectAuth = false;
  });
  it('forgot password: same 200 for unknown and known emails; known gets a working reset link by mail', async () => {
    const before = smtp.state.messages.length;
    const unknown = await a.http('POST', '/auth/forgot', { email: `nobody-${stamp}@test.local` });
    expect(unknown.status).toBe(200); expect(unknown.json).toEqual({ ok: true, emailEnabled: true }); expect(smtp.state.messages).toHaveLength(before);
    const known = await a.http('POST', '/auth/forgot', { email: A.email });
    expect(known.status).toBe(200); expect(known.json).toEqual({ ok: true, emailEnabled: true }); expect(smtp.state.messages).toHaveLength(before + 1);
    const text = decodeText(smtp.state.messages.at(-1)!.raw); const token = /\/reset\/([A-Za-z0-9_-]+)/.exec(text)?.[1];
    expect(token).toBeTruthy();
    const insp = await a.http('GET', `/auth/reset/${token}`); expect(insp.json.valid).toBe(true); expect(insp.json.email).toBe(A.email);
    const fresh = client(base); const done = await fresh.http('POST', `/auth/reset/${token}`, { password: 'brand-new-password-456' }); expect(done.status).toBe(200);
    expect((await a.http('GET', `/auth/reset/${token}`)).json.valid).toBe(false);   // ใช้ครั้งเดียว
  });
  it('important notifications (severity bad / approval / hot lead) are emailed to owners+admins; info is not; dedupe does not re-send', async () => {
    const before = smtp.state.messages.length;
    await notify(prisma, process.env.AUTH_SECRET!, ws, { type: 'info', severity: 'info', title: 'เฉยๆ' });
    await notify(prisma, process.env.AUTH_SECRET!, ws, { type: 'publish_failed', severity: 'bad', title: 'โพสต์ล้มเหลว X', body: 'Graph 190', href: '/content', dedupeKey: `mailtest:${stamp}` });
    await expect.poll(() => smtp.state.messages.length, { timeout: 5000 }).toBe(before + 1);
    expect(smtp.state.messages).toHaveLength(before + 1); const m = smtp.state.messages.at(-1)!;
    expect(m.to).toEqual([A.email]); expect(m.subject).toContain('โพสต์ล้มเหลว X'); expect(decodeText(m.raw)).toContain('/content');
    await notify(prisma, process.env.AUTH_SECRET!, ws, { type: 'publish_failed', severity: 'bad', title: 'โพสต์ล้มเหลว X', dedupeKey: `mailtest:${stamp}` });
    await new Promise(r => setTimeout(r, 200));
    expect(smtp.state.messages).toHaveLength(before + 1);
  });
});
