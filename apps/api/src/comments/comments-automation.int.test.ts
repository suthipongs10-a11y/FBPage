/**
 * Integration — ไลค์คอมเมนต์ / ส่งรายละเอียดเข้าอินบ็อกซ์จากคอมเมนต์ (private reply) / ดูแลคอมเมนต์อัตโนมัติต่อเพจ
 * mock Graph + mock AI — ไม่แตะเพจจริง
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { startMockAi } from '@fbpm/ai-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';
import { CommentAutomationService } from './automation.service';

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
const J = (v: unknown) => ({ text: JSON.stringify(v) });
const cls = (id: string, classification: string, o: Record<string, unknown> = {}) => ({ id, classification, sentiment: 'neutral', risk: false, summary: 's', draftReply: null, privateReply: null, lead: null, ...o });

run('comment engagement + automation (integration)', () => {
  let app: INestApplication; let prisma: PrismaClient;
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let ai: Awaited<ReturnType<typeof startMockAi>>;
  const stamp = Date.now();
  const A = { email: `cma-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `cma-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>; let ws = ''; let wsB = ''; let pageA = '';
  const idOf = async (fbId: string) => (await prisma.pageComment.findFirstOrThrow({ where: { pageId: pageA, facebookCommentId: fbId } })).id;

  beforeAll(async () => {
    graph = await startMockGraph(); ai = await startMockAi();
    Object.assign(process.env, { APP_ENV: 'test', META_GRAPH_BASE_URL: graph.url });
    process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${ws}/clients`, { name: 'ร้านค้า' });
    const brand = (await a.http('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'ร้านเสื้อ', primaryCTA: 'ทักแชท' })).json.id;
    await a.http('POST', `/workspaces/${ws}/brands/${brand}/knowledge`, { type: 'price', title: 'เสื้อยืด', content: 'ตัวละ 290 บาท ส่งฟรีเมื่อซื้อ 3 ตัว' });
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_CMA');
    const conn = await a.http('POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_CMA' });
    pageA = (await a.http('POST', `/workspaces/${ws}/brands/${brand}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
    const aiConn = (await a.http('POST', `/workspaces/${ws}/ai/connections`, { preset: 'custom', label: 'Mock AI', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['m'] })).json.id;
    await a.http('PUT', `/workspaces/${ws}/ai/roles`, { roles: { community: { connectionId: aiConn, model: 'm' } } });
    // คอมเมนต์ของเพจเอง (คำตอบเก่า) ต้องไม่ถูกส่งให้ AI/ตอบ/ไลค์
    graph.state.comments['111_1']!.push({ id: 'c0', message: 'ขอบคุณค่ะ', created_time: new Date().toISOString(), from: { id: '111', name: 'ระเบียงบุญ' } });
  }, 30_000);
  afterAll(async () => {
    delete process.env.META_GRAPH_BASE_URL;
    await prisma.workspace.deleteMany({ where: { id: { in: [ws, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); graph.server.close(); ai.server.close();
  });

  it('จำแนก → ร่างข้อความส่งแชทเฉพาะคนสนใจซื้อ · คอมเมนต์ของเพจเองไม่ถูกส่งให้ AI', async () => {
    expect((await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comments/sync`, { days: 30 })).status).toBe(200);
    const [c1, c2, c3] = await Promise.all(['c1', 'c2', 'c3'].map(idOf)) as [string, string, string];
    ai.state.replies.push(J({ comments: [
      cls(c1, 'PRICE_QUERY', { draftReply: 'ทักแชทได้เลยค่ะ', privateReply: 'สวัสดีค่ะคุณสมศรี เสื้อยืดตัวละ 290 บาท ส่งฟรีเมื่อซื้อ 3 ตัวค่ะ ต้องการไซซ์ไหนคะ?', lead: { intent: 'ซื้อ', leadScore: 80, confidence: 0.9 } }),
      cls(c2, 'PRAISE', { sentiment: 'positive', draftReply: 'ขอบคุณค่ะ', privateReply: 'ไม่ควรส่ง' }),
      cls(c3, 'SPAM'),
    ] }));
    const r = await a.http('POST', `/workspaces/${ws}/comments/classify`, { pageId: pageA });
    expect(r.status, r.text).toBe(200); expect(r.json.classified).toBe(3);
    expect(JSON.stringify(ai.state.requests.at(-1)!.messages)).not.toContain('"c0"');
    const own = await prisma.pageComment.findFirstOrThrow({ where: { pageId: pageA, facebookCommentId: 'c0' } });
    expect(own).toMatchObject({ classification: 'OTHER', replyStatus: 'SKIPPED' });
    expect(await prisma.pageComment.findUniqueOrThrow({ where: { id: c1 } })).toMatchObject({ privateReplyStatus: 'DRAFTED' });
    expect(await prisma.pageComment.findUniqueOrThrow({ where: { id: c2 } })).toMatchObject({ privateReplyStatus: 'NONE', privateReplyText: null });
    expect(graph.state.replies).toHaveLength(0); expect(graph.state.privateReplies).toHaveLength(0);   // ยังไม่มีอะไรถูกส่ง
  });

  it('คนกด: ไลค์ (ซ้ำไม่ยิงซ้ำ) · ส่งแชท + ตอบใต้คอมเมนต์ว่าส่งแล้ว · ส่งซ้ำ = 409 · ไม่มีสิทธิ์ pages_messaging = 422 บอกเหตุ', async () => {
    const [c1, c2, c3] = await Promise.all(['c1', 'c2', 'c3'].map(idOf)) as [string, string, string];
    const lk = await a.http('POST', `/workspaces/${ws}/comments/${c2}/like`, {});
    expect(lk.status).toBe(200); expect(lk.json.likedAt).toBeTruthy();
    await a.http('POST', `/workspaces/${ws}/comments/${c2}/like`, {});
    expect(graph.state.likes).toEqual(['c2']);

    const dm = await a.http('POST', `/workspaces/${ws}/comments/${c1}/private-reply`, {});
    expect(dm.status, dm.text).toBe(200);
    expect(graph.state.privateReplies).toEqual([{ pageId: '111', commentId: 'c1', text: expect.stringContaining('290 บาท') }]);
    expect(dm.json.comment).toMatchObject({ privateReplyStatus: 'SENT', replyStatus: 'SENT' });
    expect(graph.state.replies.at(-1)).toMatchObject({ commentId: 'c1', body: { message: expect.stringContaining('ส่งรายละเอียดให้ทางแชทแล้ว') } });
    expect((await a.http('POST', `/workspaces/${ws}/comments/${c1}/private-reply`, {})).status).toBe(409);
    expect((await a.http('PATCH', `/workspaces/${ws}/comments/${c1}`, { privateReplyText: 'แก้' })).status).toBe(409);

    graph.state.denyMessaging = true;
    const fail = await a.http('POST', `/workspaces/${ws}/comments/${c3}/private-reply`, { message: 'ลองส่ง', publicAck: null });
    expect(fail.status).toBe(422); expect(fail.json.message).toContain('pages_messaging');
    expect(await prisma.pageComment.findUniqueOrThrow({ where: { id: c3 } })).toMatchObject({ privateReplyStatus: 'FAILED' });
    graph.state.denyMessaging = false;
    expect((await b.http('POST', `/workspaces/${wsB}/comments/${c1}/like`, {})).status).toBe(404);
  });

  it('อัตโนมัติ: เปิดแล้วทำเฉพาะคอมเมนต์ใหม่ · ถามราคา = ส่งแชท+ตอบว่าส่งแล้ว+ไลค์ · ชม = ตอบ+ไลค์ · ร้องเรียน/เสี่ยง = ไม่แตะ · รอบถัดไปไม่ทำซ้ำ', async () => {
    const off = await a.http('GET', `/workspaces/${ws}/pages/${pageA}/comment-automation`);
    expect(off.json).toMatchObject({ enabled: false, autoLike: false, autoReply: false, autoPrivateReply: false });
    const on = await a.http('PUT', `/workspaces/${ws}/pages/${pageA}/comment-automation`, { enabled: true, autoLike: true, autoReply: true, autoPrivateReply: true, publicAckText: 'ส่งราคาทางแชทแล้วนะคะ 💬' });
    expect(on.status).toBe(200); expect(on.json.enabledAt).toBeTruthy();
    const later = new Date(Date.now() + 5000).toISOString();
    graph.state.comments['111_2'] = [
      { id: 'c6', message: 'ราคาเท่าไหร่ครับ สนใจ 3 ตัว', created_time: later, from: { id: 'u6', name: 'หก' } },
      { id: 'c7', message: 'เสื้อสวยมาก', created_time: later, from: { id: 'u7', name: 'เจ็ด' } },
      { id: 'c8', message: 'ของไม่ตรงปก โกง', created_time: later, from: { id: 'u8', name: 'แปด' } },
      { id: 'c9', message: 'คอมเมนต์เก่าก่อนเปิดระบบ', created_time: new Date(Date.now() - 3_600_000).toISOString(), from: { id: 'u9', name: 'เก้า' } },
    ];
    await prisma.pageComment.updateMany({ where: { pageId: pageA }, data: { autoHandledAt: new Date() } });   // ของเดิมถือว่าจัดการแล้ว
    // ซิงก์ก่อนเพื่อรู้ id แล้วเตรียมคำตอบ AI (AI จะเห็นแค่คอมเมนต์ใหม่หลังเปิด c6–c8)
    await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comments/sync`, { days: 30 });
    const [c6, c7, c8, c9] = await Promise.all(['c6', 'c7', 'c8', 'c9'].map(idOf)) as [string, string, string, string];
    ai.state.replies.push(J({ comments: [
      cls(c6, 'PRICE_QUERY', { draftReply: 'ทักแชทนะคะ', privateReply: 'สวัสดีค่ะ เสื้อยืด 290 บาท ซื้อ 3 ตัวส่งฟรีค่ะ รับไซซ์ไหนดีคะ', lead: { intent: 'ซื้อ 3 ตัว', leadScore: 85, confidence: 0.9 } }),
      cls(c7, 'PRAISE', { sentiment: 'positive', draftReply: 'ขอบคุณมากค่ะ 🥰' }),
      cls(c8, 'COMPLAINT', { sentiment: 'negative', risk: true, draftReply: 'ขออภัยค่ะ' }),
    ] }));
    const beforeReplies = graph.state.replies.length; const beforeDm = graph.state.privateReplies.length;
    const r = await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comment-automation/run`, {});
    expect(r.status, r.text).toBe(200);
    expect(r.json.classified).toBe(3);
    expect(JSON.stringify(ai.state.requests.at(-1)!.messages)).not.toContain(c9);   // ของเก่าก่อนเปิดไม่เสียค่า AI
    expect(r.json.auto).toMatchObject({ privateReplied: 1, replied: 1, liked: 2, skipped: 1 });
    expect(graph.state.privateReplies.length).toBe(beforeDm + 1);
    expect(graph.state.privateReplies.at(-1)).toMatchObject({ commentId: 'c6' });
    const sent = graph.state.replies.slice(beforeReplies).map(x => [x.commentId, x.body.message]);
    expect(sent).toHaveLength(2); expect(sent).toEqual(expect.arrayContaining([['c6', 'ส่งราคาทางแชทแล้วนะคะ 💬'], ['c7', 'ขอบคุณมากค่ะ 🥰']]));
    expect(graph.state.likes).toEqual(expect.arrayContaining(['c6', 'c7'])); expect(graph.state.likes).not.toContain('c8');
    expect(await prisma.pageComment.findUniqueOrThrow({ where: { id: c8 } })).toMatchObject({ replyStatus: 'DRAFTED', likedAt: null });
    expect(await prisma.pageComment.findUniqueOrThrow({ where: { id: c9 } })).toMatchObject({ classification: null });
    const auditAuto = await prisma.auditLog.count({ where: { workspaceId: ws, action: 'comments.private_reply.auto' } }); expect(auditAuto).toBe(1);
    // รอบถัดไป: ไม่มีอะไรใหม่ ไม่ทำซ้ำ
    const again = await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comment-automation/run`, {});
    expect(again.json.classified).toBe(0);
    expect(graph.state.privateReplies.length).toBe(beforeDm + 1); expect(graph.state.replies.length).toBe(beforeReplies + 2);
    expect((await a.http('GET', `/workspaces/${ws}/pages/${pageA}/comment-automation`)).json.lastRunAt).toBeTruthy();
  });

  it('เพจถูกหยุดโพสต์: จำแนกได้แต่ไม่ตอบ/ไลค์ · ปลดแล้วรอบถัดไปเก็บตก · รอบอัตโนมัติ (tick) ทำงานกับเพจที่เปิดไว้ · คนนอก workspace = 404', async () => {
    await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}`, { publishingPaused: true });
    graph.state.comments['111_2']!.push({ id: 'c10', message: 'ชอบมากค่ะ', created_time: new Date(Date.now() + 6000).toISOString(), from: { id: 'u10', name: 'สิบ' } });
    await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comments/sync`, { days: 30 });
    const c10 = await idOf('c10');
    ai.state.replies.push(J({ comments: [cls(c10, 'PRAISE', { sentiment: 'positive', draftReply: 'ขอบคุณค่ะ' })] }));
    const likesBefore = graph.state.likes.length;
    const r = await a.http('POST', `/workspaces/${ws}/pages/${pageA}/comment-automation/run`, {});
    expect(r.json.classified).toBe(1); expect(graph.state.likes.length).toBe(likesBefore);
    expect((await prisma.pageComment.findUniqueOrThrow({ where: { id: c10 } })).autoHandledAt).toBeNull();
    await a.http('PATCH', `/workspaces/${ws}/pages/${pageA}`, { publishingPaused: false });
    const t = await app.get(CommentAutomationService).tick();
    expect(t.runs).toEqual(expect.arrayContaining([{ pageId: pageA, ok: true }]));
    expect(graph.state.likes).toContain('c10');
    expect((await prisma.pageComment.findUniqueOrThrow({ where: { id: c10 } })).autoHandledAt).toBeTruthy();
    expect((await b.http('GET', `/workspaces/${wsB}/pages/${pageA}/comment-automation`)).status).toBe(404);
    expect((await b.http('PUT', `/workspaces/${ws}/pages/${pageA}/comment-automation`, { enabled: true })).status).toBe(404);
  });
});
