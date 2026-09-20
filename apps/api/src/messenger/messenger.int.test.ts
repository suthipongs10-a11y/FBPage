import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, encryptSecret, decryptSecret } from '@fbpm/database';
import { ingestMessenger, messengerEvents, processMessenger, recoverMessenger, startMockMessenger, type MessengerDeps } from '@fbpm/messenger-core';
import { Queue, Worker } from 'bullmq';
import { createApp } from '../app.factory';
import { MessengerService } from './messenger.service';
import { connectionFromUrl } from '../jobs/queue.service';
import { _resetRateLimits } from '../common/rate-limit.guard';
const run = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;
const secret = 'messenger-tests-only-long-encryption-secret';
function client(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    const json = await r.json() as { workspace: { id: string }; user: { id: string }; settings: { validatedAt: string } | null; ai: { provider: string; model: string } | null; text: string; url: string }; return { status: r.status, json };
  };
}
run('Messenger automatic replies (real DB/queue, local Meta/AI fixtures)', () => {
  let app: INestApplication; let db: PrismaClient; let mock: Awaited<ReturnType<typeof startMockMessenger>>; let deps: MessengerDeps;
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>; let base: string; let ws: string; let otherWs: string; let userId: string; let pageId: string; let secondId: string; let brandId: string; let q: Queue;
  const stamp = Date.now(); const fbId = `messenger-${stamp}`; let sequence = 0;
  const config = { enabled: false, instructions: 'ตอบสุภาพและถามข้อมูลให้ครบ', fallbackMessage: 'รับเรื่องแล้วค่ะ ทีมงานจะเข้ามาดูแลต่อค่ะ' };
  const path = (tail: string) => `/workspaces/${ws}/messenger${tail}`;
  function event(psid = `customer-${++sequence}`, text = 'ราคาเท่าไหร่คะ', extra: Record<string, unknown> = {}) { return { object: 'page', entry: [{ id: fbId, messaging: [{ sender: { id: psid }, recipient: { id: fbId }, timestamp: Date.now(), message: { mid: `in-${++sequence}`, text }, ...extra }] }] }; }
  async function incoming(body = event()) { const ids = await ingestMessenger(deps, messengerEvents(body)); expect(ids).toHaveLength(1); return ids[0]!; }
  beforeAll(async () => {
    mock = await startMockMessenger();
    Object.assign(process.env, { APP_ENV: 'test', AUTH_SECRET: secret, META_APP_ID: '123', META_APP_SECRET: 'meta-test-secret', META_WEBHOOK_VERIFY_TOKEN: 'messenger-verify', META_GRAPH_BASE_URL: mock.url, META_OAUTH_REDIRECT_URI: 'http://localhost:4000/facebook/oauth/callback' });
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); a = client(base); b = client(base); db = new PrismaClient();
    const reg = await a('POST', '/auth/register', { email: `messenger-a-${stamp}@test.local`, name: 'Messenger A', password: 'messenger-password-123' }); ws = reg.json.workspace.id; userId = reg.json.user.id;
    otherWs = (await b('POST', '/auth/register', { email: `messenger-b-${stamp}@test.local`, name: 'Messenger B', password: 'messenger-password-123' })).json.workspace.id;
    const c = await db.client.create({ data: { workspaceId: ws, name: 'Chat test' } });
    const brand = await db.brand.create({ data: { clientId: c.id, name: 'ร้านทดสอบ', knowledge: { create: { type: 'price', title: 'ค่าบริการ', content: 'บริการทำความสะอาดเริ่มต้น 900 บาทค่ะ' } } } }); brandId = brand.id;
    const conn = await db.facebookConnection.create({ data: { workspaceId: ws, userId, providerUserId: fbId, encryptedAccessToken: encryptSecret('USER_TOKEN_FIXTURE', secret), scopes: ['pages_messaging'] } });
    pageId = (await db.facebookPage.create({ data: { brandId, connectionId: conn.id, facebookPageId: fbId, name: 'Target page', pageAccessTokenEncrypted: encryptSecret('PAGE_TOKEN_FIXTURE', secret) } })).id;
    secondId = (await db.facebookPage.create({ data: { brandId, connectionId: conn.id, facebookPageId: `${fbId}-disabled`, name: 'Disabled page', pageAccessTokenEncrypted: encryptSecret('SECOND_TOKEN', secret) } })).id;
    deps = { ...app.get(MessengerService).deps, allowAutomaticSend: true }; q = new Queue('messenger', { connection: connectionFromUrl(process.env.REDIS_URL!) });
  }, 30000);
  afterAll(async () => {
    await q?.obliterate({ force: true }); await q?.close(); await app?.close();
    await db?.workspace.deleteMany({ where: { id: { in: [ws, otherWs].filter(Boolean) } } }); await db?.user.deleteMany({ where: { email: { in: [`messenger-a-${stamp}@test.local`, `messenger-b-${stamp}@test.local`] } } }); await db?.$disconnect(); mock?.server.close();
    for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'META_GRAPH_BASE_URL', 'META_OAUTH_REDIRECT_URI']) delete process.env[k];
  });
  it('starts off and stays off until the workspace has an AI key', async () => {
    expect((await a('GET', path('/settings'))).json.settings).toBeNull();
    expect((await a('POST', path(`/pages/${pageId}/preview`), { text: 'hello' })).status).toBe(502);
    expect(mock.state.aiCalls).toHaveLength(0);
    expect((await a('PATCH', path(`/pages/${pageId}`), { ...config, enabled: true })).status).toBe(422);
  });
  it('uses the workspace AI key and never stores or exposes a key of its own', async () => {
    await db.aiProviderKey.create({ data: { workspaceId: ws, provider: 'openai', encryptedApiKey: encryptSecret('WORKSPACE_AI_KEY', secret), baseUrl: `${mock.url}/v1` } });
    await db.aiRoleConfig.create({ data: { workspaceId: ws, role: 'community', provider: 'openai', model: 'mock-chat' } });
    const r = await a('PATCH', path('/settings'), { dailyLimit: 100 }); expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toContain('WORKSPACE_AI_KEY');
    expect(r.json.ai).toMatchObject({ provider: 'openai', model: 'mock-chat' });
    const row = await db.messengerSettings.findUniqueOrThrow({ where: { workspaceId: ws } });
    expect(Object.keys(row)).not.toContain('encryptedApiKey');
    expect(decryptSecret((await db.aiProviderKey.findFirstOrThrow({ where: { workspaceId: ws } })).encryptedApiKey!, secret)).toBe('WORKSPACE_AI_KEY');
    expect(JSON.stringify(await db.auditLog.findMany({ where: { workspaceId: ws } }))).not.toContain('WORKSPACE_AI_KEY');
  });
  it('enforces workspace isolation, permissions and input validation', async () => {
    expect((await b('GET', path('/pages'))).status).toBe(404);
    expect((await b('GET', `/workspaces/${otherWs}/messenger/conversations?pageId=${pageId}`)).status).toBe(404);
    expect((await b('PATCH', `/workspaces/${otherWs}/messenger/pages/${pageId}`, config)).status).toBe(404);
    expect((await a('PATCH', path('/settings'), { dailyLimit: -1 })).status).toBe(400);
    expect((await a('PATCH', path('/settings'), { dailyLimit: 100, apiKey: 'no-private-key-here' })).status).toBe(400);
    const member = await db.user.findFirstOrThrow({ where: { email: `messenger-b-${stamp}@test.local` } });
    await db.workspaceMember.create({ data: { workspaceId: ws, userId: member.id, role: 'viewer' } });
    expect((await b('GET', path('/pages'))).status).toBe(200);
    expect((await b('PATCH', path(`/pages/${pageId}`), config)).status).toBe(403);
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: ws, userId: member.id } } });
  });
  it('previews a knowledge-based answer using the workspace AI key and sends nothing to Meta', async () => {
    expect((await a('PATCH', path(`/pages/${pageId}`), config)).status).toBe(200);
    const r = await a('POST', path(`/pages/${pageId}/preview`), { text: 'ราคาเท่าไหร่คะ' }); expect(r.status).toBe(200); expect(r.json.text).toContain('900');
    expect(mock.state.aiCalls.at(-1)?.key).toBe('Bearer WORKSPACE_AI_KEY'); expect(mock.state.sends).toHaveLength(0);
    expect((await a('GET', path('/settings'))).json.settings?.validatedAt).toBeTruthy();
  });
  it('requests Messenger scope only for the Messenger connect flow; subscribes then enables only target page', async () => {
    const url = (await a('GET', `/workspaces/${ws}/facebook/oauth/start?messenger=true`)).json.url; expect(new URL(url).searchParams.get('scope')).toContain('pages_messaging');
    const old = (await a('GET', `/workspaces/${ws}/facebook/oauth/start`)).json.url; expect(new URL(old).searchParams.get('scope')).not.toContain('pages_messaging');
    expect((await a('POST', path(`/pages/${pageId}/subscribe`))).status).toBe(200);
    expect((await a('PATCH', path(`/pages/${pageId}`), { ...config, enabled: true })).status).toBe(200);
    expect((await db.facebookPage.findUniqueOrThrow({ where: { id: secondId }, include: { messengerConfig: true } })).messengerConfig).toBeNull();
  });
  it('durably rejects invalid signatures and replies through a real queue worker to a signed incoming message', async () => {
    const body = JSON.stringify(event());
    const bad = await fetch(`${base}/facebook/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }, body }); expect(bad.status).toBe(403);
    const worker = new Worker('messenger', job => processMessenger(deps, job.data.conversationId), { connection: connectionFromUrl(process.env.REDIS_URL!), concurrency: 2 });
    try {
      const before = mock.state.sends.length;
      const signature = 'sha256=' + createHmac('sha256', 'meta-test-secret').update(body).digest('hex');
      const ok = await fetch(`${base}/facebook/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body }); expect(ok.status).toBe(200);
      await expect.poll(() => mock.state.sends.length, { timeout: 10000 }).toBe(before + 1);
      expect(mock.state.sends.at(-1)?.text).toContain('900');
    } finally { await worker.close(); }
  }, 15000);
  it('defaults to a durable review draft with zero customer sends, including recovery', async () => {
    const cid = await incoming(); const before = mock.state.sends.length;
    const draftDeps = { ...deps, allowAutomaticSend: undefined };
    expect(await processMessenger(draftDeps, cid)).toEqual({ status: 'DRAFT' });
    expect(mock.state.sends.length).toBe(before);
    expect(await db.messengerMessage.findFirst({ where: { conversationId: cid, direction: 'IN' } })).toMatchObject({ status: 'DRAFT', replyText: expect.any(String), sentAt: null });
    expect(await db.messengerConversation.findUnique({ where: { id: cid } })).toMatchObject({ mode: 'HUMAN', needsAttention: true });
    expect(await recoverMessenger(draftDeps)).not.toContain(cid);
    await processMessenger(draftDeps, cid); expect(mock.state.sends.length).toBe(before);
  });
  it('deduplicates repeated incoming events and concurrent processing', async () => {
    const body = event(); const cid = await incoming(body); await incoming(body);
    const before = mock.state.sends.length; await Promise.all([processMessenger(deps, cid), processMessenger(deps, cid)]);
    await ingestMessenger(deps, messengerEvents(body)); await processMessenger(deps, cid); expect(mock.state.sends.length).toBe(before + 1);
  });
  it('uses recent conversation and keeps other-brand knowledge out', async () => {
    const foreign = await db.brand.create({ data: { clientId: (await db.brand.findUniqueOrThrow({ where: { id: brandId } })).clientId, name: 'Other brand', knowledge: { create: { type: 'price', title: 'secret', content: 'OTHER_BRAND_SECRET_PRICE' } } } });
    const cid = await incoming(event('history-person', 'บริการอะไร')); await processMessenger(deps, cid);
    await incoming(event('history-person', 'แล้วราคาเท่าไหร่')); await processMessenger(deps, cid);
    const prompt = mock.state.aiCalls.at(-1)!.prompt; expect(prompt).toContain('บริการอะไร'); expect(prompt).toContain('assistant'); expect(prompt).not.toContain('OTHER_BRAND_SECRET_PRICE'); await db.brand.delete({ where: { id: foreign.id } });
  });
  it('suppresses a stale reply when a new question arrives while AI is running', async () => {
    const cid = await incoming(event('rapid-person', 'คำถามแรก')); let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; }); mock.state.beforeAi = () => { entered(); return new Promise<void>(r => { release = r; }); };
    const before = mock.state.sends.length; const running = processMessenger(deps, cid); await ready; await incoming(event('rapid-person', 'คำถามใหม่')); release(); await running; mock.state.beforeAi = null;
    expect(mock.state.sends.length).toBe(before); await processMessenger(deps, cid); expect(mock.state.sends.length).toBe(before + 1);
  });
  it('pauses a conversation immediately while AI is thinking, and resumes only for new incoming messages', async () => {
    const cid = await incoming(); let release!: () => void; let entered!: () => void; const ready = new Promise<void>(r => { entered = r; });
    mock.state.beforeAi = () => { entered(); return new Promise<void>(r => { release = r; }); }; const before = mock.state.sends.length; const running = processMessenger(deps, cid); await ready;
    expect((await a('PATCH', path(`/conversations/${cid}/mode`), { mode: 'HUMAN' })).status).toBe(200); release(); await running; mock.state.beforeAi = null;
    expect(mock.state.sends.length).toBe(before); await a('PATCH', path(`/conversations/${cid}/mode`), { mode: 'AUTO' }); await processMessenger(deps, cid); expect(mock.state.sends.length).toBe(before);
  });
  it('answers a clarification and acknowledges a human handoff before pausing', async () => {
    const clarify = await incoming(event(undefined, 'unknown')); await processMessenger(deps, clarify); expect(mock.state.sends.at(-1)?.text).toContain('ประเภทไหน');
    const cid = await incoming(event(undefined, 'ขอคุยกับแอดมิน')); await processMessenger(deps, cid); expect(mock.state.sends.at(-1)?.text).toContain('แอดมิน'); expect((await db.messengerConversation.findUniqueOrThrow({ where: { id: cid } })).mode).toBe('HUMAN');
  });
  it('recognizes own echo, but hands over when an operator replies from Facebook', async () => {
    const cid = await incoming(event('echo-person')); await processMessenger(deps, cid); const sent = mock.state.sends.at(-1)!;
    const echo = (mid: string, metadata?: string) => event('unused', 'สวัสดีค่ะ', { sender: { id: fbId }, recipient: { id: 'echo-person' }, message: { mid, text: 'สวัสดีค่ะ', is_echo: true, app_id: '123', metadata } });
    await ingestMessenger(deps, messengerEvents(echo(sent.mid, sent.metadata))); expect((await db.messengerConversation.findUniqueOrThrow({ where: { id: cid } })).mode).toBe('AUTO');
    await ingestMessenger(deps, messengerEvents(echo('human-message'))); expect((await db.messengerConversation.findUniqueOrThrow({ where: { id: cid } })).mode).toBe('HUMAN');
  });
  it('does not send when workspace paused, page disabled, disconnected, or the window expired', async () => {
    const before = mock.state.sends.length;
    const c1 = await incoming(); await db.workspace.update({ where: { id: ws }, data: { automationPaused: true } }); await processMessenger(deps, c1); await db.workspace.update({ where: { id: ws }, data: { automationPaused: false } });
    const c2 = await incoming(); await db.messengerPageConfig.update({ where: { pageId }, data: { enabled: false } }); await processMessenger(deps, c2); await db.messengerPageConfig.update({ where: { pageId }, data: { enabled: true } });
    const c3 = await incoming(); await db.facebookPage.update({ where: { id: pageId }, data: { disconnectedAt: new Date() } }); await processMessenger(deps, c3); await db.facebookPage.update({ where: { id: pageId }, data: { disconnectedAt: null } });
    const c4 = await incoming(); await db.messengerConversation.update({ where: { id: c4 }, data: { lastCustomerAt: new Date(Date.now() - 25 * 3600000) } }); await processMessenger(deps, c4); expect(mock.state.sends.length).toBe(before);
  });
  it('acknowledges AI outage or invalid evidence without leaking provider errors, then alerts staff', async () => {
    for (const invalid of [false, true]) {
      mock.state.aiError = invalid ? 0 : 429; mock.state.invalidEvidence = invalid;
      const cid = await incoming(); await processMessenger(deps, cid); expect(mock.state.sends.at(-1)?.text).toBe(config.fallbackMessage);
      expect((await db.messengerConversation.findUniqueOrThrow({ where: { id: cid } })).needsAttention).toBe(true);
      expect(await db.notification.count({ where: { workspaceId: ws, resourceId: cid } })).toBe(1);
    } mock.state.aiError = 0; mock.state.invalidEvidence = false;
  });
  it('never retries uncertain sends, including after recovery and webhook replay', async () => {
    mock.state.sendError = 500; const body = event(); const cid = await incoming(body); const before = mock.state.sends.length;
    await processMessenger(deps, cid); await processMessenger(deps, cid); await recoverMessenger(deps); await ingestMessenger(deps, messengerEvents(body));
    expect(mock.state.sends.length).toBe(before + 1); expect((await db.messengerMessage.findFirstOrThrow({ where: { conversationId: cid, direction: 'IN' } })).status).toBe('UNKNOWN'); mock.state.sendError = 0;
  });
  it('recovers interrupted AI work but flags an interrupted send for reconciliation', async () => {
    const cid = await incoming(); const cutoff = new Date(Date.now() - 120000);
    await db.messengerMessage.updateMany({ where: { conversationId: cid }, data: { status: 'GENERATING', processingAt: cutoff } }); expect(await recoverMessenger(deps)).toContain(cid);
    await processMessenger(deps, cid);
    const other = await incoming(); await db.messengerMessage.updateMany({ where: { conversationId: other }, data: { status: 'SENDING', processingAt: cutoff } }); await recoverMessenger(deps); expect((await db.messengerConversation.findUniqueOrThrow({ where: { id: other } })).mode).toBe('HUMAN');
  });
  it('enforces a shared daily AI cap atomically and sends one fallback per affected conversation', async () => {
    const day = new Date().toISOString().slice(0, 10); const usage = await db.messengerDailyUsage.findUniqueOrThrow({ where: { workspaceId_day: { workspaceId: ws, day } } }); await db.messengerSettings.update({ where: { workspaceId: ws }, data: { dailyLimit: usage.requests } });
    const calls = mock.state.aiCalls.length; const cid = await incoming(); await processMessenger(deps, cid); expect(mock.state.aiCalls.length).toBe(calls); expect(mock.state.sends.at(-1)?.text).toBe(config.fallbackMessage);
    await db.messengerSettings.update({ where: { workspaceId: ws }, data: { dailyLimit: 100 } });
  });
  it('reserves only one AI call when two previews compete for the last daily slot', async () => {
    const day = new Date().toISOString().slice(0, 10); const usage = await db.messengerDailyUsage.findUniqueOrThrow({ where: { workspaceId_day: { workspaceId: ws, day } } });
    await db.messengerSettings.update({ where: { workspaceId: ws }, data: { dailyLimit: usage.requests + 1 } }); const before = mock.state.aiCalls.length;
    const results = await Promise.all([a('POST', path(`/pages/${pageId}/preview`), { text: 'ราคา' }), a('POST', path(`/pages/${pageId}/preview`), { text: 'บริการ' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 502]); expect(mock.state.aiCalls.length).toBe(before + 1);
    await db.messengerSettings.update({ where: { workspaceId: ws }, data: { dailyLimit: 100 } });
  });
  it('does not answer an unselected page and does not replay messages received while disabled', async () => {
    await a('PATCH', path(`/pages/${secondId}`), config); const body = event('disabled-customer'); body.entry[0]!.id = `${fbId}-disabled`; body.entry[0]!.messaging[0]!.recipient.id = `${fbId}-disabled`;
    const before = mock.state.sends.length; expect(await ingestMessenger(deps, messengerEvents(body))).toEqual([]);
    await a('PATCH', path(`/pages/${pageId}`), config); const old = event('off-on-customer'); expect(await ingestMessenger(deps, messengerEvents(old))).toEqual([]);
    await a('PATCH', path(`/pages/${pageId}`), { ...config, enabled: true }); expect(await ingestMessenger(deps, messengerEvents(old))).toEqual([]); expect(mock.state.sends.length).toBe(before);
  });
  it('rejects enabling a second brand for the same physical Facebook page', async () => {
    const p = await db.facebookPage.findUniqueOrThrow({ where: { id: pageId } }); const brand = await db.brand.create({ data: { clientId: (await db.brand.findUniqueOrThrow({ where: { id: brandId } })).clientId, name: 'Conflicting brand' } });
    const duplicate = await db.facebookPage.create({ data: { brandId: brand.id, connectionId: p.connectionId, facebookPageId: p.facebookPageId, name: 'Duplicate page', pageAccessTokenEncrypted: p.pageAccessTokenEncrypted, messengerConfig: { create: { subscribedAt: new Date() } } } });
    expect((await a('PATCH', path(`/pages/${duplicate.id}`), { ...config, enabled: true })).status).toBe(409); await db.brand.delete({ where: { id: brand.id } });
  });
  it('stops answering and refuses to be enabled once the workspace AI key is gone', async () => {
    await db.messengerPageConfig.update({ where: { pageId }, data: { enabled: false, revision: { increment: 1 } } });
    await db.aiProviderKey.deleteMany({ where: { workspaceId: ws } });
    expect((await a('GET', path('/settings'))).json.ai).toBeNull();
    const calls = mock.state.aiCalls.length;
    expect((await a('POST', path(`/pages/${pageId}/preview`), { text: 'ราคาเท่าไหร่คะ' })).status).toBe(502);
    expect(mock.state.aiCalls).toHaveLength(calls);
    await db.messengerSettings.update({ where: { workspaceId: ws }, data: { validatedAt: null } });
    expect((await a('PATCH', path(`/pages/${pageId}`), { ...config, enabled: true })).status).toBe(422);
  });
});
