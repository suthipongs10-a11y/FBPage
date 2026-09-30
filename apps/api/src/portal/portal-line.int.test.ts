/** Integration — LINE OA แจ้งเตือน + พอร์ทัลลูกค้า กับ LINE จำลอง / Graph จำลอง (ไม่ยิงของจริง) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, lineInboxDigest, notify, startMockLine } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const run = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie, ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text };
  } };
  return c;
}
const waitFor = async (cond: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 25)); return cond(); };

run('LINE notifications + client portal (integration)', () => {
  let app: INestApplication; let base: string; let db: PrismaClient;
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let line: Awaited<ReturnType<typeof startMockLine>>;
  const stamp = Date.now(); const TEAM = { email: `lp-team-${stamp}@test.local`, name: 'ทีมงาน', password: 'team-password-123' }; const OWNER = { email: `lp-owner-${stamp}@test.local`, name: 'เจ้าของร้าน', password: 'owner-password-123' };
  const SECRET = 'line-channel-secret-for-tests'; const authSecret = 'line-portal-tests-long-encryption-secret';
  let team: ReturnType<typeof client>; let owner: ReturnType<typeof client>; let anon: ReturnType<typeof client>;
  let ws = ''; let clientId = ''; let otherClientId = ''; let pageId = ''; let webhookPath = ''; let ownerMemberId = '';
  const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('base64');
  const hook = (events: unknown[], signature?: string) => { const raw = JSON.stringify({ destination: 'Ubot', events }); return anon.http('POST', webhookPath, raw, { 'x-line-signature': signature ?? sign(raw) }); };
  const textEvent = (userId: string, text: string) => ({ type: 'message', replyToken: `rt-${Math.random()}`, source: { type: 'user', userId }, message: { type: 'text', id: '1', text } });

  beforeAll(async () => {
    graph = await startMockGraph(); line = await startMockLine();
    Object.assign(process.env, { APP_ENV: 'test', AUTH_SECRET: authSecret, META_GRAPH_BASE_URL: graph.url, LINE_API_BASE_URL: line.url, APP_URL: 'https://app.test' });
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    team = client(base); owner = client(base); anon = client(base); db = new PrismaClient();
    ws = (await team.http('POST', '/auth/register', TEAM)).json.workspace.id;
    clientId = (await team.http('POST', `/workspaces/${ws}/clients`, { name: 'ร้านกาแฟดี' })).json.id;
    otherClientId = (await team.http('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้าอีกราย' })).json.id;
    const brand = (await team.http('POST', `/workspaces/${ws}/clients/${clientId}/brands`, { name: 'กาแฟดี' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_PORTAL_TEST');
    const conn = await team.http('POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_PORTAL_TEST' });
    pageId = (await team.http('POST', `/workspaces/${ws}/brands/${brand}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
    expect(pageId).toBeTruthy();
  }, 30_000);
  afterAll(async () => {
    await db?.workspace.deleteMany({ where: { id: ws } }); await db?.user.deleteMany({ where: { email: { in: [TEAM.email, OWNER.email] } } }); await db?.$disconnect();
    await app?.close(); graph?.server.close(); line?.server.close();
    for (const k of ['META_GRAPH_BASE_URL', 'LINE_API_BASE_URL', 'LINE_MAX_PUSH_PER_DAY']) delete process.env[k];
  });

  it('configures the LINE OA only with a token LINE accepts, and never returns the secrets', async () => {
    const bad = await team.http('PUT', `/workspaces/${ws}/line`, { channelSecret: SECRET, accessToken: 'LINE_TOKEN_BAD_xxxxxxxxxxxxxxxx' });
    expect(bad.status).toBe(422);
    line.state.validTokens.add('LINE_TOKEN_OK_LONG_ENOUGH_123');
    const r = await team.http('PUT', `/workspaces/${ws}/line`, { channelSecret: SECRET, accessToken: 'LINE_TOKEN_OK_LONG_ENOUGH_123' });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ configured: true, botBasicId: '@fbpm-test', addFriendUrl: 'https://line.me/R/ti/p/%40fbpm-test' });
    expect(r.text).not.toContain(SECRET); expect(r.text).not.toContain('LINE_TOKEN_OK_LONG_ENOUGH_123');
    webhookPath = new URL(r.json.webhookUrl).pathname.replace(/^\/api/, '');
    const audit = await db.auditLog.findMany({ where: { workspaceId: ws, action: 'LINE_CHANNEL_CONFIGURED' } });
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });

  it('links a team member through a 6-digit code sent in the OA chat; rejects forged webhooks', async () => {
    const code = await team.http('POST', `/workspaces/${ws}/line/link-code`);
    expect(code.status).toBe(200); expect(code.json.code).toMatch(/^\d{6}$/);
    expect((await hook([textEvent('Uteam', code.json.code)], 'Zm9yZ2Vk')).status).toBe(403);
    expect((await anon.http('POST', '/line/webhook/nope', '{}', { 'x-line-signature': 'x' })).status).toBe(404);
    const wrong = await hook([textEvent('Uteam', '000000')]); expect(wrong.json.linked).toBe(0);
    expect(line.state.replies.at(-1)?.text).toMatch(/ไม่ถูกต้อง/);
    const ok = await hook([textEvent('Uteam', `รหัส ${code.json.code}`)]); expect(ok.json.linked).toBe(1);
    expect(line.state.replies.at(-1)?.text).toMatch(/เชื่อมแจ้งเตือนแล้ว/);
    const again = await hook([textEvent('Uteam2', code.json.code)]); expect(again.json.linked).toBe(0);   // ใช้ซ้ำไม่ได้
    const st = await team.http('GET', `/workspaces/${ws}/line`);
    expect(st.json.recipients).toHaveLength(1); expect(st.json.recipients[0]).toMatchObject({ clientId: null, active: true, user: { name: TEAM.name } });
    const t = await team.http('POST', `/workspaces/${ws}/line/test`); expect(t.json.sent).toBe(1);
    expect(line.state.pushes.at(-1)).toMatchObject({ to: 'Uteam' });
  });

  it('invites a business owner who then sees only their own client in the portal', async () => {
    const inv = await team.http('POST', `/workspaces/${ws}/clients/${clientId}/portal/invites`, { email: OWNER.email, canReply: true, canApprove: true });
    expect(inv.status, inv.text).toBe(201); const token = inv.json.url.split('/portal/join/')[1];
    expect((await anon.http('GET', `/portal/invites/${token}`)).json).toMatchObject({ valid: true, clientName: 'ร้านกาแฟดี', email: OWNER.email });
    expect((await owner.http('POST', `/portal/invites/${token}/accept`, { ...OWNER, email: 'other@test.local' })).status).toBe(400);
    const acc = await owner.http('POST', `/portal/invites/${token}/accept`, OWNER);
    expect(acc.status, acc.text).toBe(200); expect(acc.json.clientId).toBe(clientId);
    expect((await anon.http('GET', `/portal/invites/${token}`)).json.valid).toBe(false);   // ใช้ครั้งเดียว
    const me = await owner.http('GET', '/auth/me');
    expect(me.json.workspaces).toHaveLength(0); expect(me.json.portalClients).toEqual([{ id: clientId, name: 'ร้านกาแฟดี', canReply: true, canApprove: true }]);
    // ไม่ใช่สมาชิก workspace → API ของทีมปิดหมด
    expect((await owner.http('GET', `/workspaces/${ws}/clients`)).status).toBe(404);
    expect((await owner.http('GET', `/workspaces/${ws}/comments`)).status).toBe(404);
    expect((await owner.http('GET', `/portal/clients/${otherClientId}`)).status).toBe(404);
    const ov = await owner.http('GET', `/portal/clients/${clientId}`);
    expect(ov.status, ov.text).toBe(200); expect(ov.json).toMatchObject({ preview: false, canReply: true, canApprove: true }); expect(ov.json.pages.map((p: { id: string }) => p.id)).toEqual([pageId]);
    expect(ov.text).not.toMatch(/Encrypted|access_?token|psid/i);
    const members = await team.http('GET', `/workspaces/${ws}/clients/${clientId}/portal`);
    expect(members.json.members).toHaveLength(1); ownerMemberId = members.json.members[0].id;
  });

  it('owner reads and answers comments on their page; the team view of the portal is read-only', async () => {
    expect((await team.http('POST', `/workspaces/${ws}/pages/${pageId}/comments/sync`, { days: 30 })).status).toBe(200);
    const list = await owner.http('GET', `/portal/clients/${clientId}/comments`);
    expect(list.status).toBe(200); expect(list.json.length).toBeGreaterThan(0);
    const target = list.json[0];
    const preview = await team.http('GET', `/portal/clients/${clientId}`); expect(preview.json.preview).toBe(true);
    expect((await team.http('POST', `/portal/clients/${clientId}/comments/${target.id}/reply`, { message: 'ขอบคุณค่ะ' })).status).toBe(403);
    const r = await owner.http('POST', `/portal/clients/${clientId}/comments/${target.id}/reply`, { message: 'ขอบคุณค่ะ ทักแชทได้เลย' });
    expect(r.status, r.text).toBe(200); expect(graph.state.replies).toHaveLength(1);
    expect((await owner.http('GET', `/portal/clients/${clientId}/comments`)).json.find((c: { id: string }) => c.id === target.id)).toBeUndefined();
    const audit = await db.auditLog.findFirst({ where: { workspaceId: ws, action: 'comments.reply', resourceId: target.id } }); expect(audit?.userId).toBe((await owner.http('GET', '/auth/me')).json.user.id);
    // ถอดสิทธิ์ตอบ → 403
    await team.http('PATCH', `/workspaces/${ws}/clients/${clientId}/portal/members/${ownerMemberId}`, { canReply: false });
    const other = (await owner.http('GET', `/portal/clients/${clientId}/comments`)).json[0];
    expect((await owner.http('POST', `/portal/clients/${clientId}/comments/${other.id}/reply`, { message: 'x' })).status).toBe(403);
    await team.http('PATCH', `/workspaces/${ws}/clients/${clientId}/portal/members/${ownerMemberId}`, { canReply: true });
  });

  it('owner sees chats but cannot send outside the 24h window', async () => {
    const conv = await db.messengerConversation.create({ data: { pageId, psid: 'PSID_SECRET_1', lastCustomerAt: new Date(Date.now() - 30 * 3_600_000), needsAttention: true, messages: { create: { externalId: 'm1', direction: 'IN', text: 'มีโต๊ะว่างไหมคะ', occurredAt: new Date(), status: 'SKIPPED' } } } });
    const list = await owner.http('GET', `/portal/clients/${clientId}/conversations`);
    expect(list.json[0]).toMatchObject({ id: conv.id, needsAttention: true, last: { text: 'มีโต๊ะว่างไหมคะ' } });
    const detail = await owner.http('GET', `/portal/clients/${clientId}/conversations/${conv.id}`);
    expect(detail.json.messages).toHaveLength(1); expect(detail.text).not.toContain('PSID_SECRET_1');
    expect((await owner.http('POST', `/portal/clients/${clientId}/conversations/${conv.id}/send`, { text: 'ว่างค่ะ' })).status).toBe(422);
  });

  it('owner approves or requests changes; the team is told on LINE', async () => {
    const mk = (title: string) => db.contentItem.create({ data: { pageId, title, caption: `${title} caption`, status: 'READY_FOR_APPROVAL' } });
    const [a1, a2] = [await mk('โปรเช้า'), await mk('เมนูใหม่')];
    const other = await db.contentItem.create({ data: { platform: 'YOUTUBE', title: 'ไม่ใช่ของพอร์ทัล', status: 'READY_FOR_APPROVAL' } });
    const list = await owner.http('GET', `/portal/clients/${clientId}/approvals`);
    expect(list.json.map((c: { id: string }) => c.id).sort()).toEqual([a1.id, a2.id].sort());
    expect((await owner.http('POST', `/portal/clients/${clientId}/approvals/${other.id}/approve`, {})).status).toBe(404);
    expect((await owner.http('POST', `/portal/clients/${clientId}/approvals/${a2.id}/request-changes`, {})).status).toBe(400);   // ต้องบอกว่าแก้อะไร
    const before = line.state.pushes.length;
    const ok = await owner.http('POST', `/portal/clients/${clientId}/approvals/${a1.id}/approve`, {});
    expect(ok.status, ok.text).toBe(200); expect(ok.json.status).toBe('APPROVED');
    const ch = await owner.http('POST', `/portal/clients/${clientId}/approvals/${a2.id}/request-changes`, { comment: 'ขอราคาใหญ่ขึ้น' });
    expect(ch.json.status).toBe('NEEDS_REVISION');
    expect(await waitFor(() => line.state.pushes.length >= before + 2)).toBe(true);
    const texts = line.state.pushes.slice(before).map(p => p.text).join('\n');
    expect(texts).toMatch(/\[ร้านกาแฟดี\] ลูกค้าอนุมัติแล้ว: โปรเช้า/); expect(texts).toMatch(/ลูกค้าขอแก้: เมนูใหม่[\s\S]*ขอราคาใหญ่ขึ้น/);
    await db.contentItem.delete({ where: { id: other.id } });
  });

  it('owner links LINE and gets only their business events, with a portal link; daily cap holds', async () => {
    expect((await team.http('POST', `/portal/clients/${clientId}/line/link-code`)).status).toBe(409);   // ทีม = มุมมองอ่านอย่างเดียว
    const code = await owner.http('POST', `/portal/clients/${clientId}/line/link-code`); expect(code.status).toBe(200);
    expect((await hook([textEvent('Uowner', code.json.code)])).json.linked).toBe(1);
    const mine = await owner.http('GET', `/portal/clients/${clientId}/line`);
    expect(mine.json.recipients).toHaveLength(1);
    expect((await owner.http('PATCH', `/portal/clients/${clientId}/line/recipients/${mine.json.recipients[0].id}`, { types: ['ai_budget'] })).status).toBe(400);
    const before = line.state.pushes.length;
    await notify(db, authSecret, ws, { type: 'hot_lead', severity: 'warn', title: 'ลีดร้อน: จองโต๊ะ 10 คน', resourceType: 'client', resourceId: clientId });
    await notify(db, authSecret, ws, { type: 'ai_budget', severity: 'warn', title: 'งบ AI ใกล้หมด' });
    await notify(db, authSecret, ws, { type: 'hot_lead', title: 'ลีดของอีกร้าน', resourceType: 'client', resourceId: otherClientId });
    expect(await waitFor(() => line.state.pushes.length >= before + 4)).toBe(true);
    await new Promise(r => setTimeout(r, 150));
    const got = line.state.pushes.slice(before);
    const toOwner = got.filter(p => p.to === 'Uowner'); const toTeam = got.filter(p => p.to === 'Uteam');
    expect(toOwner).toHaveLength(1); expect(toOwner[0]!.text).toContain(`https://app.test/portal/${clientId}?tab=leads`); expect(toOwner[0]!.text).not.toContain('[ร้านกาแฟดี]');
    const teamText = toTeam.map(p => p.text).join('\n');   // ส่งแบบ async ลำดับไม่แน่นอน
    for (const re of [/\[ร้านกาแฟดี\] ลีดร้อน/, /งบ AI ใกล้หมด/, /\[ลูกค้าอีกราย\] ลีดของอีกร้าน/]) expect(teamText).toMatch(re);
    // เพดานต่อวัน
    const sentToday = await db.lineDelivery.count({ where: { workspaceId: ws, status: 'SENT', recipientId: mine.json.recipients[0].id } });
    process.env.LINE_MAX_PUSH_PER_DAY = String(sentToday);
    const n = line.state.pushes.length;
    await notify(db, authSecret, ws, { type: 'hot_lead', title: 'เกินเพดาน', resourceType: 'client', resourceId: clientId });
    await waitFor(() => false, 300);
    expect(line.state.pushes.slice(n).filter(p => p.to === 'Uowner')).toHaveLength(0);
    expect(await db.lineDelivery.count({ where: { recipientId: mine.json.recipients[0].id, status: 'SKIPPED', error: 'daily_cap' } })).toBe(1);
    delete process.env.LINE_MAX_PUSH_PER_DAY;
  });

  it('sends one inbox digest per new activity (owner + combined team), nothing when quiet', async () => {
    await db.client.update({ where: { id: clientId }, data: { inboxDigestAt: new Date(Date.now() - 3_600_000) } });
    await db.client.update({ where: { id: otherClientId }, data: { inboxDigestAt: new Date() } });
    await db.messengerMessage.create({ data: { conversation: { connect: { pageId_psid: { pageId, psid: 'PSID_SECRET_1' } } }, externalId: 'm2', direction: 'IN', text: 'จองได้ไหม', occurredAt: new Date(), status: 'SKIPPED' } });
    const before = line.state.pushes.length;
    const r = await lineInboxDigest(db, authSecret, { ignoreQuietHours: true });
    expect(r.sent).toBe(2);
    const got = line.state.pushes.slice(before);
    const own = got.find(p => p.to === 'Uowner')!; const tm = got.find(p => p.to === 'Uteam')!;
    expect(own.text).toMatch(/ร้านกาแฟดี: มีความเคลื่อนไหวใหม่/); expect(own.text).toMatch(/ข้อความแชทใหม่ 2 จาก 1 คน/); expect(own.text).toContain(`/portal/${clientId}?tab=inbox`);
    expect(tm.text).toMatch(/\[ร้านกาแฟดี\]/); expect(tm.text).not.toMatch(/ลูกค้าอีกราย/);
    expect((await lineInboxDigest(db, authSecret, { ignoreQuietHours: true })).sent).toBe(0);
    expect((await lineInboxDigest(db, authSecret, { now: new Date('2026-09-30T16:30:00Z') })).skippedQuiet).toBeGreaterThanOrEqual(1);   // 23:30 น. เวลาไทย
  });

  it('unfollow deactivates; removing the owner revokes portal access and their LINE link', async () => {
    await hook([{ type: 'unfollow', source: { type: 'user', userId: 'Uteam' } }]);
    expect((await db.lineRecipient.findFirst({ where: { workspaceId: ws, lineUserId: 'Uteam' } }))?.active).toBe(false);
    expect((await team.http('DELETE', `/workspaces/${ws}/clients/${clientId}/portal/members/${ownerMemberId}`)).status).toBe(200);
    expect((await owner.http('GET', `/portal/clients/${clientId}`)).status).toBe(404);
    expect(await db.lineRecipient.count({ where: { workspaceId: ws, clientId } })).toBe(0);
    expect((await owner.http('GET', '/auth/me')).json.portalClients).toEqual([]);
  });
});
