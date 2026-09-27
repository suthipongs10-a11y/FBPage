/**
 * Integration — ห้องข่าว: คีย์ค้นเว็บเข้ารหัส, แหล่งข่าว RSS/คำค้น, ดึง+กันซ้ำ, AI คัด (research), AI เขียน+การ์ด → รออนุมัติ, อนุมัติ+ตั้งเวลาคลิกเดียว
 * ทุกอย่างยิง mock (เว็บ/Tavily/AI/Graph) — ไม่แตะข่าวจริง AI จริง หรือเพจจริง
 */
import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { startMockAi } from '@fbpm/ai-core';
import { startMockWeb } from '@fbpm/web-core';
import { QUEUES } from '@fbpm/shared';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';
import { findChrome } from '../media/chromium';
import { NewsAutomationService } from './automation.service';

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
const pad = (n: number) => String(n).padStart(2, '0');
/** เวลา local กรุงเทพฯ ล่วงหน้า N นาที ในรูป YYYY-MM-DDTHH:MM */
const bkkLocal = (minutes: number) => { const d = new Date(Date.now() + minutes * 60_000 + 7 * 3_600_000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

run('news room (integration)', () => {
  let app: INestApplication; let prisma: PrismaClient; let publishQueue: Queue;
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let ai: Awaited<ReturnType<typeof startMockAi>>; let web: Awaited<ReturnType<typeof startMockWeb>>;
  const stamp = Date.now();
  const A = { email: `news-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `news-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>;
  let wsA = ''; let wsB = ''; let brandA = ''; let brandOther = ''; let pageA = ''; let aiConn = '';

  beforeAll(async () => {
    graph = await startMockGraph(); ai = await startMockAi(); web = await startMockWeb();
    Object.assign(process.env, { APP_ENV: 'test', META_GRAPH_BASE_URL: graph.url, WEB_MOCK_BASE_URL: web.url, WEB_ALLOW_PRIVATE_TARGETS: 'true' });
    process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    _resetRateLimits();
    ({ app } = await createApp()); await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    const u = new URL(process.env.REDIS_URL!); publishQueue = new Queue(QUEUES.facebookPublish, { connection: { host: u.hostname, port: Number(u.port) || 6379, db: Number(u.pathname.slice(1)) || 0 } });
    wsA = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'เพจของผมเอง' });
    brandA = (await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'ข่าวรอบโลก', description: 'ข่าวแปลก น่าสนใจจากทั่วโลก', targetAudience: 'คนไทยวัยทำงาน' })).json.id;
    brandOther = (await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'อีกแบรนด์' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_NEWS_TEST');
    const conn = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_NEWS_TEST' });
    pageA = (await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
    aiConn = (await a.http('POST', `/workspaces/${wsA}/ai/connections`, { preset: 'custom', label: 'Mock AI', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['m-research', 'm-content', 'm-fast'] })).json.id;
    await a.http('PUT', `/workspaces/${wsA}/ai/roles`, { roles: { research: { connectionId: aiConn, model: 'm-research' }, content: { connectionId: aiConn, model: 'm-content' }, fast: { connectionId: aiConn, model: 'm-fast' } } });
  }, 30_000);
  afterAll(async () => {
    for (const k of ['META_GRAPH_BASE_URL', 'WEB_MOCK_BASE_URL', 'WEB_ALLOW_PRIVATE_TARGETS']) delete process.env[k];
    await publishQueue.obliterate({ force: true }).catch(() => undefined); await publishQueue.close();
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); graph.server.close(); ai.server.close(); web.server.close();
  });

  it('search key: stored encrypted, verified, never returned; wrong key is flagged', async () => {
    const bad = await a.http('PUT', `/workspaces/${wsA}/news/search-provider`, { apiKey: 'tvly-WRONG-KEY' });
    expect(bad.status).toBe(200); expect(bad.json.status).toBe('AUTH_FAILED');
    const ok = await a.http('PUT', `/workspaces/${wsA}/news/search-provider`, { apiKey: 'TAVILY_OK' });
    expect(ok.json).toMatchObject({ configured: true, status: 'OK', keyHint: '…Y_OK' });
    expect(ok.text).not.toContain('TAVILY_OK'); expect(ok.text).not.toContain('apiKeyEnc');
    const row = await prisma.searchProviderAccount.findFirstOrThrow({ where: { workspaceId: wsA, provider: 'tavily' } });
    expect(row.apiKeyEnc).not.toContain('TAVILY_OK');
    expect((await b.http('GET', `/workspaces/${wsA}/news/search-provider`)).status).toBe(404);   // คนนอก workspace ไม่เห็นแม้แต่ว่ามีอยู่
  });

  it('sources: RSS + search per brand; tenant isolation; bad URLs rejected', async () => {
    const rss = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/sources`, { kind: 'RSS', label: 'ข่าวจำลอง', url: `${web.url}/news/rss.xml` });
    expect(rss.status).toBe(201);
    const q = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/sources`, { kind: 'SEARCH', label: 'ข่าวแปลก', query: 'ข่าวแปลกทั่วโลก' });
    expect(q.status).toBe(201);
    expect((await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/sources`, { kind: 'RSS', label: 'x', url: 'ftp://x.example/feed' })).status).toBe(400);
    expect((await b.http('POST', `/workspaces/${wsB}/brands/${brandA}/news/sources`, { kind: 'RSS', label: 'x', url: 'https://x.example/feed' })).status).toBe(404);
    const list = await a.http('GET', `/workspaces/${wsA}/brands/${brandA}/news/sources`);
    expect(list.json.map((s: { kind: string }) => s.kind)).toEqual(['RSS', 'SEARCH']);
  });

  it('fetch: stores new items, dedupes the same story across sources, and a second fetch adds nothing', async () => {
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/fetch`);
    expect(r.status).toBe(200);
    // RSS: 2 ข่าว · Tavily: 2 ข่าว แต่ข่าวลูกช้างซ้ำกับ RSS (URL ต่างแค่ www/พารามิเตอร์ติดตาม) → เก็บ 3
    expect(r.json.added).toBe(3);
    expect(r.json.sources.every((s: { error: string | null }) => s.error === null)).toBe(true);
    expect(web.state.news.tavilyQueries).toContain('ข่าวแปลกทั่วโลก');
    expect((await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/fetch`)).json.added).toBe(0);
    const items = await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}`);
    expect(items.json).toHaveLength(3);
    expect(items.json.every((i: { status: string }) => i.status === 'NEW')).toBe(true);
  });

  it('a broken source is reported without stopping the others', async () => {
    const bad = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/sources`, { kind: 'RSS', label: 'ไม่ใช่ฟีด', url: `${web.url}/news/not-a-feed` });
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/fetch`);
    const row = r.json.sources.find((s: { sourceId: string }) => s.sourceId === bad.json.id);
    expect(row.error).toMatch(/ไม่ใช่ RSS/);
    expect(r.json.sources.filter((s: { error: string | null }) => !s.error)).toHaveLength(2);
    await a.http('DELETE', `/workspaces/${wsA}/news/sources/${bad.json.id}`);
  });

  it('AI shortlist (research role) keeps only ids it was given and records risk', async () => {
    const items = (await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}`)).json as { id: string; title: string }[];
    const elephant = items.find(i => i.title.includes('ลูกช้าง'))!; const sea = items.find(i => i.title.includes('deep-sea'))!;
    ai.state.replies.push({ text: JSON.stringify({ picks: [
      { id: elephant.id, score: 88, headlineTh: 'กู้ภัยช่วยลูกช้างตกบ่อสำเร็จ', why: 'สัตว์น่ารัก มีอารมณ์ร่วม', category: 'สัตว์', risk: 'LOW', riskReasons: [] },
      { id: sea.id, score: 70, headlineTh: 'พบสัตว์ทะเลลึกชนิดใหม่ 12 ชนิด', why: 'น่าทึ่ง', category: 'วิทยาศาสตร์', risk: 'LOW', riskReasons: [] },
      { id: 'not-a-real-id', score: 99, headlineTh: 'แต่งขึ้น', why: 'x', category: 'x', risk: 'LOW', riskReasons: [] },
    ] }) });
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/shortlist`, { max: 5 });
    expect(r.status).toBe(200); expect(r.json.picked).toBe(2);
    expect(ai.state.requests.at(-1)!.model).toBe('m-research');
    const sl = await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}&status=SHORTLISTED`);
    expect(sl.json.map((i: { score: number }) => i.score)).toEqual([88, 70]);
    expect(sl.json[0].angle).toMatchObject({ category: 'สัตว์', risk: 'LOW' });
  });

  it('AI writes a post with source credit + news card, submits it for approval, and blocks unconfirmed facts on approve', async () => {
    const sl = (await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}&status=SHORTLISTED`)).json as { id: string; url: string }[];
    const first = sl[0]!;
    // เพจต้องอยู่แบรนด์เดียวกับข่าว
    const otherPage = await prisma.facebookPage.update({ where: { id: pageA }, data: { brandId: brandOther } });
    expect((await a.http('POST', `/workspaces/${wsA}/news/items/${first.id}/draft`, { pageId: otherPage.id })).status).toBe(400);
    await prisma.facebookPage.update({ where: { id: pageA }, data: { brandId: brandA } });

    ai.state.replies.push({ text: JSON.stringify({ title: 'ลูกช้างตกบ่อ', caption: '🐘 ใจหายใจคว่ำ! เจ้าหน้าที่กู้ภัยใช้เวลา 3 ชั่วโมงช่วยลูกช้างที่พลัดตกบ่อน้ำจนปลอดภัย เกิดขึ้นที่ [ต้องยืนยัน: จังหวัด]\n\nใครเคยเห็นช้างป่าใกล้บ้านบ้างไหม?', hashtags: ['#ข่าวดี', 'ช้าง'], card: { kicker: 'สัตว์', headline: 'กู้ภัยช่วย*ลูกช้าง*ตกบ่อสำเร็จ', sub: 'ใช้เวลา 3 ชั่วโมงเต็ม' }, risk: 'LOW', riskReasons: [], needsCheck: [] }) });
    const r = await a.http('POST', `/workspaces/${wsA}/news/items/${first.id}/draft`, { pageId: pageA, theme: 'dark' });
    expect(r.status).toBe(200);
    expect(ai.state.requests.at(-1)!.model).toBe('m-content');
    expect(r.json.content.status).toBe('READY_FOR_APPROVAL');
    expect(r.json.content.caption).toContain(`ที่มา: `); expect(r.json.content.caption).toContain(first.url);
    expect(r.json.content.hashtags).toEqual(['ข่าวดี', 'ช้าง']);
    expect(r.json.needsCheck.some((x: string) => x.includes('จังหวัด'))).toBe(true);
    if (findChrome(process.env.CHROME_BIN)) { expect(r.json.cardError).toBeNull(); expect(r.json.content.mediaPaths).toHaveLength(1); }
    else expect(r.json.cardError).toMatch(/Chromium/);
    const item = await prisma.newsItem.findUniqueOrThrow({ where: { id: first.id } });
    expect(item).toMatchObject({ status: 'DRAFTED', contentId: r.json.content.id });
    expect((await a.http('POST', `/workspaces/${wsA}/news/items/${first.id}/draft`, { pageId: pageA })).status).toBe(422);

    // ยังมี [ต้องยืนยัน] → อนุมัติ+ตั้งเวลาไม่ได้ และสถานะไม่ถูกเปลี่ยนครึ่งทาง
    const blocked = await a.http('POST', `/workspaces/${wsA}/content/${r.json.content.id}/approve-schedule`, { scheduledLocal: bkkLocal(90) });
    expect(blocked.status).toBe(422);
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: r.json.content.id } })).status).toBe('READY_FOR_APPROVAL');
  });

  it('approve + schedule in one click (time validated before approving)', async () => {
    const sl = (await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}&status=SHORTLISTED`)).json as { id: string }[];
    ai.state.replies.push({ text: JSON.stringify({ title: 'สัตว์ทะเลลึก', caption: '🌊 นักวิทยาศาสตร์พบสิ่งมีชีวิตชนิดใหม่ถึง 12 ชนิด ใกล้ปล่องน้ำร้อนใต้ทะเลลึก การค้นพบนี้ช่วยให้เข้าใจชีวิตในที่มืดสนิทมากขึ้น\n\nคิดว่าใต้ทะเลยังมีอะไรที่เรายังไม่รู้อีก?', hashtags: [], card: { headline: 'พบสัตว์ทะเลลึกชนิดใหม่ *12* ชนิด' }, risk: 'LOW', riskReasons: [], needsCheck: [] }) });
    const d = await a.http('POST', `/workspaces/${wsA}/news/items/${sl[0]!.id}/draft`, { pageId: pageA });
    const id = d.json.content.id as string;
    expect((await a.http('POST', `/workspaces/${wsA}/content/${id}/approve-schedule`, { scheduledLocal: bkkLocal(2) })).status).toBe(400);
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id } })).status).toBe('READY_FOR_APPROVAL');
    const ok = await a.http('POST', `/workspaces/${wsA}/content/${id}/approve-schedule`, { scheduledLocal: bkkLocal(90), timezone: 'Asia/Bangkok' });
    expect(ok.status).toBe(200); expect(ok.json.status).toBe('SCHEDULED');
    const list = await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}&status=DRAFTED`);
    expect(list.json.find((i: { contentId: string }) => i.contentId === id).content.status).toBe('SCHEDULED');
  });

  it('dismiss / restore an item; drafted items cannot be dismissed', async () => {
    const items = (await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}`)).json as { id: string; status: string }[];
    const fresh = items.find(i => i.status === 'NEW')!; const drafted = items.find(i => i.status === 'DRAFTED')!;
    expect((await a.http('PATCH', `/workspaces/${wsA}/news/items/${fresh.id}`, { status: 'DISMISSED' })).json.status).toBe('DISMISSED');
    expect((await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}`)).json.some((i: { id: string }) => i.id === fresh.id)).toBe(false);
    expect((await a.http('PATCH', `/workspaces/${wsA}/news/items/${drafted.id}`, { status: 'DISMISSED' })).status).toBe(422);
  });

  // ---------- N-3 ภาพจาก AI ----------
  it('AI image config: only image-capable keys, safety suffix, idempotency, per-run override, failures recorded, monthly limit', async () => {
    const claude = (await a.http('POST', `/workspaces/${wsA}/ai/connections`, { preset: 'anthropic', label: 'Claude', apiKey: 'sk-ant-test-key-123', models: ['claude-sonnet-5'] })).json.id;
    expect((await a.http('PUT', `/workspaces/${wsA}/media/ai-config`, { connectionId: claude, model: 'claude-sonnet-5' })).status).toBe(422);
    const gem = (await a.http('POST', `/workspaces/${wsA}/ai/connections`, { preset: 'gemini', label: 'Gemini ภาพ', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['gemini-2.5-flash-image'] })).json.id;
    const cfg = await a.http('PUT', `/workspaces/${wsA}/media/ai-config`, { connectionId: gem, model: 'gemini-2.5-flash-image', unitCostUsd: 0.04 });
    expect(cfg.status).toBe(200); expect(cfg.json.image).toMatchObject({ connectionId: gem, model: 'gemini-2.5-flash-image', unitCostUsd: 0.04 });

    const one = await a.http('POST', `/workspaces/${wsA}/media/ai-image`, { prompt: 'ลูกช้างในป่าฝน', attach: false });
    expect(one.status).toBe(200); expect(one.json.asset).toMatchObject({ aiGenerated: true, mimeType: 'image/png', kind: 'ai' });
    expect(ai.state.imageRequests.at(-1)).toMatchObject({ style: 'gemini', model: 'gemini-2.5-flash-image' });
    expect(ai.state.imageRequests.at(-1)!.prompt).toMatch(/no identifiable real people/);
    expect((await fetch(`${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/workspaces/${wsA}/media/${one.json.asset.id}/file`, { headers: { cookie: a.cookie } })).headers.get('content-type')).toBe('image/png');

    const n = ai.state.imageRequests.length;
    const k1 = await a.http('POST', `/workspaces/${wsA}/media/ai-image`, { prompt: 'x ภาพ', attach: false, idempotencyKey: 'same-key-123' });
    const k2 = await a.http('POST', `/workspaces/${wsA}/media/ai-image`, { prompt: 'x ภาพ', attach: false, idempotencyKey: 'same-key-123' });
    expect(k2.json).toMatchObject({ reused: true }); expect(k2.json.asset.id).toBe(k1.json.asset.id); expect(ai.state.imageRequests.length).toBe(n + 1);

    const ov = await a.http('POST', `/workspaces/${wsA}/media/ai-image`, { prompt: 'ภาพจากอีกเจ้า', attach: false, modelOverride: { connectionId: aiConn, model: 'gpt-image-1' } });
    expect(ov.status).toBe(200); expect(ai.state.imageRequests.at(-1)).toMatchObject({ style: 'openai', model: 'gpt-image-1' });

    ai.state.imageFailNext = 1;
    const fail = await a.http('POST', `/workspaces/${wsA}/media/ai-image`, { prompt: 'จะล้ม', attach: false });
    expect(fail.status).toBe(502); expect(fail.json.message).toMatch(/IMAGE_SAFETY/);
    expect(await prisma.mediaJob.count({ where: { workspaceId: wsA, status: 'FAILED' } })).toBe(1);

    await a.http('PUT', `/workspaces/${wsA}/media/ai-config`, { monthlyImageLimit: 3 });   // ใช้ไป 3 (งานที่ล้มไม่นับ)
    const over = await a.http('POST', `/workspaces/${wsA}/media/ai-image`, { prompt: 'เกินเพดาน', attach: false });
    expect(over.status).toBe(402); expect(over.json.message).toMatch(/เพดาน/);
    const view = await a.http('GET', `/workspaces/${wsA}/media/ai-config`);
    expect(view.json).toMatchObject({ usedThisMonth: 3, monthlyImageLimit: 3 });
    expect(view.text).not.toContain('MOCK_KEY');
    await a.http('PUT', `/workspaces/${wsA}/media/ai-config`, { monthlyImageLimit: null });
  });

  it('news draft with aiImage embeds an AI picture in the headline card', async () => {
    web.state.news.rssItems.push({ title: 'นักบินอวกาศปลูกผักกาดบนสถานีอวกาศสำเร็จ', link: 'https://news.example.com/a/space-lettuce', description: 'ผักกาดโตในสภาวะไร้น้ำหนัก', pubDate: new Date().toUTCString() });
    await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/fetch`);
    const item = ((await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}&status=NEW`)).json as { id: string; title: string }[]).find(i => i.title.includes('ผักกาด'))!;
    ai.state.replies.push({ text: JSON.stringify({ title: 'ผักบนอวกาศ', caption: '🥬 ผักกาดต้นแรกที่โตได้ในสภาวะไร้น้ำหนัก ก้าวเล็ก ๆ ของการปลูกอาหารนอกโลก\n\nถ้าได้ไปอวกาศ อยากกินผักอะไร?', hashtags: [], card: { kicker: 'อวกาศ', headline: 'ปลูก*ผักกาด*บนอวกาศสำเร็จ' }, risk: 'LOW', riskReasons: [], needsCheck: [], imagePrompt: 'A lettuce sprout floating inside a space station window, soft light' }) });
    const r = await a.http('POST', `/workspaces/${wsA}/news/items/${item.id}/draft`, { pageId: pageA, aiImage: true, theme: 'ocean' });
    expect(r.status).toBe(200); expect(r.json.imageError).toBeNull();
    expect(ai.state.imageRequests.at(-1)!.prompt).toContain('lettuce sprout');
    const assets = (await a.http('GET', `/workspaces/${wsA}/media?contentId=${r.json.content.id}`)).json as { kind: string; aiGenerated: boolean }[];
    expect(assets.some(x => x.kind === 'ai')).toBe(true);
    if (findChrome(process.env.CHROME_BIN)) { expect(r.json.aiImage).toBe(true); expect(r.json.content.mediaPaths).toHaveLength(1); expect(assets.some(x => x.kind === 'card')).toBe(true); }
    const stored = await prisma.mediaAsset.findMany({ where: { contentId: r.json.content.id, kind: 'card' }, select: { meta: true } });
    for (const x of stored) expect(JSON.stringify(x.meta)).not.toContain('base64');   // ไม่เก็บภาพฝังซ้ำใน DB
  });

  it('news draft with a real stock photo: card uses the photo, full photo attached as 2nd image, photographer credited', async () => {
    const key = await a.http('PUT', `/workspaces/${wsA}/news/search-provider`, { provider: 'pexels', apiKey: 'PEXELS_OK' });
    expect(key.json).toMatchObject({ configured: true, status: 'OK', provider: 'pexels' });
    expect((await a.http('GET', `/workspaces/${wsA}/news/search-provider?provider=tavily`)).json.status).toBe('OK');   // คีย์ Tavily ยังอยู่
    web.state.news.rssItems.push({ title: 'ลูกช้างป่าเดินหลงเข้าหมู่บ้าน ชาวบ้านช่วยพากลับฝูง', link: 'https://news.example.com/a/elephant-village', description: 'ชาวบ้านร่วมกันนำทาง', pubDate: new Date().toUTCString() });
    await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/fetch`);
    const item = ((await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}&status=NEW`)).json as { id: string; title: string }[]).find(i => i.title.includes('หมู่บ้าน'))!;
    ai.state.replies.push({ text: JSON.stringify({ title: 'ลูกช้างหลงฝูง', caption: '🐘 ลูกช้างป่าเดินหลงเข้าหมู่บ้าน ชาวบ้านช่วยกันพากลับไปหาแม่อย่างปลอดภัย\n\nเคยเจอช้างป่าใกล้บ้านไหม?', hashtags: [], card: { kicker: 'สัตว์', headline: 'ชาวบ้านช่วย*ลูกช้าง*กลับฝูง' }, risk: 'LOW', riskReasons: [], needsCheck: [], photoQuery: 'baby elephant forest' }) });
    const r = await a.http('POST', `/workspaces/${wsA}/news/items/${item.id}/draft`, { pageId: pageA, imageSource: 'stock' });
    expect(r.status).toBe(200); expect(r.json.imageError).toBeNull(); expect(r.json.hasPhoto).toBe(true);
    expect(web.state.news.pexelsQueries.at(-1)).toBe('baby elephant forest');
    expect(r.json.content.caption).toContain('ภาพประกอบ: Somsri Camera / Pexels');
    const assets = (await a.http('GET', `/workspaces/${wsA}/media?contentId=${r.json.content.id}`)).json as { kind: string }[];
    expect(assets.some(x => x.kind === 'stock')).toBe(true);
    if (findChrome(process.env.CHROME_BIN)) expect(r.json.content.mediaPaths).toHaveLength(2);
  });

  // ---------- N-4 อัตโนมัติ ----------
  it('automation: fetch → shortlist → draft within the daily quota, skipping high-risk stories; never publishes', async () => {
    const bad = await a.http('PUT', `/workspaces/${wsA}/brands/${brandOther}/news/automation`, { enabled: true, pageId: pageA });
    expect(bad.status).toBe(400);
    const set = await a.http('PUT', `/workspaces/${wsA}/brands/${brandA}/news/automation`, { enabled: true, pageId: pageA, draftsPerDay: 5, minScore: 50, skipHighRisk: true, postingSlots: ['19:00', '09:00', '09:00'] });
    expect(set.status).toBe(200); expect(set.json.postingSlots).toEqual(['09:00', '19:00']);
    web.state.news.rssItems.push(
      { title: 'ตำรวจรวบผู้ต้องหาคดีฉ้อโกงออนไลน์', link: 'https://news.example.com/a/fraud', description: 'จับกุมแล้ว', pubDate: new Date().toUTCString() },
      { title: 'เต่าทะเลวางไข่ชายหาดภูเก็ตครั้งแรกในรอบ 5 ปี', link: 'https://news.example.com/a/turtle', description: 'พบรังไข่ 80 ฟอง', pubDate: new Date().toUTCString() },
    );
    const auto = app.get(NewsAutomationService);
    // ต้นรอบ: ดึงได้ 2 ข่าวใหม่ → AI คัด (ตอบ 2 ข่าว: เสี่ยง 90, ไม่เสี่ยง 80) → เขียนเฉพาะข่าวไม่เสี่ยง
    const snapshot = async () => (await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}&status=NEW`)).json as { id: string; title: string }[];
    const beforeReplies = ai.state.replies.length;
    const origFetch = auto.runOne.bind(auto);
    // ใส่คำตอบ AI หลังรู้ id (ดึงข่าวก่อน แล้วค่อยรันส่วนที่เหลือ)
    await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/fetch`);
    const fresh = await snapshot();
    const fraud = fresh.find(i => i.title.includes('ฉ้อโกง'))!; const turtle = fresh.find(i => i.title.includes('เต่า'))!;
    ai.state.replies.push({ text: JSON.stringify({ picks: [
      { id: fraud.id, score: 90, headlineTh: 'รวบแก๊งฉ้อโกง', why: 'ใกล้ตัว', category: 'อาชญากรรม', risk: 'HIGH', riskReasons: ['อาชญากรรม'] },
      { id: turtle.id, score: 80, headlineTh: 'เต่าทะเลกลับมาวางไข่', why: 'ข่าวดี', category: 'สัตว์', risk: 'LOW', riskReasons: [] },
    ] }) });
    ai.state.replies.push({ text: JSON.stringify({ title: 'เต่าทะเลวางไข่', caption: '🐢 ข่าวดีจากภูเก็ต! เต่าทะเลกลับมาวางไข่ที่ชายหาดอีกครั้งในรอบ 5 ปี พบรังไข่ราว 80 ฟอง\n\nใครเคยเห็นเต่าทะเลตัวจริงบ้าง?', hashtags: [], card: { headline: 'เต่าทะเลกลับมา*วางไข่*' }, risk: 'LOW', riskReasons: [], needsCheck: [] }) });
    const r1 = await origFetch(wsA, brandA);
    expect(ai.state.replies.length).toBe(beforeReplies);   // ใช้คำตอบ AI ครบพอดี
    expect(r1).toMatchObject({ shortlisted: 2, drafted: 1, draftedToday: 4 });
    expect((await prisma.newsItem.findUniqueOrThrow({ where: { id: fraud.id } })).status).toBe('SHORTLISTED');
    const turtleItem = await prisma.newsItem.findUniqueOrThrow({ where: { id: turtle.id } });
    expect(turtleItem.status).toBe('DRAFTED');
    const c = await prisma.contentItem.findUniqueOrThrow({ where: { id: turtleItem.contentId! } });
    expect(c.status).toBe('READY_FOR_APPROVAL');   // ไม่โพสต์ ไม่ตั้งเวลาเอง
    const stateNow = (await a.http('GET', `/workspaces/${wsA}/brands/${brandA}/news/automation`)).json;
    expect(stateNow.lastResult).toMatchObject({ drafted: 1 }); expect(stateNow.lastRunAt).toBeTruthy();
  });

  it('tick respects the kill switch and the fetch interval', async () => {
    const auto = app.get(NewsAutomationService);
    await prisma.workspace.update({ where: { id: wsA }, data: { automationPaused: true } });
    await prisma.newsAutomation.update({ where: { brandId: brandA }, data: { lastFetchAt: null } });
    expect((await auto.tick()).runs.find(x => x.brandId === brandA)).toBeUndefined();
    await prisma.workspace.update({ where: { id: wsA }, data: { automationPaused: false } });
    await prisma.newsAutomation.update({ where: { brandId: brandA }, data: { lastFetchAt: new Date() } });
    expect((await auto.tick()).runs.find(x => x.brandId === brandA)).toBeUndefined();   // ยังไม่ถึงรอบ 3 ชม.
  });

  it('next free posting slot follows the brand slots in the page time zone', async () => {
    const r = await a.http('GET', `/workspaces/${wsA}/news/next-slot?pageId=${pageA}`);
    expect(r.status).toBe(200); expect(r.json.slots).toEqual(['09:00', '19:00']);
    expect(r.json.scheduledLocal).toMatch(/T(09|19):00$/);
    // จองช่องนั้นไว้แล้ว → ช่องถัดไปต้องเลื่อน
    const taken = r.json.scheduledLocal as string;
    await prisma.contentItem.create({ data: { pageId: pageA, status: 'SCHEDULED', caption: 'จองช่อง', scheduledLocal: taken, scheduledTz: 'Asia/Bangkok', scheduledAt: new Date(Date.now() + 86_400_000) } });
    const next = await a.http('GET', `/workspaces/${wsA}/news/next-slot?pageId=${pageA}`);
    expect(next.json.scheduledLocal).not.toBe(taken);
  });
});
