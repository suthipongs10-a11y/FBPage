/**
 * Integration — โต๊ะค้นคว้า: ค้นเว็บ (Tavily หลายคำค้น + อ่านบทความ) / AI ค้นเอง (citations) / จากลิงก์ / จากข้อความ
 * → สรุปประเด็นพร้อมเลขแหล่ง → เขียนโพสต์ + ตรวจข้อเท็จจริง → ร่างรออนุมัติผ่านทางนำเข้าเดิม · ทุกอย่างยิง mock
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
const brief = (over: Record<string, unknown> = {}) => ({ headline: 'ลูกช้างกลับฝูง', summary: 'เจ้าหน้าที่ช่วยลูกช้างกลับฝูงสำเร็จ', keyPoints: [{ text: 'ใช้เวลา 3 วันตามรอยฝูง', sources: [1] }, { text: 'ลูกช้างแข็งแรงดี', sources: [1, 9] }], angles: [{ title: 'ความผูกพันแม่ลูก', why: 'คนชอบ' }], openQuestions: [], category: 'สัตว์', risk: 'LOW', riskReasons: [], ...over });
const post = (title: string, over: Record<string, unknown> = {}) => ({ title, caption: `${title} — ทีมเจ้าหน้าที่ใช้เวลาสามวันพาลูกช้างกลับไปหาแม่ได้สำเร็จ คุณเคยเห็นช้างป่าไหม?`, hashtags: ['ช้าง'], sourceIds: [1], card: { kicker: 'สัตว์', headline: title }, photoQuery: 'baby elephant', risk: 'LOW', riskReasons: [], needsCheck: [], ...over });

run('research desk (integration)', () => {
  let app: INestApplication; let prisma: PrismaClient;
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let ai: Awaited<ReturnType<typeof startMockAi>>; let web: Awaited<ReturnType<typeof startMockWeb>>;
  const stamp = Date.now();
  const A = { email: `res-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `res-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>;
  let wsA = ''; let wsB = ''; let brandA = ''; let pageA = ''; let conn = ''; let briefId = '';

  beforeAll(async () => {
    graph = await startMockGraph(); ai = await startMockAi(); web = await startMockWeb();
    Object.assign(process.env, { APP_ENV: 'test', META_GRAPH_BASE_URL: graph.url, WEB_MOCK_BASE_URL: web.url, WEB_ALLOW_PRIVATE_TARGETS: 'true' });
    process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    _resetRateLimits();
    ({ app } = await createApp()); await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    wsA = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'เพจของผมเอง' });
    brandA = (await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'ข่าวรอบโลก', description: 'ข่าวสัตว์และวิทยาศาสตร์' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_RESEARCH');
    const fb = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_RESEARCH' });
    pageA = (await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: fb.json.connection.id, facebookPageId: '111' })).json.id;
    conn = (await a.http('POST', `/workspaces/${wsA}/ai/connections`, { preset: 'custom', label: 'Mock AI', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['m-main', 'sonar'] })).json.id;
    await a.http('PUT', `/workspaces/${wsA}/ai/roles`, { roles: { research: { connectionId: conn, model: 'm-main' }, content: { connectionId: conn, model: 'm-main' }, fast: { connectionId: conn, model: 'm-main' } } });
    await a.http('PUT', `/workspaces/${wsA}/news/search-provider`, { provider: 'tavily', apiKey: 'TAVILY_OK' });
    web.state.news.tavilyResults = [
      { title: 'Baby elephant reunited', url: `${web.url}/article/elephant`, content: 'Rangers reunited a calf with its herd.' },
      { title: 'Secret admin page', url: `${web.url}/admin/secret`, content: 'เกริ่นจากผลค้นที่อ่านหน้าเต็มไม่ได้' },
    ];
  }, 30_000);
  afterAll(async () => {
    for (const k of ['META_GRAPH_BASE_URL', 'WEB_MOCK_BASE_URL', 'WEB_ALLOW_PRIVATE_TARGETS']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); graph.server.close(); ai.server.close(); web.server.close();
  });

  it('capabilities: บอกว่าคีย์/โมเดลไหนค้นเว็บเองได้ และมีคีย์ Tavily ไหม', async () => {
    const r = await a.http('GET', `/workspaces/${wsA}/news/research/capabilities`);
    expect(r.json.webSearch).toEqual([{ connectionId: conn, label: 'Mock AI', model: 'sonar' }]);
    expect(r.json).toMatchObject({ tavily: true, researchRoleSearches: false });
  });

  it('web: แตกคำค้น → ค้นหลายคำ → อ่านบทความ (robots ห้าม = ใช้เกริ่น) → สรุปพร้อมเลขแหล่ง · ไม่เก็บเนื้อความเต็ม', async () => {
    ai.state.replies.push(J({ queries: ['baby elephant rescue', 'ลูกช้างพลัดหลง'] }), J(brief()));
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/research`, { mode: 'web', query: 'ลูกช้างกลับฝูง', maxSources: 4 });
    expect(r.status).toBe(200);
    expect(web.state.news.tavilyQueries).toEqual(expect.arrayContaining(['ลูกช้างกลับฝูง', 'baby elephant rescue', 'ลูกช้างพลัดหลง']));
    expect(r.json.sources).toHaveLength(2);
    expect(r.json.sources[0]).toMatchObject({ n: 1, fetched: true, siteName: 'Mock Times' });
    expect(r.json.sources[1]).toMatchObject({ n: 2, fetched: false, excerpt: 'เกริ่นจากผลค้นที่อ่านหน้าเต็มไม่ได้' });
    expect(r.json.failures.join(' ')).toContain('robots');
    expect(r.json.brief.keyPoints[1].sources).toEqual([1]);   // เลขแหล่งที่ไม่มีจริง (9) ถูกตัดทิ้ง
    // prompt สรุปได้เนื้อความบทความจริง (ในหน่วยความจำ) แต่ DB เก็บแค่ excerpt
    expect(JSON.stringify(ai.state.requests.at(-1)!.messages)).toContain('เขาใหญ่');
    const row = await prisma.researchBrief.findUniqueOrThrow({ where: { id: r.json.id } });
    expect(JSON.stringify(row.sources)).not.toContain('"text"');
    briefId = r.json.id;
  });

  it('write: หลายโพสต์ + ตรวจข้อเท็จจริง → ข้อที่ไม่มีหลักฐานติด [ต้องยืนยัน] → ร่างรออนุมัติพร้อมที่มา', async () => {
    ai.state.replies.push(J({ posts: [post('แม่ช้างรอลูก'), post('3 วันตามรอยฝูง')] }), J({ results: [{ index: 1, unsupported: [{ claim: 'ลูกช้างอายุ 5 เดือน', reason: 'แหล่งบอก 2 เดือน' }] }] }));
    const r = await a.http('POST', `/workspaces/${wsA}/news/research/${briefId}/write`, { count: 2, style: 'listicle', imageFallback: 'none', pageId: pageA });
    expect(r.status).toBe(200);
    expect(r.json.factCheck).toMatchObject({ ran: true, flagged: 1 });
    expect(r.json.import).toMatchObject({ channel: 'research', status: 'DRAFTED', postCount: 2, draftCount: 2 });
    const [p1, p2] = r.json.import.report.posts;
    const c1 = await prisma.contentItem.findUniqueOrThrow({ where: { id: p1.result.contentId } });
    const c2 = await prisma.contentItem.findUniqueOrThrow({ where: { id: p2.result.contentId } });
    expect(c1.status).toBe('READY_FOR_APPROVAL');
    expect(c1.caption).toContain(`ที่มา: Mock Times\n${web.url}/article/elephant`);
    expect(c2.caption).toContain('[ต้องยืนยัน: ลูกช้างอายุ 5 เดือน]');
    expect(p2.checks.map((c: { code: string }) => c.code)).toContain('NEEDS_CHECK');
    // prompt ของคนเขียนบอกสไตล์ที่เลือก
    expect(JSON.stringify(ai.state.requests.at(-2)!.messages)).toContain('สรุปเป็นข้อ');
    const list = await a.http('GET', `/workspaces/${wsA}/brands/${brandA}/news/research`);
    expect(list.json[0]).toMatchObject({ id: briefId, lastImportId: r.json.import.id });
    expect((await b.http('POST', `/workspaces/${wsB}/news/research/${briefId}/write`, {})).status).toBe(404);
  });

  it('ai: ขั้น 1 AI ค้นเว็บ (ข้อความ + citations จริง) → ขั้น 2 สรุปเป็น JSON · ไม่ค้นจริง → สลับไป Tavily · ไม่มี Tavily = 422', async () => {
    ai.state.replies.push({ text: 'ข้อค้นพบ: พบน้ำแข็งใกล้ขั้วใต้ของดวงจันทร์ (Mock Times)', citations: [{ url: `${web.url}/article/moon`, title: 'Moon ice' }, { url: 'https://unreachable.invalid/x', title: 'X' }] });
    ai.state.replies.push(J(brief({ headline: 'น้ำแข็งบนดวงจันทร์', keyPoints: [{ text: 'พบน้ำแข็งใกล้ขั้วใต้', sources: [1, 7] }] })));
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/research`, { mode: 'ai', query: 'น้ำแข็งบนดวงจันทร์', recency: 'any', modelOverride: { connectionId: conn, model: 'sonar' } });
    expect(r.status).toBe(200);
    expect(r.json.mode).toBe('ai');
    expect(r.json.sources[0]).toMatchObject({ n: 1, fetched: true, url: `${web.url}/article/moon` });
    expect(r.json.sources[1]).toMatchObject({ n: 2, fetched: false });
    expect(r.json.brief.keyPoints[0].sources).toEqual([1]);
    const [search, structure] = ai.state.requests.slice(-2);
    expect(search!.extra!.response_format).toBeUndefined();                  // ขั้นค้นไม่บังคับ JSON
    expect(JSON.stringify(structure!.messages)).toContain('ข้อค้นพบจากการค้นเว็บ');
    expect(structure!.extra!.response_format).toEqual({ type: 'json_object' }); // ขั้นจัดรูปใช้ JSON mode ได้ตามปกติ

    // โมเดลไม่ค้นจริงทั้งสองรอบ → ใช้ Tavily แทน (มีคีย์)
    ai.state.replies.push({ text: 'ตอบจากความจำ' }, { text: 'ตอบจากความจำอีกรอบ' }, J({ queries: ['moon ice'] }), J(brief()));
    const fb = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/research`, { mode: 'ai', query: 'น้ำแข็งบนดวงจันทร์', modelOverride: { connectionId: conn, model: 'sonar' } });
    expect(fb.status).toBe(200); expect(fb.json.mode).toBe('web');
    expect(fb.json.failures[0]).toContain('ไม่ได้ค้นเว็บ');
    // ไม่มีคีย์ Tavily → แจ้งชัดเจน
    await a.http('DELETE', `/workspaces/${wsA}/news/search-provider?provider=tavily`);
    ai.state.replies.push({ text: 'x' }, { text: 'y' });
    const bad = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/research`, { mode: 'ai', query: 'อะไรก็ได้', modelOverride: { connectionId: conn, model: 'sonar' } });
    expect(bad.status).toBe(422); expect(bad.json.message).toContain('ไม่ได้ค้นเว็บ');
    await a.http('PUT', `/workspaces/${wsA}/news/search-provider`, { provider: 'tavily', apiKey: 'TAVILY_OK' });
  });

  it('urls + text: อ่านจากลิงก์ (ลิงก์เสียรายงานแยก) · ข้อความที่วาง → โพสต์ของเพจเอง (ไม่ต้องมีที่มา)', async () => {
    ai.state.replies.push(J(brief()));
    const u = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/research`, { mode: 'urls', urls: [`${web.url}/article/elephant`, `${web.url}/article/missing`] });
    expect(u.status).toBe(200); expect(u.json.sources).toHaveLength(1); expect(u.json.failures).toHaveLength(1);
    expect((await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/research`, { mode: 'urls', urls: [`${web.url}/article/missing`] })).status).toBe(422);

    ai.state.replies.push(J(brief({ keyPoints: [{ text: 'ร้านเปิด 9 โมง', sources: [1] }] })));
    const t = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/research`, { mode: 'text', text: 'โน้ตของเจ้าของเพจ: เดือนหน้าจะพาไปเที่ยวสวนสัตว์ เปิด 9 โมงเช้า มีโซนให้อาหารยีราฟ เด็กเข้าฟรี' });
    expect(t.status).toBe(200); expect(t.json.sources[0]).toMatchObject({ n: 1, url: null });
    ai.state.replies.push(J({ posts: [post('พาเที่ยวสวนสัตว์', { sourceIds: [1] })] }));
    const w = await a.http('POST', `/workspaces/${wsA}/news/research/${t.json.id}/write`, { factCheck: false, imageFallback: 'none' });
    expect(w.json.import.status).toBe('DRAFTED');
    const c = await prisma.contentItem.findUniqueOrThrow({ where: { id: w.json.import.report.posts[0].result.contentId } });
    expect(c.caption).not.toContain('ที่มา:');
    expect((await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/research`, { mode: 'web' })).status).toBe(400);
  });
});
