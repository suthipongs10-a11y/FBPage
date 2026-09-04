/**
 * Integration test — AI Gateway (§4, §5), BYOK (§42), task log (§50), command center (§37), analyst (§19) กับ mock AI + mock Graph
 * ต้องมี DATABASE_URL + REDIS_URL ไม่งั้นข้าม
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { startMockAi } from '@fbpm/ai-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;

function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text };
  } };
  return c;
}

run('AI gateway + command center + analyst (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient;
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let ai: Awaited<ReturnType<typeof startMockAi>>;
  const stamp = Date.now();
  const A = { email: `ai-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `ai-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>;
  let wsA = ''; let wsB = ''; let brandA = ''; let pageA = '';

  beforeAll(async () => {
    graph = await startMockGraph(); ai = await startMockAi();
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    process.env.META_GRAPH_BASE_URL = graph.url;
    _resetRateLimits();
    ({ app } = await createApp());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    wsA = (await a.http('POST', '/auth/register', A)).json.workspace.id;
    wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'ลูกค้า AI' });
    brandA = (await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'แบรนด์ AI', toneOfVoice: 'เป็นกันเอง' })).json.id;
    await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/knowledge`, { type: 'business_info', title: 'ธุรกิจ', content: 'ร้านทำความสะอาดในภูเก็ต' });
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_AI_TESTS');
    const conn = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_AI_TESTS' });
    pageA = (await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
  }, 30_000);

  afterAll(async () => {
    delete process.env.META_GRAPH_BASE_URL;
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });
    await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); graph.server.close(); ai.server.close();
  });

  it('without any key → 422 with a clear message', async () => {
    const r = await a.http('POST', `/workspaces/${wsA}/ai/command`, { message: 'สวัสดี' });
    expect(r.status).toBe(422); expect(r.json.message).toMatch(/API key/);
  });

  it('stores a BYOK key encrypted, never returns it, and validates it against the provider', async () => {
    const bad = await a.http('PUT', `/workspaces/${wsA}/ai/providers/compatible`, { apiKey: 'short' });
    expect(bad.status).toBe(400);
    const r = await a.http('PUT', `/workspaces/${wsA}/ai/providers/compatible`, { apiKey: 'MOCK_KEY', baseUrl: ai.url, label: 'Mock LiteLLM' });
    expect(r.status, r.text).toBe(200);
    expect(r.json.keyHint).toBe('_KEY'); expect(r.text).not.toContain('MOCK_KEY');
    const row = await prisma.aiProviderKey.findFirstOrThrow({ where: { workspaceId: wsA, provider: 'compatible' } });
    expect(row.encryptedApiKey.startsWith('v1.')).toBe(true); expect(row.encryptedApiKey).not.toContain('MOCK_KEY');
    const list = await a.http('GET', `/workspaces/${wsA}/ai/providers`);
    expect(list.json.find((p: { id: string }) => p.id === 'compatible').configured).toBe(true);
    expect(list.text).not.toContain('MOCK_KEY');
    // ยังไม่มีโมเดลในบทบาทใด → validate บอกให้ตั้งก่อน
    const v0 = await a.http('POST', `/workspaces/${wsA}/ai/providers/compatible/validate`, {});
    expect(v0.json.ok).toBe(false);
    const roles = await a.http('PUT', `/workspaces/${wsA}/ai/roles`, { roles: { strategy: { provider: 'compatible', model: 'mock-strategy' }, analysis: { provider: 'compatible', model: 'mock-analysis' }, fast: { provider: 'compatible', model: 'mock-fast' } } });
    expect(roles.status).toBe(200); expect(roles.json.roles.strategy.model).toBe('mock-strategy'); expect(roles.json.roles.content).toBeNull();
    const v = await a.http('POST', `/workspaces/${wsA}/ai/providers/compatible/validate`, {});
    expect(v.json.ok, v.text).toBe(true);
  });

  it('wrong key → validate reports auth error and marks lastError', async () => {
    await a.http('PUT', `/workspaces/${wsA}/ai/providers/compatible`, { apiKey: 'WRONG_KEY_1234' });
    const v = await a.http('POST', `/workspaces/${wsA}/ai/providers/compatible/validate`, {});
    expect(v.json.ok).toBe(false); expect(v.json.error).toMatch(/API key/);
    const list = await a.http('GET', `/workspaces/${wsA}/ai/providers`);
    expect(list.json.find((p: { id: string }) => p.id === 'compatible').lastError).toMatch(/API key/);
    await a.http('PUT', `/workspaces/${wsA}/ai/providers/compatible`, { apiKey: 'MOCK_KEY' });
  });

  it('command center: uses tools against real workspace data, logs the task with cost/usage, locks context', async () => {
    ai.state.replies.push({ toolCalls: [{ name: 'get_posts', args: { days: 30 } }, { name: 'get_brand_knowledge', args: {} }] }, { text: 'เพจมี 2 โพสต์ใน 30 วัน ค่า reactions อ่านไม่ได้' });
    const r = await a.http('POST', `/workspaces/${wsA}/ai/command`, { message: 'สรุปเพจนี้', context: { pageId: pageA, days: 30 } });
    expect(r.status, r.text).toBe(200);
    expect(r.json.text).toContain('2 โพสต์');
    expect(r.json.steps.map((s: { type: string; name: string }) => `${s.type}:${s.name}`)).toEqual(['tool:get_posts', 'result:get_posts', 'tool:get_brand_knowledge', 'result:get_brand_knowledge']);
    expect(r.json.model).toBe('mock-strategy');
    expect(r.json.usage.input).toBeGreaterThan(0);
    // เครื่องมือได้ข้อมูลจริง: โพสต์ของเพจ 111 และ knowledge ของแบรนด์
    const toolMsgs = r.json.messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolMsgs[0].content).toContain('111_1'); expect(toolMsgs[0].content).toContain('"reactions":null');
    expect(toolMsgs[1].content).toContain('ภูเก็ต');
    // system prompt ส่งบริบทที่ล็อกไว้ให้โมเดล
    const sys = (ai.state.requests.at(-1)!.messages as { role: string; content: string }[]).find(m => m.role === 'system')!.content;
    expect(sys).toContain('ระเบียงบุญ'); expect(sys).toContain('30 วัน');
    const log = await prisma.aiTaskLog.findFirstOrThrow({ where: { workspaceId: wsA, taskType: 'ai.command' }, orderBy: { createdAt: 'desc' } });
    expect(log.success).toBe(true); expect(log.inputTokens).toBe(240); expect(log.role).toBe('strategy'); expect(log.resourceId).toBe(pageA);
  });

  it('tenant isolation: user B cannot use A pages as context; A tools cannot reach B data', async () => {
    const r = await b.http('POST', `/workspaces/${wsA}/ai/command`, { message: 'x', context: { pageId: pageA } });
    expect(r.status).toBe(404);
    const r2 = await b.http('POST', `/workspaces/${wsB}/ai/command`, { message: 'x', context: { pageId: pageA } });
    expect([404, 422]).toContain(r2.status);   // ไม่พบเพจในบริบท หรือยังไม่มี key
  });

  it('analyst agent returns validated structured analysis, retries on bad JSON, stores PageAnalysis', async () => {
    ai.state.replies.push(
      { text: '{"summary": "x"}' },   // ไม่ครบ → โมเดลถูกขอให้แก้
      { text: JSON.stringify({ summary: 'เพจโพสต์สม่ำเสมอ', dataLimitations: ['reactions อ่านไม่ได้'], topPosts: [{ facebookPostId: '111_1', why: 'แชร์ 3' }], patterns: [{ finding: 'โพสต์ข้อความล้วน', evidence: '2/2', confidence: 'medium' }], recommendations: [{ title: 'เพิ่มรูป', why: 'โพสต์มีแต่ข้อความ', action: 'ทำการ์ดภาพ 1080x1080', confidence: 'medium', expectedImpact: 'high' }], contentPillars: ['ความรู้', 'โปรโมชัน'] }) },
    );
    const r = await a.http('POST', `/workspaces/${wsA}/analytics/pages/${pageA}/analyze`, { days: 30 });
    expect(r.status, r.text).toBe(200);
    expect(r.json.model).toBe('mock-analysis');
    expect(r.json.result.recommendations[0].title).toBe('เพิ่มรูป');
    expect(r.json.result.dataLimitations).toContain('reactions อ่านไม่ได้');
    const prompt = (ai.state.requests.at(-2)!.messages as { role: string; content: string }[]).find(m => m.role === 'user')!.content;
    expect(prompt).toContain('อ่านไม่ได้ทุกโพสต์');   // ข้อจำกัดข้อมูลถูกส่งให้โมเดล
    const list = await a.http('GET', `/workspaces/${wsA}/analytics/pages/${pageA}/analyses`);
    expect(list.json).toHaveLength(1);
    expect((await b.http('GET', `/workspaces/${wsA}/analytics/pages/${pageA}/analyses`)).status).toBe(404);
  });

  it('budget: monthly cap blocks new tasks with 402; usage endpoint reports month-to-date', async () => {
    await prisma.aiTaskLog.create({ data: { workspaceId: wsA, taskType: 'seed', role: 'fast', provider: 'compatible', model: 'm', latencyMs: 1, estimatedCost: 5, success: true, requestId: 'seed' } });
    const set = await a.http('PATCH', `/workspaces/${wsA}`, { aiMonthlyBudgetUsd: 4 });
    expect(set.status).toBe(200);
    const r = await a.http('POST', `/workspaces/${wsA}/ai/command`, { message: 'x' });
    expect(r.status).toBe(402);
    const u = await a.http('GET', `/workspaces/${wsA}/ai/usage`);
    expect(u.json.monthlyBudgetUsd).toBe(4); expect(u.json.monthToDate.costUsd).toBeGreaterThanOrEqual(5);
    await a.http('PATCH', `/workspaces/${wsA}`, { aiMonthlyBudgetUsd: null });
  });

  it('provider outage → retried once then 502 with user message; logged as failures', async () => {
    ai.state.failNext = 2;
    const r = await a.http('POST', `/workspaces/${wsA}/ai/command`, { message: 'x' });
    expect(r.status).toBe(502);
    const fails = await prisma.aiTaskLog.count({ where: { workspaceId: wsA, taskType: 'ai.command', success: false } });
    expect(fails).toBeGreaterThanOrEqual(1);
    const tasks = await a.http('GET', `/workspaces/${wsA}/ai/tasks?limit=5`);
    expect(tasks.status).toBe(200); expect(tasks.text).not.toContain('MOCK_KEY');
  });

  it('removing the key returns the workspace to "not configured"', async () => {
    expect((await a.http('DELETE', `/workspaces/${wsA}/ai/providers/compatible`)).status).toBe(200);
    expect((await a.http('POST', `/workspaces/${wsA}/ai/command`, { message: 'x' })).status).toBe(422);
    expect((await a.http('GET', `/workspaces/${wsA}/ai/tools`)).json.every((t: { riskLevel: string }) => t.riskLevel === 'READ')).toBe(true);
  });
});
