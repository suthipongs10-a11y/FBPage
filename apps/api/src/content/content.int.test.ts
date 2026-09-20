/**
 * Integration — content lifecycle (§28), approval (§29), human edit revisions (§55), schedule (§47), publish + idempotency (§48), kill switch (§92), agents (mock AI)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaClient } from '@fbpm/database';
import { FacebookService, publishContent, startMockGraph } from '@fbpm/facebook-core';
import { startMockAi } from '@fbpm/ai-core';
import { QUEUES, publishJobId } from '@fbpm/shared';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';
import { localToUtc } from './tz';

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

describe('localToUtc (§47)', () => {
  it('converts Bangkok local time to UTC (no DST)', () => { expect(localToUtc('2026-09-10T10:00', 'Asia/Bangkok').toISOString()).toBe('2026-09-10T03:00:00.000Z'); });
  it('handles DST zones', () => { expect(localToUtc('2026-07-01T12:00', 'Europe/London').toISOString()).toBe('2026-07-01T11:00:00.000Z'); expect(localToUtc('2026-01-01T12:00', 'Europe/London').toISOString()).toBe('2026-01-01T12:00:00.000Z'); });
});

run('content lifecycle + publish (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient; let graph: Awaited<ReturnType<typeof startMockGraph>>; let ai: Awaited<ReturnType<typeof startMockAi>>; let publishQueue: Queue;
  const stamp = Date.now();
  const A = { email: `ct-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `ct-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>;
  let wsA = ''; let wsB = ''; let brandA = ''; let pageA = ''; let cid = '';

  beforeAll(async () => {
    graph = await startMockGraph(); ai = await startMockAi();
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars'; process.env.META_GRAPH_BASE_URL = graph.url;
    _resetRateLimits();
    ({ app } = await createApp()); await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    const u = new URL(process.env.REDIS_URL!); publishQueue = new Queue(QUEUES.facebookPublish, { connection: { host: u.hostname, port: Number(u.port) || 6379, db: Number(u.pathname.slice(1)) || 0 } });
    wsA = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'ลูกค้า C' });
    brandA = (await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'แบรนด์ C', primaryCTA: 'ทักแชท' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_CONTENT_TEST');
    const conn = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_CONTENT_TEST' });
    pageA = (await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
  }, 30_000);
  afterAll(async () => {
    delete process.env.META_GRAPH_BASE_URL;
    await publishQueue.obliterate({ force: true }).catch(() => undefined); await publishQueue.close();
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); graph.server.close(); ai.server.close();
  });

  it('creates a draft, human edit stores a revision, state machine rejects illegal moves', async () => {
    const r = await a.http('POST', `/workspaces/${wsA}/content`, { pageId: pageA, title: 'โปรเปิดตัว', caption: 'ร่างแรก', hashtags: ['ระเบียงบุญ'] });
    expect(r.status, r.text).toBe(201); cid = r.json.id; expect(r.json.status).toBe('DRAFT');
    expect((await a.http('POST', `/workspaces/${wsA}/content/${cid}/approve`, {})).status).toBe(409);   // ยังไม่ส่งขออนุมัติ
    const e = await a.http('PATCH', `/workspaces/${wsA}/content/${cid}`, { caption: 'ร่างที่สอง แก้โดยคน', reason: 'ปรับน้ำเสียง' });
    expect(e.status).toBe(200); expect(e.json.editedByHuman).toBe(true);
    const revs = await a.http('GET', `/workspaces/${wsA}/content/${cid}/revisions`);
    expect(revs.json.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    expect((await b.http('GET', `/workspaces/${wsA}/content/${cid}`)).status).toBe(404);
    expect((await b.http('POST', `/workspaces/${wsB}/content`, { pageId: pageA, caption: 'x' })).status).toBe(404);   // เพจของ A
  });

  it('submit without AI skips review → READY_FOR_APPROVAL with a PENDING approval; approve → APPROVED (audited)', async () => {
    const s = await a.http('POST', `/workspaces/${wsA}/content/${cid}/submit`, {});
    expect(s.status, s.text).toBe(200); expect(s.json.status).toBe('READY_FOR_APPROVAL'); expect(s.json.approvals[0].status).toBe('PENDING');
    const q = await a.http('GET', `/workspaces/${wsA}/approvals`); expect(q.json).toHaveLength(1);
    const ap = await a.http('POST', `/workspaces/${wsA}/content/${cid}/approve`, { comment: 'โอเค' });
    expect(ap.status).toBe(200); expect(ap.json.status).toBe('APPROVED'); expect(ap.json.approvals[0].status).toBe('APPROVED'); expect(ap.json.approvals[0].reviewerComment).toBe('โอเค');
    const audit = await prisma.auditLog.findMany({ where: { workspaceId: wsA, resourceId: cid }, select: { action: true } });
    expect(audit.map(x => x.action)).toEqual(expect.arrayContaining(['content.create', 'content.update', 'content.submit', 'content.approved']));
  });

  it('editing after approval sends it back to DRAFT (must be re-approved)', async () => {
    const e = await a.http('PATCH', `/workspaces/${wsA}/content/${cid}`, { caption: 'แก้หลังอนุมัติ' });
    expect(e.json.status).toBe('DRAFT');
    await a.http('POST', `/workspaces/${wsA}/content/${cid}/submit`, {}); await a.http('POST', `/workspaces/${wsA}/content/${cid}/approve`, {});
  });

  it('schedule stores local+tz+utc and enqueues a delayed job keyed by content id; reschedule replaces it; cancel removes it', async () => {
    const bad = await a.http('POST', `/workspaces/${wsA}/content/${cid}/schedule`, { scheduledLocal: '2020-01-01T10:00' });
    expect(bad.status).toBe(400);
    const local = new Date(Date.now() + 2 * 3_600_000); const pad = (n: number) => String(n).padStart(2, '0');
    const iso = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    const s = await a.http('POST', `/workspaces/${wsA}/content/${cid}/schedule`, { scheduledLocal: iso, timezone: 'UTC' });
    expect(s.status, s.text).toBe(200); expect(s.json.status).toBe('SCHEDULED'); expect(s.json.scheduledTz).toBe('UTC'); expect(new Date(s.json.scheduledAt).toISOString().slice(0, 16)).toBe(`${iso}`);
    const job = await publishQueue.getJob(publishJobId(cid)); expect(job).toBeTruthy(); expect(await job!.getState()).toBe('delayed');
    const js = await a.http('GET', `/workspaces/${wsA}/content/${cid}/job`); expect(js.json.state).toBe('delayed');
    const local2 = new Date(Date.now() + 3 * 3_600_000);
    const iso2 = `${local2.getUTCFullYear()}-${pad(local2.getUTCMonth() + 1)}-${pad(local2.getUTCDate())}T${pad(local2.getUTCHours())}:${pad(local2.getUTCMinutes())}`;
    const s2 = await a.http('POST', `/workspaces/${wsA}/content/${cid}/schedule`, { scheduledLocal: iso2, timezone: 'UTC' });
    expect(s2.status, s2.text).toBe(200); expect(new Date(s2.json.scheduledAt).getTime()).toBeGreaterThan(new Date(s.json.scheduledAt).getTime());
    expect(await (await publishQueue.getJob(publishJobId(cid)))!.getState()).toBe('delayed');
    const back = await a.http('POST', `/workspaces/${wsA}/content/${cid}/reopen`, {});
    expect(back.json.status).toBe('APPROVED'); expect(await publishQueue.getJob(publishJobId(cid))).toBeUndefined();
  });

  it('kill switch: paused page blocks publish with a reason and nothing is sent to Facebook', async () => {
    await a.http('PATCH', `/workspaces/${wsA}/pages/${pageA}`, { publishingPaused: true });
    const before = graph.state.published.length;
    const r = await a.http('POST', `/workspaces/${wsA}/content/${cid}/publish`, {});
    expect(r.status).toBe(200); expect(r.json.outcome.status).toBe('SKIPPED'); expect(r.json.outcome.reason).toMatch(/หยุดการโพสต์/);
    expect(graph.state.published.length).toBe(before);
    await a.http('PATCH', `/workspaces/${wsA}/pages/${pageA}`, { publishingPaused: false });
  });

  it('publish now → Facebook post created once, FacebookPost(source=app) linked, second call is idempotent', async () => {
    const before = graph.state.published.length;
    const r = await a.http('POST', `/workspaces/${wsA}/content/${cid}/publish`, {});
    expect(r.status, r.text).toBe(200); expect(r.json.outcome.status).toBe('PUBLISHED'); expect(r.json.content.status).toBe('PUBLISHED');
    expect(graph.state.published.length).toBe(before + 1);
    expect(graph.state.published.at(-1)!.body.message).toContain('แก้หลังอนุมัติ'); expect(graph.state.published.at(-1)!.body.message).toContain('#ระเบียงบุญ');
    const post = await prisma.facebookPost.findFirst({ where: { pageId: pageA, source: 'app' } }); expect(post?.facebookPostId).toBe(r.json.outcome.externalId);
    const op = await prisma.externalOperation.findUnique({ where: { idempotencyKey: `publish:${cid}` } }); expect(op?.status).toBe('SUCCEEDED');
    // เรียก publisher ซ้ำ (เหมือน job retry) → ไม่ยิงซ้ำ
    const again = await publishContent({ prisma, fb: new FacebookService({ baseUrl: graph.url }), authSecret: process.env.AUTH_SECRET!, apiVersion: 'v26.0' }, cid, { requestId: 'retry' });
    expect(again.status).toBe('SKIPPED');   // สถานะ PUBLISHED ไม่ใช่ publishable
    expect(graph.state.published.length).toBe(before + 1);
    expect((await a.http('POST', `/workspaces/${wsA}/content/${cid}/publish`, {})).status).toBe(409);
  });

  it('ambiguous legacy attempts require reconciliation even when a caption matches another post', async () => {
    const c2 = (await a.http('POST', `/workspaces/${wsA}/content`, { pageId: pageA, caption: `โพสต์กันซ้ำ ${stamp}` })).json.id;
    await a.http('POST', `/workspaces/${wsA}/content/${c2}/submit`, {}); await a.http('POST', `/workspaces/${wsA}/content/${c2}/approve`, {});
    // จำลอง: รอบแรกส่งถึง Facebook แล้วแต่เราไม่ได้ id → op PENDING + retryCount 1 + โพสต์มีอยู่แล้วบนเพจ
    graph.state.posts['111']!.unshift({ id: '111_dup', message: `โพสต์กันซ้ำ ${stamp}`, created_time: new Date().toISOString() });
    await prisma.externalOperation.create({ data: { workspaceId: wsA, provider: 'facebook', operationType: 'publish-post', idempotencyKey: `publish:${c2}`, requestHash: 'old', status: 'PENDING' } });
    await prisma.contentItem.update({ where: { id: c2 }, data: { status: 'PUBLISH_FAILED', retryCount: 1 } });
    const before = graph.state.published.length;
    const r = await a.http('POST', `/workspaces/${wsA}/content/${c2}/publish`, {});
    expect(r.json.outcome.status).toBe('SKIPPED'); expect(r.json.outcome.reason).toContain('RECONCILIATION_REQUIRED');
    expect(graph.state.published.length).toBe(before);
  });

  it('changing the approved title also requires another human approval', async () => {
    const item = await prisma.contentItem.create({ data: { pageId: pageA, caption: 'approved', status: 'APPROVED' } });
    const edited = await a.http('PATCH', `/workspaces/${wsA}/content/${item.id}`, { title: 'changed title' });
    expect(edited.status).toBe(200); expect(edited.json.status).toBe('DRAFT');
    expect((await a.http('POST', `/workspaces/${wsA}/content/${item.id}/publish`, {})).status).toBe(409);
  });
  it('concurrent publishers claim an approved item only once', async () => {
    const item = await prisma.contentItem.create({ data: { pageId: pageA, caption: 'concurrent claim', status: 'APPROVED' } });
    const before = graph.state.published.length;
    const deps = { prisma, fb: new FacebookService({ baseUrl: graph.url }), authSecret: process.env.AUTH_SECRET!, apiVersion: 'v26.0' };
    const results = await Promise.all(Array.from({ length: 6 }, () => publishContent(deps, item.id)));
    expect(results.filter(r => r.status === 'PUBLISHED')).toHaveLength(1);
    expect(graph.state.published.length).toBe(before + 1);
  });

  it('a lost response never retries a write or associates an unrelated post', async () => {
    const item = await prisma.contentItem.create({ data: { pageId: pageA, caption: 'ambiguous response', status: 'APPROVED' } });
    let writes = 0;
    const fb = new FacebookService({ baseUrl: graph.url, fetchImpl: async (url, init) => {
      if (init?.method === 'POST') { writes++; throw new Error('connection lost'); }
      return fetch(url, init);
    } });
    const deps = { prisma, fb, authSecret: process.env.AUTH_SECRET!, apiVersion: 'v26.0' };
    const result = await publishContent(deps, item.id);
    expect(result).toMatchObject({ status: 'FAILED', retryable: false });
    expect(writes).toBe(1);
    expect(await publishContent(deps, item.id)).toMatchObject({ status: 'SKIPPED' });
    expect(writes).toBe(1);
    expect(await prisma.externalOperation.findUnique({ where: { idempotencyKey: `publish:${item.id}` } })).toMatchObject({ status: 'UNKNOWN', externalId: null });
  });

  it('strategist plan → PLANNED items; content agent fills a draft with missingInfo flagged; reviewer gates submit', async () => {
    const aiConn = (await a.http('POST', `/workspaces/${wsA}/ai/connections`, { preset: 'custom', label: 'Mock AI', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['m-content', 'm-fast', 'm-strategy'] })).json.id;
    await a.http('PUT', `/workspaces/${wsA}/ai/roles`, { roles: { strategy: { connectionId: aiConn, model: 'm-strategy' }, content: { connectionId: aiConn, model: 'm-content' }, fast: { connectionId: aiConn, model: 'm-fast' } } });
    ai.state.replies.push({ text: JSON.stringify({ objective: 'เพิ่มการทัก', contentPillars: ['ความรู้', 'โปร'], recommendedMix: { ความรู้: 0.6, โปร: 0.4 }, rationale: 'r', dataLimitations: [], items: [{ dayOffset: 0, contentType: 'post', pillar: 'ความรู้', title: 'ทำไมต้องจัดงานบุญ', objective: 'ให้ความรู้', hook: 'รู้ไหมว่า…', cta: 'ทักแชท' }, { dayOffset: 3, contentType: 'photo', pillar: 'โปร', title: 'แพ็กเกจ', objective: 'ขาย', hook: 'จัดครบ', cta: 'ทักแชท' }] }) });
    const p = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/content/plan`, { days: 7, postsPerWeek: 2 });
    expect(p.status, p.text).toBe(200); expect(p.json.items).toHaveLength(2); expect(p.json.items[0].status).toBe('PLANNED'); expect(p.json.model).toBe('m-strategy');
    const planned = p.json.items[1].id;
    ai.state.replies.push({ text: JSON.stringify({ drafts: [{ headline: 'แพ็กเกจจัดงานบุญ', caption: 'จัดงานบุญครบวงจร สนใจทักแชท', cta: 'ทักแชท', hashtags: ['#งานบุญ'], mediaBrief: 'ภาพโต๊ะจัดเลี้ยง', contentPillar: 'โปร', missingInfo: ['ราคาแพ็กเกจ'] }] }) });
    const g = await a.http('POST', `/workspaces/${wsA}/content/${planned}/generate`, {});
    expect(g.status, g.text).toBe(200); expect(g.json.items[0].status).toBe('DRAFT'); expect(g.json.items[0].caption).toContain('ทักแชท'); expect(g.json.items[0].hashtags).toEqual(['งานบุญ']);
    expect(g.json.items[0].aiNotes.missingInfo).toEqual(['ราคาแพ็กเกจ']); expect(g.json.items[0].aiNotes.needsHumanInput).toBe(true);
    // reviewer บอกต้องแก้ → NEEDS_REVISION; รอบสอง PASS → READY_FOR_APPROVAL
    ai.state.replies.push({ text: JSON.stringify({ result: 'NEEDS_REVISION', summary: 'ยังไม่มีราคา', issues: [{ type: 'missing_info', detail: 'ระบุราคาก่อน', severity: 'medium' }] }) });
    const s1 = await a.http('POST', `/workspaces/${wsA}/content/${planned}/submit`, {});
    expect(s1.status, s1.text).toBe(200); expect(s1.json.status).toBe('NEEDS_REVISION'); expect(s1.json.reviewResult.result).toBe('NEEDS_REVISION');
    await a.http('PATCH', `/workspaces/${wsA}/content/${planned}`, { caption: 'จัดงานบุญครบวงจร เริ่ม 9,900 บาท สนใจทักแชท' });
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    const s2 = await a.http('POST', `/workspaces/${wsA}/content/${planned}/submit`, {});
    expect(s2.json.status).toBe('READY_FOR_APPROVAL'); expect(s2.json.reviewResult.result).toBe('PASS');
    const cal = await a.http('GET', `/workspaces/${wsA}/content/calendar`); expect(cal.status).toBe(200); expect(cal.json.some((x: { id: string }) => x.id === cid)).toBe(true);
    const bulk = await (async () => { ai.state.replies.push({ text: JSON.stringify({ drafts: [{ headline: 'A', caption: 'a', cta: '', hashtags: [], mediaBrief: '', contentPillar: 'ความรู้', missingInfo: [] }, { headline: 'B', caption: 'b', cta: '', hashtags: [], mediaBrief: '', contentPillar: 'ความรู้', missingInfo: [] }] }) }); return a.http('POST', `/workspaces/${wsA}/pages/${pageA}/content/generate`, { brief: 'ความรู้เรื่องงานบุญ', count: 2 }); })();
    expect(bulk.json.items).toHaveLength(2);
  });
});
