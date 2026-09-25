/**
 * Integration test — Facebook connection + page sync (§106 ขั้น 3–4) กับ mock Graph (§77)
 * ตรวจ: token ไม่หลุดใน response, tenant isolation, metric null-aware, disconnect ล้าง token
 * ต้องมี DATABASE_URL + REDIS_URL ไม่งั้นข้าม
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph, type MockState } from '@fbpm/facebook-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;

function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown, redirect: 'follow' | 'manual' = 'follow') => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body), redirect });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text, location: res.headers.get('location') };
  } };
  return c;
}

run('facebook connection + sync (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient; let mock: Awaited<ReturnType<typeof startMockGraph>>; let state: MockState;
  const stamp = Date.now();
  const A = { email: `fb-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `fb-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>;
  let wsA = ''; let wsB = ''; let brandA = ''; let connA = ''; let pageA = ''; let userA = '';

  beforeAll(async () => {
    mock = await startMockGraph(); state = mock.state;
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    process.env.META_GRAPH_BASE_URL = mock.url;
    process.env.META_APP_ID = 'app123'; process.env.META_APP_SECRET = 'secret456'; process.env.META_OAUTH_REDIRECT_URI = 'http://localhost:4000/facebook/oauth/callback';
    _resetRateLimits();
    ({ app } = await createApp());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    const ra = await a.http('POST', '/auth/register', A); wsA = ra.json.workspace.id; userA = ra.json.user.id;
    const rb = await b.http('POST', '/auth/register', B); wsB = rb.json.workspace.id;
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'ลูกค้า A' });
    const br = await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'แบรนด์ A' });
    brandA = br.json.id;
  }, 30_000);

  afterAll(async () => {
    delete process.env.META_GRAPH_BASE_URL; delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); mock.server.close();
  });

  it('rejects an invalid token with a user-facing 422, never echoing it', async () => {
    const r = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'BAD_TOKEN_THAT_IS_LONG_ENOUGH' });
    expect(r.status).toBe(422);
    expect(r.json.message).toMatch(/เชื่อมต่อเพจใหม่/);
    expect(r.text).not.toContain('BAD_TOKEN');
  });

  it('connects with a pasted user token and lists pages without any access_token', async () => {
    state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_TESTS');
    const r = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_TESTS' });
    expect(r.status, r.text).toBe(201);
    connA = r.json.connection.id;
    expect(r.json.connection.providerUserName).toBe('Test User');
    expect(r.json.connection.scopes).toContain('pages_manage_posts');
    expect(r.json.pages.map((p: { id: string }) => p.id)).toEqual(['111', '222']);
    expect(r.text).not.toMatch(/PAGE_111|PAGE_222|USER_OK|accessToken|encryptedAccessToken/);
    const stored = await prisma.facebookConnection.findUniqueOrThrow({ where: { id: connA }, select: { encryptedAccessToken: true } });
    expect(stored.encryptedAccessToken.startsWith('v1.')).toBe(true);
    expect(stored.encryptedAccessToken).not.toContain('USER_OK');
  });

  it('attaches a page to a brand, encrypts the page token and imports history with null-aware metrics', async () => {
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: connA, facebookPageId: '111' });
    expect(r.status, r.text).toBe(201);
    pageA = r.json.id;
    expect(r.json.name).toBe('ระเบียงบุญ');
    expect(r.json.tokenStatus).toBe('VALID');
    expect(r.json.tasks).toContain('CREATE_CONTENT');
    expect(r.json.initialSync.ok).toBe(true);
    expect(r.json.initialSync.imported).toBe(2);
    expect(r.json.completeness.score).toBeGreaterThan(0);
    expect(r.text).not.toMatch(/PAGE_111|pageAccessTokenEncrypted/);
    const row = await prisma.facebookPage.findUniqueOrThrow({ where: { id: pageA }, select: { pageAccessTokenEncrypted: true } });
    expect(row.pageAccessTokenEncrypted.startsWith('v1.')).toBe(true);

    const posts = await a.http('GET', `/workspaces/${wsA}/pages/${pageA}/posts`);
    expect(posts.status).toBe(200);
    expect(posts.json).toHaveLength(2);
    const first = posts.json.find((p: { facebookPostId: string }) => p.facebookPostId === '111_1');
    expect(first.metrics.shares.value).toBe(3);
    expect(first.metrics.reactions.value).toBeNull();   // อ่านไม่ได้ ≠ 0
    expect(first.metrics.comments.value).toBeNull();
    expect(first.source).toBe('imported');
  });

  it('rejects connecting a page id the account does not administer', async () => {
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: connA, facebookPageId: '999' });
    expect(r.status).toBe(404);
  });

  it('available pages mark already-connected ones', async () => {
    const r = await a.http('GET', `/workspaces/${wsA}/facebook/connections/${connA}/pages`);
    expect(r.status).toBe(200);
    expect(r.json.find((p: { id: string }) => p.id === '111').connected.brandName).toBe('แบรนด์ A');
    expect(r.json.find((p: { id: string }) => p.id === '222').connected).toBeNull();
  });

  it('re-sync updates existing posts and adds a new snapshot; detail exposes availability', async () => {
    const r = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/sync`, { days: 30 });
    expect(r.status, r.text).toBe(200);
    expect(r.json.updated).toBe(2); expect(r.json.imported).toBe(0);
    expect(r.json.availability).toEqual({ likes: false, comments: false, shares: true });
    const snaps = await prisma.postMetricSnapshot.count({ where: { post: { pageId: pageA } } });
    expect(snaps).toBe(4);
    const d = await a.http('GET', `/workspaces/${wsA}/pages/${pageA}`);
    expect(d.json.stats.availability).toEqual({ shares: true, reactions: false, comments: false });
    expect(d.json.stats.posts30d).toBe(2);
    expect(d.json.fanCount).toBe(1829);
    expect(d.json.lastSyncedAt).toBeTruthy();
  });

  it('tenant isolation: user B cannot see or sync workspace A pages (404)', async () => {
    expect((await b.http('GET', `/workspaces/${wsA}/pages`)).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsA}/pages/${pageA}`)).status).toBe(404);
    expect((await b.http('POST', `/workspaces/${wsA}/pages/${pageA}/sync`, {})).status).toBe(404);
    const list = await b.http('GET', `/workspaces/${wsB}/pages`);
    expect(list.status).toBe(200); expect(list.json).toEqual([]);
  });

  it('updates automation settings with audit and validates input', async () => {
    const r = await a.http('PATCH', `/workspaces/${wsA}/pages/${pageA}`, { automationLevel: 'AUTO_DRAFT', publishingPaused: true });
    expect(r.status).toBe(200); expect(r.json.automationLevel).toBe('AUTO_DRAFT'); expect(r.json.publishingPaused).toBe(true);
    expect((await a.http('PATCH', `/workspaces/${wsA}/pages/${pageA}`, { automationLevel: 'YOLO' })).status).toBe(400);
    const audit = await prisma.auditLog.findMany({ where: { workspaceId: wsA, action: { startsWith: 'facebook.' } }, select: { action: true, after: true } });
    expect(audit.map(x => x.action)).toEqual(expect.arrayContaining(['facebook.connection.create', 'facebook.page.connect', 'facebook.page.sync', 'facebook.page.update']));
    expect(JSON.stringify(audit)).not.toMatch(/PAGE_111|USER_OK/);
  });

  it('token failure during sync marks the page INVALID with a readable error', async () => {
    state.pageTokens['111'] = 'ROTATED';   // token เดิมใช้ไม่ได้แล้ว
    const r = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/sync`, {});
    expect(r.status).toBe(422);
    const d = await a.http('GET', `/workspaces/${wsA}/pages/${pageA}`);
    expect(d.json.tokenStatus).toBe('INVALID'); expect(d.json.lastSyncError).toMatch(/เชื่อมต่อเพจใหม่/);
    const v = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/validate`, {});
    expect(v.json.valid).toBe(false);
    // ผู้ใช้วาง token ใหม่ → page token ถูกต่ออายุอัตโนมัติ
    const again = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_TESTS' });
    expect(again.status).toBe(201);
    const d2 = await a.http('GET', `/workspaces/${wsA}/pages/${pageA}`);
    expect(d2.json.tokenStatus).toBe('VALID');
    expect((await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/validate`, {})).json.valid).toBe(true);
  });

  it('OAuth: start returns a facebook.com dialog url; callback exchanges code and redirects to /pages', async () => {
    const s = await a.http('GET', `/workspaces/${wsA}/facebook/oauth/start`);
    expect(s.status).toBe(200);
    const u = new URL(s.json.url);
    expect(u.hostname).toBe('www.facebook.com'); expect(u.searchParams.get('client_id')).toBe('app123');
    const st = u.searchParams.get('state')!;
    const bad = await client(base).http('GET', `/facebook/oauth/callback?code=GOOD&state=tampered`, undefined, 'manual');
    expect(bad.status).toBe(302); expect(bad.location).toContain('fbError=state');
    const ok = await client(base).http('GET', `/facebook/oauth/callback?code=GOOD&state=${encodeURIComponent(st)}`, undefined, 'manual');
    expect(ok.status).toBe(302); expect(ok.location).toMatch(/\/pages\?connected=/);
    const conns = await a.http('GET', `/workspaces/${wsA}/facebook/connections`);
    expect(conns.json.some((c: { providerUserId: string; user: { id: string } }) => c.providerUserId === 'U1' && c.user.id === userA)).toBe(true);
  });

  it('disconnect clears the page token but keeps history; revoke clears the user token', async () => {
    const r = await a.http('DELETE', `/workspaces/${wsA}/pages/${pageA}`);
    expect(r.status).toBe(200);
    const row = await prisma.facebookPage.findUniqueOrThrow({ where: { id: pageA }, select: { pageAccessTokenEncrypted: true, tokenStatus: true, disconnectedAt: true, _count: { select: { posts: true } } } });
    expect(row.pageAccessTokenEncrypted).toBe(''); expect(row.tokenStatus).toBe('DISCONNECTED'); expect(row.disconnectedAt).toBeTruthy(); expect(row._count.posts).toBe(2);
    expect((await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/sync`, {})).status).toBe(422);
    const rv = await a.http('DELETE', `/workspaces/${wsA}/facebook/connections/${connA}`);
    expect(rv.status).toBe(200);
    const c = await prisma.facebookConnection.findUniqueOrThrow({ where: { id: connA }, select: { encryptedAccessToken: true, status: true } });
    expect(c.encryptedAccessToken).toBe(''); expect(c.status).toBe('REVOKED');
    expect((await a.http('GET', `/workspaces/${wsA}/facebook/connections/${connA}/pages`)).status).toBe(422);
  });
});
