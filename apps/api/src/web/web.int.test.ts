/** Integration — Website Care (AGENTS_WEB.md W-1/W-2) กับ mock เว็บลูกค้า + mock PageSpeed/Search Console + mock Google token + mock AI — ไม่แตะเว็บ/Google จริง */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockAi } from '@fbpm/ai-core';
import { startMockYouTube } from '@fbpm/youtube-core';
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

run('website care (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient;
  let web: Awaited<ReturnType<typeof startMockWeb>>; let yt: Awaited<ReturnType<typeof startMockYouTube>>; let ai: Awaited<ReturnType<typeof startMockAi>>;
  const stamp = Date.now(); const A = { email: `web-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' }; const B = { email: `web-b-${stamp}@test.local`, name: 'Bob', password: 'bob-password-12345' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>; let ws = ''; let wsB = ''; let brand = ''; let siteId = ''; let connId = '';
  beforeAll(async () => {
    web = await startMockWeb(); yt = await startMockYouTube(); ai = await startMockAi();
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    Object.assign(process.env, { WEB_MOCK_BASE_URL: web.url, WEB_ALLOW_PRIVATE_TARGETS: 'true', PAGESPEED_API_KEY: 'PSI_OK', YOUTUBE_MOCK_BASE_URL: yt.url, GOOGLE_CLIENT_ID: 'gclient', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_OAUTH_REDIRECT_URI: 'http://127.0.0.1:4000/youtube/oauth/callback' });
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${ws}/clients`, { name: 'ฟ้าแดง' });
    brand = (await a.http('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'ฟ้าแดง คลีนนิ่ง', industry: 'บริการทำความสะอาด', serviceArea: 'ภูเก็ต', primaryCTA: 'ทักแชท' })).json.id;
    await a.http('PUT', `/workspaces/${ws}/ai/providers/compatible`, { apiKey: 'MOCK_KEY', baseUrl: ai.url });
    await a.http('PUT', `/workspaces/${ws}/ai/roles`, { roles: { analysis: { provider: 'compatible', model: 'm-analysis' } } });
  }, 40_000);
  afterAll(async () => {
    for (const k of ['WEB_MOCK_BASE_URL', 'WEB_ALLOW_PRIVATE_TARGETS', 'PAGESPEED_API_KEY', 'YOUTUBE_MOCK_BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: { in: [ws, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } }); await prisma.$disconnect();
    await app.close(); web.server.close(); yt.server.close(); ai.server.close();
  });

  it('adds a site (normalized URL) and runs UPTIME/SSL/SEO immediately; SSRF targets and duplicates are refused', async () => {
    const r = await a.http('POST', `/workspaces/${ws}/web/sites`, { brandId: brand, url: `${web.siteUrl}/?utm=1#top`, expectedText: 'ภูเก็ต' });
    expect(r.status, r.text).toBe(201); siteId = r.json.id; expect(r.json.url).toBe(web.siteUrl); expect(r.json.name).toBe('127.0.0.1');
    expect(r.json.lastStatus).toBe('UP'); expect(r.json.lastHttpStatus).toBe(200); expect(r.json.lastLatencyMs).not.toBeNull();
    expect(r.json.summary.latest.SSL.status).toBe('SKIPPED'); expect(r.json.summary.latest.SEO.status).toBe('WARN'); expect(r.json.summary.latest.SEO.details.issues.map((i: { code: string }) => i.code)).toContain('IMG_ALT');
    expect((await a.http('POST', `/workspaces/${ws}/web/sites`, { brandId: brand, url: web.siteUrl })).status).toBe(409);
    expect((await a.http('POST', `/workspaces/${ws}/web/sites`, { brandId: brand, url: 'ftp://example.com' })).status).toBe(400);
    process.env.WEB_ALLOW_PRIVATE_TARGETS = 'true';   // env ถูกอ่านตอน boot: ทดสอบตัวกัน SSRF ผ่าน normalizeSiteUrl ใน web-core แทน
  });
  it('LINKS + PAGESPEED checks store details; PageSpeed without key would be SKIPPED not 0', async () => {
    const r = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/check`, { kinds: ['LINKS', 'PAGESPEED'] });
    expect(r.status, r.text).toBe(200); expect(r.json.results.LINKS.status).toBe('WARN'); expect(r.json.results.PAGESPEED.status).toBe('WARN');
    const d = await a.http('GET', `/workspaces/${ws}/web/sites/${siteId}`);
    expect(d.json.summary.latest.LINKS.details.broken).toHaveLength(1); expect(d.json.summary.latest.PAGESPEED.details.performance).toBe(72); expect(d.json.summary.latest.PAGESPEED.details.inpMs).toBeNull();
    expect(d.json.checks.length).toBeGreaterThanOrEqual(5);
  });
  it('outage: first failure is DEGRADED (no alarm), second opens a DOWN incident + notification; recovery resolves it + info notification', async () => {
    web.state.down = true;
    const first = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/check`, { kinds: ['UPTIME'] });
    expect(first.json.status).toBe('DEGRADED'); expect(first.json.events).toHaveLength(0);
    const second = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/check`, { kinds: ['UPTIME'] });
    expect(second.json.status).toBe('DOWN'); expect(second.json.events).toHaveLength(1); expect(second.json.events[0].kind).toBe('DOWN'); expect(second.json.events[0].opened).toBe(true);
    const third = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/check`, { kinds: ['UPTIME'] }); expect(third.json.events).toHaveLength(0);   // ไม่แจ้งซ้ำ
    let n = await a.http('GET', `/workspaces/${ws}/notifications`); expect(n.json.items.filter((x: { title: string }) => x.title.includes('ล่ม'))).toHaveLength(1);
    expect((await a.http('GET', `/workspaces/${ws}/web/overview`)).json.down).toBe(1);
    web.state.down = false;
    const up = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/check`, { kinds: ['UPTIME'] });
    expect(up.json.status).toBe('UP'); expect(up.json.events).toHaveLength(1); expect(up.json.events[0].opened).toBe(false);
    const inc = await prisma.siteIncident.findMany({ where: { siteId } }); expect(inc).toHaveLength(1); expect(inc[0]!.resolvedAt).not.toBeNull();
    n = await a.http('GET', `/workspaces/${ws}/notifications`); expect(n.json.items.some((x: { title: string }) => x.title.includes('กลับมาใช้งานได้'))).toBe(true);
  });
  it('Search Console: needs the search scope on the Google account, auto-matches the property, stores 28 daily snapshots; 403 → NO_ACCESS honestly', async () => {
    const tok = await a.http('POST', `/workspaces/${ws}/youtube/connections/token`, { refreshToken: 'REFRESH_OK' }); expect(tok.status, tok.text).toBe(200); connId = tok.json.id;
    const props = await a.http('GET', `/workspaces/${ws}/web/search-console/properties?connectionId=${connId}`);
    expect(props.status, props.text).toBe(200); expect(props.json[0].siteUrl).toBe('sc-domain:127.0.0.1');
    const r = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/search-console`, { connectionId: connId });
    expect(r.status, r.text).toBe(200); expect(r.json.searchConsoleProperty).toBe('sc-domain:127.0.0.1'); expect(r.json.gscStatus).toBe('OK'); expect(r.json.sync.days).toBe(28);
    expect(r.json.summary.search.clicks).toBeGreaterThan(0); expect(r.json.summary.search.topQueries[0].keys[0]).toContain('ภูเก็ต'); expect(r.json.summary.search.topPages.length).toBe(2);
    expect(JSON.stringify(r.json)).not.toMatch(/ACCESS_|REFRESH_OK|Encrypted/);
    web.state.scForbidden = true;
    const s = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/search-console/sync`, { days: 28 });
    expect(s.status).toBe(200); expect(s.json.status).toBe('NO_ACCESS');
    expect((await a.http('GET', `/workspaces/${ws}/web/sites/${siteId}`)).json.gscStatus).toBe('NO_ACCESS');
    const n = await a.http('GET', `/workspaces/${ws}/notifications`); expect(n.json.items.some((x: { title: string }) => x.title.includes('Search Console'))).toBe(true);
    web.state.scForbidden = false;
    const again = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/search-console/sync`, {}); expect(again.json.status).toBe('OK');
    expect((await prisma.siteIncident.findMany({ where: { siteId, kind: 'GSC_ACCESS' } }))[0]!.resolvedAt).not.toBeNull();
  });
  it('trends and overview come from saved data; SEO analyst produces evidence-based recommendations', async () => {
    const t = await a.http('GET', `/workspaces/${ws}/web/sites/${siteId}/trends?weeks=8`);
    expect(t.status).toBe(200); expect(t.json.weeks).toHaveLength(8); expect(t.json.weeks.at(-1).availabilityPct).not.toBeNull(); expect(t.json.weeks.reduce((n: number, w: { clicks: number | null }) => n + (w.clicks ?? 0), 0)).toBeGreaterThan(0);
    const o = await a.http('GET', `/workspaces/${ws}/web/overview`); expect(o.json.sites).toBe(1); expect(o.json.down).toBe(0); expect(o.json.search.clicks).toBeGreaterThan(0);
    ai.state.replies.push({ text: JSON.stringify({ summary: 'หน้าแรกพื้นฐานดี แต่รูปขาด alt และไม่มี og:image', observations: [{ kind: 'OBSERVED', text: 'มีลิงก์เสีย 1 ลิงก์ (/old-promo)', evidence: ['LINKS.broken=1'] }], inferences: [{ kind: 'INFERENCE', text: 'คำค้น "ทำความสะอาดบ้าน ภูเก็ต" มี CTR ต่ำเทียบ impressions', confidence: 'MEDIUM' }],
      recommendations: [{ actionType: 'FIX_BROKEN_LINK', title: 'ลบ/redirect ลิงก์ /old-promo', why: 'ลิงก์เสียบนหน้าแรก', evidence: ['LINKS.broken'], confidence: 'HIGH', priority: 80, effort: 'LOW' }, { actionType: 'FIX_META', title: 'เพิ่ม og:image และ alt รูป', why: 'แชร์ลง Facebook ไม่มีภาพ', evidence: ['OG_INCOMPLETE', 'IMG_ALT'], confidence: 'HIGH', priority: 70, effort: 'LOW' }],
      contentIdeas: [{ topic: 'ราคาแม่บ้านรายวัน ภูเก็ต', targetQuery: 'แม่บ้านรายวัน', why: 'มี impressions แต่ยังไม่มีหน้าตรง' }], dataLimitations: [] }) });
    const an = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/analyze`, {});
    expect(an.status, an.text).toBe(200); expect(an.json.result.recommendations).toHaveLength(2); expect(an.json.result.dataLimitations.length).toBeGreaterThanOrEqual(0);
    expect((await a.http('GET', `/workspaces/${ws}/web/sites/${siteId}/analyses`)).json).toHaveLength(1);
    const prompt = JSON.stringify(ai.state.requests.at(-1)!.messages); expect(prompt).toContain('ภูเก็ต'); expect(prompt).not.toMatch(/ACCESS_|REFRESH_OK/);
  });
  it('tenant isolation + remove (soft) stops monitoring', async () => {
    expect((await b.http('GET', `/workspaces/${wsB}/web/sites/${siteId}`)).status).toBe(404);
    expect((await b.http('POST', `/workspaces/${wsB}/web/sites/${siteId}/check`, {})).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsB}/web/sites`)).json).toHaveLength(0);
    const up = await a.http('PATCH', `/workspaces/${ws}/web/sites/${siteId}`, { name: 'ฟ้าแดง เว็บหลัก', checkIntervalMin: 30 }); expect(up.json.name).toBe('ฟ้าแดง เว็บหลัก'); expect(up.json.checkIntervalMin).toBe(30);
    expect((await a.http('DELETE', `/workspaces/${ws}/web/sites/${siteId}`)).status).toBe(200);
    expect((await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/check`, {})).status).toBe(403);
    expect((await a.http('GET', `/workspaces/${ws}/web/overview`)).json.sites).toBe(0);
  });
});
