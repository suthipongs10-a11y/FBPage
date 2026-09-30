/** Integration — แพ็กเกจลูกค้า + โควต้าโพสต์ + ภาพรวมทุกเพจ (Graph จำลอง ไม่แตะเพจจริง) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { billingCycle } from '@fbpm/shared';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const run = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text };
  } };
  return c;
}

run('service plans + monthly post quota + portfolio (integration)', () => {
  let app: INestApplication; let base: string; let db: PrismaClient; let graph: Awaited<ReturnType<typeof startMockGraph>>;
  const stamp = Date.now(); const OWNER = { email: `pq-owner-${stamp}@test.local`, name: 'เจ้าของทีม', password: 'owner-password-123' }; const VIEWER = { email: `pq-viewer-${stamp}@test.local`, name: 'ผู้ดู', password: 'viewer-password-123' }; const OTHER = { email: `pq-other-${stamp}@test.local`, name: 'อีกทีม', password: 'other-password-123' };
  let a: ReturnType<typeof client>; let viewer: ReturnType<typeof client>; let other: ReturnType<typeof client>;
  let ws = ''; let otherWs = ''; let clientId = ''; let pageA = ''; let pageB = ''; let planId = ''; let proId = '';
  beforeAll(async () => {
    graph = await startMockGraph();
    Object.assign(process.env, { APP_ENV: 'test', AUTH_SECRET: process.env.AUTH_SECRET ?? 'plans-quota-tests-long-encryption-secret', META_GRAPH_BASE_URL: graph.url });
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); viewer = client(base); other = client(base); db = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', OWNER)).json.workspace.id;
    otherWs = (await other.http('POST', '/auth/register', OTHER)).json.workspace.id;
    clientId = (await a.http('POST', `/workspaces/${ws}/clients`, { name: 'ร้านส้มตำ' })).json.id;
    const brand = (await a.http('POST', `/workspaces/${ws}/clients/${clientId}/brands`, { name: 'ส้มตำแซ่บ' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_PLANS_TEST');
    const conn = (await a.http('POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_PLANS_TEST' })).json.connection.id;
    pageA = (await a.http('POST', `/workspaces/${ws}/brands/${brand}/pages/connect`, { connectionId: conn, facebookPageId: '111' })).json.id;
    pageB = (await a.http('POST', `/workspaces/${ws}/brands/${brand}/pages/connect`, { connectionId: conn, facebookPageId: '222' })).json.id;
    const inv = await a.http('POST', `/workspaces/${ws}/invites`, { role: 'viewer' });
    await viewer.http('POST', `/auth/invites/${inv.json.url.split('/invite/')[1]}/accept`, VIEWER);
  }, 30_000);
  afterAll(async () => {
    await db?.workspace.deleteMany({ where: { id: { in: [ws, otherWs] } } }); await db?.user.deleteMany({ where: { email: { in: [OWNER.email, VIEWER.email, OTHER.email] } } });
    await db?.$disconnect(); await app?.close(); graph?.server.close(); delete process.env.META_GRAPH_BASE_URL;
  });

  it('creates packages with validation; names are unique per workspace', async () => {
    expect((await a.http('POST', `/workspaces/${ws}/plans`, { name: 'ผิด', postsPerMonth: 4, reelsPerMonth: 6 })).status).toBe(400);
    const r = await a.http('POST', `/workspaces/${ws}/plans`, { name: 'เริ่มต้น', priceMonthly: 590, postsPerMonth: 12, reelsPerMonth: 2, features: ['posts', 'comments', 'report'] });
    expect(r.status, r.text).toBe(201); planId = r.json.id;
    proId = (await a.http('POST', `/workspaces/${ws}/plans`, { name: 'โปร', priceMonthly: 1490, postsPerMonth: null, features: ['posts', 'reels', 'messenger', 'portal', 'line'] })).json.id;
    expect((await a.http('POST', `/workspaces/${ws}/plans`, { name: 'เริ่มต้น', postsPerMonth: 8 })).status).toBe(409);
    expect((await a.http('POST', `/workspaces/${ws}/plans`, { name: 'x', features: ['teleport'] })).status).toBe(400);
    expect((await other.http('POST', `/workspaces/${otherWs}/plans`, { name: 'เริ่มต้น', postsPerMonth: 5 })).status).toBe(201);   // คนละ workspace ใช้ชื่อซ้ำได้
  });

  it('counts published + scheduled posts inside the page billing cycle only', async () => {
    const as = await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}/plan`, { servicePlanId: planId, billingDay: 1 });
    expect(as.status, as.text).toBe(200); expect(as.json.plan).toMatchObject({ name: 'เริ่มต้น', priceMonthly: 590 });
    const cyc = billingCycle(new Date(), 1, 'Asia/Bangkok'); const now = Date.now();
    const mk = (data: Record<string, unknown>) => db.contentItem.create({ data: { pageId: pageA, caption: 'x', ...data } as never });
    await mk({ status: 'PUBLISHED', publishedAt: new Date(Math.max(cyc.start.getTime() + 60_000, now - 3_600_000)) });
    await mk({ status: 'ANALYZED', publishedAt: new Date(Math.max(cyc.start.getTime() + 120_000, now - 7_200_000)) });
    await mk({ status: 'PUBLISHED', publishedAt: new Date(cyc.start.getTime() - 86_400_000) });   // รอบก่อน ไม่นับ
    await mk({ status: 'SCHEDULED', scheduledAt: new Date(now + 10 * 60_000) });
    await mk({ status: 'SCHEDULED', contentType: 'reel', scheduledAt: new Date(now + 20 * 60_000) });
    await mk({ status: 'SCHEDULED', scheduledAt: new Date(cyc.end.getTime() + 86_400_000) });   // รอบหน้า ไม่นับ
    await mk({ status: 'READY_FOR_APPROVAL' }); await mk({ status: 'PUBLISH_FAILED' });
    await db.contentItem.create({ data: { platform: 'YOUTUBE', status: 'PUBLISHED', publishedAt: new Date(), title: 'yt' } });   // ไม่ใช่ Facebook ไม่นับ

    const q = await a.http('GET', `/workspaces/${ws}/pages/${pageA}/quota`);
    expect(q.status, q.text).toBe(200);
    expect(q.json.quota).toMatchObject({ limit: 12, used: 2, planned: 4, remaining: 8 }); expect(q.json.scheduled).toBe(2);
    expect(q.json.reels).toEqual({ limit: 2, planned: 1, remaining: 1 });
    expect(new Date(q.json.cycle.start).toISOString()).toBe(cyc.start.toISOString());

    const pf = await a.http('GET', `/workspaces/${ws}/portfolio`);
    expect(pf.status).toBe(200);
    const rowA = pf.json.rows.find((r: { page: { id: string } }) => r.page.id === pageA); const rowB = pf.json.rows.find((r: { page: { id: string } }) => r.page.id === pageB);
    expect(rowA.client).toMatchObject({ id: clientId, name: 'ร้านส้มตำ' });
    expect(rowA.activity).toMatchObject({ pendingApproval: 1, failed: 1 }); expect(rowA.attention).toEqual(expect.arrayContaining(['FAILED', 'APPROVAL']));
    expect(rowA.attention).not.toContain('NO_PLAN'); expect(rowA.attention).not.toContain('STALE');
    expect(rowB.plan).toBeNull(); expect(rowB.quota.pace).toBe('NO_PLAN'); expect(rowB.attention).toContain('NO_PLAN'); expect(rowB.activity.lastPostAt).not.toBeNull();   // ซิงก์โพสต์จาก Graph จำลองตอนเชื่อมเพจ
    expect(pf.json.summary).toMatchObject({ pages: 2, withPlan: 1, monthlyRevenue: 590, postsUsed: 2, postsPlanned: 4, quotaTotal: 12, pendingApproval: 1 });
    expect(pf.json.summary.byPlan).toEqual([{ id: planId, name: 'เริ่มต้น', pages: 1, revenue: 590 }]);
    expect(pf.text).not.toMatch(/Encrypted|access_?token/i);
  });

  it('flags over-quota and keeps revenue away from roles without client.manage', async () => {
    await a.http('PATCH', `/workspaces/${ws}/plans/${planId}`, { postsPerMonth: 3, reelsPerMonth: 0 });
    const row = (await a.http('GET', `/workspaces/${ws}/portfolio`)).json.rows.find((r: { page: { id: string } }) => r.page.id === pageA);
    expect(row.quota).toMatchObject({ pace: 'OVER', remaining: -1 }); expect(row.attention).toEqual(expect.arrayContaining(['OVER', 'REELS_OVER']));
    await a.http('PATCH', `/workspaces/${ws}/pages/${pageB}/plan`, { servicePlanId: proId });
    const v = await viewer.http('GET', `/workspaces/${ws}/portfolio`);
    expect(v.status).toBe(200); expect(v.json.summary.monthlyRevenue).toBeNull(); expect(v.text).not.toContain('priceMonthly'); expect(v.text).not.toContain('1490');
    expect(v.json.rows.find((r: { page: { id: string } }) => r.page.id === pageB).quota.pace).toBe('UNLIMITED');
    const vp = await viewer.http('GET', `/workspaces/${ws}/plans`); expect(vp.status).toBe(200); expect(vp.text).not.toContain('priceMonthly');
    expect((await viewer.http('POST', `/workspaces/${ws}/plans`, { name: 'แอบสร้าง' })).status).toBe(403);
    expect((await viewer.http('PATCH', `/workspaces/${ws}/pages/${pageA}/plan`, { servicePlanId: null })).status).toBe(403);
    expect((await a.http('GET', `/workspaces/${ws}/plans`)).json.find((p: { id: string }) => p.id === planId)).toMatchObject({ pages: 1, priceMonthly: 590 });
  });

  it('isolates workspaces and protects plans that are in use', async () => {
    expect((await other.http('GET', `/workspaces/${ws}/portfolio`)).status).toBe(404);
    const otherPlan = (await other.http('GET', `/workspaces/${otherWs}/plans`)).json[0].id;
    expect((await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}/plan`, { servicePlanId: otherPlan })).status).toBe(404);
    expect((await other.http('PATCH', `/workspaces/${otherWs}/pages/${pageA}/plan`, { servicePlanId: otherPlan })).status).toBe(404);
    expect((await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}/plan`, { billingDay: 29 })).status).toBe(400);
    expect((await a.http('DELETE', `/workspaces/${ws}/plans/${planId}`)).status).toBe(409);
    await a.http('PATCH', `/workspaces/${ws}/plans/${proId}`, { active: false });
    expect((await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}/plan`, { servicePlanId: proId })).status).toBe(409);   // ปิดรับแล้ว
    expect((await a.http('PATCH', `/workspaces/${ws}/pages/${pageB}/plan`, { billingDay: 15 })).status).toBe(200);        // เพจเดิมที่ใช้อยู่ยังแก้ได้
    const cleared = await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}/plan`, { servicePlanId: null });
    expect(cleared.json.plan).toBeNull(); expect((await a.http('DELETE', `/workspaces/${ws}/plans/${planId}`)).status).toBe(200);
    const audit = await db.auditLog.count({ where: { workspaceId: ws, action: { in: ['plan.create', 'plan.update', 'plan.delete', 'page.plan.assign'] } } });
    expect(audit).toBeGreaterThanOrEqual(6);
  });

  it('shows the quota (not the price) to the business owner in the portal', async () => {
    const ov = await a.http('GET', `/portal/clients/${clientId}`);   // ทีมเปิดดูแบบลูกค้า
    expect(ov.status, ov.text).toBe(200);
    const pb = ov.json.pages.find((p: { id: string }) => p.id === pageB);
    expect(pb.plan).toMatchObject({ name: 'โปร', postsPerMonth: null }); expect(pb.quota).toMatchObject({ limit: null });
    expect(ov.text).not.toContain('priceMonthly');
  });
});
