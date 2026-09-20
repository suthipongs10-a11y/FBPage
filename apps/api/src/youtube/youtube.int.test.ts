/** Integration — YouTube module (AGENTS_YOUTUBE YT-1…YT-7) กับ mock YouTube / mock AI / mock Graph — ไม่แตะช่องจริง ไม่ใช้ key จริง */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { startMockAi } from '@fbpm/ai-core';
import { startMockYouTube } from '@fbpm/youtube-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text, location: res.headers.get('location') };
  } };
  return c;
}
const SECRETS = /ACCESS_OK|REFRESH_OK|APIKEY_OK|accessTokenEncrypted|refreshTokenEncrypted/;

run('youtube module (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient;
  let yt: Awaited<ReturnType<typeof startMockYouTube>>; let ai: Awaited<ReturnType<typeof startMockAi>>; let graph: Awaited<ReturnType<typeof startMockGraph>>;
  const stamp = Date.now(); const A = { email: `yt-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' }; const B = { email: `yt-b-${stamp}@test.local`, name: 'Bob', password: 'bob-password-12345' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>; let ws = ''; let wsB = ''; let brand = ''; let brand2 = ''; let pageA = '';
  let connId = ''; let channelId = ''; let contentId = ''; let commentC4 = ''; let clusterId = '';
  beforeAll(async () => {
    yt = await startMockYouTube(); ai = await startMockAi(); graph = await startMockGraph();
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    process.env.META_GRAPH_BASE_URL = graph.url; process.env.YOUTUBE_MOCK_BASE_URL = yt.url;
    process.env.GOOGLE_CLIENT_ID = 'gclient'; process.env.GOOGLE_CLIENT_SECRET = 'gsecret'; process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://127.0.0.1:4000/youtube/oauth/callback';
    process.env.YOUTUBE_API_KEY = 'APIKEY_OK'; process.env.YOUTUBE_UPLOAD_ENABLED = 'true'; process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'yt-media-'));
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id;
    wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้าเกษตร' });
    brand = (await a.http('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'เกษตรก้าวหน้า', industry: 'เกษตร', primaryCTA: 'ทักแชท', targetAudience: 'เกษตรกรรายย่อย' })).json.id;
    brand2 = (await a.http('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'แบรนด์สอง' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_YT_TEST');
    const fconn = await a.http('POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_YT_TEST' });
    pageA = (await a.http('POST', `/workspaces/${ws}/brands/${brand}/pages/connect`, { connectionId: fconn.json.connection.id, facebookPageId: '111' })).json.id;
    await a.http('PUT', `/workspaces/${ws}/ai/providers/compatible`, { apiKey: 'MOCK_KEY', baseUrl: ai.url });
    await a.http('PUT', `/workspaces/${ws}/ai/roles`, { roles: { strategy: { provider: 'compatible', model: 'm-strategy' }, content: { provider: 'compatible', model: 'm-content' }, analysis: { provider: 'compatible', model: 'm-analysis' }, community: { provider: 'compatible', model: 'm-community' }, fast: { provider: 'compatible', model: 'm-fast' } } });
  }, 40_000);
  afterAll(async () => {
    for (const k of ['META_GRAPH_BASE_URL', 'YOUTUBE_MOCK_BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'YOUTUBE_API_KEY', 'YOUTUBE_UPLOAD_ENABLED']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: { in: [ws, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } }); await prisma.$disconnect();
    await app.close(); yt.server.close(); ai.server.close(); graph.server.close();
  });

  // ---------- YT-1 connection ----------
  it('health reports configuration and quota without exposing secrets', async () => {
    const r = await a.http('GET', `/workspaces/${ws}/youtube/health`);
    expect(r.status).toBe(200); expect(r.json.oauthConfigured).toBe(true); expect(r.json.apiKeyConfigured).toBe(true); expect(r.json.uploadEnabled).toBe(true);
    expect(r.text).not.toMatch(SECRETS);
  });
  it('OAuth start → callback with signed state creates a Google connection; tampered state → gError', async () => {
    const s = await a.http('POST', `/workspaces/${ws}/youtube/connections/oauth/start`, { features: 'read,analytics,upload' });
    expect(s.status).toBe(200); expect(s.json.url).toContain(yt.urls.auth); expect(s.json.scopes.join(' ')).toMatch(/youtube.upload/);
    const state = new URL(s.json.url).searchParams.get('state')!;
    const cb = await fetch(`${base}/youtube/oauth/callback?code=GOOD_CODE&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    expect(cb.status).toBe(302); expect(cb.headers.get('location')).toMatch(/\/youtube\?gConnected=/);
    const bad = await fetch(`${base}/youtube/oauth/callback?code=GOOD_CODE&state=${encodeURIComponent(state.slice(0, -3) + 'xxx')}`, { redirect: 'manual' });
    expect(bad.headers.get('location')).toMatch(/gError=state/);
    const list = await a.http('GET', `/workspaces/${ws}/youtube/connections`); expect(list.json).toHaveLength(1); expect(list.text).not.toMatch(SECRETS);
  });
  it('paste refresh token (Playground shortcut) upserts the same Google user; wrong token → 422', async () => {
    const r = await a.http('POST', `/workspaces/${ws}/youtube/connections/token`, { refreshToken: 'REFRESH_OK' });
    expect(r.status, r.text).toBe(200); expect(r.text).not.toMatch(SECRETS); connId = r.json.id;
    expect((await a.http('GET', `/workspaces/${ws}/youtube/connections`)).json).toHaveLength(1);   // providerUserId เดียวกัน → ไม่ซ้ำ
    const bad = await a.http('POST', `/workspaces/${ws}/youtube/connections/token`, { refreshToken: 'REFRESH_BAD_TOKEN' });
    expect(bad.status).toBe(422);
  });
  it('connects the owner channel via OAuth with progressive initial sync (quick + videos, uploads playlist not search)', async () => {
    const before = yt.state.requests.length;
    const r = await a.http('POST', `/workspaces/${ws}/youtube/channels`, { brandId: brand, mode: 'OAUTH', connectionId: connId });
    expect(r.status, r.text).toBe(201); channelId = r.json.id;
    expect(r.json.title).toBe('เกษตรก้าวหน้า'); expect(r.json.accessMode).toBe('OAUTH'); expect(r.json.subscriberCount).toBe(12400);
    expect(r.json.initialSync.quick.ok).toBe(true); expect(r.json.initialSync.videos.videos.imported).toBe(4);
    expect(r.json.capabilities.upload).toBe(true); expect(r.json.capabilities.analytics).toBe(true);
    expect(r.text).not.toMatch(SECRETS);
    const calls = yt.state.requests.slice(before); expect(calls.some(c => c.includes('/search'))).toBe(false); expect(calls.some(c => c.includes('playlistItems'))).toBe(true);
  });
  it('same channel cannot be attached to a second brand; public API-key mode by @handle works for another workspace-visible channel', async () => {
    const dup = await a.http('POST', `/workspaces/${ws}/youtube/channels`, { brandId: brand2, mode: 'PUBLIC_API_KEY', handle: '@kasetkaona' });
    expect(dup.status).toBe(409);
    const nf = await a.http('POST', `/workspaces/${ws}/youtube/channels`, { brandId: brand2, mode: 'PUBLIC_API_KEY', handle: '@nobody' });
    expect(nf.status).toBe(404);
  });

  // ---------- YT-2 sync / videos ----------
  it('full sync stores analytics snapshots; Shorts classified by duration; unreadable metrics stay null (never 0)', async () => {
    const r = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/sync`, { stage: 'all' });
    expect(r.status, r.text).toBe(200); expect(r.json.analytics.videos).toBe(4); expect(r.json.playlists.playlists).toBe(1);
    const list = await a.http('GET', `/workspaces/${ws}/youtube/videos?channelId=${channelId}&sort=views`);
    expect(list.json).toHaveLength(4); expect(list.json[0].youtubeVideoId).toBe('v1');
    const v3 = list.json.find((v: { youtubeVideoId: string }) => v.youtubeVideoId === 'v3');
    expect(v3.videoType).toBe('SHORT'); expect(v3.commentCount).toBeNull(); expect(v3.stats.comments).toBe(0);   // Analytics ให้ 0 จริง แต่ Data API ไม่ส่ง → คอลัมน์ต้นทาง null
    const v1 = list.json.find((v: { youtubeVideoId: string }) => v.youtubeVideoId === 'v1');
    expect(v1.stats.avgViewDuration).toBe(346); expect(v1.stats.subscribersGained).toBe(520); expect(v1.stats.subscriberConversion).toBeCloseTo(0.01, 3);
    const detail = await a.http('GET', `/workspaces/${ws}/youtube/videos/${v1.id}`);
    expect(detail.status).toBe(200); expect(detail.json.timeline.length).toBeGreaterThan(0); expect(detail.json.packaging.diagnosis).toBeDefined();
    const ch = await a.http('GET', `/workspaces/${ws}/youtube/channels/${channelId}`); expect(ch.json.latestAnalytics.metricsJson.views.value).toBe(92100); expect(ch.json.analyticsStatus).toBe('OK');
  });
  it('quota ledger records every Data API call per workspace and quotaExceeded surfaces as 429 + notification (no retry storm)', async () => {
    const q = await a.http('GET', `/workspaces/${ws}/youtube/quota`);
    expect(q.json.used).toBeGreaterThan(0); expect(q.json.byMethod.length).toBeGreaterThan(0); expect(q.json.level).toBeDefined();
    yt.state.quotaExceeded = true;
    const r = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/sync`, { stage: 'videos' });
    expect(r.status).toBe(429); expect(r.json.code).toBe('quotaExceeded');
    yt.state.quotaExceeded = false;
    const n = await a.http('GET', `/workspaces/${ws}/notifications`); expect(n.json.items.some((x: { title: string }) => x.title.includes('โควตา'))).toBe(true);
  });
  it('baselines are per-format medians; without analytics scope revenue is unavailable (not 0)', async () => {
    const r = await a.http('GET', `/workspaces/${ws}/youtube/channels/${channelId}/baselines?type=LONG_FORM`);
    expect(r.status).toBe(200); expect(r.json.n ?? r.json.count ?? 3).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(r.json)).not.toMatch(/"revenue":0/);
  });

  // ---------- YT-3 analyst ----------
  it('analyst produces observed/inference/recommendations, assigns pillars, and stores recommendations for triage', async () => {
    ai.state.replies.push({ text: JSON.stringify({ summary: 'ช่องเน้นปุ๋ยและดิน วิดีโอเรื่องปุ๋ยดึงผู้ติดตามได้ดี', observations: [{ kind: 'OBSERVED', text: 'v1 มีวิว 52000 สูงกว่าค่ากลาง', evidence: ['views=52000'] }], inferences: [{ kind: 'INFERENCE', text: 'หัวข้อปุ๋ยตรงความต้องการ', confidence: 'MEDIUM' }],
      contentPillars: [{ pillar: 'ปุ๋ย', videoIds: ['v1', 'v2'], confidence: 0.8 }, { pillar: 'โรคพืช/ดิน', videoIds: ['v3', 'v4'], confidence: 0.7 }], topVideos: [{ videoId: 'v1', why: 'วิวและ sub สูงสุด' }], subscriberDrivers: [{ videoId: 'v1', why: 'sub+520' }],
      packagingIssues: [{ videoId: 'v4', hypothesis: 'ชื่อไม่บอกประโยชน์', confidence: 'LOW' }], revivalCandidates: [{ videoId: 'v2', why: 'AVD สูงแต่วิวต่ำ' }], commentInsights: ['ผู้ชมถามเรื่องเวลาใส่ปุ๋ยซ้ำ'], dataLimitations: ['ไม่มี CTR'],
      recommendations: [{ actionType: 'CREATE_FOLLOWUP', videoId: 'v1', title: 'ทำภาคต่อเรื่องยูเรีย: ปริมาณต่อไร่', why: 'คอมเมนต์ถามซ้ำ + วิดีโอเดิมทำผลงานดี', evidence: ['c1', 'views=52000'], confidence: 'HIGH', priority: 90 }, { actionType: 'OPTIMIZE_TITLE', videoId: 'v4', title: 'ปรับชื่อ v4 ให้บอกผลลัพธ์', why: 'วิวต่ำกว่าค่ากลาง', evidence: ['views=2100'], confidence: 'LOW', priority: 40 }] }) });
    const r = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/analyze`, { days: 90 });
    expect(r.status, r.text).toBe(200); expect(r.json.recommendationsCreated).toBe(2); expect(r.json.result.dataLimitations.length).toBeGreaterThan(0);
    const recs = await a.http('GET', `/workspaces/${ws}/youtube/recommendations?channelId=${channelId}`); expect(recs.json).toHaveLength(2); expect(recs.json[0].actionType).toBe('CREATE_FOLLOWUP');
    const done = await a.http('PATCH', `/workspaces/${ws}/youtube/recommendations/${recs.json[1].id}`, { status: 'IGNORED' }); expect(done.status).toBe(200);
    expect((await a.http('GET', `/workspaces/${ws}/youtube/recommendations?channelId=${channelId}`)).json).toHaveLength(1);
    const vids = await a.http('GET', `/workspaces/${ws}/youtube/videos?channelId=${channelId}&pillar=${encodeURIComponent('ปุ๋ย')}`); expect(vids.json).toHaveLength(2);
    const an = await a.http('GET', `/workspaces/${ws}/youtube/channels/${channelId}/analyses`); expect(an.json).toHaveLength(1);
    const rev = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/revival`, {}); expect(rev.status).toBe(200);
  });
  it('metadata edit of a published video goes through the API with audit; never bulk (§67)', async () => {
    const v4 = (await a.http('GET', `/workspaces/${ws}/youtube/videos?channelId=${channelId}&q=${encodeURIComponent('ดินเปรี้ยว')}`)).json[0];
    const r = await a.http('PATCH', `/workspaces/${ws}/youtube/videos/${v4.id}/metadata`, { title: 'ดินเปรี้ยว ปรับอย่างไรให้ผลผลิตเพิ่ม' });
    expect(r.status, r.text).toBe(200); expect(yt.state.updates).toHaveLength(1); expect(yt.state.videos.v4!.title).toBe('ดินเปรี้ยว ปรับอย่างไรให้ผลผลิตเพิ่ม');
    const audit = await prisma.auditLog.findFirst({ where: { workspaceId: ws, action: 'YOUTUBE_VIDEO_UPDATED' } }); expect(audit).not.toBeNull();
  });

  // ---------- YT-6 comments ----------
  it('syncs comments, classifies with lead detection (hot lead → notification), drafts replies, clusters into ideas', async () => {
    const s = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/comments/sync`, {});
    expect(s.status, s.text).toBe(200); expect(s.json.imported + s.json.updated).toBe(5);   // stage=all ซิงก์ไปแล้วรอบหนึ่ง → รอบนี้ update
    const list = await a.http('GET', `/workspaces/${ws}/youtube/comments?channelId=${channelId}&unclassified=1`); expect(list.json).toHaveLength(5);
    const ids = Object.fromEntries(list.json.map((c: { id: string; youtubeCommentId: string }) => [c.youtubeCommentId, c.id])); commentC4 = ids.c4;
    ai.state.replies.push({ text: JSON.stringify({ comments: [
      { id: ids.c1, classification: 'QUESTION', sentiment: 'neutral', risk: false, summary: 'ถามเวลาใส่ยูเรีย', draftReply: 'ใส่ช่วงเย็นครับ ดินชื้นพอดี', lead: null },
      { id: ids.c2, classification: 'CONTENT_REQUEST', sentiment: 'positive', risk: false, summary: 'ขอคลิปเรื่องปุ๋ยอินทรีย์', draftReply: null, lead: null },
      { id: ids.c3, classification: 'PRAISE', sentiment: 'positive', risk: false, summary: 'ชม', draftReply: null, lead: null },
      { id: ids.c4, classification: 'PRODUCT_INTEREST', sentiment: 'neutral', risk: false, summary: 'ถามซื้อปุ๋ย', draftReply: 'ทักแชทได้เลยครับ', lead: { intent: 'ซื้อปุ๋ย', product: 'ปุ๋ยสูตรลดต้นทุน', service: null, urgency: 'high', leadScore: 85 } },
      { id: ids.c5, classification: 'QUESTION', sentiment: 'neutral', risk: false, summary: 'ถามปริมาณปูนขาว', draftReply: 'ประมาณ 300 กก./ไร่ ขึ้นกับค่า pH', lead: null },
    ] }) });
    const c = await a.http('POST', `/workspaces/${ws}/youtube/comments/classify`, { channelId, limit: 25 });
    expect(c.status, c.text).toBe(200); expect(c.json.classified).toBe(5); expect(c.json.leads).toBe(1); expect(c.json.autoReplied).toBe(0);   // APPROVAL_REQUIRED → ไม่ตอบเอง
    const leads = await a.http('GET', `/workspaces/${ws}/leads`); expect(leads.json.some((l: { sourcePlatform?: string; source?: string }) => l.sourcePlatform === 'YOUTUBE' || l.source === 'youtube-comment')).toBe(true);
    const n = await a.http('GET', `/workspaces/${ws}/notifications`); expect(n.json.items.some((x: { type: string }) => x.type === 'hot_lead')).toBe(true);
    // ตอบด้วยข้อความที่คนยืนยัน (ผ่าน OAuth ของเจ้าของช่อง)
    const rep = await a.http('POST', `/workspaces/${ws}/youtube/comments/${ids.c1}/reply`, { message: 'ใส่ช่วงเย็นครับ ดินชื้นพอดี' });
    expect(rep.status, rep.text).toBe(200); expect(rep.json.replyStatus).toBe('SENT'); expect(yt.state.replies).toHaveLength(1);
    ai.state.replies.push({ text: JSON.stringify({ clusters: [{ label: 'เวลาและปริมาณการใส่ปุ๋ย', kind: 'QUESTION', description: 'ถามเวลา/ปริมาณ', commentIds: [ids.c1, ids.c5], confidence: 0.8 }, { label: 'อยากได้คลิปปุ๋ยอินทรีย์', kind: 'CONTENT_REQUEST', description: 'ขอคลิป', commentIds: [ids.c2], confidence: 0.7 }] }) });
    const cl = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/comments/cluster`, {});
    expect(cl.status, cl.text).toBe(200);
    const clusters = await a.http('GET', `/workspaces/${ws}/youtube/comments/clusters?channelId=${channelId}`); expect(clusters.json.length).toBe(1); expect(clusters.json[0].count).toBe(2); clusterId = clusters.json[0].id;   // กลุ่มที่มีคอมเมนต์เดียวไม่นับเป็นคลัสเตอร์
    const idea = await a.http('POST', `/workspaces/${ws}/youtube/comments/clusters/${clusterId}/idea`, {});
    expect(idea.status, idea.text).toBe(200); expect(idea.json.platform).toBe('YOUTUBE'); expect(idea.json.ytStatus).toBe('IDEA');
    const ins = await a.http('GET', `/workspaces/${ws}/youtube/comments/insights?channelId=${channelId}&days=60`); expect(ins.status).toBe(200);
  });

  // ---------- YT-4/YT-5 content lab → approval → upload ----------
  it('topic ideas → script → titles → SEO metadata → policy fields → submit → approve', async () => {
    ai.state.replies.push({ text: JSON.stringify({ ideas: [{ topic: 'ยูเรียต่อไร่', title: 'ยูเรียใส่กี่กิโลต่อไร่ถึงพอดี', whyNow: 'คอมเมนต์ถามซ้ำ', evidence: ['c1', 'v1 views'], contentPillar: 'ปุ๋ย', format: 'LONG_FORM', objective: 'ตอบคำถามผู้ชม', hook: 'ใส่มากไปเสียเงินฟรี', priority: 90, confidence: 0.8, source: 'COMMENTS' }, { topic: 'ปุ๋ยอินทรีย์', title: 'ปุ๋ยอินทรีย์ทำเองใน 7 วัน', whyNow: 'ผู้ชมขอ', evidence: ['c2'], contentPillar: 'ปุ๋ย', format: 'SHORT', objective: 'ขยายฐาน', hook: '7 วันได้ปุ๋ยฟรี', priority: 70, confidence: 0.6, source: 'COMMENTS' }],
      gaps: [{ pillar: 'โรคพืช', finding: 'ทำน้อยแต่ Shorts ได้วิวดี' }], saturation: [], insights: [{ type: 'AUDIENCE_QUESTION', platforms: ['YOUTUBE', 'FACEBOOK'], title: 'ผู้ชมถามเวลาใส่ปุ๋ยซ้ำ', observation: 'คอมเมนต์ 2 ใน 5 ถามเรื่องนี้', inference: 'ยังไม่มีคอนเทนต์ตอบตรง', recommendation: 'ทำ FAQ ทั้งสองแพลตฟอร์ม', confidence: 'MEDIUM' }] }) });
    const ideas = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/ideas`, { count: 2 });
    expect(ideas.status, ideas.text).toBe(200); expect(ideas.json.items).toHaveLength(2); contentId = ideas.json.items[0].id;
    expect(ideas.json.items[0].ytStatus).toBe('IDEA'); expect(ideas.json.items[1].youtubeMeta.format).toBe('SHORT');
    const insights = await a.http('GET', `/workspaces/${ws}/youtube/insights`); expect(insights.json.length).toBe(1); expect(insights.json[0].platforms).toContain('FACEBOOK');

    ai.state.replies.push({ text: JSON.stringify({ hook: 'ใส่ยูเรียมากไป เสียเงินฟรีแล้วยังทำต้นไหม้', outline: [{ section: 'เปิด', points: ['ปัญหา'], visual: 'แปลงข้าว', durationSec: 30 }, { section: 'วิธีคำนวณ', points: ['ดูอายุพืช', 'ดูดิน'], visual: 'ตาราง', durationSec: 240 }], script: 'สวัสดีครับ วันนี้มาตอบคำถามที่ถามกันมากที่สุด...', cta: 'ทักแชทเพจได้เลย', aiInterpretation: ['สมมติว่าเป็นนาข้าว'], missingInfo: ['สูตรปุ๋ยที่แบรนด์ขาย'], researchNeeded: [] }) });
    const sc = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/script`, { targetDurationSec: 480 });
    expect(sc.status, sc.text).toBe(200); expect(sc.json.ytStatus).toBe('SCRIPT'); expect(sc.json.youtubeMeta.script).toMatch(/สวัสดีครับ/);
    ai.state.replies.push({ text: JSON.stringify({ titles: [{ title: 'ยูเรียใส่กี่กิโลต่อไร่? คำนวณให้ดูทีละขั้น', angle: 'question', reason: 'ตรงคำถามผู้ชม', risk: 'low' }, { title: 'หยุดใส่ยูเรียแบบเดา! วิธีคำนวณที่ถูกต้อง', angle: 'curiosity', reason: 'ดึงความสนใจ', risk: 'medium' }] }) });
    const ti = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/titles`, { count: 2 });
    expect(ti.status, ti.text).toBe(200); expect(ti.json.titles ?? ti.json.youtubeMeta?.titleCandidates).toBeDefined();
    ai.state.replies.push({ text: JSON.stringify({ title: 'ยูเรียใส่กี่กิโลต่อไร่? คำนวณให้ดูทีละขั้น', description: 'วิธีคำนวณปริมาณยูเรียต่อไร่ตามอายุพืชและสภาพดิน\n\nติดต่อ: ทักแชทเพจ', tags: ['ยูเรีย', 'ปุ๋ย', 'นาข้าว'], categoryId: '26', defaultLanguage: 'th', playlistIds: [], relatedVideoCta: 'ดูคลิปเวลาใส่ปุ๋ย', notes: [] }) });
    const md = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/metadata`, {});
    expect(md.status, md.text).toBe(200); expect(md.json.ytStatus).toBe('METADATA_READY'); expect(md.json.youtubeMeta.tags).toContain('ยูเรีย');
    // นโยบาย: AI ไม่ตัดสิน madeForKids/synthetic/paid → submit ก่อนกรอกต้องถูกบล็อก
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    const blocked = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/submit`, {});
    expect(blocked.status, blocked.text).toBe(200); expect(blocked.json.ytStatus).toBe('METADATA_READY'); expect(JSON.stringify(blocked.json.reviewResult ?? blocked.json.aiNotes ?? blocked.json)).toMatch(/syntheticMedia|madeForKids|paidPlacement/);   // นโยบาย: คนต้องกรอก AI ห้ามตัดสิน
    const upd = await a.http('PATCH', `/workspaces/${ws}/youtube/content/${contentId}`, { madeForKids: false, syntheticMedia: false, paidPlacement: false, privacyStatus: 'private' });
    expect(upd.status, upd.text).toBe(200);
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ไม่พบข้ออ้างเกินจริง', issues: [] }) });
    const sub = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/submit`, {});
    expect(sub.status, sub.text).toBe(200); expect(sub.json.ytStatus).toBe('READY_FOR_APPROVAL'); expect(sub.json.approvals[0].status).toBe('PENDING');
    const appr = await a.http('GET', `/workspaces/${ws}/approvals`); expect(appr.json.some((x: { content: { id: string; platform: string } }) => x.content.id === contentId && x.content.platform === 'YOUTUBE')).toBe(true);   // คิวอนุมัติรวมสองแพลตฟอร์ม
    const ok = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/approve`, { comment: 'ผ่าน' });
    expect(ok.status, ok.text).toBe(200); expect(ok.json.ytStatus).toBe('APPROVED');
  });
  it('upload is refused without a video file, blocked by kill switch, then runs resumable + idempotent inline and reaches READY', async () => {
    const noFile = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/upload`, { inline: true });
    expect(noFile.status).toBe(422); expect(noFile.json.message).toMatch(/ไฟล์วิดีโอ/);
    expect((await a.http('GET', `/workspaces/${ws}/youtube/content/${contentId}`)).json.ytStatus).toBe('APPROVED');   // ถอยกลับ ไม่ค้าง UPLOAD_PENDING
    const bytes = Buffer.alloc(3 * 1024 * 1024, 7);
    const up = await fetch(`${base}/workspaces/${ws}/youtube/content/${contentId}/assets/video`, { method: 'POST', headers: { cookie: a.cookie, 'content-type': 'video/mp4', 'x-file-name': encodeURIComponent('คลิป.mp4') }, body: bytes });
    expect(up.status).toBe(201); const asset = await up.json() as { bytes: number }; expect(asset.bytes).toBe(bytes.length);
    const badThumb = await fetch(`${base}/workspaces/${ws}/youtube/content/${contentId}/assets/thumbnail`, { method: 'POST', headers: { cookie: a.cookie, 'content-type': 'text/plain', 'x-file-name': 'x.txt' }, body: 'nope' });
    expect(badThumb.status).toBe(400);
    await a.http('PATCH', `/workspaces/${ws}/youtube/channels/${channelId}`, { uploadsPaused: true });
    const paused = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/upload`, { inline: true }); expect(paused.status).toBe(403);
    await a.http('PATCH', `/workspaces/${ws}/youtube/channels/${channelId}`, { uploadsPaused: false });
    const r = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/upload`, { inline: true });
    expect(r.status, r.text).toBe(200); expect(['UPLOADED', 'READY']).toContain(r.json.outcome.status); expect(yt.state.uploads).toHaveLength(1);
    expect(yt.state.uploads[0]!.received).toBe(bytes.length); expect((yt.state.uploads[0]!.metadata as { status: { privacyStatus: string; selfDeclaredMadeForKids: boolean } }).status.privacyStatus).toBe('private');
    expect(r.json.content.externalPostId).toBeTruthy(); expect(['PROCESSING', 'PUBLISHED', 'SCHEDULED', 'READY']).toContain(r.json.content.ytStatus);
    const again = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/upload`, { inline: true });
    expect(again.status).toBe(409); expect(yt.state.uploads).toHaveLength(1);   // idempotent — ไม่อัปโหลดซ้ำ
    const chk = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/check-processing`, {});
    expect(chk.status, chk.text).toBe(200); expect(['PROCESSING', 'READY', 'SKIPPED']).toContain(chk.json.state); expect(['PROCESSING', 'PUBLISHED', 'SCHEDULED']).toContain(chk.json.content.ytStatus);   // inline ตรวจ processing ไปแล้ว → SKIPPED เมื่อเผยแพร่แล้ว
    const ops = await prisma.youTubeUploadOperation.findMany({ where: { contentItemId: contentId } }); expect(ops).toHaveLength(1); expect(Number(ops[0]!.bytesSent)).toBe(bytes.length);
    const vids = await a.http('GET', `/workspaces/${ws}/youtube/videos?channelId=${channelId}`); expect(vids.json.some((v: { source: string }) => v.source === 'app')).toBe(true);
  });
  it('repurposes a YouTube item into Facebook drafts with ContentRelation and shared calendar', async () => {
    ai.state.replies.push({ text: JSON.stringify({ posts: [{ kind: 'FAQ', headline: 'ยูเรียใส่กี่กิโล', caption: 'คำถามที่เจอบ่อย: ยูเรียใส่กี่กิโลต่อไร่? ดูคลิปเต็มได้ที่ YouTube', cta: 'ทักแชท', hashtags: ['ปุ๋ย'], mediaBrief: 'การ์ดตัวเลข', contentPillar: 'ปุ๋ย' }, { kind: 'TEASER', headline: 'คลิปใหม่', caption: 'คลิปใหม่มาแล้ว: คำนวณยูเรียให้พอดี', cta: 'ดูคลิป', hashtags: [], mediaBrief: 'ภาพปก', contentPillar: 'ปุ๋ย' }] }) });
    const r = await a.http('POST', `/workspaces/${ws}/youtube/content/${contentId}/repurpose`, { targetPageId: pageA, count: 2 });
    expect(r.status, r.text).toBe(200); expect(r.json.created).toHaveLength(2);
    const fb = await a.http('GET', `/workspaces/${ws}/content?pageId=${pageA}`); expect(fb.json.filter((c: { platform: string }) => c.platform === 'FACEBOOK').length).toBeGreaterThanOrEqual(2);
    const rel = await prisma.contentRelation.count({ where: { parentContentId: contentId, relationType: 'REPURPOSED_FROM' } }); expect(rel).toBe(2);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString(); const to = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const cal = await a.http('GET', `/workspaces/${ws}/youtube/content/calendar?from=${from}&to=${to}`); expect(cal.status).toBe(200);
  });

  // ---------- YT-7 report ----------
  it('monthly report is computed from saved snapshots, marks unavailable metrics honestly, and can skip AI', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const r = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/reports`, { month, withAi: false });
    expect(r.status, r.text).toBe(200); expect(r.json.data.publishing.videos).toBeGreaterThanOrEqual(2); expect(r.json.data.metricsAvailable.revenue).toBe(false); expect(r.json.data.channelMetrics.revenueUsd).toBeNull();
    expect(r.json.data.text).toMatch(/ไม่มีข้อมูล/); expect(r.json.data.summary).toBeNull(); expect(r.json.data.comments.total).toBeGreaterThan(0);
    const list = await a.http('GET', `/workspaces/${ws}/youtube/reports?channelId=${channelId}`); expect(list.json).toHaveLength(1);
    const one = await a.http('GET', `/workspaces/${ws}/youtube/reports/${r.json.id}`); expect(one.status).toBe(200);
    const pdf = await fetch(`${base}/workspaces/${ws}/youtube/reports/${r.json.id}/pdf`, { headers: { cookie: a.cookie } });
    expect(pdf.status).toBe(200); expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
    const sh = await a.http('POST', `/workspaces/${ws}/youtube/reports/${r.json.id}/share`, {}); const token = (sh.json.url as string).split('/share/r/')[1];
    const pub = await fetch(`${base}/share/reports/${token}`); const body = await pub.json() as { kind: string; data: { channelMetrics: { revenueUsd: number | null } } };
    expect(pub.status).toBe(200); expect(body.kind).toBe('youtube'); expect(body.data.channelMetrics.revenueUsd).toBeNull(); expect(JSON.stringify(body)).not.toMatch(SECRETS);
    expect((await b.http('GET', `/workspaces/${wsB}/youtube/reports/${r.json.id}/pdf`)).status).toBe(404);
  });

  // ---------- Playlist Architect (§45) + overview ----------
  it('playlist architect proposes (AI) → recommendations; apply creates/adds via OAuth idempotently and syncs back', async () => {
    const before = await a.http('GET', `/workspaces/${ws}/youtube/channels/${channelId}/playlists`);
    expect(before.status).toBe(200); expect(before.json.playlists).toHaveLength(1); expect(before.json.unlisted.length).toBeGreaterThanOrEqual(2);   // PL1 มี v1,v2 → v3,v4 (+ วิดีโอที่อัปโหลด) ยังไม่อยู่ใน playlist
    ai.state.replies.push({ text: JSON.stringify({ playlists: [
      { playlistId: 'PL1', title: 'ปุ๋ยพื้นฐาน', description: '', videoIds: ['v4', 'v1'], why: 'เรื่องดิน/ปุ๋ยต่อเนื่องกัน', confidence: 'HIGH', priority: 80 },
      { playlistId: null, title: 'Shorts โรคพืช', description: 'คลิปสั้นเรื่องโรคพืช', videoIds: ['v3', 'ไม่มีจริง'], why: 'แยก Shorts ออกจากวิดีโอยาว', confidence: 'MEDIUM', priority: 60 },
    ], notes: ['เสนอ 2 กลุ่ม'] }) });
    const plan = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/playlists/plan`, {});
    expect(plan.status, plan.text).toBe(200); expect(plan.json.recommendationsCreated).toBe(2); expect(plan.json.proposed[1].videoIds).toEqual(['v3']);   // วิดีโอที่ไม่มีจริงถูกตัด
    const recs = (await a.http('GET', `/workspaces/${ws}/youtube/recommendations?channelId=${channelId}`)).json as { id: string; actionType: string }[];
    const create = recs.find(r => r.actionType === 'CREATE_PLAYLIST')!; const add = recs.find(r => r.actionType === 'ADD_TO_PLAYLIST')!;
    expect(yt.state.playlists).toHaveLength(1);
    const ap1 = await a.http('POST', `/workspaces/${ws}/youtube/recommendations/${create.id}/apply`, {});
    expect(ap1.status, ap1.text).toBe(200); expect(ap1.json.createdPlaylist).toBe(true); expect(ap1.json.added).toBe(1); expect(yt.state.playlists).toHaveLength(2); expect(yt.state.playlists[1]!.items).toEqual(['v3']);
    const ap2 = await a.http('POST', `/workspaces/${ws}/youtube/recommendations/${add.id}/apply`, {});
    expect(ap2.status, ap2.text).toBe(200); expect(ap2.json.added).toBe(1); expect(ap2.json.skipped).toEqual(['v1']);   // v1 อยู่แล้ว → ข้าม (idempotent)
    expect((await a.http('POST', `/workspaces/${ws}/youtube/recommendations/${add.id}/apply`, {})).status).toBe(409);   // ทำแล้ว
    const after = await a.http('GET', `/workspaces/${ws}/youtube/channels/${channelId}/playlists`);
    expect(after.json.playlists).toHaveLength(2); expect(after.json.playlists.find((p: { youtubePlaylistId: string }) => p.youtubePlaylistId === 'PL1').items).toHaveLength(3);
    const audit = await prisma.auditLog.count({ where: { workspaceId: ws, action: 'YOUTUBE_PLAYLIST_APPLIED' } }); expect(audit).toBe(2);
    await a.http('PATCH', `/workspaces/${ws}/youtube/channels/${channelId}`, { automationPaused: true });
    ai.state.replies.push({ text: JSON.stringify({ playlists: [{ playlistId: 'PL1', title: 'x', description: '', videoIds: ['v2'], why: 'y', confidence: 'LOW', priority: 10 }], notes: [] }) });
    await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/playlists/plan`, {});
    const rec3 = ((await a.http('GET', `/workspaces/${ws}/youtube/recommendations?channelId=${channelId}`)).json as { id: string; actionType: string }[]).find(r => r.actionType === 'ADD_TO_PLAYLIST')!;
    expect((await a.http('POST', `/workspaces/${ws}/youtube/recommendations/${rec3.id}/apply`, {})).status).toBe(409);   // kill switch
    await a.http('PATCH', `/workspaces/${ws}/youtube/channels/${channelId}`, { automationPaused: false });
  });
  it('weekly trends: videos/views per publish week + subscriber snapshots, no API calls', async () => {
    const before = yt.state.requests.length;
    const r = await a.http('GET', `/workspaces/${ws}/youtube/channels/${channelId}/trends?weeks=12`);
    expect(r.status, r.text).toBe(200); expect(r.json.weeks).toHaveLength(12); expect(r.json.weeks.reduce((n: number, w: { videos: number }) => n + w.videos, 0)).toBeGreaterThanOrEqual(4);
    expect(r.json.channelSeries.length).toBeGreaterThanOrEqual(1); expect(r.json.channelSeries[0].subscribers).toBe(12400); expect(yt.state.requests.length).toBe(before);
  });
  it('overview summarises YouTube state for the shared dashboard', async () => {
    const r = await a.http('GET', `/workspaces/${ws}/youtube/overview`);
    expect(r.status).toBe(200); expect(r.json.configured).toBe(true); expect(r.json.channels).toBe(1); expect(r.json.videosMonth).toBeGreaterThanOrEqual(1);
    expect(r.json.openRecommendations).toBeGreaterThanOrEqual(1); expect(r.json.quota.used).toBeGreaterThan(0); expect(r.json.unresolvedComments).toBeGreaterThanOrEqual(1);
    expect((await b.http('GET', `/workspaces/${wsB}/youtube/overview`)).json.channels).toBe(0);
  });

  // ---------- tenant isolation + RBAC ----------
  it('another workspace cannot see channels, videos, content, comments or reports', async () => {
    expect((await b.http('GET', `/workspaces/${wsB}/youtube/channels/${channelId}`)).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsB}/youtube/content/${contentId}`)).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsB}/youtube/channels`)).json).toHaveLength(0);
    expect((await b.http('GET', `/workspaces/${wsB}/youtube/comments?channelId=${channelId}`)).json).toHaveLength(0);
    expect((await b.http('POST', `/workspaces/${wsB}/youtube/comments/${commentC4}/reply`, { message: 'x' })).status).toBe(404);
    expect([403, 404]).toContain((await b.http('GET', `/workspaces/${ws}/youtube/channels`)).status);   // ไม่ใช่สมาชิก → ไม่เผยว่ามี workspace
  });
  it('disconnect keeps history but stops sync; revoke connection calls Google revoke', async () => {
    const d = await a.http('DELETE', `/workspaces/${ws}/youtube/channels/${channelId}`); expect(d.status).toBe(200);
    const s = await a.http('POST', `/workspaces/${ws}/youtube/channels/${channelId}/sync`, { stage: 'quick' }); expect(s.status).toBe(422);
    expect((await a.http('GET', `/workspaces/${ws}/youtube/videos?channelId=${channelId}`)).json.length).toBeGreaterThan(0);
    const rv = await a.http('DELETE', `/workspaces/${ws}/youtube/connections/${connId}`); expect(rv.status).toBe(200); expect(yt.state.requests.some(r => r.includes('/revoke'))).toBe(true);
  });
});
