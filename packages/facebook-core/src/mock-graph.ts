/**
 * Mock Meta Graph API สำหรับ test (AGENTS.md §77 — ห้ามยิงเพจจริงใน CI)
 * จำลองพฤติกรรมที่เจอจริง: likes.summary ถูกปฏิเสธ (code 10), token หมดอายุ (code 190), rate limit (code 4)
 */
import { createServer, type Server } from 'node:http';

export interface MockState {
  validUserTokens: Set<string>;
  pageTokens: Record<string, string>;        // pageId → token
  pages: { id: string; name: string; category: string; tasks: string[] }[];
  posts: Record<string, { id: string; message: string; created_time: string; shares?: number }[]>;
  denyEngagementSummary: boolean;
  rateLimitNext: number;                     // จำนวนคำขอถัดไปที่จะตอบ code 4
  published: { pageId: string; body: Record<string, string> }[];
  requests: string[];
}

export async function startMockGraph(): Promise<{ server: Server; url: string; state: MockState }> {
  const state: MockState = {
    validUserTokens: new Set(['USER_OK']),
    pageTokens: { '111': 'PAGE_111', '222': 'PAGE_222' },
    pages: [
      { id: '111', name: 'ระเบียงบุญ', category: 'Party Entertainment Service', tasks: ['MODERATE', 'MESSAGING', 'ANALYZE', 'ADVERTISE', 'CREATE_CONTENT'] },
      { id: '222', name: 'Phuket Maids Service', category: 'Cleaning Service', tasks: ['MODERATE', 'MESSAGING', 'ANALYZE', 'ADVERTISE', 'CREATE_CONTENT', 'MANAGE'] },
    ],
    posts: {
      '111': [{ id: '111_1', message: 'โพสต์แรก', created_time: new Date(Date.now() - 2 * 86400000).toISOString(), shares: 3 }, { id: '111_2', message: 'โพสต์สอง', created_time: new Date(Date.now() - 86400000).toISOString() }],
      '222': [{ id: '222_1', message: 'ทำความสะอาด', created_time: new Date(Date.now() - 3600000).toISOString(), shares: 6 }],
    },
    denyEngagementSummary: true, rateLimitNext: 0, published: [], requests: [],
  };
  const err = (res: import('node:http').ServerResponse, code: number, message: string, status = 400, type = 'OAuthException') => {
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message, code, type } }));
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let body = ''; for await (const c of req) body += c;
    const params = new URLSearchParams(url.search);
    if (body && !req.headers['content-type']?.includes('multipart')) for (const [k, v] of new URLSearchParams(body)) params.set(k, v);
    let token = params.get('access_token') ?? '';
    if (!token && body.includes('name="access_token"')) token = body.split('name="access_token"')[1]?.split('\r\n\r\n')[1]?.split('\r\n')[0] ?? '';
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, '');
    state.requests.push(`${req.method} ${path}`);
    if (state.rateLimitNext > 0) { state.rateLimitNext--; return err(res, 4, 'Application request limit reached', 400); }
    const ok = (data: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const pageByToken = Object.entries(state.pageTokens).find(([, t]) => t === token)?.[0];

    if (path === 'oauth/access_token') {
      if (params.get('code') === 'GOOD') return ok({ access_token: 'SHORT_OK', token_type: 'bearer', expires_in: 5000 });
      if (params.get('fb_exchange_token') === 'SHORT_OK') return ok({ access_token: 'USER_OK', token_type: 'bearer', expires_in: 5184000 });
      return err(res, 100, 'Invalid verification code format.', 400);
    }
    if (path === 'me') { if (!state.validUserTokens.has(token)) return err(res, 190, 'Invalid OAuth access token', 401); return ok({ id: 'U1', name: 'Test User' }); }
    if (path === 'me/permissions') return ok({ data: ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_manage_posts'].map(p => ({ permission: p, status: 'granted' })) });
    if (path === 'debug_token') return ok({ data: { type: 'USER', expires_at: 0 } });
    if (path === 'me/accounts') { if (!state.validUserTokens.has(token)) return err(res, 190, 'Invalid OAuth access token', 401); return ok({ data: state.pages.map(p => ({ ...p, access_token: state.pageTokens[p.id], picture: { data: { url: `http://x/${p.id}.jpg` } } })) }); }

    const m = path.match(/^(\d+)(?:\/(\w+))?$/);
    if (m) {
      const [, pageId, edge] = m;
      if (!pageByToken || pageByToken !== pageId) return err(res, 190, 'Invalid OAuth access token', 401);
      const page = state.pages.find(p => p.id === pageId)!;
      if (!edge) {
        if (req.method === 'DELETE') return ok({ success: true });
        return ok({ id: page.id, name: page.name, category: page.category, about: 'about', phone: '+66000000000', is_published: true, fan_count: 1829, picture: { data: { url: `http://x/${page.id}.jpg`, is_silhouette: false } }, cover: { source: `http://x/${page.id}-cover.jpg` } });
      }
      if (edge === 'feed' && req.method === 'POST') { state.published.push({ pageId, body: Object.fromEntries(params) }); return ok({ id: `${pageId}_new${state.published.length}` }); }
      if (['published_posts', 'feed', 'posts'].includes(edge)) {
        const fields = params.get('fields') ?? '';
        if (state.denyEngagementSummary && /summary\(true\)/.test(fields)) return err(res, 10, "This endpoint requires the 'pages_read_engagement' permission or the 'Page Public Content Access' feature.", 400, 'OAuthException');
        const since = Number(params.get('since')) || 0;
        return ok({ data: (state.posts[pageId] ?? []).filter(p => new Date(p.created_time).getTime() / 1000 >= since).map(p => ({ id: p.id, message: p.message, created_time: p.created_time, permalink_url: `http://x/${p.id}`, ...(fields.includes('shares') && p.shares != null && { shares: { count: p.shares } }) })) });
      }
      if (edge === 'photos') { state.published.push({ pageId, body: Object.fromEntries(params) }); return ok({ id: `ph_${state.published.length}` }); }
    }
    err(res, 803, `Unknown path ${path}`, 404, 'GraphMethodException');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${addr.port}`, state };
}
