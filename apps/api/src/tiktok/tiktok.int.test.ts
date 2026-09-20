import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, decryptSecret } from '@fbpm/database';
import { startMockTikTok, accessToken, syncAccount, uploadContent, pollContent, reconcileStalledUploads, type TikTokDeps } from '@fbpm/tiktok-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';
import { TT } from './tiktok.provider';
import { TikTokContentService } from './content.service';
const run = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;
run('TikTok local integration: OAuth, tenant isolation, AI, approval and Inbox', () => {
  let app: INestApplication; let db: PrismaClient; let base: string; let mock: Awaited<ReturnType<typeof startMockTikTok>>; let deps: TikTokDeps; let lab: TikTokContentService;
  let cookie = ''; let otherCookie = ''; let ws: string; let wsB: string; let uid: string; let brand: string; let account: string; let draft: string;
  let aiOutput: unknown; let aiCalls = 0; let geminiHeadersCorrect = false;
  const aiServer = createServer(async (req, res) => { let data = ''; for await (const b of req) data += b; JSON.parse(data); aiCalls++; geminiHeadersCorrect = req.headers['x-goog-api-key'] === 'MOCK_KEY'; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiOutput) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 15 } })); });
  const stamp = Date.now();
  async function http(method: string, path: string, body?: unknown, c = cookie) {
    const res = await fetch(base + path, { method, headers: { cookie: c, 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }), redirect: 'manual' });
    const text = await res.text(); const json = text.startsWith('{') ? JSON.parse(text) as Record<string, unknown> : {};
    return { status: res.status, text, json, location: res.headers.get('location') || '', cookie: res.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  async function state() { const r = await http('POST', `/workspaces/${ws}/tiktok/oauth/start`, { brandId: brand, profile: true, stats: true, upload: true }); expect(r.status, r.text).toBe(200); return new URL(String(r.json.url)).searchParams.get('state')!; }
  beforeAll(async () => {
    mock = await startMockTikTok();
    Object.assign(process.env, { APP_ENV: 'test', AUTH_SECRET: 'tiktok-test-encryption-secret-over-32-chars', TIKTOK_CLIENT_KEY: 'MOCK_CLIENT', TIKTOK_CLIENT_SECRET: 'MOCK_SECRET', TIKTOK_REDIRECT_URI: 'http://localhost:4000/tiktok/oauth/callback', TIKTOK_MOCK_BASE_URL: mock.url, SOCIAL_PUBLISHING_ENABLED: 'false', TIKTOK_VERIFIED_MEDIA_PREFIXES: 'https://media.example/videos/' });
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); db = new PrismaClient(); deps = app.get(TT); lab = app.get(TikTokContentService);
    const a = await http('POST', '/auth/register', { email: `tt-${stamp}@test.local`, name: 'TikTok Tester', password: 'test-password-long-123', workspaceName: 'TikTok test' }, ''); expect(a.status, a.text).toBe(201); cookie = a.cookie;
    const b = await http('POST', '/auth/register', { email: `tt-b-${stamp}@test.local`, name: 'Other', password: 'test-password-long-123', workspaceName: 'Other workspace' }, ''); otherCookie = b.cookie;
    const user = await db.user.findUniqueOrThrow({ where: { email: `tt-${stamp}@test.local` }, include: { memberships: true } }); uid = user.id; ws = user.memberships[0]!.workspaceId;
    const other = await db.user.findUniqueOrThrow({ where: { email: `tt-b-${stamp}@test.local` }, include: { memberships: true } }); wsB = other.memberships[0]!.workspaceId;
    const c = await db.client.create({ data: { workspaceId: ws, name: 'Test Client', brands: { create: { name: 'Test Brand' } } }, include: { brands: true } }); brand = c.brands[0]!.id;
    await new Promise<void>(r => aiServer.listen(0, '127.0.0.1', r)); const addr = aiServer.address(); if (!addr || typeof addr === 'string') throw new Error('AI mock unavailable');
    expect((await http('PUT', `/workspaces/${ws}/ai/providers/gemini`, { apiKey: 'MOCK_KEY', baseUrl: `http://127.0.0.1:${addr.port}/models` })).status).toBe(200);
    await http('PUT', `/workspaces/${ws}/ai/roles`, { roles: { content: { provider: 'gemini', model: 'gemini-test' }, analysis: { provider: 'gemini', model: 'gemini-test' } } });
  }, 40_000);
  afterAll(async () => {
    if (db) { if (brand) await db.contentItem.deleteMany({ where: { platform: 'TIKTOK', tiktokBrandId: brand } }); if (account) { await db.contentItem.deleteMany({ where: { tiktokAccountId: account } }); await db.tikTokAccount.deleteMany({ where: { id: account } }); } if (ws) await db.tikTokOAuthState.deleteMany({ where: { workspaceId: ws } }); await db.workspace.deleteMany({ where: { id: { in: [ws, wsB].filter(Boolean) } } }); await db.user.deleteMany({ where: { email: { in: [`tt-${stamp}@test.local`, `tt-b-${stamp}@test.local`] } } }); await db.$disconnect(); }
    await app?.close(); mock?.server.closeAllConnections(); mock?.server.close(); aiServer.closeAllConnections(); aiServer.close();
    for (const k of ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI', 'TIKTOK_MOCK_BASE_URL', 'SOCIAL_PUBLISHING_ENABLED', 'TIKTOK_VERIFIED_MEDIA_PREFIXES']) delete process.env[k];
  });
  it('rejects cross-workspace access, callback tampering, other browser session and replay', async () => {
    expect((await http('GET', `/workspaces/${ws}/tiktok/accounts`, undefined, otherCookie)).status).toBe(404);
    const nonce = await state(); const cb = `/tiktok/oauth/callback?state=${nonce}&code=MOCK_CODE`;
    expect((await http('GET', cb, undefined, otherCookie)).location).toContain('invalid_state');
    expect((await http('GET', '/tiktok/oauth/callback?state=bad&code=x')).location).toContain('invalid_state');
    expect((await http('GET', cb)).location).toContain('connected');
    expect((await http('GET', cb)).location).toContain('invalid_state');
    const a = await db.tikTokAccount.findFirstOrThrow({ where: { workspaceId: ws } }); account = a.id;
    expect(a.accessTokenEncrypted).not.toContain('ACCESS_SECRET'); expect(decryptSecret(a.accessTokenEncrypted, deps.secret)).toBe('ACCESS_SECRET');
    expect((await http('GET', `/workspaces/${ws}/tiktok/accounts`)).text).not.toMatch(/ACCESS_SECRET|REFRESH_SECRET|TokenEncrypted/);
  });
  it('rechecks connection permission when callback arrives and enforces expiry', async () => {
    const nonce = await state(); await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: ws, userId: uid } }, data: { role: 'viewer' } });
    expect((await http('GET', `/tiktok/oauth/callback?state=${nonce}&code=x`)).location).toContain('permission_denied');
    expect((await http('POST', `/workspaces/${ws}/tiktok/oauth/start`, { brandId: brand })).status).toBe(403);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: ws, userId: uid } }, data: { role: 'owner' } });
    await db.tikTokOAuthState.updateMany({ where: { workspaceId: ws, consumedAt: null }, data: { expiresAt: new Date(0) } });
    expect((await http('GET', `/tiktok/oauth/callback?state=${nonce}&code=x`)).location).toContain('invalid_state');
  });
  it('refreshes once under concurrency, persists rotated token, paginates and upserts videos with null metrics', async () => {
    await db.tikTokAccount.update({ where: { id: account }, data: { tokenExpiresAt: new Date(0) } });
    await Promise.all([accessToken(deps, ws, account), accessToken(deps, ws, account)]); expect(mock.state.refreshes).toBe(1);
    const a = await db.tikTokAccount.findUniqueOrThrow({ where: { id: account } }); expect(decryptSecret(a.refreshTokenEncrypted, deps.secret)).toBe('REFRESH_SECRET_1');
    await syncAccount(deps, ws, account); await syncAccount(deps, ws, account);
    expect(await db.tikTokVideo.count({ where: { accountId: account } })).toBe(6);
    const v = await db.tikTokVideo.findFirstOrThrow({ where: { accountId: account, externalId: 'v6' }, include: { snapshots: true } }); expect(v.snapshots[0]?.shares).toBeNull();
    const r = await http('GET', `/workspaces/${ws}/tiktok/accounts/${account}/analytics`); expect(r.status).toBe(200); expect(r.json.medianViews).toBe(100);
  });
  it('generates a saved TikTok draft through the shared Gemini provider and blocks unknown analysis evidence', async () => {
    aiOutput = { title: 'ทดสอบไอเดีย', caption: 'คำบรรยายจากข้อมูลแบรนด์', hook: 'เริ่มคลิป', script: 'ฉากหนึ่ง อธิบาย ปิดท้าย CTA', hashtags: ['ทดสอบ'], ideas: [], missingFacts: [] };
    const r = await http('POST', `/workspaces/${ws}/tiktok/accounts/${account}/studio`, { task: 'script', brief: 'คลิปแนะนำแบรนด์' }); expect(r.status, r.text).toBe(200); draft = String(r.json.id);
    expect(aiCalls).toBeGreaterThan(0); expect(geminiHeadersCorrect).toBe(true); expect(r.json.aiProvider).toBe('gemini'); expect(r.json.status).toBe('DRAFT');
    aiOutput = { interpretations: [{ text: 'Unsupported evidence', evidenceVideoIds: ['invented'], confidence: 'high' }], recommendations: [], limitations: ['Mixed ages'] };
    expect((await http('POST', `/workspaces/${ws}/tiktok/accounts/${account}/analyze`, {})).status).toBeGreaterThanOrEqual(400);
    const video = await db.tikTokVideo.findFirstOrThrow({ where: { accountId: account } }); aiOutput = { interpretations: [{ text: 'ข้อมูลตัวอย่างยังน้อย', evidenceVideoIds: [video.id], confidence: 'low' }], recommendations: [], limitations: ['วิดีโอมีอายุต่างกัน'] };
    expect((await http('POST', `/workspaces/${ws}/tiktok/accounts/${account}/analyze`, {})).status).toBe(200);
  });
  it('requires human review and TikTok-specific approval; editing invalidates approval and confirmation', async () => {
    expect((await http('POST', `/workspaces/${ws}/tiktok/content/${draft}/submit`, {})).status).toBe(400);
    expect((await http('POST', `/workspaces/${ws}/content/${draft}/approve`, {})).status).toBe(409);
    expect((await http('POST', `/workspaces/${ws}/tiktok/content/${draft}/submit`, { reviewed: true })).status).toBe(200);
    expect((await http('POST', `/workspaces/${ws}/tiktok/content/${draft}/decision`, { approve: true })).status).toBe(200);
    expect((await http('POST', `/workspaces/${ws}/tiktok/content/${draft}/send`, { confirm: true })).json.status).toBe('DISABLED'); expect(mock.state.inits).toBe(0);
    await lab.update(ws, uid, draft, { title: 'Reviewed', caption: 'Reviewed caption', hook: 'Hook', script: 'Reviewed script', hashtags: [], sourceUrl: 'https://media.example/videos/ready.mp4' }, 'edit');
    expect((await lab.get(ws, draft)).status).toBe('DRAFT'); expect(await db.approvalRequest.count({ where: { contentId: draft, status: 'APPROVED' } })).toBe(0);
    await lab.submit(ws, uid, draft, 'submit'); await lab.decide(ws, uid, draft, true, undefined, 'approve');
  });
  it('uses the shared Gemini adapter for a brand draft without selecting a TikTok account and links its source', async () => {
    aiOutput = { title: 'แปลงร่างตามแบรนด์', caption: 'คำบรรยาย', hook: 'Hook', script: 'Script', hashtags: [], ideas: [], missingFacts: [] };
    const r = await http('POST', `/workspaces/${ws}/tiktok/brands/${brand}/studio`, { task: 'repurpose', brief: 'ปรับร่างเดิมให้สั้น', sourceContentId: draft });
    expect(r.status, r.text).toBe(200); expect(r.json.tiktokAccountId).toBeNull(); expect(r.json.tiktokBrandId).toBe(brand); expect(r.json.aiProvider).toBe('gemini');
    expect(await db.contentRelation.findFirst({ where: { parentContentId: draft, childContentId: String(r.json.id), relationType: 'REPURPOSED_FROM' } })).not.toBeNull();
  });
  it('enforces pause and workspace kill switch, sends once and distinguishes Inbox from publication', async () => {
    deps.publishingEnabled = true;
    await db.tikTokContentMetadata.update({ where: { contentId: draft }, data: { confirmedAt: new Date(), confirmedById: uid } });
    await db.tikTokAccount.update({ where: { id: account }, data: { uploadsPaused: true } }); await expect(uploadContent(deps, ws, draft, 'account-paused')).rejects.toMatchObject({ code: 'automation_paused' }); await db.tikTokAccount.update({ where: { id: account }, data: { uploadsPaused: false } });
    await db.workspace.update({ where: { id: ws }, data: { automationPaused: true } }); await expect(uploadContent(deps, ws, draft, 'paused')).rejects.toMatchObject({ code: 'automation_paused' }); await db.workspace.update({ where: { id: ws }, data: { automationPaused: false } });
    const results = await Promise.all([uploadContent(deps, ws, draft, 'send'), uploadContent(deps, ws, draft, 'duplicate')]); expect(results.some(r => r.status === 'PUBLISH_PENDING')).toBe(true); expect(mock.state.inits).toBe(1);
    expect((await pollContent(deps, ws, draft)).status).toBe('UPLOADED'); expect((await lab.get(ws, draft)).status).toBe('PUBLISHING');
    await expect(lab.update(ws, uid, draft, { title: 'Changed', caption: 'No', hook: '', script: '', hashtags: [], sourceUrl: '' }, 'edit')).rejects.toThrow();
    mock.state.status = 'PUBLISH_COMPLETE'; await db.tikTokContentMetadata.update({ where: { contentId: draft }, data: { lastPolledAt: new Date(0) } }); expect((await pollContent(deps, ws, draft)).status).toBe('PUBLISHED'); expect(mock.state.inits).toBe(1);
  });
  it('schedules Inbox delivery in the selected timezone and safely ignores jobs invalidated by edits', async () => {
    const c = await lab.create(ws, uid, { accountId: account, title: 'Scheduled', caption: 'Caption', script: 'Script', hook: '', hashtags: [], sourceUrl: 'https://media.example/videos/scheduled.mp4' }, 'create');
    await lab.submit(ws, uid, c.id, 'submit'); await lab.decide(ws, uid, c.id, true, undefined, 'approve');
    expect((await http('POST', `/workspaces/${ws}/tiktok/content/${c.id}/send`, { confirm: true, scheduledLocal: '2030-02-31T12:00', timezone: 'Asia/Bangkok' })).status).toBe(400);
    await expect(lab.send(ws, uid, c.id, 'bad-zone', '2030-10-01T12:00', 'Invalid/Zone')).rejects.toThrow();
    const result = await lab.send(ws, uid, c.id, 'schedule', '2030-10-01T12:00', 'Asia/Bangkok'); expect(result?.status).toBe('SCHEDULED');
    expect((await lab.get(ws, c.id)).scheduledAt?.toISOString()).toBe('2030-10-01T05:00:00.000Z');
    const q = lab.queue.tiktok;
    try {
      const job = await q.getJob(`tiktok-${c.id}`); expect(job?.data.contentId).toBe(c.id); expect(await job?.getState()).toBe('delayed');
      const before = mock.state.inits; await expect(uploadContent(deps, ws, c.id, 'early-worker')).rejects.toMatchObject({ code: 'not_due' });
      await lab.update(ws, uid, c.id, { title: 'Edited after scheduling', caption: 'Changed', hook: '', script: 'Changed', hashtags: [], sourceUrl: '' }, 'edit');
      await expect(uploadContent(deps, ws, c.id, 'stale-worker')).rejects.toMatchObject({ code: 'approval_required' }); expect(mock.state.inits).toBe(before);
      await job?.remove();
    } finally { await q.getJob(`tiktok-${c.id}`).then(j => j?.remove()); }
    expect((await http('GET', `/workspaces/${wsB}/tiktok/accounts/${account}/videos`, undefined, otherCookie)).status).toBe(404);
    expect((await http('PATCH', `/workspaces/${wsB}/tiktok/content/${c.id}`, { title: 'Cross tenant' }, otherCookie)).status).toBe(404);
  });
  it('marks expired refresh credentials for reconnection and restores access after a new OAuth grant', async () => {
    await db.tikTokAccount.update({ where: { id: account }, data: { tokenExpiresAt: new Date(0), refreshExpiresAt: new Date(0) } });
    await expect(accessToken(deps, ws, account)).rejects.toMatchObject({ code: 'token_expired' });
    expect((await db.tikTokAccount.findUniqueOrThrow({ where: { id: account } })).status).toBe('RECONNECT_REQUIRED');
    const nonce = await state(); expect((await http('GET', `/tiktok/oauth/callback?state=${nonce}&code=reconnect`)).location).toContain('connected');
    expect((await accessToken(deps, ws, account)).token).toBe('ACCESS_SECRET');
  });
  it('recovers a worker crash as uncertain without repeating the external write', async () => {
    const c = await lab.create(ws, uid, { accountId: account, title: 'Interrupted', caption: 'Caption', script: 'Script', hook: '', hashtags: [], sourceUrl: 'https://media.example/videos/interrupted.mp4' }, 'create');
    await db.contentItem.update({ where: { id: c.id }, data: { status: 'PUBLISHING', updatedAt: new Date(Date.now() - 20 * 60_000), tiktokMeta: { update: { uploadStatus: 'UPLOADING', confirmedAt: new Date(), confirmedById: uid } } } });
    await db.externalOperation.create({ data: { workspaceId: ws, provider: 'TIKTOK', operationType: 'INBOX_UPLOAD', idempotencyKey: `tiktok-inbox-${c.id}`, requestHash: 'test', status: 'PENDING' } });
    const before = mock.state.inits; await reconcileStalledUploads(deps);
    expect((await lab.get(ws, c.id)).tiktokMeta?.uploadStatus).toBe('RECONCILIATION_REQUIRED');
    await expect(uploadContent(deps, ws, c.id, 'crash-retry')).rejects.toMatchObject({ code: 'approval_required' }); expect(mock.state.inits).toBe(before);
  });
  it('does not repeat uncertain writes and removes secrets when disconnecting', async () => {
    const c = await lab.create(ws, uid, { accountId: account, title: 'Uncertain', caption: 'Caption', script: 'Script', hook: '', hashtags: [], sourceUrl: 'https://media.example/videos/uncertain.mp4' }, 'create'); await lab.submit(ws, uid, c.id, 'submit'); await lab.decide(ws, uid, c.id, true, undefined, 'approve');
    await db.tikTokContentMetadata.update({ where: { contentId: c.id }, data: { confirmedAt: new Date(), confirmedById: uid } }); mock.state.failInit = true;
    expect((await uploadContent(deps, ws, c.id, 'uncertain')).status).toBe('RECONCILIATION_REQUIRED'); const before = mock.state.inits;
    await expect(uploadContent(deps, ws, c.id, 'retry')).rejects.toMatchObject({ code: 'approval_required' }); expect(mock.state.inits).toBe(before); mock.state.failInit = false;
    expect((await http('DELETE', `/workspaces/${ws}/tiktok/accounts/${account}`)).status).toBe(200); const a = await db.tikTokAccount.findUniqueOrThrow({ where: { id: account } }); expect(a.accessTokenEncrypted).toBe(''); expect(a.refreshTokenEncrypted).toBe('');
    await expect(accessToken(deps, ws, account)).rejects.toThrow();
  });
});
