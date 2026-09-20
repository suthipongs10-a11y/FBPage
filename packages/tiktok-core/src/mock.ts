import { createServer } from 'node:http';
export async function startMockTikTok(port = 0) {
  const state = { refreshes: 0, inits: 0, calls: [] as { path: string; body: Record<string, unknown> }[], scopes: 'user.info.basic,video.list,user.info.profile,user.info.stats,video.upload', status: 'SEND_TO_USER_INBOX', error: '', httpStatus: 200, failInit: false };
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const path = new URL(req.url!, 'http://localhost').pathname;
    const data = req.headers['content-type']?.includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(body)) : body ? JSON.parse(body) as Record<string, unknown> : {};
    state.calls.push({ path, body: data });
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const ok = (value: unknown) => json({ data: value, error: { code: 'ok' } });
    if (state.error) return json({ error: { code: state.error, message: 'Never show ACCESS_SECRET or REFRESH_SECRET' } }, state.httpStatus);
    if (path === '/v2/oauth/token/') {
      if (data.grant_type === 'refresh_token') state.refreshes++;
      return json({ open_id: 'mock-open-id', access_token: 'ACCESS_SECRET', refresh_token: `REFRESH_SECRET_${state.refreshes}`, expires_in: 86400, refresh_expires_in: 31536000, scope: state.scopes, token_type: 'Bearer' });
    }
    if (path === '/v2/oauth/revoke/') return json({});
    if (path === '/v2/user/info/') return ok({ user: { open_id: 'mock-open-id', display_name: 'TikTok ทดสอบ', username: 'local_test', follower_count: 123, following_count: 12, likes_count: 450, video_count: 6 } });
    if (path === '/v2/video/list/') return ok({ videos: Array.from({ length: data.cursor ? 1 : 5 }, (_, i) => ({ id: data.cursor ? 'v6' : `v${i + 1}`, title: `วิดีโอ ${i + 1}`, video_description: 'ข้อมูลทดสอบ', create_time: 1750000000 - i * 86400, duration: 25, view_count: data.cursor ? 1000 : 100, like_count: 10, comment_count: 2, ...(data.cursor ? {} : { share_count: 3 }) })), cursor: data.cursor ? 1 : 2, has_more: !data.cursor });
    if (path === '/v2/post/publish/inbox/video/init/') { state.inits++; if (state.failInit) { req.socket.destroy(); return; } return ok({ publish_id: 'mock-publish-id' }); }
    if (path === '/v2/post/publish/status/fetch/') return ok({ status: state.status });
    json({ error: { code: 'not_found' } }, 404);
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Mock server unavailable');
  return { server, state, url: `http://127.0.0.1:${address.port}` };
}
