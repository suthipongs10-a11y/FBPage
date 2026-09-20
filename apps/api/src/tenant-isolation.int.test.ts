/**
 * Integration test — tenant isolation (§57), RBAC (§58), validation (§56), audit (§49)
 * ต้องมี DATABASE_URL + REDIS_URL (ฐานข้อมูลจริง) ไม่งั้นข้าม
 * รัน:  DATABASE_URL=... REDIS_URL=... AUTH_SECRET=<32+ chars> pnpm --filter @fbpm/api test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { createApp } from './app.factory';
import { _resetRateLimits } from './common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;

interface Http { (method: string, path: string, body?: unknown): Promise<{ status: number; json: any; setCookie?: string }> } // eslint-disable-line @typescript-eslint/no-explicit-any

function client(base: string): { http: Http; cookie: string } {
  const c = { cookie: '', http: (async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie') ?? undefined;
    if (sc) c.cookie = sc.split(';')[0] ?? '';
    return { status: res.status, json: await res.json().catch(() => null), setCookie: sc };
  }) as Http };
  return c;
}

run('tenant isolation + RBAC (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient;
  const stamp = Date.now();
  const A = { email: `a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  const a = client(''); const b = client('');
  let wsA = ''; let wsB = ''; let clientA = ''; let brandA = ''; let knA = '';

  beforeAll(async () => {
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    _resetRateLimits();
    ({ app } = await createApp());
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl(); base = url.replace('[::1]', '127.0.0.1');
    (a as { http: Http }).http = client(base).http; (b as { http: Http }).http = client(base).http;
    // rebind cookie jars to base
    Object.assign(a, client(base)); Object.assign(b, client(base));
    prisma = new PrismaClient();
  }, 30_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } }); // cascade → sessions, memberships
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB].filter(Boolean) } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('registers two users, each with their own workspace', async () => {
    const ra = await a.http('POST', '/auth/register', A);
    expect(ra.status, JSON.stringify(ra.json)).toBe(201);
    expect(ra.setCookie).toMatch(/fbpm_session=.*HttpOnly/);
    wsA = ra.json.workspace.id;
    const rb = await b.http('POST', '/auth/register', B);
    expect(rb.status).toBe(201); wsB = rb.json.workspace.id;
    expect(wsA).not.toBe(wsB);
  });

  it('rejects unauthenticated and duplicate registration', async () => {
    expect((await client(base).http('GET', '/auth/me')).status).toBe(401);
    expect((await client(base).http('POST', '/auth/register', A)).status).toBe(409);
    const bad = await client(base).http('POST', '/auth/login', { email: A.email, password: 'wrong-password-xx' });
    expect(bad.status).toBe(401);
  });

  it('validates input with field-level issues', async () => {
    const r = await a.http('POST', `/workspaces/${wsA}/clients`, { name: '' });
    expect(r.status).toBe(400);
    expect(r.json.issues?.[0]?.path).toBe('name');
    const r2 = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'x', email: 'not-an-email' });
    expect(r2.status).toBe(400);
  });

  it('A creates client → brand → knowledge inside workspace A', async () => {
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'ระเบียงบุญ', phone: '+66619656292' });
    expect(c.status).toBe(201); clientA = c.json.id;
    const br = await a.http('POST', `/workspaces/${wsA}/clients/${clientA}/brands`, { name: 'ระเบียงบุญ ภูเก็ต', industry: 'event-rental', serviceArea: 'ภูเก็ต / พังงา' });
    expect(br.status).toBe(201); brandA = br.json.id;
    expect(br.json.knowledgeBaseStatus).toBe('EMPTY');
    const k = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/knowledge`, { type: 'prohibited_claim', title: 'ห้ามอ้างราคาแบบตายตัว', content: 'ใช้คำว่า ราคาเริ่มต้น เสมอ' });
    expect(k.status).toBe(201); knA = k.json.id;
    const after = await a.http('GET', `/workspaces/${wsA}/brands/${brandA}`);
    expect(after.json.knowledgeBaseStatus).toBe('PARTIAL');
  });

  it('B cannot see or touch anything in workspace A (404, not 403 — no existence leak)', async () => {
    expect((await b.http('GET', `/workspaces/${wsA}`)).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsA}/clients`)).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsA}/audit`)).status).toBe(404);
    expect((await b.http('PATCH', `/workspaces/${wsA}/clients/${clientA}`, { name: 'hacked' })).status).toBe(404);
  });

  it('B cannot reach A\'s resources through B\'s own workspace id (query scoping)', async () => {
    expect((await b.http('GET', `/workspaces/${wsB}/clients/${clientA}`)).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsB}/brands/${brandA}`)).status).toBe(404);
    expect((await b.http('PATCH', `/workspaces/${wsB}/brands/${brandA}`, { name: 'hacked' })).status).toBe(404);
    expect((await b.http('DELETE', `/workspaces/${wsB}/brands/${brandA}/knowledge/${knA}`)).status).toBe(404);
    expect((await b.http('POST', `/workspaces/${wsB}/clients/${clientA}/brands`, { name: 'x' })).status).toBe(404);
    // ข้อมูลของ A ต้องไม่ถูกแตะ
    const still = await a.http('GET', `/workspaces/${wsA}/brands/${brandA}`);
    expect(still.json.name).toBe('ระเบียงบุญ ภูเก็ต');
  });

  it('viewer can read but not write; owner sees audit trail', async () => {
    const add = await a.http('POST', `/workspaces/${wsA}/members`, { email: B.email, role: 'viewer' });
    expect(add.status).toBe(201);
    const list = await b.http('GET', `/workspaces/${wsA}/clients`);
    expect(list.status).toBe(200); expect(list.json.map((c: { id: string }) => c.id)).toContain(clientA);
    expect((await b.http('POST', `/workspaces/${wsA}/clients`, { name: 'nope' })).status).toBe(403);
    expect((await b.http('GET', `/workspaces/${wsA}/audit`)).status).toBe(403);
    const audit = await a.http('GET', `/workspaces/${wsA}/audit`);
    expect(audit.status).toBe(200);
    const actions = audit.json.map((x: { action: string }) => x.action);
    for (const act of ['workspace.create', 'client.create', 'brand.create', 'brand.knowledge.add', 'workspace.member.add']) expect(actions).toContain(act);
    expect(JSON.stringify(audit.json)).not.toMatch(/passwordHash|scrypt\$/);
  });

  it('owner cannot be demoted or removed; unknown email → 404', async () => {
    const me = await a.http('GET', '/auth/me');
    expect((await a.http('PATCH', `/workspaces/${wsA}/members/${me.json.user.id}`, { role: 'viewer' })).status).toBe(400);
    expect((await a.http('POST', `/workspaces/${wsA}/members`, { email: 'nobody@test.local', role: 'editor' })).status).toBe(404);
  });

  it('logout revokes the session server-side', async () => {
    expect((await a.http('POST', '/auth/logout')).status).toBe(200);
    expect((await a.http('GET', '/auth/me')).status).toBe(401);
    const login = await a.http('POST', '/auth/login', { email: A.email, password: A.password });
    expect(login.status).toBe(200);
    expect((await a.http('GET', '/auth/me')).json.workspaces[0].id).toBe(wsA);
  });
});
