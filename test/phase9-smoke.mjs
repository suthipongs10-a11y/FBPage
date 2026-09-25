// Phase 9 (YouTube) smoke — ผ่าน Next proxy กับ mock YouTube/Google + mock AI (ไม่แตะช่องจริง ไม่ใช้ key จริง)
// ต้องเปิด API ด้วย: YOUTUBE_MOCK_BASE_URL=http://127.0.0.1:4997 GOOGLE_CLIENT_ID=gclient GOOGLE_CLIENT_SECRET=gsecret GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:4000/youtube/oauth/callback YOUTUBE_API_KEY=APIKEY_OK YOUTUBE_UPLOAD_ENABLED=true
// (+ web/Postgres/Redis)   รัน:  node test/phase9-smoke.mjs
import { startMockYouTube } from '../packages/youtube-core/dist/mock-youtube.js';
import { startMockAi } from '../packages/ai-core/dist/mock-ai.js';
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3000';
let fail = 0; let cookie = '';
const check = (label, ok, detail = '') => { console.log(`${ok ? '✔' : '✖'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail++; };
const api = async (method, path, body) => {
  const res = await fetch(`${WEB}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
};
const yt = await startMockYouTube(4997); const ai = await startMockAi();
const stamp = Date.now();
const reg = await api('POST', '/auth/register', { email: `smoke9-${stamp}@test.local`, name: 'Smoke9', password: 'smoke-password-123' });
const ws = reg.json?.workspace?.id; check('register → 201', reg.status === 201);
const c = await api('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้า 9' });
const b = await api('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'แบรนด์ 9', primaryCTA: 'ทักแชท' });
await api('PUT', `/workspaces/${ws}/ai/providers/compatible`, { apiKey: 'MOCK_KEY', baseUrl: ai.url });
await api('PUT', `/workspaces/${ws}/ai/roles`, { roles: { strategy: { provider: 'compatible', model: 'm' }, content: { provider: 'compatible', model: 'm' }, analysis: { provider: 'compatible', model: 'm' }, community: { provider: 'compatible', model: 'm' }, fast: { provider: 'compatible', model: 'm' } } });

const h = await api('GET', `/workspaces/${ws}/youtube/health`);
check('youtube/health → mock configured', h.status === 200 && h.json.oauthConfigured && h.json.apiKeyConfigured, h.status !== 200 || !h.json?.oauthConfigured ? 'API ต้องเปิดด้วย YOUTUBE_MOCK_BASE_URL=http://127.0.0.1:4997 + GOOGLE_CLIENT_ID=gclient GOOGLE_CLIENT_SECRET=gsecret …' : '');
if (!(h.status === 200 && h.json.oauthConfigured)) { yt.server.close(); ai.server.close(); process.exit(1); }
for (const p of ['/youtube', '/youtube/videos', '/youtube/content', '/youtube/comments', '/youtube/reports']) { const r = await fetch(`${WEB}${p}`); check(`web ${p} → 200`, r.status === 200); }

const tok = await api('POST', `/workspaces/${ws}/youtube/connections/token`, { refreshToken: 'REFRESH_OK' });
check('paste refresh token → connection (no secrets in response)', tok.status === 200 && !/REFRESH_OK|ACCESS_OK|Encrypted/.test(tok.text));
const ch = await api('POST', `/workspaces/${ws}/youtube/channels`, { brandId: b.json.id, mode: 'OAUTH', connectionId: tok.json.id });
check('connect channel (OAuth) + initial sync 4 videos', ch.status === 201 && ch.json.initialSync?.videos?.videos?.imported === 4, ch.text.slice(0, 200)); const channelId = ch.json.id;
const sync = await api('POST', `/workspaces/${ws}/youtube/channels/${channelId}/sync`, { stage: 'all' });
check('sync all → analytics + comments + playlists', sync.status === 200 && sync.json.analytics?.videos === 4);
const vids = await api('GET', `/workspaces/${ws}/youtube/videos?channelId=${channelId}&sort=views`);
check('videos listed with stats; short classified; null stays null', vids.json?.length === 4 && vids.json.find(v => v.youtubeVideoId === 'v3')?.videoType === 'SHORT' && vids.json.find(v => v.youtubeVideoId === 'v3')?.commentCount === null);
const quota = await api('GET', `/workspaces/${ws}/youtube/quota`); check('quota ledger records usage', quota.json?.used > 0);

ai.state.replies.push({ text: JSON.stringify({ summary: 'สรุป', observations: [], inferences: [], contentPillars: [{ pillar: 'ปุ๋ย', videoIds: ['v1', 'v2'], confidence: 0.8 }], topVideos: [], subscriberDrivers: [], packagingIssues: [], revivalCandidates: [], commentInsights: [], dataLimitations: [], recommendations: [{ actionType: 'CREATE_FOLLOWUP', videoId: 'v1', title: 'ภาคต่อ', why: 'ถามซ้ำ', evidence: [], confidence: 'HIGH', priority: 90 }] }) });
const an = await api('POST', `/workspaces/${ws}/youtube/channels/${channelId}/analyze`, { days: 90 });
check('analyze → recommendations', an.status === 200 && an.json.recommendationsCreated === 1);

ai.state.replies.push({ text: JSON.stringify({ ideas: [{ topic: 'ยูเรีย', title: 'ยูเรียใส่กี่กิโลต่อไร่', whyNow: 'ถามซ้ำ', evidence: [], contentPillar: 'ปุ๋ย', format: 'LONG_FORM', objective: 'FAQ', hook: 'ใส่มากไปเสียเงินฟรี', priority: 90, confidence: 0.8, source: 'COMMENTS' }], gaps: [], saturation: [], insights: [] }) });
const ideas = await api('POST', `/workspaces/${ws}/youtube/channels/${channelId}/ideas`, { count: 1 });
check('ideas → IDEA item', ideas.status === 200 && ideas.json.items?.[0]?.ytStatus === 'IDEA'); const id = ideas.json.items[0].id;
ai.state.replies.push({ text: JSON.stringify({ hook: 'h', outline: [], script: 'สวัสดีครับ...', cta: 'ทักแชท', aiInterpretation: [], missingInfo: [], researchNeeded: [] }) });
check('script → SCRIPT', (await api('POST', `/workspaces/${ws}/youtube/content/${id}/script`, {})).json?.ytStatus === 'SCRIPT');
ai.state.replies.push({ text: JSON.stringify({ title: 'ยูเรียใส่กี่กิโลต่อไร่? คำนวณให้ดู', description: 'รายละเอียด', tags: ['ปุ๋ย'], categoryId: '26', defaultLanguage: 'th', playlistIds: [], relatedVideoCta: '', notes: [] }) });
check('metadata → METADATA_READY', (await api('POST', `/workspaces/${ws}/youtube/content/${id}/metadata`, {})).json?.ytStatus === 'METADATA_READY');
await api('PATCH', `/workspaces/${ws}/youtube/content/${id}`, { madeForKids: false, syntheticMedia: false, paidPlacement: false });
ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
const sub = await api('POST', `/workspaces/${ws}/youtube/content/${id}/submit`, {});
check('submit → READY_FOR_APPROVAL (unified approvals)', sub.json?.ytStatus === 'READY_FOR_APPROVAL' && (await api('GET', `/workspaces/${ws}/approvals`)).json?.some(x => x.content?.id === id));
check('approve → APPROVED', (await api('POST', `/workspaces/${ws}/youtube/content/${id}/approve`, { comment: 'ok' })).json?.ytStatus === 'APPROVED');
check('upload without file → 422', (await api('POST', `/workspaces/${ws}/youtube/content/${id}/upload`, { inline: true })).status === 422);
const up = await fetch(`${WEB}/api/workspaces/${ws}/youtube/content/${id}/assets/video`, { method: 'POST', headers: { cookie, 'content-type': 'video/mp4', 'x-file-name': 'smoke.mp4' }, body: Buffer.alloc(1024 * 1024, 1) });
check('attach video asset (raw stream via proxy)', up.status === 201);
const upl = await api('POST', `/workspaces/${ws}/youtube/content/${id}/upload`, { inline: true });
check('inline resumable upload → UPLOADED/READY, idempotent op', upl.status === 200 && ['UPLOADED', 'READY'].includes(upl.json.outcome?.status) && yt.state.uploads.length === 1, upl.text.slice(0, 200));
check('duplicate upload → 409, no second upload', (await api('POST', `/workspaces/${ws}/youtube/content/${id}/upload`, { inline: true })).status === 409 && yt.state.uploads.length === 1);
check('calendar (shared) shows YouTube item', (await api('GET', `/workspaces/${ws}/content/calendar?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 86400000).toISOString()}`)).json?.some(x => x.id === id && x.platform === 'YOUTUBE'));

const cs = await api('POST', `/workspaces/${ws}/youtube/channels/${channelId}/comments/sync`, {});
check('comments sync', cs.status === 200 && cs.json.imported + cs.json.updated === 5);
const rep = await api('POST', `/workspaces/${ws}/youtube/channels/${channelId}/reports`, { month: new Date().toISOString().slice(0, 7), withAi: false });
check('monthly report (no AI) — revenue null not 0', rep.status === 200 && rep.json.data.channelMetrics.revenueUsd === null && /ไม่มีข้อมูล/.test(rep.json.data.text));
yt.state.quotaExceeded = true;
check('quotaExceeded → 429', (await api('POST', `/workspaces/${ws}/youtube/channels/${channelId}/sync`, { stage: 'videos' })).status === 429);
yt.state.quotaExceeded = false;

console.log(fail ? `\n${fail} check(s) failed` : '\nPhase 9 (YouTube) smoke: all checks passed');
yt.server.close(); ai.server.close(); process.exit(fail ? 1 : 0);
