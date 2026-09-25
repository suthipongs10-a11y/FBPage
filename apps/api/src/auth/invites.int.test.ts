/** Integration — invite links, reset links, change password */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text, setCookie: sc };
  } };
  return c;
}

run('invites + password reset (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient;
  const stamp = Date.now(); const A = { email: `inv-a-${stamp}@test.local`, name: 'Owner', password: 'owner-password-123' }; const B = { email: `inv-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let ws = ''; let bobId = '';
  beforeAll(async () => {
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id;
  }, 30_000);
  afterAll(async () => { await prisma.workspace.deleteMany({ where: { id: ws } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } }); await prisma.$disconnect(); await app.close(); });

  it('owner creates an invite link; a new person accepts it and becomes a member with that role', async () => {
    const inv = await a.http('POST', `/workspaces/${ws}/invites`, { role: 'editor' });
    expect(inv.status).toBe(201); expect(inv.json.url).toMatch(/\/invite\//);
    const token = inv.json.url.split('/invite/')[1];
    expect((await a.http('GET', `/workspaces/${ws}/invites`)).json).toHaveLength(1);
    const b = client(base);
    const look = await b.http('GET', `/auth/invites/${token}`); expect(look.json.valid).toBe(true); expect(look.json.role).toBe('editor');
    expect((await b.http('POST', `/auth/invites/${token}/accept`, { email: B.email, password: B.password })).status).toBe(400);   // ต้องมีชื่อ
    const acc = await b.http('POST', `/auth/invites/${token}/accept`, { name: B.name, email: B.email, password: B.password });
    expect(acc.status, acc.text).toBe(200); expect(acc.json.workspaceId).toBe(ws); expect(acc.setCookie).toMatch(/fbpm_session/);
    const me = await b.http('GET', '/auth/me'); expect(me.json.workspaces[0].role).toBe('editor'); bobId = me.json.user.id;
    expect((await b.http('GET', `/auth/invites/${token}`)).json.valid).toBe(false);   // ใช้แล้ว
    expect((await client(base).http('POST', `/auth/invites/${token}/accept`, { name: 'x', email: `z-${stamp}@t.local`, password: 'zzzzzzzzzzzz' })).status).toBe(404);
    expect((await a.http('GET', `/workspaces/${ws}/members`)).json).toHaveLength(2);
    expect((await b.http('POST', `/workspaces/${ws}/invites`, { role: 'viewer' })).status).toBe(403);   // editor เชิญไม่ได้
  });

  it('revoke removes a pending invite; existing user accepts by logging in through the link', async () => {
    const inv = await a.http('POST', `/workspaces/${ws}/invites`, { role: 'viewer', email: 'someone@test.local' });
    expect((await a.http('DELETE', `/workspaces/${ws}/invites/${inv.json.id}`)).status).toBe(200);
    expect((await client(base).http('GET', `/auth/invites/${inv.json.url.split('/invite/')[1]}`)).json.valid).toBe(false);
    const ws2 = (await a.http('POST', '/workspaces', { name: 'อีก workspace' })).json.id;
    const inv2 = await a.http('POST', `/workspaces/${ws2}/invites`, { role: 'analyst' });
    const acc = await client(base).http('POST', `/auth/invites/${inv2.json.url.split('/invite/')[1]}/accept`, { email: B.email, password: B.password });
    expect(acc.status, acc.text).toBe(200); expect(acc.json.role).toBe('analyst');
    await prisma.workspace.delete({ where: { id: ws2 } });
  });

  it('owner issues a reset link; the member sets a new password, old sessions die, login works with the new one', async () => {
    const rl = await a.http('POST', `/workspaces/${ws}/members/${bobId}/reset-link`, {});
    expect(rl.status).toBe(201); const token = rl.json.url.split('/reset/')[1];
    const anon = client(base);
    expect((await anon.http('GET', `/auth/reset/${token}`)).json.email).toBe(B.email);
    expect((await anon.http('POST', `/auth/reset/${token}`, { password: 'short' })).status).toBe(400);
    const done = await anon.http('POST', `/auth/reset/${token}`, { password: 'new-bob-password-456' });
    expect(done.status, done.text).toBe(200); expect(done.setCookie).toMatch(/fbpm_session/);
    expect((await anon.http('GET', `/auth/reset/${token}`)).json.valid).toBe(false);
    expect((await client(base).http('POST', '/auth/login', { email: B.email, password: B.password })).status).toBe(401);
    expect((await client(base).http('POST', '/auth/login', { email: B.email, password: 'new-bob-password-456' })).status).toBe(200);
    const ch = await anon.http('POST', '/auth/password', { current: 'wrong-password-xx', next: 'another-password-789' }); expect(ch.status).toBe(401);
    expect((await anon.http('POST', '/auth/password', { current: 'new-bob-password-456', next: 'another-password-789' })).status).toBe(200);
    expect((await a.http('POST', `/workspaces/${ws}/members/${(await a.http('GET', '/auth/me')).json.user.id}/reset-link`, {})).status).toBe(201);   // owner ให้ตัวเองได้
  });
});
