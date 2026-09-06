import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLinks, checkPageSpeed, checkSsl, checkUptime, isPrivateHost, normalizeSiteUrl, seoAudit } from './checks';
import { SearchConsoleClient } from './search-console';
import { startMockWeb } from './mock-web';

describe('web-core checks (mock site)', () => {
  let mock: Awaited<ReturnType<typeof startMockWeb>>;
  beforeAll(async () => { mock = await startMockWeb(); });
  afterAll(() => mock.server.close());

  it('normalizes URLs and blocks private targets unless allowed (SSRF guard)', () => {
    expect(normalizeSiteUrl('example.com/path/?q=1#x')).toBe('https://example.com/path');
    expect(normalizeSiteUrl('HTTP://Example.com/')).toBe('http://example.com');
    expect(() => normalizeSiteUrl('ftp://example.com')).toThrow(/http/);
    expect(() => normalizeSiteUrl('http://127.0.0.1:8080')).toThrow(/ภายใน/);
    expect(() => normalizeSiteUrl('http://192.168.1.5')).toThrow(); expect(() => normalizeSiteUrl('http://169.254.169.254/latest')).toThrow();
    expect(normalizeSiteUrl('http://127.0.0.1:8080', true)).toBe('http://127.0.0.1:8080');
    expect(isPrivateHost('10.0.0.1')).toBe(true); expect(isPrivateHost('172.20.1.1')).toBe(true); expect(isPrivateHost('8.8.8.8')).toBe(false); expect(isPrivateHost('::1')).toBe(true); expect(isPrivateHost('shop.local')).toBe(true);
  });

  it('uptime: UP with latency and expected text; DOWN on 503 or missing text; DEGRADED when slow', async () => {
    const up = await checkUptime(mock.siteUrl, 'ภูเก็ต', { allowPrivate: true });
    expect(up.siteStatus).toBe('UP'); expect(up.httpStatus).toBe(200); expect(up.textFound).toBe(true); expect(up.latencyMs).not.toBeNull(); expect(up.html).toContain('<title>');
    const missing = await checkUptime(mock.siteUrl, 'ไม่มีคำนี้แน่นอน', { allowPrivate: true });
    expect(missing.siteStatus).toBe('DOWN'); expect(missing.error).toMatch(/ไม่พบข้อความ/);
    mock.state.down = true; const down = await checkUptime(mock.siteUrl, null, { allowPrivate: true }); expect(down.siteStatus).toBe('DOWN'); expect(down.httpStatus).toBe(503); mock.state.down = false;
    let now = 0; const slow = await checkUptime(mock.siteUrl, null, { allowPrivate: true, now: () => (now += 4_000) }); expect(slow.siteStatus).toBe('DEGRADED'); expect(slow.status).toBe('WARN');
    const dead = await checkUptime('http://127.0.0.1:1', null, { allowPrivate: true, timeoutMs: 2000 }); expect(dead.siteStatus).toBe('DOWN'); expect(dead.httpStatus).toBeNull();
  });

  it('ssl: http site is SKIPPED (never a fake OK)', async () => {
    const r = await checkSsl(mock.siteUrl); expect(r.status).toBe('SKIPPED'); expect(r.daysLeft).toBeNull();
  });

  it('seo audit finds concrete issues and counts links/images/words', async () => {
    const up = await checkUptime(mock.siteUrl, null, { allowPrivate: true });
    const r = seoAudit(up.html!, mock.siteUrl);
    expect(r.title).toContain('ฟ้าแดง'); expect(r.description).toBeTruthy(); expect(r.h1Count).toBe(1); expect(r.lang).toBe('th'); expect(r.viewport).toBe(true); expect(r.canonical).toContain('http');
    expect(r.imagesTotal).toBe(2); expect(r.imagesMissingAlt).toBe(1); expect(r.internalLinks).toBe(3); expect(r.externalLinks).toBe(1); expect(r.wordCount).toBeGreaterThan(50);
    expect(r.issues.map(i => i.code)).toEqual(expect.arrayContaining(['IMG_ALT', 'OG_INCOMPLETE'])); expect(r.issues.map(i => i.code)).not.toContain('TITLE_MISSING');
    const bad = seoAudit('<html><head><meta name="robots" content="noindex"></head><body><p>hi</p></body></html>', 'https://x.test');
    expect(bad.status).toBe('FAIL'); expect(bad.issues.map(i => i.code)).toEqual(expect.arrayContaining(['TITLE_MISSING', 'NOINDEX', 'H1_MISSING', 'THIN_CONTENT', 'DESCRIPTION_MISSING']));
  });

  it('links: finds broken internal links, respects robots Disallow, stays within limits', async () => {
    const up = await checkUptime(mock.siteUrl, null, { allowPrivate: true });
    const html = up.html! + `<a href="/admin/secret">admin</a>`;
    const r = await checkLinks(mock.siteUrl, html, { allowPrivate: true, delayMs: 0, max: 50 });
    expect(r.checked).toBe(3);   // /services /contact /old-promo — /admin ถูก robots กัน, facebook.com เป็น external
    expect(r.broken.map(b => new URL(b.url).pathname)).toEqual(['/old-promo']); expect(r.status).toBe('WARN');
    expect(mock.state.requests.some(x => x.includes('/admin'))).toBe(false);
  });

  it('pagespeed: SKIPPED without key, scores with key, FAIL when Lighthouse errors', async () => {
    const none = await checkPageSpeed(mock.siteUrl, undefined, { baseUrl: `${mock.url}/pagespeed` }); expect(none.status).toBe('SKIPPED'); expect(none.performance).toBeNull();
    const ok = await checkPageSpeed(mock.siteUrl, 'PSI_OK', { baseUrl: `${mock.url}/pagespeed` }); expect(ok.status).toBe('WARN'); expect(ok.performance).toBe(72); expect(ok.seo).toBe(90); expect(ok.lcpMs).toBe(2900); expect(ok.cls).toBe(0.05); expect(ok.fieldData).toBe(false);
    mock.state.pagespeedFail = true; const fail = await checkPageSpeed(mock.siteUrl, 'PSI_OK', { baseUrl: `${mock.url}/pagespeed` }); expect(fail.status).toBe('FAIL'); expect(fail.performance).toBeNull(); mock.state.pagespeedFail = false;
    const badKey = await checkPageSpeed(mock.siteUrl, 'WRONG', { baseUrl: `${mock.url}/pagespeed` }); expect(badKey.status).toBe('FAIL'); expect(badKey.error).toMatch(/key/i);
  });

  it('search console: lists properties, matches the right one, returns daily rows + top queries/pages; 403 → forbidden', async () => {
    const sc = new SearchConsoleClient({ baseUrl: `${mock.url}/webmasters/v3` });
    const sites = await sc.listSites('ACCESS_OK'); expect(sites).toHaveLength(1);
    const prop = SearchConsoleClient.matchProperty(sites, mock.siteUrl); expect(prop).toBe('sc-domain:127.0.0.1');
    expect(SearchConsoleClient.matchProperty([{ siteUrl: 'https://www.example.com/', permissionLevel: 'siteOwner' }, { siteUrl: 'https://www.example.com/blog/', permissionLevel: 'siteOwner' }], 'https://example.com/blog/post')).toBe('https://www.example.com/blog/');
    const r = await sc.daily('ACCESS_OK', prop!, '2026-01-01', '2026-12-31'); expect(r.days.length).toBe(28); expect(r.topQueries[0]!.keys[0]).toContain('ภูเก็ต'); expect(r.topPages.length).toBe(2);
    await expect(sc.listSites('BAD')).rejects.toMatchObject({ code: 'reconnect' });
    mock.state.scForbidden = true; await expect(sc.listSites('ACCESS_OK')).rejects.toMatchObject({ code: 'forbidden' }); mock.state.scForbidden = false;
  });
});
