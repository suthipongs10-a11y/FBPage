/** Mock Google OAuth + YouTube Data API v3 + Analytics v2 + resumable upload (§168) — ห้ามยิงช่องจริงใน CI */
import { createServer, type Server } from 'node:http';

export interface MockYtState {
  validCodes: Set<string>; refreshTokens: Set<string>; accessTokens: Set<string>; apiKeys: Set<string>;
  invalidGrant: boolean; quotaExceeded: boolean; analyticsForbidden: boolean;
  channel: { id: string; title: string; handle: string; uploads: string; subscriberCount: number; videoCount: number; viewCount: number };
  videos: Record<string, { id: string; title: string; description: string; publishedAt: string; duration: string; tags: string[]; privacyStatus: string; publishAt?: string; viewCount: number; likeCount: number; commentCount: number | null; categoryId: string }>;
  comments: Record<string, { id: string; videoId: string; parentId: string | null; author: string; text: string; publishedAt: string; likeCount: number }[]>;   // videoId → comments
  playlists: { id: string; title: string; description: string; items: string[] }[];
  analytics: Record<string, Record<string, number>>;   // videoId or 'channel' → metric map
  uploads: { sessionId: string; metadata: unknown; total: number; received: number; videoId?: string }[];
  updates: { videoId: string; body: unknown }[]; replies: { parentId: string; text: string }[]; requests: string[];
}

export async function startMockYouTube(port = 0): Promise<{ server: Server; url: string; state: MockYtState; urls: { auth: string; token: string; tokenInfo: string; data: string; analytics: string; upload: string } }> {
  const day = 86_400_000; const iso = (d: number) => new Date(Date.now() - d * day).toISOString();
  const state: MockYtState = {
    validCodes: new Set(['GOOD_CODE']), refreshTokens: new Set(['REFRESH_OK']), accessTokens: new Set(['ACCESS_OK']), apiKeys: new Set(['APIKEY_OK']),
    invalidGrant: false, quotaExceeded: false, analyticsForbidden: false,
    channel: { id: 'UC_TEST_CHANNEL', title: 'เกษตรก้าวหน้า', handle: 'kasetkaona', uploads: 'UU_TEST_CHANNEL', subscriberCount: 12400, videoCount: 4, viewCount: 980000 },
    videos: {
      v1: { id: 'v1', title: 'ใส่ปุ๋ยยูเรียตอนไหนดีที่สุด', description: 'อธิบายช่วงเวลาใส่ปุ๋ย', publishedAt: iso(40), duration: 'PT12M30S', tags: ['ปุ๋ย', 'ยูเรีย'], privacyStatus: 'public', viewCount: 52000, likeCount: 1800, commentCount: 210, categoryId: '26' },
      v2: { id: 'v2', title: 'ลดต้นทุนปุ๋ย 30% ทำได้จริง', description: 'เทคนิคลดต้นทุน', publishedAt: iso(20), duration: 'PT9M05S', tags: ['ต้นทุน'], privacyStatus: 'public', viewCount: 8000, likeCount: 600, commentCount: 95, categoryId: '26' },
      v3: { id: 'v3', title: 'โรคใบจุด แก้ยังไง', description: 'โรคพืช', publishedAt: iso(10), duration: 'PT45S', tags: ['โรคพืช'], privacyStatus: 'public', viewCount: 30000, likeCount: 900, commentCount: null, categoryId: '26' },
      v4: { id: 'v4', title: 'ดินเปรี้ยว ปรับอย่างไร', description: 'ดิน', publishedAt: iso(3), duration: 'PT15M', tags: ['ดิน'], privacyStatus: 'public', viewCount: 2100, likeCount: 150, commentCount: 12, categoryId: '26' },
    },
    comments: {
      v1: [{ id: 'c1', videoId: 'v1', parentId: null, author: 'ลุงสม', text: 'ยูเรียใส่ตอนเช้าหรือเย็นดีครับ', publishedAt: iso(30), likeCount: 5 }, { id: 'c2', videoId: 'v1', parentId: null, author: 'ป้าแดง', text: 'อยากให้ทำคลิปเรื่องปุ๋ยสั่งตัด', publishedAt: iso(28), likeCount: 12 }, { id: 'c3', videoId: 'v1', parentId: null, author: 'บอท', text: 'รับสมัครงานออนไลน์ ทักมา', publishedAt: iso(27), likeCount: 0 }],
      v2: [{ id: 'c4', videoId: 'v2', parentId: null, author: 'น้าเขียว', text: 'ซื้อปุ๋ยสูตรนี้ได้ที่ไหนครับ ราคาเท่าไหร่', publishedAt: iso(15), likeCount: 3 }],
      v4: [{ id: 'c5', videoId: 'v4', parentId: null, author: 'ครูพร', text: 'ใส่ปูนขาวปริมาณเท่าไหร่ต่อไร่', publishedAt: iso(2), likeCount: 1 }],
    },
    playlists: [{ id: 'PL1', title: 'ปุ๋ยพื้นฐาน', description: '', items: ['v1', 'v2'] }],
    analytics: { channel: { views: 92100, estimatedMinutesWatched: 410000, averageViewDuration: 267, averageViewPercentage: 41.2, likes: 3450, comments: 318, shares: 620, subscribersGained: 840, subscribersLost: 60 },
      v1: { views: 52000, estimatedMinutesWatched: 300000, averageViewDuration: 346, averageViewPercentage: 46, likes: 1800, comments: 210, shares: 400, subscribersGained: 520, subscribersLost: 10 },
      v2: { views: 8000, estimatedMinutesWatched: 42000, averageViewDuration: 315, averageViewPercentage: 58, likes: 600, comments: 95, shares: 150, subscribersGained: 260, subscribersLost: 5 },
      v3: { views: 30000, estimatedMinutesWatched: 15000, averageViewDuration: 30, averageViewPercentage: 67, likes: 900, comments: 0, shares: 60, subscribersGained: 40, subscribersLost: 20 },
      v4: { views: 2100, estimatedMinutesWatched: 9000, averageViewDuration: 257, averageViewPercentage: 29, likes: 150, comments: 12, shares: 10, subscribersGained: 20, subscribersLost: 25 } },
    uploads: [], updates: [], replies: [], requests: [],
  };
  const gerr = (res: import('node:http').ServerResponse, status: number, reason: string, message = reason) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: status, message, errors: [{ reason, domain: 'youtube' }] } })); };
  const ok = (res: import('node:http').ServerResponse, data: unknown, status = 200, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
  const vres = (v: MockYtState['videos'][string]) => ({ kind: 'youtube#video', id: v.id, snippet: { title: v.title, description: v.description, publishedAt: v.publishedAt, tags: v.tags, categoryId: v.categoryId, thumbnails: { high: { url: `http://x/${v.id}.jpg` } }, liveBroadcastContent: 'none' }, contentDetails: { duration: v.duration }, statistics: { viewCount: String(v.viewCount), likeCount: String(v.likeCount), ...(v.commentCount !== null && { commentCount: String(v.commentCount) }) }, status: { privacyStatus: v.privacyStatus, uploadStatus: 'processed', madeForKids: false, ...(v.publishAt && { publishAt: v.publishAt }) } });
  const cres = (c: MockYtState['comments'][string][number]) => ({ kind: 'youtube#comment', id: c.id, snippet: { videoId: c.videoId, parentId: c.parentId ?? undefined, authorDisplayName: c.author, authorChannelId: { value: `UC_${c.author}` }, textOriginal: c.text, textDisplay: c.text, likeCount: c.likeCount, publishedAt: c.publishedAt, updatedAt: c.publishedAt } });

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'); const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); const bodyBuf = Buffer.concat(chunks); const bodyText = bodyBuf.toString('utf8');
    state.requests.push(`${req.method} ${u.pathname}`);
    const auth = req.headers.authorization?.replace('Bearer ', '') ?? ''; const key = u.searchParams.get('key') ?? '';
    // ---- OAuth ----
    if (u.pathname === '/token') {
      const p = new URLSearchParams(bodyText);
      if (p.get('client_id') !== 'gclient' || p.get('client_secret') !== 'gsecret') return ok(res, { error: 'invalid_client' }, 401);
      if (p.get('grant_type') === 'authorization_code') { if (!state.validCodes.has(p.get('code') ?? '')) return ok(res, { error: 'invalid_grant', error_description: 'Bad code' }, 400); state.validCodes.delete(p.get('code')!); return ok(res, { access_token: 'ACCESS_OK', refresh_token: 'REFRESH_OK', expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/webmasters.readonly', token_type: 'Bearer' }); }
      if (p.get('grant_type') === 'refresh_token') { if (state.invalidGrant || !state.refreshTokens.has(p.get('refresh_token') ?? '')) return ok(res, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400); const t = `ACCESS_R${Date.now()}`; state.accessTokens.add(t); return ok(res, { access_token: t, expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/webmasters.readonly', token_type: 'Bearer' }); }
      return ok(res, { error: 'unsupported_grant_type' }, 400);
    }
    if (u.pathname === '/tokeninfo') { const t = u.searchParams.get('access_token') ?? ''; if (!state.accessTokens.has(t)) return ok(res, { error: 'invalid_token' }, 400); return ok(res, { sub: 'google-user-1', email: 'owner@example.com', scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl', expires_in: '3000' }); }
    if (u.pathname === '/revoke') return ok(res, {});
    const sm = u.pathname.match(/^\/upload\/session\/(\w+)$/);
    if (sm && req.method === 'PUT') {
      const s = state.uploads.find(x => x.sessionId === sm[1]); if (!s) return gerr(res, 404, 'notFound');
      const range = req.headers['content-range'] as string | undefined; const m = /bytes (\*|(\d+)-(\d+))\/(\d+)/.exec(range ?? '');
      if (m && m[1] === '*') { if (s.videoId) return ok(res, vres(state.videos[s.videoId]!)); res.writeHead(308, { range: `bytes=0-${s.received - 1}` }); return res.end(); }
      s.received = Math.max(s.received, Number(m?.[3] ?? 0) + 1);
      if (s.received < s.total) { res.writeHead(308, { range: `bytes=0-${s.received - 1}` }); return res.end(); }
      const md = s.metadata as { snippet?: { title?: string; description?: string; tags?: string[] }; status?: { privacyStatus?: string; publishAt?: string } };
      const id = `up${state.uploads.length}`; s.videoId = id;
      state.videos[id] = { id, title: md.snippet?.title ?? 'untitled', description: md.snippet?.description ?? '', publishedAt: new Date().toISOString(), duration: 'PT1M', tags: md.snippet?.tags ?? [], privacyStatus: md.status?.privacyStatus ?? 'private', publishAt: md.status?.publishAt, viewCount: 0, likeCount: 0, commentCount: 0, categoryId: '22' };
      return ok(res, { ...vres(state.videos[id]!), status: { ...vres(state.videos[id]!).status, uploadStatus: 'uploaded' } });
    }
    // ---- auth check ----
    const oauthOk = auth && state.accessTokens.has(auth); const keyOk = key && state.apiKeys.has(key);
    if (!oauthOk && !keyOk) return gerr(res, 401, 'authError', 'Invalid Credentials');
    if (state.quotaExceeded && !u.pathname.startsWith('/analytics')) return gerr(res, 403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.');
    // ---- Analytics ----
    if (u.pathname === '/analytics/reports') {
      if (!oauthOk) return gerr(res, 401, 'authError'); if (state.analyticsForbidden) return gerr(res, 403, 'insufficientPermissions', 'Insufficient Permission');
      const metrics = (u.searchParams.get('metrics') ?? '').split(','); const filters = u.searchParams.get('filters') ?? ''; const dims = u.searchParams.get('dimensions');
      if (metrics.includes('engagedViews')) return gerr(res, 400, 'badRequest', 'Unknown metric engagedViews');
      const ids = filters.startsWith('video==') ? filters.slice(7).split(',') : ['channel'];
      if (dims === 'video') return ok(res, { columnHeaders: [{ name: 'video', columnType: 'DIMENSION', dataType: 'STRING' }, ...metrics.map(m => ({ name: m, columnType: 'METRIC', dataType: 'INTEGER' }))], rows: ids.filter(id => state.analytics[id]).map(id => [id, ...metrics.map(m => state.analytics[id]![m] ?? null)]) });
      if (dims === 'insightTrafficSourceType') return ok(res, { columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }], rows: [['YT_SEARCH', 40000], ['SUGGESTED', 30000], ['EXTERNAL', 5000]] });
      const src = state.analytics[ids[0]!]; return ok(res, { columnHeaders: metrics.map(m => ({ name: m, columnType: 'METRIC', dataType: 'INTEGER' })), rows: src ? [metrics.map(m => src[m] ?? null)] : [] });
    }
    // ---- Upload ----
    if (u.pathname === '/upload/videos') {
      if (!oauthOk) return gerr(res, 401, 'authError');
      const sessionId = `sess${state.uploads.length + 1}`; state.uploads.push({ sessionId, metadata: JSON.parse(bodyText || '{}'), total: Number(req.headers['x-upload-content-length'] ?? 0), received: 0 });
      return ok(res, {}, 200, { location: `http://127.0.0.1:${(server.address() as { port: number }).port}/upload/session/${sessionId}` });
    }
    if (u.pathname === '/upload/thumbnails/set') { if (!oauthOk) return gerr(res, 401, 'authError'); return ok(res, { items: [{ default: { url: 'http://x/thumb.jpg' } }] }); }
    // ---- Data API ----
    const path = u.pathname.replace(/^\/youtube\/v3\//, '');
    if (path === 'channels') {
      const mine = u.searchParams.get('mine') === 'true'; const id = u.searchParams.get('id'); const handle = u.searchParams.get('forHandle');
      if (mine && !oauthOk) return gerr(res, 401, 'authError');
      if (mine || id === state.channel.id || (handle && handle.toLowerCase() === state.channel.handle)) return ok(res, { items: [{ kind: 'youtube#channel', id: state.channel.id, snippet: { title: state.channel.title, customUrl: `@${state.channel.handle}`, description: 'ช่องความรู้เกษตร', country: 'TH', publishedAt: iso(900), thumbnails: { high: { url: 'http://x/ch.jpg' } } }, contentDetails: { relatedPlaylists: { uploads: state.channel.uploads } }, statistics: { subscriberCount: String(state.channel.subscriberCount), videoCount: String(Object.keys(state.videos).length), viewCount: String(state.channel.viewCount), hiddenSubscriberCount: false } }] });
      return ok(res, { items: [] });
    }
    if (path === 'playlistItems' && req.method === 'GET') {
      const pl = u.searchParams.get('playlistId'); const ids = pl === state.channel.uploads ? Object.values(state.videos).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map(v => v.id) : (state.playlists.find(p => p.id === pl)?.items ?? []);
      const page = Number(u.searchParams.get('pageToken') ?? 0); const size = Math.min(Number(u.searchParams.get('maxResults') ?? 50), 2);   // หน้าเล็กเพื่อทดสอบ pagination
      const slice = ids.slice(page * size, page * size + size);
      return ok(res, { items: slice.map(id => ({ contentDetails: { videoId: id, videoPublishedAt: state.videos[id]?.publishedAt } })), pageInfo: { totalResults: ids.length }, ...(page * size + size < ids.length && { nextPageToken: String(page + 1) }) });
    }
    if (path === 'playlistItems' && req.method === 'POST') { const b = JSON.parse(bodyText); const pl = state.playlists.find(p => p.id === b.snippet.playlistId); if (!pl) return gerr(res, 404, 'playlistNotFound'); pl.items.push(b.snippet.resourceId.videoId); return ok(res, { id: `pli${pl.items.length}` }); }
    if (path === 'videos' && req.method === 'GET') { const ids = (u.searchParams.get('id') ?? '').split(',').filter(Boolean); return ok(res, { items: ids.map(id => state.videos[id]).filter(Boolean).map(v => vres(v!)) }); }
    if (path === 'videos' && req.method === 'PUT') { if (!oauthOk) return gerr(res, 401, 'authError'); const b = JSON.parse(bodyText); const v = state.videos[b.id]; if (!v) return gerr(res, 404, 'videoNotFound'); state.updates.push({ videoId: b.id, body: b }); Object.assign(v, { title: b.snippet?.title ?? v.title, description: b.snippet?.description ?? v.description, tags: b.snippet?.tags ?? v.tags, privacyStatus: b.status?.privacyStatus ?? v.privacyStatus, publishAt: b.status?.publishAt }); return ok(res, vres(v)); }
    if (path === 'commentThreads') {
      const vid = u.searchParams.get('videoId') ?? ''; const v = state.videos[vid]; if (!v) return gerr(res, 404, 'videoNotFound');
      if (v.commentCount === null) return gerr(res, 403, 'commentsDisabled', 'The video identified by the videoId parameter has disabled comments.');
      const tops = (state.comments[vid] ?? []).filter(c => !c.parentId);
      return ok(res, { items: tops.map(c => ({ kind: 'youtube#commentThread', id: c.id, snippet: { videoId: vid, topLevelComment: cres(c), totalReplyCount: (state.comments[vid] ?? []).filter(r => r.parentId === c.id).length }, replies: { comments: (state.comments[vid] ?? []).filter(r => r.parentId === c.id).slice(0, 1).map(cres) } })), pageInfo: { totalResults: tops.length } });
    }
    if (path === 'comments' && req.method === 'GET') { const parent = u.searchParams.get('parentId') ?? ''; const all = Object.values(state.comments).flat(); return ok(res, { items: all.filter(c => c.parentId === parent).map(cres) }); }
    if (path === 'comments' && req.method === 'POST') { if (!oauthOk) return gerr(res, 401, 'authError'); const b = JSON.parse(bodyText); const parentId = b.snippet.parentId; const parent = Object.values(state.comments).flat().find(c => c.id === parentId); if (!parent) return gerr(res, 404, 'notFound'); state.replies.push({ parentId, text: b.snippet.textOriginal }); const r = { id: `r${state.replies.length}`, videoId: parent.videoId, parentId, author: 'ช่อง', text: b.snippet.textOriginal, publishedAt: new Date().toISOString(), likeCount: 0 }; (state.comments[parent.videoId] ??= []).push(r); return ok(res, cres(r)); }
    if (path === 'playlists' && req.method === 'GET') return ok(res, { items: state.playlists.map(p => ({ id: p.id, snippet: { title: p.title, description: p.description }, contentDetails: { itemCount: p.items.length }, status: { privacyStatus: 'public' } })) });
    if (path === 'playlists' && req.method === 'POST') { if (!oauthOk) return gerr(res, 401, 'authError'); const b = JSON.parse(bodyText); const p = { id: `PL${state.playlists.length + 1}`, title: b.snippet.title, description: b.snippet.description ?? '', items: [] as string[] }; state.playlists.push(p); return ok(res, { id: p.id, snippet: { title: p.title, description: p.description }, status: { privacyStatus: b.status?.privacyStatus ?? 'public' } }); }
    gerr(res, 404, 'notFound', `mock: unknown ${req.method} ${u.pathname}`);
  });
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { server, url: base, state, urls: { auth: `${base}/auth`, token: `${base}/token`, tokenInfo: `${base}/tokeninfo`, data: `${base}/youtube/v3`, analytics: `${base}/analytics`, upload: `${base}/upload` } };
}
