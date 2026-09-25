/** Integration — comments/leads (§23, §24, §33) + notifications (§65) กับ mock Graph / mock AI / mock webhook receiver */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { startMockAi } from '@fbpm/ai-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text };
  } };
  return c;
}

run('comments + leads + notifications (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient; let graph: Awaited<ReturnType<typeof startMockGraph>>; let ai: Awaited<ReturnType<typeof startMockAi>>;
  let hook: Server; let hookUrl = ''; const received: unknown[] = [];
  const stamp = Date.now(); const A = { email: `cm-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  let a: ReturnType<typeof client>; let ws = ''; let pageA = '';
  beforeAll(async () => {
    graph = await startMockGraph(); ai = await startMockAi();
    hook = createServer(async (req, res) => { let b = ''; for await (const ch of req) b += ch; received.push(JSON.parse(b)); res.writeHead(204); res.end(); });
    await new Promise<void>(r => hook.listen(0, '127.0.0.1', r)); hookUrl = `http://127.0.0.1:${(hook.address() as { port: number }).port}/hook`;
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars'; process.env.META_GRAPH_BASE_URL = graph.url;
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้า CM' });
    const brand = (await a.http('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'ระเบียงบุญ', primaryCTA: 'ทักแชท' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_COMMENTS_TEST');
    const conn = await a.http('POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_COMMENTS_TEST' });
    pageA = (await a.http('POST', `/workspaces/${ws}/brands/${brand}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
    const aiConn = (await a.http('POST', `/workspaces/${ws}/ai/connections`, { preset: 'custom', label: 'Mock AI', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['m-community', 'm-fast'] })).json.id;
    await a.http('PUT', `/workspaces/${ws}/ai/roles`, { roles: { community: { connectionId: aiConn, model: 'm-community' }, fast: { connectionId: aiConn, model: 'm-fast' } } });
  }, 30_000);
  afterAll(async () => { delete process.env.META_GRAPH_BASE_URL; await prisma.workspace.deleteMany({ where: { id: ws } }); await prisma.user.deleteMany({ where: { email: A.email } }); await prisma.$disconnect(); await app.close(); graph.server.close(); ai.server.close(); hook.close(); });

  it('without permission: sync reports NO_PERMISSION honestly (422) and raises a notification', async () => {
    graph.state.denyComments = true;
    const r = await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comments/sync`, {});
    expect(r.status).toBe(422); expect(r.json.message).toMatch(/pages_read_user_content/);
    expect((await a.http('GET', `/workspaces/${ws}/pages/${pageA}`)).json.commentsStatus).toBe('NO_PERMISSION');
    const n = await a.http('GET', `/workspaces/${ws}/notifications`);
    expect(n.json.items.some((x: { type: string }) => x.type === 'comments_permission')).toBe(true);
    graph.state.denyComments = false;
  });

  it('syncs comments from posts and classifies them with lead detection, drafts replies, never auto-sends at APPROVAL_REQUIRED', async () => {
    graph.state.denyComments = false;
    const r = await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comments/sync`, { days: 30 });
    expect(r.status, r.text).toBe(200); expect(r.json.imported).toBe(3);
    const list = await a.http('GET', `/workspaces/${ws}/comments?pageId=${pageA}&unclassified=1`); expect(list.json).toHaveLength(3);
    const ids = Object.fromEntries(list.json.map((c: { facebookCommentId: string; id: string }) => [c.facebookCommentId, c.id]));
    ai.state.replies.push({ text: JSON.stringify({ comments: [
      { id: ids.c1, classification: 'PRICE_QUERY', sentiment: 'neutral', risk: false, summary: 'ถามราคา 30 คน', draftReply: 'สวัสดีค่ะ ราคาขึ้นกับรูปแบบงาน ทักแชทเพื่อรับใบเสนอราคาได้เลยค่ะ', lead: { intent: 'จัดงาน', product: null, service: 'จัดงานบุญ', quantity: '30', requestedDate: '2026-09-18', location: null, budget: null, phone: null, urgency: 'high', leadScore: 88, confidence: 0.9 } },
      { id: ids.c2, classification: 'PRAISE', sentiment: 'positive', risk: false, summary: 'ชม', draftReply: 'ขอบคุณมากค่ะ', lead: null },
      { id: ids.c3, classification: 'SPAM', sentiment: 'neutral', risk: false, summary: 'สแปม', draftReply: null, lead: null },
    ] }) });
    const cl = await a.http('POST', `/workspaces/${ws}/comments/classify`, { pageId: pageA });
    expect(cl.status, cl.text).toBe(200); expect(cl.json.classified).toBe(3); expect(cl.json.leads).toBe(1); expect(cl.json.autoReplied).toBe(0);
    const c1 = cl.json.items.find((x: { facebookCommentId: string }) => x.facebookCommentId === 'c1');
    expect(c1.classification).toBe('PRICE_QUERY'); expect(c1.replyStatus).toBe('DRAFTED'); expect(c1.lead.leadScore).toBe(88);
    expect(cl.json.items.find((x: { facebookCommentId: string }) => x.facebookCommentId === 'c3').replyStatus).toBe('SKIPPED');
    expect(graph.state.replies).toHaveLength(0);   // ไม่ส่งเอง
    const leads = await a.http('GET', `/workspaces/${ws}/leads`); expect(leads.json).toHaveLength(1); expect(leads.json[0].service).toBe('จัดงานบุญ'); expect(leads.json[0].phone).toBeNull(); expect(leads.json[0].name).toBe('สมศรี');
    const n = await a.http('GET', `/workspaces/${ws}/notifications?unread=1`); expect(n.json.items.some((x: { type: string }) => x.type === 'hot_lead')).toBe(true);
    const ins = await a.http('GET', `/workspaces/${ws}/comments/insights?pageId=${pageA}&days=30`);
    expect(ins.json.total).toBe(3); expect(ins.json.recommendations.join(' ')).toMatch(/FAQ ราคา/); expect(ins.json.leadsNew).toBe(1);
  });

  it('human edits the draft and sends it; hide works; permission failure reported clearly', async () => {
    const c1 = (await a.http('GET', `/workspaces/${ws}/comments?pageId=${pageA}&classification=PRICE_QUERY`)).json[0];
    const upd = await a.http('PATCH', `/workspaces/${ws}/comments/${c1.id}`, { draftReply: 'สวัสดีค่ะ ทักแชทมาได้เลยนะคะ' });
    expect(upd.json.replyStatus).toBe('APPROVED');
    const sent = await a.http('POST', `/workspaces/${ws}/comments/${c1.id}/reply`, {});
    expect(sent.status, sent.text).toBe(200); expect(sent.json.replyStatus).toBe('SENT'); expect(sent.json.resolvedAt).toBeTruthy();
    expect(graph.state.replies.at(-1)!.body.message).toBe('สวัสดีค่ะ ทักแชทมาได้เลยนะคะ');
    expect((await a.http('POST', `/workspaces/${ws}/comments/${c1.id}/reply`, {})).status).toBe(409);
    const spam = (await a.http('GET', `/workspaces/${ws}/comments?pageId=${pageA}&classification=SPAM`)).json[0];
    expect((await a.http('POST', `/workspaces/${ws}/comments/${spam.id}/hide`, {})).json.isHidden).toBe(true);
    graph.state.denyComments = true;
    const praise = (await a.http('GET', `/workspaces/${ws}/comments?pageId=${pageA}&classification=PRAISE`)).json[0];
    const fail = await a.http('POST', `/workspaces/${ws}/comments/${praise.id}/reply`, {});
    expect(fail.status).toBe(422); expect(fail.json.message).toMatch(/pages_manage_engagement/);
    graph.state.denyComments = false;
    const lead = (await a.http('GET', `/workspaces/${ws}/leads`)).json[0];
    expect((await a.http('PATCH', `/workspaces/${ws}/leads/${lead.id}`, { status: 'CONTACTED', notes: 'โทรแล้ว' })).json.status).toBe('CONTACTED');
  });

  it('FULL_AUTO page auto-replies safe classes only; risky/complaint stays for humans', async () => {
    await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}`, { automationLevel: 'FULL_AUTO' });
    graph.state.comments['111_2'] = [{ id: 'c4', message: 'ไปถึงภูเก็ตไหม', created_time: new Date().toISOString(), from: { id: 'u_d', name: 'ดำ' } }, { id: 'c5', message: 'บริการห่วยมาก จะฟ้อง', created_time: new Date().toISOString(), from: { id: 'u_e', name: 'เอ' } }];
    await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comments/sync`, { days: 30 });
    const list = await a.http('GET', `/workspaces/${ws}/comments?pageId=${pageA}&unclassified=1`);
    const ids = Object.fromEntries(list.json.map((c: { facebookCommentId: string; id: string }) => [c.facebookCommentId, c.id]));
    ai.state.replies.push({ text: JSON.stringify({ comments: [
      { id: ids.c4, classification: 'LOCATION_QUERY', sentiment: 'neutral', risk: false, summary: 'ถามพื้นที่', draftReply: 'ไปถึงทั่วภูเก็ตค่ะ', lead: { intent: 'สอบถาม', service: null, product: null, quantity: null, requestedDate: null, location: 'ภูเก็ต', budget: null, phone: null, urgency: null, leadScore: 45, confidence: 0.6 } },
      { id: ids.c5, classification: 'COMPLAINT', sentiment: 'negative', risk: true, summary: 'ร้องเรียนรุนแรง', draftReply: 'ขออภัยค่ะ ทีมงานจะติดต่อกลับทันที', lead: null },
    ] }) });
    const before = graph.state.replies.length;
    const cl = await a.http('POST', `/workspaces/${ws}/comments/classify`, { pageId: pageA });
    expect(cl.json.autoReplied).toBe(1); expect(graph.state.replies.length).toBe(before + 1);
    const c5 = cl.json.items.find((x: { facebookCommentId: string }) => x.facebookCommentId === 'c5');
    expect(c5.replyStatus).toBe('DRAFTED'); expect(c5.riskFlag).toBe(true);
    const audit = await prisma.auditLog.count({ where: { workspaceId: ws, action: 'comments.reply.auto' } }); expect(audit).toBe(1);
    await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}`, { automationLevel: 'APPROVAL_REQUIRED' });
  });

  it('notifications: webhook out receives events; mark read; dedupe re-surfaces instead of duplicating', async () => {
    const set = await a.http('PUT', `/workspaces/${ws}/notifications/webhook`, { url: hookUrl });
    expect(set.json.configured).toBe(true); expect(set.json.hint).toContain('127.0.0.1'); expect(set.text).not.toContain('Encrypted');
    const test = await a.http('POST', `/workspaces/${ws}/notifications/webhook/test`, {}); expect(test.json.ok).toBe(true);
    expect((received.at(-1) as { title: string }).title).toMatch(/ทดสอบ/);
    const cid = (await a.http('POST', `/workspaces/${ws}/content`, { pageId: pageA, title: 'แจ้งเตือน', caption: 'x' })).json.id;
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    await a.http('POST', `/workspaces/${ws}/content/${cid}/submit`, {});
    await new Promise(r => setTimeout(r, 200));
    expect(received.some(x => (x as { type: string }).type === 'approval_required')).toBe(true);
    const n1 = await a.http('GET', `/workspaces/${ws}/notifications`);
    const appr = n1.json.items.filter((x: { type: string }) => x.type === 'approval_required'); expect(appr).toHaveLength(1);
    await a.http('POST', `/workspaces/${ws}/notifications/${appr[0].id}/read`, {});
    expect((await a.http('GET', `/workspaces/${ws}/notifications?unread=1`)).json.items.some((x: { id: string }) => x.id === appr[0].id)).toBe(false);
    await a.http('POST', `/workspaces/${ws}/content/${cid}/request-changes`, { comment: 'แก้' }); await a.http('PATCH', `/workspaces/${ws}/content/${cid}`, { caption: 'y' });
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    await a.http('POST', `/workspaces/${ws}/content/${cid}/submit`, {});
    const n2 = await a.http('GET', `/workspaces/${ws}/notifications`);
    expect(n2.json.items.filter((x: { type: string }) => x.type === 'approval_required')).toHaveLength(1);   // dedupe
    expect(n2.json.unread).toBeGreaterThan(0);
    expect((await a.http('POST', `/workspaces/${ws}/notifications/read-all`, {})).json.ok).toBe(true);
    expect((await a.http('GET', `/workspaces/${ws}/notifications`)).json.unread).toBe(0);
    await a.http('PUT', `/workspaces/${ws}/notifications/webhook`, { url: null });
  });
});
