/**
 * Integration — ผู้ช่วยหาเรื่องโพสต์ต่อเพจ: เช็คข้อมูลเพจ (ข้อเท็จจริง + โปรไฟล์ AI) → หาเรื่องเหมาะ/เป็นกระแส (web / ai) → ไอเดีย → โต๊ะค้นคว้า
 * ทุกอย่างยิง mock (Graph/AI/เว็บ/Tavily) — metric ที่อ่านไม่ได้ต้องเป็น null ไม่ใช่ 0
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { startMockAi } from '@fbpm/ai-core';
import { startMockWeb } from '@fbpm/web-core';
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
const J = (v: unknown) => ({ text: JSON.stringify(v) });
const metric = (reactions: number | null, comments: number | null, shares: number | null) => ({ reactions: { value: reactions, sourceMetric: 'likes' }, comments: { value: comments, sourceMetric: 'comments' }, shares: { value: shares, sourceMetric: 'shares' } });
const profile = { summary: 'บริการแม่บ้านทำความสะอาดวิลล่าและคอนโดในภูเก็ต', businessType: 'บริการทำความสะอาด', audience: 'เจ้าของวิลล่า/คอนโดชาวต่างชาติ', location: 'ภูเก็ต', pillars: [{ name: 'เคล็ดลับทำความสะอาด', why: 'ได้แชร์เยอะ' }], whatWorks: ['โพสต์ก่อน-หลังได้ยอดสูงสุด'], gaps: ['ไม่มีรีวิวลูกค้า'], seasonalHooks: ['ฤดูฝน'], avoid: [], searchTopics: [{ query: 'Phuket villa rental news', why: 'ลูกค้าหลัก' }, { query: 'ฝนตกภูเก็ต', why: 'ฤดูฝน' }], dataWarnings: [] };

run('page scout (integration)', () => {
  let app: INestApplication; let prisma: PrismaClient;
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let ai: Awaited<ReturnType<typeof startMockAi>>; let web: Awaited<ReturnType<typeof startMockWeb>>;
  const stamp = Date.now();
  const A = { email: `scout-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `scout-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>;
  let wsA = ''; let wsB = ''; let brandA = ''; let pageA = ''; let conn = '';

  beforeAll(async () => {
    graph = await startMockGraph(); ai = await startMockAi(); web = await startMockWeb();
    Object.assign(process.env, { APP_ENV: 'test', META_GRAPH_BASE_URL: graph.url, WEB_MOCK_BASE_URL: web.url, WEB_ALLOW_PRIVATE_TARGETS: 'true' });
    process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    _resetRateLimits();
    ({ app } = await createApp()); await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    wsA = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'Phuket Maids' });
    brandA = (await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'Phuket Maids Service', description: 'แม่บ้านทำความสะอาดวิลล่า', serviceArea: 'ภูเก็ต' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_SCOUT');
    const fb = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_SCOUT' });
    pageA = (await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: fb.json.connection.id, facebookPageId: '111' })).json.id;
    conn = (await a.http('POST', `/workspaces/${wsA}/ai/connections`, { preset: 'custom', label: 'Mock AI', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['m-main', 'sonar'] })).json.id;
    await a.http('PUT', `/workspaces/${wsA}/ai/roles`, { roles: { research: { connectionId: conn, model: 'm-main' }, content: { connectionId: conn, model: 'm-main' }, fast: { connectionId: conn, model: 'm-main' }, analysis: { connectionId: conn, model: 'm-main' } } });
    await a.http('PUT', `/workspaces/${wsA}/news/search-provider`, { provider: 'tavily', apiKey: 'TAVILY_OK' });
    // ข้อมูลเพจ + โพสต์ย้อนหลัง + คลังความรู้ (แทนการซิงก์จริง)
    await prisma.facebookPage.update({ where: { id: pageA }, data: { profile: { about: 'Villa cleaning in Phuket', phone: '+66812345678' } } });
    await prisma.facebookPost.deleteMany({ where: { pageId: pageA } });
    const mk = (id: string, message: string, days: number, m: ReturnType<typeof metric> | null) => prisma.facebookPost.create({ data: { pageId: pageA, facebookPostId: `111_${id}`, message, publishedAt: new Date(Date.now() - days * 86_400_000), ...(m && { snapshots: { create: { metrics: m, apiVersion: 'v26.0' } } }) } });
    await mk('1', 'ก่อน-หลัง ทำความสะอาดวิลล่า 5 ห้องนอน', 3, metric(120, 30, 12));
    await mk('2', 'โปรโมชั่นแม่บ้านรายเดือน', 10, metric(8, 1, 0));
    await mk('3', 'ข้อความที่อ่านตัวเลขไม่ได้', 20, metric(null, null, null));
    await prisma.brandKnowledgeItem.create({ data: { brandId: brandA, type: 'service', title: 'ทำความสะอาดหลังเช็คเอาท์', content: 'สำหรับวิลล่าให้เช่า ภายใน 3 ชั่วโมง' } });
  }, 30_000);
  afterAll(async () => {
    for (const k of ['META_GRAPH_BASE_URL', 'WEB_MOCK_BASE_URL', 'WEB_ALLOW_PRIVATE_TARGETS']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); graph.server.close(); ai.server.close(); web.server.close();
  });

  it('เช็คข้อมูลเพจ: ข้อเท็จจริงคำนวณเอง (null ไม่กลายเป็น 0) + โปรไฟล์จาก AI บทบาท analysis', async () => {
    ai.state.replies.push(J(profile));
    const r = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/scout/check`, {});
    expect(r.status).toBe(200);
    expect(r.json.facts).toMatchObject({ posts90d: 3, metricsAvailable: true, knowledgeCount: 1 });
    expect(r.json.facts.completenessScore).toBeGreaterThan(0);
    expect(r.json.facts.topPosts.map((p: { engagement: number }) => p.engagement)).toEqual([162, 9]);   // โพสต์ที่อ่านไม่ได้ไม่ถูกนับเป็น 0
    expect(r.json.facts.warnings).toEqual([]);
    expect(r.json.profile.searchTopics).toHaveLength(2);
    const prompt = JSON.stringify(ai.state.requests.at(-1)!.messages);
    expect(prompt).toContain('ก่อน-หลัง ทำความสะอาดวิลล่า'); expect(prompt).toContain('ทำความสะอาดหลังเช็คเอาท์'); expect(prompt).toContain('อ่านตัวเลขไม่ได้');
    expect((await a.http('GET', `/workspaces/${wsA}/pages/${pageA}/scout`)).json.profile.summary).toContain('ภูเก็ต');
    expect((await b.http('POST', `/workspaces/${wsB}/pages/${pageA}/scout/check`, {})).status).toBe(404);
  });

  it('หาเรื่อง (web): ค้นตามคำค้นของโปรไฟล์ → ไอเดียอ้างแหล่งจริง · "กระแส" ที่ไม่มีแหล่งถูกลดเป็น evergreen', async () => {
    web.state.news.tavilyResults = [{ title: 'Phuket villa bookings surge for high season', url: `${web.url}/article/elephant`, content: 'Bookings up 30%' }];
    ai.state.replies.push(J({ ideas: [
      { title: 'เตรียมวิลล่าก่อนไฮซีซัน', why: 'ยอดจองพุ่ง', trend: 'ข่าวยอดจองเพิ่ม', angle: 'เช็กลิสต์', format: 'listicle', kind: 'trend', sources: [1, 42], query: 'Phuket high season villa' },
      { title: 'ฝนตกบ่อย กันราขึ้นผนังยังไง', why: 'ฤดูฝน', trend: 'ข่าวลือ', angle: 'เคล็ดลับ', format: 'qa', kind: 'trend', sources: [], query: 'กันราในบ้านช่วงฝน' },
    ] }));
    const r = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/scout/ideas`, { mode: 'web', count: 3 });
    expect(r.status).toBe(200);
    expect(web.state.news.tavilyQueries).toEqual(expect.arrayContaining(['Phuket villa rental news', 'ฝนตกภูเก็ต']));
    expect(r.json.ideaSources[0]).toMatchObject({ n: 1, url: `${web.url}/article/elephant` });
    expect(r.json.ideas[0]).toMatchObject({ kind: 'trend', sources: [1], format: 'listicle' });
    expect(r.json.ideas[1]).toMatchObject({ kind: 'evergreen', trend: '' });
  });

  it('ไอเดีย → โต๊ะค้นคว้า: มีลิงก์ = อ่านจากลิงก์ · ไม่มี = ค้นเว็บด้วยคำค้นของไอเดีย', async () => {
    const brief = { headline: 'ไฮซีซันภูเก็ต', summary: 's', keyPoints: [{ text: 'ยอดจองเพิ่ม', sources: [1] }], angles: [], openQuestions: [], category: 'ท่องเที่ยว', risk: 'LOW', riskReasons: [] };
    ai.state.replies.push(J(brief));
    const r1 = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/scout/ideas/0/research`, {});
    expect(r1.status).toBe(200); expect(r1.json.brief.mode).toBe('urls'); expect(r1.json.idea.briefId).toBe(r1.json.brief.id);
    ai.state.replies.push(J({ queries: ['mold prevention rainy season'] }), J(brief));
    const r2 = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/scout/ideas/1/research`, {});
    expect(r2.status).toBe(200); expect(r2.json.brief.mode).toBe('web');
    expect(web.state.news.tavilyQueries).toContain('กันราในบ้านช่วงฝน');
    expect((await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/scout/ideas/9/research`, {})).status).toBe(404);
  });

  it('หาเรื่อง (ai): ค้นเว็บก่อนแล้วจัดเป็นไอเดีย · แหล่งมาจาก citations จริง · AI ไม่ค้น → ใช้ Tavily แทน', async () => {
    ai.state.replies.push({ text: 'สงกรานต์ภูเก็ตปีนี้คึกคัก (Mock Times)', citations: [{ url: `${web.url}/article/moon`, title: 'Moon' }] });
    ai.state.replies.push(J({ ideas: [{ title: 'สงกรานต์ภูเก็ต', why: 'x', trend: 'y', angle: 'z', format: 'news', kind: 'seasonal', sources: [1, 5], query: 'q' }] }));
    const r = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/scout/ideas`, { mode: 'ai', count: 3, modelOverride: { connectionId: conn, model: 'sonar' } });
    expect(r.status).toBe(200);
    expect(r.json.ideas[0].sources).toEqual([1]); expect(r.json.ideaSources[0].url).toBe(`${web.url}/article/moon`);
    expect(JSON.stringify(ai.state.requests.at(-1)!.messages)).toContain('สงกรานต์ภูเก็ตปีนี้คึกคัก');
    ai.state.replies.push({ text: 'ไม่ได้ค้น' }, { text: 'ยังไม่ค้น' }, J({ ideas: [{ title: 'เตรียมบ้านรับหน้าฝน', kind: 'evergreen', sources: [1] }] }));
    const fb = await a.http('POST', `/workspaces/${wsA}/pages/${pageA}/scout/ideas`, { mode: 'ai', modelOverride: { connectionId: conn, model: 'sonar' } });
    expect(fb.status).toBe(200);
    expect(fb.json.failures[0]).toContain('Tavily');
    expect(fb.json.ideaSources[0].url).toBe(`${web.url}/article/elephant`);
  });

  it('ย้ายเพจไปแบรนด์อื่น: ห้องข่าวอัตโนมัติของแบรนด์เดิมที่ใช้เพจนี้ถูกปิด · แบรนด์ต่าง workspace = 404', async () => {
    const c2 = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'ลูกค้าใหม่' });
    const brand2 = (await a.http('POST', `/workspaces/${wsA}/clients/${c2.json.id}/brands`, { name: 'แบรนด์ที่ถูกต้อง' })).json.id;
    await a.http('PUT', `/workspaces/${wsA}/brands/${brandA}/news/automation`, { enabled: true, pageId: pageA });
    const cB = await b.http('POST', `/workspaces/${wsB}/clients`, { name: 'ของคนอื่น' });
    const brandB = (await b.http('POST', `/workspaces/${wsB}/clients/${cB.json.id}/brands`, { name: 'x' })).json.id;
    expect((await a.http('PATCH', `/workspaces/${wsA}/pages/${pageA}`, { brandId: brandB })).status).toBe(404);
    const r = await a.http('PATCH', `/workspaces/${wsA}/pages/${pageA}`, { brandId: brand2 });
    expect(r.status).toBe(200);
    expect((await prisma.facebookPage.findUniqueOrThrow({ where: { id: pageA } })).brandId).toBe(brand2);
    const auto = await prisma.newsAutomation.findUniqueOrThrow({ where: { brandId: brandA } });
    expect(auto.enabled).toBe(false); expect(auto.lastError).toContain('ย้าย');
  });
});
