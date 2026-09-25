import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoogleAuth, YouTubeAnalyticsService, YouTubeApiError, YouTubeClient, YouTubeService, ageWindow, classifyVideoType, fromAnalyticsRow, fromDataApiStats, median, packagingDiagnosis, parseIsoDuration, quotaState, revivalScore, scopesForFeatures, subscriberConversion, toYtSnapshot } from './index';
import { startMockYouTube, type MockYtState } from './mock-youtube';

let m: Awaited<ReturnType<typeof startMockYouTube>>; let state: MockYtState; const used: { method: string; units: number }[] = [];
beforeAll(async () => { m = await startMockYouTube(); state = m.state; });
afterAll(() => m.server.close());
const client = () => new YouTubeClient({ dataBaseUrl: m.urls.data, analyticsBaseUrl: m.urls.analytics, uploadBaseUrl: m.urls.upload, maxRetries: 1, sleep: async () => undefined, quota: { record: r => { used.push({ method: r.method, units: r.units }); } } });
const svc = () => new YouTubeService(client());
const oauth = { kind: 'oauth' as const, accessToken: 'ACCESS_OK' }; const apiKey = { kind: 'apiKey' as const, apiKey: 'APIKEY_OK' };
const google = () => new GoogleAuth({ clientId: 'gclient', clientSecret: 'gsecret', redirectUri: 'http://cb', authBaseUrl: m.urls.auth, tokenUrl: m.urls.token, tokenInfoUrl: m.urls.tokenInfo });

describe('metric adapter (§15, §43–45, §95)', () => {
  it('parses ISO durations and classifies video type', () => {
    expect(parseIsoDuration('PT12M30S')).toBe(750); expect(parseIsoDuration('PT45S')).toBe(45); expect(parseIsoDuration('P1DT1H')).toBe(90000); expect(parseIsoDuration(null)).toBeNull();
    expect(classifyVideoType({ durationSeconds: 45, liveBroadcastContent: 'none' })).toBe('SHORT'); expect(classifyVideoType({ durationSeconds: 750, liveBroadcastContent: 'none' })).toBe('LONG_FORM'); expect(classifyVideoType({ durationSeconds: null, liveBroadcastContent: 'live' })).toBe('LIVE'); expect(classifyVideoType({ durationSeconds: null, liveBroadcastContent: null })).toBe('UNKNOWN');
  });
  it('keeps missing metrics as null with source + unit', () => {
    const ms = fromDataApiStats({ viewCount: 10, likeCount: null, commentCount: null });
    expect(ms.find(x => x.key === 'likes')!.value).toBeNull(); expect(ms[0]!.source).toBe('DATA_API');
    const an = fromAnalyticsRow([{ name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }], [100, 50, 30]);
    expect(toYtSnapshot(an)).toMatchObject({ views: { value: 100, unit: 'COUNT' }, watchMinutes: { value: 50, unit: 'MINUTES' }, averageViewDuration: { value: 30, unit: 'SECONDS' } });
    expect(fromAnalyticsRow([{ name: 'views' }], undefined)[0]!.value).toBeNull();
    expect(subscriberConversion(5, 0)).toBeNull(); expect(subscriberConversion(5, 100)).toBe(0.05);
  });
  it('windows, median, packaging diagnosis, revival score, quota state', () => {
    expect(ageWindow(new Date(Date.now() - 3_600_000))).toBe('FIRST_24H'); expect(ageWindow(new Date(Date.now() - 10 * 86_400_000))).toBe('FIRST_28D'); expect(median([1, 5, 3])).toBe(3); expect(median([])).toBeNull();
    expect(packagingDiagnosis({ ctr: 2, ctrMedian: 4, avgViewDuration: 300, avdMedian: 200, views: null, viewsMedian: null }).diagnosis).toBe('PACKAGING_OPPORTUNITY');
    expect(packagingDiagnosis({ ctr: null, ctrMedian: null, avgViewDuration: 300, avdMedian: 200, views: 100, viewsMedian: 500 })).toMatchObject({ diagnosis: 'PACKAGING_OPPORTUNITY', confidence: 'LOW' });
    expect(packagingDiagnosis({ ctr: null, ctrMedian: null, avgViewDuration: null, avdMedian: null, views: 1, viewsMedian: 1 }).diagnosis).toBe('INSUFFICIENT_DATA');
    expect(revivalScore({ avdRatio: 1.3, subConvRatio: 2, viewsRatio: 0.5, ageDays: 120, recentDeclineRatio: null, commentDemand: 4 }).score).toBe(100);
    expect(quotaState(8500)).toMatchObject({ level: 'WARN' }); expect(quotaState(9600).level).toBe('CRITICAL');
    expect(scopesForFeatures(['analytics', 'upload'])).toHaveLength(4);
  });
});

describe('Google OAuth (mock)', () => {
  it('builds auth url, exchanges code, refreshes, maps invalid_grant', async () => {
    const g = google(); const url = new URL(g.authUrl('st', scopesForFeatures(['analytics'])));
    expect(url.searchParams.get('access_type')).toBe('offline'); expect(url.searchParams.get('state')).toBe('st');
    const t = await g.exchangeCode('GOOD_CODE'); expect(t.accessToken).toBe('ACCESS_OK'); expect(t.refreshToken).toBe('REFRESH_OK'); expect(t.scopes.length).toBeGreaterThan(2);
    const info = await g.tokenInfo('ACCESS_OK'); expect(info.email).toBe('owner@example.com');
    const r = await g.refresh('REFRESH_OK'); expect(r.accessToken).toMatch(/^ACCESS_R/); expect(r.refreshToken).toBe('REFRESH_OK');
    state.invalidGrant = true;
    await expect(g.refresh('REFRESH_OK')).rejects.toSatisfy((e: unknown) => e instanceof YouTubeApiError && e.code === 'invalidGrant' && e.needsReconnect && /เชื่อมต่อ/.test(e.userMessage));
    state.invalidGrant = false;
  });
});

describe('YouTubeService (mock Data API)', () => {
  it('reads channel by handle with API key, uploads playlist with pagination, videos in batches, records quota', async () => {
    const ch = await svc().getChannelByHandle(apiKey, '@kasetkaona'); expect(ch?.id).toBe('UC_TEST_CHANNEL'); expect(ch?.uploadsPlaylistId).toBe('UU_TEST_CHANNEL');
    const ids: string[] = []; let tok: string | undefined; let pages = 0;
    do { const p = await svc().listUploadIds(apiKey, ch!.uploadsPlaylistId!, tok); ids.push(...p.items.map(i => i.videoId)); tok = p.nextPageToken ?? undefined; pages++; } while (tok);
    expect(ids).toEqual(['v4', 'v3', 'v2', 'v1']); expect(pages).toBe(2);
    const vids = await svc().getVideos(apiKey, ids); expect(vids).toHaveLength(4); expect(vids.find(v => v.id === 'v3')!.commentsDisabled).toBe(true); expect(vids.find(v => v.id === 'v1')!.durationSeconds).toBe(750);
    expect(used.filter(u => u.method === 'videos.list').length).toBeGreaterThan(0); expect(used.every(u => u.units >= 0)).toBe(true);
  });
  it('mine channel requires oauth; quota exceeded maps to quotaExceeded', async () => {
    expect((await svc().getMyChannel(oauth))?.title).toBe('เกษตรก้าวหน้า');
    await expect(svc().getMyChannel(apiKey)).rejects.toSatisfy((e: unknown) => e instanceof YouTubeApiError && e.code === 'invalidGrant');
    state.quotaExceeded = true;
    await expect(svc().getVideos(apiKey, ['v1'])).rejects.toSatisfy((e: unknown) => e instanceof YouTubeApiError && e.code === 'quotaExceeded' && e.isPermanent);
    state.quotaExceeded = false;
  });
  it('comment threads + replies, comments disabled, reply insert', async () => {
    const t = await svc().listCommentThreads(apiKey, 'v1'); expect(t.items.map(c => c.id)).toEqual(['c1', 'c2', 'c3']);
    await expect(svc().listCommentThreads(apiKey, 'v3')).rejects.toSatisfy((e: unknown) => e instanceof YouTubeApiError && e.code === 'commentsDisabled');
    const r = await svc().replyToComment(oauth, 'c1', 'ตอนเช้าครับ'); expect(r.parentId).toBe('c1'); expect(state.replies.at(-1)!.text).toBe('ตอนเช้าครับ');
  });
  it('updateVideo sends full snippet and schedules via publishAt', async () => {
    const [v] = await svc().getVideos(apiKey, ['v2']);
    const u = await svc().updateVideo(oauth, 'v2', v!, { title: 'ลดต้นทุนปุ๋ย 30% (ฉบับปรับปรุง)', publishAt: null });
    expect(u.title).toContain('ปรับปรุง'); expect((state.updates.at(-1)!.body as { snippet: { tags: string[] } }).snippet.tags).toEqual(['ต้นทุน']);
  });
  it('playlists list/create/add', async () => {
    const pls = await svc().listPlaylists(apiKey, 'UC_TEST_CHANNEL'); expect(pls[0]!.itemCount).toBe(2);
    const p = await svc().createPlaylist(oauth, { title: 'ดิน' }); await svc().addVideoToPlaylist(oauth, p.id, 'v4');
    expect(state.playlists.find(x => x.id === p.id)!.items).toEqual(['v4']);
  });
  it('resumable upload in chunks', async () => {
    const c = client(); const bytes = new Uint8Array(1000).fill(1);
    const session = await c.initiateResumable(oauth, svc().buildUploadMetadata({ title: 'ทดสอบ', privacyStatus: 'private', madeForKids: false }), bytes.byteLength, 'video/mp4');
    const r1 = await c.putChunk(session, bytes.subarray(0, 400), 0, 1000); expect(r1.done).toBe(false); if (!r1.done) expect(r1.received).toBe(400);
    const r2 = await c.putChunk(session, bytes.subarray(400), 400, 1000); expect(r2.done).toBe(true); if (r2.done) expect(String(r2.video.id)).toMatch(/^up/);
    expect(used.some(u => u.method === 'videos.insert' && u.units === 1600)).toBe(true);
  });
});

describe('Analytics (mock)', () => {
  it('channel summary falls back when a metric is unknown; video comparison keyed by id; api key rejected', async () => {
    const a = new YouTubeAnalyticsService(client()); const range = { start: '2026-08-01', end: '2026-08-31' };
    const s = await a.channelSummary(oauth, range); expect(toYtSnapshot(s.metrics).subscribersGained!.value).toBe(840);
    const s2 = await a.channelSummary(oauth, range, ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'engagedViews']); expect(s2.unavailable).toContain('engagedViews');
    const cmp = await a.videoComparison(oauth, ['v1', 'v2', 'nope'], range); expect(Object.keys(cmp).sort()).toEqual(['v1', 'v2']); expect(toYtSnapshot(cmp.v2!).averageViewDuration!.value).toBe(315);
    await expect(a.channelSummary(apiKey, range)).rejects.toSatisfy((e: unknown) => e instanceof YouTubeApiError && e.code === 'insufficientPermissions');
    state.analyticsForbidden = true; await expect(a.channelSummary(oauth, range)).rejects.toSatisfy((e: unknown) => e instanceof YouTubeApiError && e.code === 'insufficientPermissions'); state.analyticsForbidden = false;
  });
});
