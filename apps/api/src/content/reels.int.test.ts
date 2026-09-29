/**
 * Integration — Facebook Reels: อัปโหลดคลิป (สตรีมลงดิสก์ + ตรวจ MP4) → ChatGPT/นำเข้าแนบคลิปรายหัวข้อ หรือแนบกับร่างเดิม
 * → อนุมัติ → โพสต์ Reels ผ่าน mock Graph (start → อัปโหลด → finish) · ทุกอย่างยิง mock ไม่แตะเพจจริง
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { fakeMp4, startMockGraph } from '@fbpm/facebook-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie, ...headers }, body: body === undefined ? undefined : raw ? body as Buffer : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text, headers: res.headers };
  } };
  return c;
}

run('Facebook Reels (integration)', () => {
  let app: INestApplication; let prisma: PrismaClient; let base = '';
  let graph: Awaited<ReturnType<typeof startMockGraph>>;
  const stamp = Date.now();
  const A = { email: `reel-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `reel-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>;
  let wsA = ''; let wsB = ''; let brandA = ''; let pageA = '';
  const upload = (who: ReturnType<typeof client>, ws: string, buf: Buffer, name = 'clip.mp4') => who.http('POST', `/workspaces/${ws}/media/videos?name=${encodeURIComponent(name)}`, buf, { 'content-type': 'video/mp4' });

  beforeAll(async () => {
    graph = await startMockGraph();
    Object.assign(process.env, { APP_ENV: 'test', META_GRAPH_BASE_URL: graph.url, REELS_MAX_MB: '10' });
    process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    _resetRateLimits();
    ({ app } = await createApp()); await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    wsA = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'ลูกค้า Reels' });
    brandA = (await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'แบรนด์ Reels' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_REELS_TEST');
    const conn = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_REELS_TEST' });
    pageA = (await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
  }, 30_000);
  afterAll(async () => {
    for (const k of ['META_GRAPH_BASE_URL', 'REELS_MAX_MB']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); graph.server.close();
  });

  it('อัปโหลดคลิป: ตรวจหัวไฟล์/ความยาว/ขนาด · ดูคลิปแบบ Range ได้ · ข้าม workspace ไม่ได้', async () => {
    const ok = await upload(a, wsA, fakeMp4({ durationSec: 20, width: 1080, height: 1920, padBytes: 20_000 }));
    expect(ok.status, ok.text).toBe(201);
    expect(ok.json).toMatchObject({ durationSec: 20, width: 1080, height: 1920, warnings: [] });
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: ok.json.id } });
    expect(asset).toMatchObject({ kind: 'video', mimeType: 'video/mp4', workspaceId: wsA }); expect(asset.path.endsWith('.mp4')).toBe(true);
    expect((await upload(a, wsA, Buffer.from('this is not a video file'))).status).toBe(400);
    const long = await upload(a, wsA, fakeMp4({ durationSec: 120 })); expect(long.status).toBe(422); expect(long.json.message).toContain('3–90');
    const wide = await upload(a, wsA, fakeMp4({ width: 1920, height: 1080 })); expect(wide.status).toBe(201); expect(wide.json.warnings[0]).toContain('แนวนอน');
    expect((await upload(a, wsA, Buffer.concat([fakeMp4(), Buffer.alloc(11 * 1048576)]))).status).toBe(400);   // เกิน REELS_MAX_MB
    const part = await fetch(`${base}/workspaces/${wsA}/media/${ok.json.id}/file`, { headers: { cookie: a.cookie, range: 'bytes=0-99' } });
    expect(part.status).toBe(206); expect(part.headers.get('content-type')).toContain('video/mp4'); expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect((await b.http('GET', `/workspaces/${wsB}/media/${ok.json.id}/file`)).status).toBe(404);
  });

  it('ChatGPT แบบ Reels: คำสั่งมี videoIdea · นำเข้าพร้อมคลิปรายหัวข้อ → ร่าง Reels → อนุมัติ → โพสต์เป็น Reels', async () => {
    const pr = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/import/chat-prompt`, { pageId: pageA, count: 2, format: 'reel' });
    expect(pr.json.prompt).toContain('videoIdea'); expect(pr.json.prompt).toContain('9:16'); expect(pr.json.prompt).not.toContain('imagePrompt');
    const clip = await upload(a, wsA, fakeMp4({ durationSec: 30, padBytes: 4096 }), 'topic1.mp4');
    const reel = (title: string) => ({ type: 'original', title, caption: `🎬 ${title}\n\nเคล็ดลับที่ทำได้ใน 30 วินาที\n\n💬 ใครเคยลองบ้าง?`, hashtags: ['reels'], images: [], videoIdea: '0–3 วิ: ช็อตเปิด' });
    const text = '```json\n' + JSON.stringify({ format: 'fbpm-content-v1', posts: [reel(`คลิปแรก ${stamp}`)] }) + '\n```';
    const path = `/workspaces/${wsA}/brands/${brandA}/news/import`;
    expect((await a.http('POST', `${path}/check`, { text, pageId: pageA, postVideos: { 0: 'nope' } })).json.posts[0].checks.map((c: { code: string }) => c.code)).toContain('VIDEO_MISSING');
    expect((await b.http('POST', `/workspaces/${wsB}/brands/${brandA}/news/import`, { text, postVideos: { 0: clip.json.id } })).status).toBe(404);
    const imp = await a.http('POST', path, { text, pageId: pageA, postVideos: { 0: clip.json.id }, imageFallback: 'stock' });
    expect(imp.status, imp.text).toBe(200); expect(imp.json.draftCount).toBe(1);
    const id = imp.json.report.posts[0].result.contentId as string;
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: clip.json.id } });
    const draft = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
    expect(draft).toMatchObject({ contentType: 'reel', mediaPaths: [asset.path], status: 'READY_FOR_APPROVAL' });
    expect(draft.mediaBrief).toContain('ไอเดียคลิป'); expect(asset.contentId).toBe(id);
    expect(await prisma.mediaAsset.count({ where: { contentId: id, kind: { in: ['card', 'import'] } } })).toBe(0);   // ไม่มีการ์ด/ภาพคลังฟรี

    await a.http('POST', `/workspaces/${wsA}/content/${id}/approve`, {});
    const before = graph.state.reels.length;
    const pub = await a.http('POST', `/workspaces/${wsA}/content/${id}/publish`, {});
    expect(pub.json.outcome.status, pub.text).toBe('PUBLISHED');
    const r = graph.state.reels.at(-1)!;
    expect(graph.state.reels.length).toBe(before + 1);
    expect(r).toMatchObject({ pageId: '111', published: true, bytes: asset.bytes });
    expect(r.description).toContain(`คลิปแรก ${stamp}`); expect(r.description).toContain('#reels');
    expect(pub.json.outcome.permalink).toBe(`https://www.facebook.com/reel/${r.videoId}`);
    const post = await prisma.facebookPost.findFirstOrThrow({ where: { pageId: pageA, facebookPostId: r.videoId } });
    expect(post.mediaType).toBe('reel');
  });

  it('แนบคลิปกับร่างเดิม (ไม่ผ่าน ChatGPT) · อนุมัติแล้วเปลี่ยนคลิปไม่ได้ · Reels ไม่มีคลิป = ล้มพร้อมเหตุผล · อัปโหลดล้มไม่ขึ้นเพจ', async () => {
    const d = await a.http('POST', `/workspaces/${wsA}/content`, { pageId: pageA, caption: `ร่าง Reels ทำเอง ${stamp}` });
    const clip = await upload(a, wsA, fakeMp4({ durationSec: 12 }));
    expect((await b.http('POST', `/workspaces/${wsB}/content/${d.json.id}/video`, { assetId: clip.json.id })).status).toBe(404);
    const att = await a.http('POST', `/workspaces/${wsA}/content/${d.json.id}/video`, { assetId: clip.json.id });
    expect(att.status, att.text).toBe(200);
    expect(await prisma.contentItem.findUniqueOrThrow({ where: { id: d.json.id } })).toMatchObject({ contentType: 'reel' });
    await a.http('POST', `/workspaces/${wsA}/content/${d.json.id}/submit`, {}); await a.http('POST', `/workspaces/${wsA}/content/${d.json.id}/approve`, {});
    expect((await a.http('POST', `/workspaces/${wsA}/content/${d.json.id}/video`, { assetId: clip.json.id })).status).toBe(422);

    // อัปโหลดไป Meta ล้ม → ยังไม่ finish = ไม่ขึ้นเพจ → ล้มแน่นอน ส่งใหม่ได้
    graph.state.reelError = { phase: 'upload', status: 400, code: 100, message: 'Video format not supported' };
    const f = await a.http('POST', `/workspaces/${wsA}/content/${d.json.id}/publish`, {});
    expect(f.json.outcome.status).toBe('FAILED'); expect(f.json.content.lastError).toContain('Video format not supported'); expect(f.json.content.lastError).not.toContain('RECONCILIATION_REQUIRED');
    graph.state.reelError = null;
    expect((await a.http('POST', `/workspaces/${wsA}/content/${d.json.id}/publish`, {})).json.outcome.status).toBe('PUBLISHED');

    // contentType reel แต่ไม่มีไฟล์คลิป
    const nov = await prisma.contentItem.create({ data: { pageId: pageA, caption: 'reel ไม่มีคลิป', contentType: 'reel', status: 'APPROVED' } });
    const f2 = await a.http('POST', `/workspaces/${wsA}/content/${nov.id}/publish`, {});
    expect(f2.json.content.lastError).toContain('Reels ต้องแนบไฟล์คลิป');
  });
});
