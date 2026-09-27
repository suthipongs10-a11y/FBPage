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
  /** ห้องข่าว: ฟีด RSS จำลองที่ `/news/rss.xml` (+ `/news/atom.xml`, `/news/redirect`) และ Tavily ที่ `POST /tavily/search` (Bearer `TAVILY_OK`) */
  news: { rssItems: { title: string; link: string; description: string; pubDate: string }[]; tavilyResults: { title: string; url: string; content: string; published_date?: string }[]; tavilyQueries: string[]; pexelsQueries: string[]; pexelsEmpty: boolean };
  /** Google Drive จำลอง (service account): `POST /google/token` → `DRIVE_TOKEN` · `GET /google/drive/v3/files?q='<folder>' in parents` · `…/files/<id>?alt=media` · Google Docs `…/export` */
  /** บทความจำลอง `/article/<slug>` */
  articles: Record<string, { title: string; paragraphs: string[] }>;
  drive: { folderId: string; files: { id: string; name: string; mimeType: string; md5Checksum: string; modifiedTime: string; content: Buffer }[]; tokenIssuers: string[]; downloads: string[] };
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
    news: {
      rssItems: [
        { title: 'ทีมกู้ภัยช่วยลูกช้างตกบ่อได้สำเร็จ', link: 'https://news.example.com/a/elephant?utm_source=rss', description: '&lt;p&gt;เจ้าหน้าที่ใช้เวลา 3 ชั่วโมงช่วยลูกช้างออกจากบ่อน้ำ&lt;/p&gt;', pubDate: new Date(Date.now() - 3_600_000).toUTCString() },
        { title: 'ญี่ปุ่นเปิดตัวรถไฟความเร็วสูงรุ่นใหม่ วิ่งได้ 400 กม./ชม.', link: 'https://news.example.com/a/train', description: '<![CDATA[รถไฟรุ่นใหม่ทดสอบวิ่งครั้งแรก]]>', pubDate: new Date(Date.now() - 7_200_000).toUTCString() },
        { title: 'ข่าวที่ไม่มีลิงก์', link: '', description: 'ข้าม', pubDate: '' },
      ],
      tavilyResults: [
        { title: 'Scientists find new deep-sea species', url: 'https://science.example.org/deep-sea', content: 'Researchers discovered 12 new species near a hydrothermal vent.', published_date: new Date(Date.now() - 5_400_000).toUTCString() },
        { title: 'ทีมกู้ภัยช่วยลูกช้างตกบ่อได้สำเร็จ', url: 'https://www.news.example.com/a/elephant/', content: 'ซ้ำกับฟีด', published_date: new Date().toUTCString() },
      ],
      tavilyQueries: [], pexelsQueries: [], pexelsEmpty: false,
    },
    articles: {
      elephant: { title: 'ทีมกู้ภัยพาลูกช้างกลับฝูงสำเร็จหลังพลัดหลง 3 วัน', paragraphs: ['เจ้าหน้าที่อุทยานแห่งชาติเขาใหญ่ใช้เวลา 3 วันติดตามรอยฝูงช้างป่าเพื่อพาลูกช้างอายุราว 2 เดือนกลับไปหาแม่ หลังพบลูกช้างพลัดหลงอยู่ริมลำธาร', 'ทีมสัตวแพทย์ตรวจสุขภาพแล้วพบว่าลูกช้างแข็งแรงดี มีเพียงอาการขาดน้ำเล็กน้อย จึงให้สารน้ำและนมทดแทนก่อนปล่อย', 'เมื่อพบฝูง แม่ช้างเดินออกมารับลูกทันที เจ้าหน้าที่ระบุว่านี่เป็นครั้งที่สองของปีที่ช่วยลูกช้างกลับฝูงได้สำเร็จ'] },
      moon: { title: 'Scientists detect water ice deposits near lunar south pole', paragraphs: ['A team of planetary scientists reported new evidence of water ice in permanently shadowed craters near the Moon\'s south pole, using radar data collected over two years.', 'The deposits could supply future crewed missions with drinking water and rocket fuel, the researchers said, though the exact quantity remains uncertain.'] },
    },
    drive: { folderId: 'FOLDER_OK_1234', files: [], tokenIssuers: [], downloads: [] },
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
    // ---- ห้องข่าว ----
    if (u.pathname === '/news/rss.xml') {
      const items = state.news.rssItems.map(i => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description}</description><pubDate>${i.pubDate}</pubDate></item>`).join('');
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' }); return res.end(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>ข่าวจำลอง</title>${items}</channel></rss>`);
    }
    if (u.pathname === '/news/atom.xml') { res.writeHead(200, { 'content-type': 'application/atom+xml' }); return res.end('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom จำลอง</title><entry><title type="html">Mars &amp;amp; Moon</title><link rel="alternate" href="https://atom.example.com/mars"/><summary>Rover update</summary><updated>2026-09-01T10:00:00Z</updated></entry></feed>'); }
    if (u.pathname === '/news/redirect') { res.writeHead(302, { location: '/news/rss.xml' }); return res.end(); }
    if (u.pathname === '/news/not-a-feed') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body>hello</body></html>'); }
    if (u.pathname === '/admin/feed.xml') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); return res.end('<rss><channel></channel></rss>'); }
    if (u.pathname === '/tavily/search' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer TAVILY_OK') return json(401, { detail: { error: 'Unauthorized: missing or invalid API key.' } });
      const body = JSON.parse(bodyText || '{}') as { query?: string; topic?: string };
      state.news.tavilyQueries.push(String(body.query ?? ''));
      return json(200, { query: body.query, results: state.news.tavilyResults });
    }
    // ---- บทความจำลองสำหรับโต๊ะค้นคว้า: /article/<slug> · /article/go/<slug> (302) · /admin/secret-article (robots ห้าม) ----
    if (u.pathname.startsWith('/article/go/')) { res.writeHead(302, { location: `/article/${u.pathname.slice(12)}` }); return res.end(); }
    if (u.pathname.startsWith('/article/')) {
      const a = state.articles[u.pathname.slice(9)];
      if (!a) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<html><body>not found</body></html>'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><title>${a.title} | ข่าวจำลอง</title><meta property="og:title" content="${a.title}"><meta property="og:site_name" content="Mock Times"><meta property="article:published_time" content="2026-09-26T08:00:00Z"></head><body><header><nav>เมนู หน้าแรก ข่าว กีฬา บันเทิง</nav></header><article><h1>${a.title}</h1>${a.paragraphs.map(p => `<p>${p}</p>`).join('')}</article><aside>ข่าวที่เกี่ยวข้อง โฆษณา</aside><footer>ลิขสิทธิ์ Mock Times</footer><script>var tracking = 1;</script></body></html>`);
    }
    // ---- Google Drive จำลอง ----
    if (u.pathname === '/google/token' && req.method === 'POST') {
      const assertion = new URLSearchParams(bodyText).get('assertion') ?? '';
      const [h, c, sig] = assertion.split('.');
      try {
        const head = JSON.parse(Buffer.from(h ?? '', 'base64url').toString()) as { alg?: string }; const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString()) as { iss?: string; scope?: string };
        if (head.alg !== 'RS256' || !sig || !claims.iss?.endsWith('.iam.gserviceaccount.com') || !claims.scope?.includes('drive')) return json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
        state.drive.tokenIssuers.push(claims.iss); return json(200, { access_token: 'DRIVE_TOKEN', expires_in: 3599, token_type: 'Bearer' });
      } catch { return json(400, { error: 'invalid_grant', error_description: 'Invalid JWT.' }); }
    }
    if (u.pathname.startsWith('/google/drive/v3/files')) {
      if (req.headers.authorization !== 'Bearer DRIVE_TOKEN') return json(401, { error: { message: 'Invalid Credentials' } });
      if (u.pathname === '/google/drive/v3/files') {
        const folder = (u.searchParams.get('q') ?? '').match(/'([^']+)' in parents/)?.[1];
        if (folder !== state.drive.folderId) return json(404, { error: { message: `File not found: ${folder}.` } });
        return json(200, { files: [...state.drive.files].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).map(({ content: _c, ...f }) => ({ ...f, size: String(_c.byteLength) })) });
      }
      const m = u.pathname.match(/^\/google\/drive\/v3\/files\/([^/]+)(\/export)?$/); const f = m && state.drive.files.find(x => x.id === decodeURIComponent(m[1]!));
      if (!f) return json(404, { error: { message: 'File not found.' } });
      state.drive.downloads.push(f.id);
      res.writeHead(200, { 'content-type': m![2] ? 'text/plain' : f.mimeType }); return res.end(f.content);
    }
    // ---- คลังภาพ Pexels จำลอง: GET /pexels/v1/search (header Authorization: PEXELS_OK) + ไฟล์ภาพ /img/*.png ----
    if (u.pathname === '/pexels/v1/search') {
      if (req.headers.authorization !== 'PEXELS_OK') return json(401, { error: 'Unauthorized' });
      state.news.pexelsQueries.push(u.searchParams.get('query') ?? '');
      const host = `http://${req.headers.host}`;
      return json(200, { photos: state.news.pexelsEmpty ? [] : [{ id: 101, url: 'https://www.pexels.com/photo/101/', width: 1600, height: 1067, photographer: 'Somsri Camera', photographer_url: 'https://www.pexels.com/@somsri', alt: 'elephant in forest', src: { large2x: `${host}/img/stock-101.png`, large: `${host}/img/stock-101.png` } }] });
    }
    if (u.pathname.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')); }
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
