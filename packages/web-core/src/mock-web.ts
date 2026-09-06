/**
 * Mock สำหรับ test เท่านั้น — เว็บลูกค้าจำลอง + PageSpeed API + Search Console API ในเซิร์ฟเวอร์เดียว
 * ห้ามใช้ใน production; ห้ามยิงเว็บจริง/Google จริงใน test
 */
import { createServer, type Server } from 'node:http';

export interface MockWebState {
  /** สถานะหน้าแรกของเว็บจำลอง */
  down: boolean; slowMs: number; status: number; html: string; brokenPaths: Set<string>;
  pagespeed: { performance: number; seo: number; accessibility: number; bestPractices: number; lcp: number; cls: number } | null; pagespeedFail: boolean;
  scSites: { siteUrl: string; permissionLevel: string }[]; scForbidden: boolean; scRows: Record<string, { clicks: number; impressions: number; ctr: number; position: number }>; scQueries: { query: string; clicks: number; impressions: number }[]; scPages: { page: string; clicks: number; impressions: number }[];
  accessTokens: Set<string>; requests: string[];
  /** WordPress REST จำลอง (W-3) — Basic auth username `wpadmin` + Application Password `abcd EFGH ijkl MNOP` */
  wp: { posts: MockWpPost[]; tags: { id: number; name: string }[]; categories: { id: number; name: string }[]; disabled: boolean; authFail: boolean; failNext: number; roles: string[] };
}
export interface MockWpPost { id: number; title: string; content: string; excerpt: string; slug: string; status: string; date: string; tags: number[]; categories: number[] }
export const MOCK_WP_USER = 'wpadmin'; export const MOCK_WP_APP_PASSWORD = 'abcd EFGH ijkl MNOP';

export async function startMockWeb(port = 0): Promise<{ server: Server; url: string; siteUrl: string; state: MockWebState }> {
  const state: MockWebState = {
    down: false, slowMs: 0, status: 200, brokenPaths: new Set(['/old-promo']),
    html: `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ฟ้าแดง คลีนนิ่ง — บริการทำความสะอาดบ้าน ภูเก็ต</title><meta name="description" content="บริการทำความสะอาดบ้านและคอนโด ภูเก็ต ทีมงานมืออาชีพ นัดหมายง่าย ราคาชัดเจน"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="SELF/"><meta property="og:title" content="ฟ้าแดง คลีนนิ่ง"></head><body><h1>ทำความสะอาดบ้าน ภูเก็ต</h1><p>${'บริการทำความสะอาดบ้าน คอนโด ออฟฟิศ โดยทีมงานที่ผ่านการอบรม ใช้น้ำยาปลอดภัยต่อเด็กและสัตว์เลี้ยง '.repeat(12)}</p><img src="/a.jpg" alt="ทีมงาน"><img src="/b.jpg"><a href="/services">บริการ</a><a href="/contact">ติดต่อ</a><a href="/old-promo">โปรเก่า</a><a href="https://facebook.com/fadaeng">Facebook</a></body></html>`,
    pagespeed: { performance: 0.72, seo: 0.9, accessibility: 0.85, bestPractices: 0.95, lcp: 2900, cls: 0.05 }, pagespeedFail: false,
    scSites: [{ siteUrl: 'sc-domain:MOCKHOST', permissionLevel: 'siteOwner' }], scForbidden: false,
    scRows: {}, scQueries: [{ query: 'ทำความสะอาดบ้าน ภูเก็ต', clicks: 42, impressions: 900 }, { query: 'แม่บ้านรายวัน', clicks: 18, impressions: 620 }], scPages: [{ page: 'SELF/services', clicks: 30, impressions: 700 }, { page: 'SELF/', clicks: 25, impressions: 800 }],
    accessTokens: new Set(['ACCESS_OK']), requests: [],
    wp: { posts: [], tags: [{ id: 11, name: 'ภูเก็ต' }], categories: [{ id: 1, name: 'Uncategorized' }], disabled: false, authFail: false, failNext: 0, roles: ['editor'] },
  };
  let nextId = 100;
  for (let i = 1; i <= 28; i++) { const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10); state.scRows[d] = { clicks: 5 + (i % 7), impressions: 120 + (i % 5) * 20, ctr: 0.05, position: 8.2 }; }
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'); state.requests.push(`${req.method} ${u.pathname}`);
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); const bodyText = Buffer.concat(chunks).toString('utf8');
    // ---- PageSpeed ----
    if (u.pathname === '/pagespeed/runPagespeed') {
      if (u.searchParams.get('key') !== 'PSI_OK') return json(400, { error: { message: 'API key not valid' } });
      if (state.pagespeedFail || !state.pagespeed) return json(500, { error: { message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST' } });
      const p = state.pagespeed;
      return json(200, { lighthouseResult: { categories: { performance: { score: p.performance }, seo: { score: p.seo }, accessibility: { score: p.accessibility }, 'best-practices': { score: p.bestPractices } }, audits: { 'largest-contentful-paint': { numericValue: p.lcp }, 'cumulative-layout-shift': { numericValue: p.cls }, 'first-contentful-paint': { numericValue: 1400 }, 'server-response-time': { numericValue: 380 } } } });
    }
    // ---- Search Console ----
    if (u.pathname.startsWith('/webmasters/v3/')) {
      const auth = (req.headers.authorization ?? '').replace('Bearer ', ''); if (!state.accessTokens.has(auth) && !auth.startsWith('ACCESS_R')) return json(401, { error: { message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } });
      if (state.scForbidden) return json(403, { error: { message: 'User does not have sufficient permission for site', status: 'PERMISSION_DENIED' } });
      const host = req.headers.host ?? '127.0.0.1'; const self = `http://${host}`;
      if (u.pathname === '/webmasters/v3/sites') return json(200, { siteEntry: state.scSites.map(s => ({ ...s, siteUrl: s.siteUrl.replace('MOCKHOST', host.split(':')[0]!).replace('SELF', self) })) });
      const m = /^\/webmasters\/v3\/sites\/([^/]+)\/searchAnalytics\/query$/.exec(u.pathname);
      if (m && req.method === 'POST') {
        const b = JSON.parse(bodyText || '{}') as { dimensions?: string[]; startDate: string; endDate: string; rowLimit?: number };
        const dim = b.dimensions?.[0];
        if (dim === 'date') return json(200, { rows: Object.entries(state.scRows).filter(([d]) => d >= b.startDate && d <= b.endDate).sort().map(([d, r]) => ({ keys: [d], ...r })) });
        if (dim === 'query') return json(200, { rows: state.scQueries.map(q => ({ keys: [q.query], clicks: q.clicks, impressions: q.impressions, ctr: q.clicks / q.impressions, position: 6.5 })) });
        if (dim === 'page') return json(200, { rows: state.scPages.map(p => ({ keys: [p.page.replace('SELF', self)], clicks: p.clicks, impressions: p.impressions, ctr: p.clicks / p.impressions, position: 7.1 })) });
        return json(200, { rows: [] });
      }
      return json(404, { error: { message: 'not found' } });
    }
    // ---- WordPress REST จำลอง (W-3) ----
    if (u.pathname.startsWith('/wp-json/')) {
      if (state.wp.disabled) return json(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' });
      const expected = `Basic ${Buffer.from(`${MOCK_WP_USER}:${MOCK_WP_APP_PASSWORD.replace(/\s+/g, '')}`).toString('base64')}`;
      if (state.wp.authFail || req.headers.authorization !== expected) return json(401, { code: 'rest_not_logged_in', message: 'Sorry, you are not allowed to do that.' });
      if (state.wp.failNext > 0) { state.wp.failNext--; return json(500, { code: 'internal_server_error', message: 'mock failure' }); }
      const self = `http://${req.headers.host}`; const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      const view = (p: MockWpPost) => ({ id: p.id, link: `${self}/${p.slug}/`, slug: p.slug, status: p.status, date_gmt: p.date, modified_gmt: p.date, title: { raw: p.title, rendered: p.title }, content: { raw: p.content }, excerpt: { raw: p.excerpt }, tags: p.tags, categories: p.categories });
      if (u.pathname === '/wp-json/wp/v2/users/me') return json(200, { id: 1, name: 'Somchai Editor', slug: 'somchai', roles: state.wp.roles, capabilities: { publish_posts: state.wp.roles.some(r => ['administrator', 'editor', 'author'].includes(r)), edit_posts: true } });
      if (u.pathname === '/wp-json/wp/v2/posts' && req.method === 'GET') { const slug = u.searchParams.get('slug'); return json(200, state.wp.posts.filter(p => !slug || p.slug === slug).map(view)); }
      if (u.pathname === '/wp-json/wp/v2/posts' && req.method === 'POST') {
        if (!body.title) return json(400, { code: 'rest_invalid_param', message: 'title required' });
        const slug = String(body.slug ?? '') || String(body.title).toLowerCase().replace(/\s+/g, '-');
        const post: MockWpPost = { id: nextId++, title: String(body.title), content: String(body.content ?? ''), excerpt: String(body.excerpt ?? ''), slug, status: String(body.status ?? 'draft'), date: new Date().toISOString(), tags: (body.tags as number[]) ?? [], categories: (body.categories as number[]) ?? [] };
        state.wp.posts.push(post); return json(201, view(post));
      }
      const pm = /^\/wp-json\/wp\/v2\/posts\/(\d+)$/.exec(u.pathname);
      if (pm) { const post = state.wp.posts.find(p => p.id === Number(pm[1])); if (!post) return json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' }); if (req.method === 'POST') Object.assign(post, { ...(body.title !== undefined && { title: String(body.title) }), ...(body.content !== undefined && { content: String(body.content) }), ...(body.excerpt !== undefined && { excerpt: String(body.excerpt) }), ...(body.status !== undefined && { status: String(body.status) }), ...(Array.isArray(body.tags) && { tags: body.tags as number[] }), ...(Array.isArray(body.categories) && { categories: body.categories as number[] }) }); return json(200, view(post)); }
      const tm = /^\/wp-json\/wp\/v2\/(tags|categories)$/.exec(u.pathname);
      if (tm) {
        const list = state.wp[tm[1] as 'tags' | 'categories'];
        if (req.method === 'GET') { const q = (u.searchParams.get('search') ?? '').toLowerCase(); return json(200, list.filter(t => !q || t.name.toLowerCase().includes(q))); }
        const name = String(body.name ?? '').trim(); if (!name) return json(400, { code: 'rest_invalid_param', message: 'name required' });
        if (list.some(t => t.name.toLowerCase() === name.toLowerCase())) return json(400, { code: 'term_exists', message: 'A term with the name provided already exists.' });
        const t = { id: nextId++, name }; list.push(t); return json(201, t);
      }
      return json(404, { code: 'rest_no_route', message: 'No route' });
    }
    // ---- เว็บลูกค้าจำลอง ----
    if (state.slowMs) await new Promise(r => setTimeout(r, state.slowMs));
    if (u.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /admin\n'); }
    if (state.down) { res.writeHead(503, { 'content-type': 'text/html' }); return res.end('<html><body>maintenance</body></html>'); }
    if (state.brokenPaths.has(u.pathname)) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<html><body>not found</body></html>'); }
    if (u.pathname === '/' ) { res.writeHead(state.status, { 'content-type': 'text/html; charset=utf-8' }); return res.end(state.html.replace(/SELF/g, `http://${req.headers.host}`)); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<html lang="th"><head><title>${u.pathname}</title></head><body><h1>${u.pathname}</h1></body></html>`);
  });
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  const p = (server.address() as { port: number }).port; const url = `http://127.0.0.1:${p}`;
  return { server, url, siteUrl: url, state };
}
