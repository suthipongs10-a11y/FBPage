/**
 * Integration — นำเข้าแพ็กเกจคอนเทนต์ fbpm-content-v1: วาง/อัปโหลด, URL รับไฟล์ด้วยคีย์, โฟลเดอร์ Google Drive (service account)
 * → ตรวจ (ผ่าน/เตือน/ไม่ผ่าน) → ร่างรออนุมัติพร้อมการ์ด+รูป · กันซ้ำ · คีย์/ไฟล์คีย์ไม่หลุด · ทุกอย่างยิง mock
 */
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { startMockWeb } from '@fbpm/web-core';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';
import { findChrome } from '../media/chromium';
import { ContentImportService } from './import.service';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
function client(base: string) {
  const c = { cookie: '', http: async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = Buffer.isBuffer(body) || typeof body === 'string';
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: c.cookie, ...headers }, body: body === undefined ? undefined : raw ? body as string : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0] ?? '';
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text };
  } };
  return c;
}

run('content import (integration)', () => {
  let app: INestApplication; let prisma: PrismaClient; let base = '';
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let web: Awaited<ReturnType<typeof startMockWeb>>;
  const stamp = Date.now();
  const A = { email: `imp-a-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  const B = { email: `imp-b-${stamp}@test.local`, name: 'Bob', password: 'bobby-password-123' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>;
  let wsA = ''; let wsB = ''; let brandA = ''; let pageA = '';
  const chrome = !!findChrome(process.env.CHROME_BIN);
  const post = (over: Record<string, unknown> = {}) => ({ title: 'ช้างน้อยกลับบ้าน', caption: 'ทีมกู้ภัยใช้เวลาสามวันพาช้างน้อยกลับไปหาแม่ได้สำเร็จ คุณคิดว่าอย่างไรบ้าง?', hashtags: ['ข่าวดี'], sources: [{ name: 'Example News', url: 'https://news.example.com/a/elephant-home' }], card: { kicker: 'ข่าวดี', headline: 'ช้างน้อย *กลับบ้าน* แล้ว', sub: 'ภารกิจสามวัน' }, ...over });

  beforeAll(async () => {
    graph = await startMockGraph(); web = await startMockWeb();
    Object.assign(process.env, { APP_ENV: 'test', META_GRAPH_BASE_URL: graph.url, WEB_MOCK_BASE_URL: web.url, WEB_ALLOW_PRIVATE_TARGETS: 'true' });
    process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    _resetRateLimits();
    ({ app } = await createApp()); await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    wsA = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${wsA}/clients`, { name: 'เพจของผมเอง' });
    brandA = (await a.http('POST', `/workspaces/${wsA}/clients/${c.json.id}/brands`, { name: 'ข่าวรอบโลก' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_IMPORT_TEST');
    const conn = await a.http('POST', `/workspaces/${wsA}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_IMPORT_TEST' });
    pageA = (await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
    await a.http('PUT', `/workspaces/${wsA}/news/search-provider`, { provider: 'pexels', apiKey: 'PEXELS_OK' });
  }, 30_000);
  afterAll(async () => {
    for (const k of ['META_GRAPH_BASE_URL', 'WEB_MOCK_BASE_URL', 'WEB_ALLOW_PRIVATE_TARGETS']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    await prisma.$disconnect(); await app.close(); graph.server.close(); web.server.close();
  });

  it('template: ตัวอย่าง + คำสั่งสำหรับแชต AI พร้อมชื่อเพจของแบรนด์', async () => {
    const r = await a.http('GET', `/workspaces/${wsA}/brands/${brandA}/news/import/template`);
    expect(r.status).toBe(200);
    expect(r.json.format).toBe('fbpm-content-v1');
    const pageName = (await prisma.facebookPage.findUniqueOrThrow({ where: { id: pageA } })).name;
    expect(r.json.instructions).toContain(`"${pageName}"`);
    expect((await b.http('GET', `/workspaces/${wsB}/brands/${brandA}/news/import/template`)).status).toBe(404);
  });

  it('check: ข้อความจากแชต (```json) → ผลตรวจรายโพสต์ ไม่สร้างอะไร', async () => {
    const text = `ได้เลยครับ\n\`\`\`json\n${JSON.stringify({ format: 'fbpm-content-v1', posts: [post(), { caption: 'สั้น' }, post({ page: 'เพจที่ไม่มี', title: 'อีกเรื่อง', sources: [{ url: 'https://news.example.com/b' }] })] })}\n\`\`\``;
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/import/check`, { text });
    expect(r.status).toBe(200);
    expect(r.json.posts.map((p: { status: string }) => p.status)).toEqual(['PASS', 'FAIL', 'FAIL']);
    expect(r.json.posts[2].checks.map((c: { code: string }) => c.code)).toContain('PAGE_NOT_FOUND');
    expect(await prisma.contentImport.count({ where: { workspaceId: wsA } })).toBe(0);
  });

  it('paste + อัปโหลดรูป → ร่างรออนุมัติ (การ์ด + รูปเต็ม) · ที่มาต่อท้าย · กันซ้ำรอบสอง', async () => {
    const up = await a.http('POST', `/workspaces/${wsA}/news/import/files?name=cover.png`, PNG, { 'content-type': 'image/png' });
    expect(up.status).toBe(201); expect(up.json.mimeType).toBe('image/png');
    expect((await a.http('POST', `/workspaces/${wsA}/news/import/files?name=x.png`, Buffer.from('not an image'), { 'content-type': 'image/png' })).status).toBe(400);
    const text = JSON.stringify({ posts: [post({ images: [{ file: 'cover.png', credit: 'ทีมงานเพจ' }], scheduleAt: '2099-01-01T19:00:00+07:00' })] });
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/import`, { text, files: { 'cover.png': up.json.id }, fileName: 'elephant.json' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'DRAFTED', postCount: 1, draftCount: 1 });
    const res = r.json.report.posts[0].result;
    const content = await prisma.contentItem.findUniqueOrThrow({ where: { id: res.contentId } });
    expect(content.status).toBe('READY_FOR_APPROVAL');
    expect(content.caption).toContain('ที่มา: Example News\nhttps://news.example.com/a/elephant-home');
    expect(content.caption).toContain('ภาพประกอบ: ทีมงานเพจ');
    expect((content.aiNotes as { suggestedAt: string }).suggestedAt).toBe('2099-01-01T12:00:00.000Z');
    expect(content.mediaPaths).toHaveLength(chrome ? 2 : 1);
    const item = await prisma.newsItem.findUniqueOrThrow({ where: { id: res.newsItemId } });
    expect(item).toMatchObject({ status: 'DRAFTED', contentId: content.id, brandId: brandA });
    // ขึ้นแท็บ "เขียนแล้ว" ของห้องข่าวเหมือนข่าวที่ AI เขียน
    const drafted = await a.http('GET', `/workspaces/${wsA}/news/items?brandId=${brandA}&status=DRAFTED`);
    expect(drafted.json.some((i: { contentId: string }) => i.contentId === content.id)).toBe(true);
    // ส่งแพ็กเกจเดิมซ้ำ → ไม่ผ่าน (ซ้ำ) ไม่สร้างร่างเพิ่ม
    const again = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/import`, { text: JSON.stringify({ posts: [post()] }) });
    expect(again.json.status).toBe('FAILED');
    expect(again.json.report.posts[0].checks.map((c: { code: string }) => c.code)).toContain('DUPLICATE');
    const list = await a.http('GET', `/workspaces/${wsA}/brands/${brandA}/news/imports`);
    expect(list.json).toHaveLength(2);
    expect((await b.http('POST', `/workspaces/${wsB}/news/imports/${r.json.id}/draft`)).status).toBe(404);
  });

  it('รูปจากลิงก์ดาวน์โหลดให้ · รูปจากเว็บต้นทางถูกปฏิเสธ · ไม่มีรูป → คลังภาพฟรีตาม photoQuery', async () => {
    const text = JSON.stringify({ posts: [
      post({ title: 'รูปลิงก์', sources: [{ name: 'Sci', url: 'https://science.example.org/x1' }], images: [{ url: `${web.url}/img/own.png`, credit: 'Somsri / Pexels' }] }),
      post({ title: 'รูปสำนักข่าว', sources: [{ name: 'Sci', url: 'https://science.example.org/x2' }], images: ['https://cdn.science.example.org/photo.jpg'] }),
      post({ title: 'ไม่มีรูป', sources: [{ name: 'Sci', url: 'https://science.example.org/x3' }], photoQuery: 'baby elephant' }),
    ] });
    const r = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/import`, { text, imageFallback: 'stock' });
    expect(r.json.status).toBe('PARTIAL');
    const [p1, p2, p3] = r.json.report.posts;
    expect(p1.result.contentId).toBeTruthy(); expect(p1.result.imageErrors).toBeUndefined();
    expect(p2.status).toBe('FAIL'); expect(p2.checks.map((c: { code: string }) => c.code)).toContain('IMAGE_FROM_SOURCE');
    expect(p3.result.contentId).toBeTruthy();
    expect(web.state.news.pexelsQueries).toContain('baby elephant');
    const c3 = await prisma.contentItem.findUniqueOrThrow({ where: { id: p3.result.contentId } });
    expect(c3.caption).toContain('ภาพประกอบ: Somsri Camera / Pexels');
  });

  it('ChatGPT: สร้างคำสั่งตามที่กำหนด → วางผล + รูปรายหัวข้อ (โพสต์รูปเลย ไม่ทำการ์ด) → อนุมัติ+ตั้งเวลาทีละหัวข้อ', async () => {
    const path = `/workspaces/${wsA}/brands/${brandA}/news/import`;
    const pr = await a.http('POST', `${path}/chat-prompt`, { pageId: pageA, count: 3, topic: 'ทำความสะอาดบ้านหน้าฝน', kind: 'original', length: 'short', emoji: true, images: 'chatgpt' });
    expect(pr.status).toBe(200);
    const pageName = (await prisma.facebookPage.findUniqueOrThrow({ where: { id: pageA } })).name;
    for (const s of ['คัดมา 3 หัวข้อ', 'ทำความสะอาดบ้านหน้าฝน', 'fbpm-content-v1', `"${pageName}"`, 'รูปที่ X']) expect(pr.json.prompt).toContain(s);
    expect((await a.http('POST', `${path}/chat-prompt`, { count: 0 })).status).toBe(400);
    expect((await a.http('POST', `${path}/chat-prompt`, { count: 3, apiKey: 'x' })).status).toBe(400);
    expect((await b.http('POST', `/workspaces/${wsB}/brands/${brandA}/news/import/chat-prompt`, { count: 3 })).status).toBe(404);

    const up = await a.http('POST', `/workspaces/${wsA}/news/import/files?name=chatgpt-1.png`, PNG, { 'content-type': 'image/png' });
    expect(up.status).toBe(201);
    const orig = (title: string) => ({ type: 'original', title, caption: `🌧️ ${title} เคล็ดลับง่าย ๆ ที่ทำได้เองที่บ้าน\n\n✅ เปิดหน้าต่างระบายอากาศ\n✅ ซักผ้าปูที่นอนด้วยน้ำร้อน\n\n💬 บ้านไหนเจอปัญหานี้บ้าง?`, hashtags: ['หน้าฝน'], images: [] });
    const text = '```json\n' + JSON.stringify({ format: 'fbpm-content-v1', posts: [orig(`หัวข้อแรก ${stamp}`), orig(`หัวข้อสอง ${stamp}`)] }) + '\n```';
    const chk = await a.http('POST', `${path}/check`, { text, pageId: pageA, postImages: { 0: up.json.id } });
    expect(chk.json.posts.map((p: { status: string }) => p.status)).toEqual(['PASS', 'PASS']);
    expect((await a.http('POST', `${path}/check`, { text, pageId: pageA, postImages: { 1: 'not-my-upload' } })).json.posts[1].checks.map((c: { code: string }) => c.code)).toContain('UPLOAD_MISSING');
    // รูปของ workspace อื่นใช้ไม่ได้
    expect((await b.http('POST', `/workspaces/${wsB}/brands/${brandA}/news/import`, { text, postImages: { 0: up.json.id } })).status).toBe(404);

    const imp = await a.http('POST', path, { text, pageId: pageA, postImages: { 0: up.json.id }, cardMode: 'photo', imageFallback: 'none' });
    expect(imp.status, imp.text).toBe(200); expect(imp.json.draftCount).toBe(2);
    const [id0, id1] = imp.json.report.posts.map((p: { result: { contentId: string } }) => p.result.contentId) as [string, string];
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: up.json.id } });
    const c0 = await prisma.contentItem.findUniqueOrThrow({ where: { id: id0 } });
    expect(c0.mediaPaths).toEqual([asset.path]); expect(c0.contentType).toBe('photo'); expect(c0.status).toBe('READY_FOR_APPROVAL');
    expect(asset.contentId).toBe(id0);
    expect(await prisma.mediaAsset.count({ where: { contentId: id0, kind: 'card' } })).toBe(0);
    if (chrome) expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: id1 } })).mediaPaths).toHaveLength(1);   // ไม่มีรูป → การ์ดพาดหัวแทน

    const d = new Date(Date.now() + 2 * 86_400_000); const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const s0 = await a.http('POST', `/workspaces/${wsA}/content/${id0}/approve-schedule`, { scheduledLocal: `${day}T09:00`, timezone: 'Asia/Bangkok' });
    const s1 = await a.http('POST', `/workspaces/${wsA}/content/${id1}/approve-schedule`, { scheduledLocal: `${day}T18:00`, timezone: 'Asia/Bangkok' });
    expect([s0.status, s1.status], s0.text + s1.text).toEqual([200, 200]);
    expect([s0.json.status, s1.json.status]).toEqual(['SCHEDULED', 'SCHEDULED']);
    expect(new Date(s1.json.scheduledAt).getTime() - new Date(s0.json.scheduledAt).getTime()).toBe(9 * 3_600_000);
  });

  it('URL รับไฟล์: คีย์แสดงครั้งเดียว เก็บเป็น hash · ไม่มีคีย์ = 401 · ข้อความ text/plain ได้ · ยกเลิกคีย์แล้วใช้ไม่ได้', async () => {
    const k = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/inbox/key`);
    expect(k.status).toBe(200); expect(k.json.key).toMatch(/^fbin_/);
    const inbox = await prisma.contentInbox.findUniqueOrThrow({ where: { brandId: brandA } });
    expect(JSON.stringify(inbox)).not.toContain(k.json.key);
    const view = await a.http('GET', `/workspaces/${wsA}/brands/${brandA}/news/inbox`);
    expect(view.json).toMatchObject({ hasKey: true, keyHint: k.json.keyHint }); expect(view.text).not.toContain(k.json.key);

    expect((await a.http('POST', '/inbox/content', { posts: [post()] })).status).toBe(401);
    expect((await a.http('POST', '/inbox/content', { posts: [post()] }, { authorization: 'Bearer fbin_wrong' })).status).toBe(401);
    const body = `ผลลัพธ์\n\`\`\`json\n${JSON.stringify({ posts: [post({ title: 'จาก GPT', sources: [{ name: 'GPT src', url: 'https://gpt.example.com/story' }] })] })}\n\`\`\``;
    const r = await fetch(`${base}/inbox/content`, { method: 'POST', headers: { authorization: `Bearer ${k.json.key}`, 'content-type': 'text/plain; charset=utf-8' }, body });
    const j = await r.json() as { status: string; drafted: number; posts: { status: string; contentId: string }[] };
    expect(r.status).toBe(200); expect(j).toMatchObject({ status: 'DRAFTED', drafted: 1 });
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: j.posts[0]!.contentId } })).status).toBe('READY_FOR_APPROVAL');
    const spec = await a.http('GET', '/inbox/openapi.json');
    expect(spec.json.paths['/inbox/content'].post.operationId).toBe('sendPosts');

    await a.http('DELETE', `/workspaces/${wsA}/brands/${brandA}/news/inbox/key`);
    expect((await a.http('POST', '/inbox/content', { posts: [post({ title: 'หลังยกเลิก' })] }, { authorization: `Bearer ${k.json.key}` })).status).toBe(401);
  });

  it('Google Drive: ไฟล์คีย์เข้ารหัสไม่แสดงกลับ → ดึงแพ็กเกจ + รูปในโฟลเดอร์ → ร่าง · ดึงซ้ำไม่นำเข้าไฟล์เดิม', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const sa = JSON.stringify({ type: 'service_account', client_email: 'importer@fbpm-test.iam.gserviceaccount.com', private_key: privateKey });
    expect((await a.http('PUT', `/workspaces/${wsA}/brands/${brandA}/news/inbox`, { driveCredentials: '{"type":"user"}xxxxxxxxxxxxxxx' })).status).toBe(400);
    const bad = await a.http('PUT', `/workspaces/${wsA}/brands/${brandA}/news/inbox`, { driveEnabled: true, driveFolder: 'https://drive.google.com/drive/folders/WRONG_FOLDER_99', driveCredentials: sa });
    expect(bad.status).toBe(200); expect(bad.json.driveLastError).toMatch(/แชร์โฟลเดอร์/);
    const s = await a.http('PUT', `/workspaces/${wsA}/brands/${brandA}/news/inbox`, { driveFolder: 'https://drive.google.com/drive/folders/FOLDER_OK_1234?usp=sharing', pageId: pageA, imageFallback: 'none' });
    expect(s.json).toMatchObject({ driveEnabled: true, driveFolderId: 'FOLDER_OK_1234', driveClientEmail: 'importer@fbpm-test.iam.gserviceaccount.com', driveConfigured: true, driveLastError: null });
    expect(s.text).not.toContain('PRIVATE KEY');
    const row = await prisma.contentInbox.findUniqueOrThrow({ where: { brandId: brandA } });
    expect(row.driveCredentialsEnc).not.toContain('PRIVATE KEY');
    const audits = await prisma.auditLog.findMany({ where: { workspaceId: wsA, action: 'content_import.inbox_update' } });
    expect(JSON.stringify(audits)).not.toContain('PRIVATE KEY');

    const now = new Date().toISOString();
    web.state.drive.files = [
      { id: 'pkg1', name: 'drive-posts.json', mimeType: 'application/json', md5Checksum: 'm1', modifiedTime: now, content: Buffer.from(JSON.stringify({ posts: [post({ title: 'จาก Drive', sources: [{ name: 'Drive src', url: 'https://drive-news.example.com/1' }], images: ['drive-cover.png'] })] })) },
      { id: 'img1', name: 'drive-cover.png', mimeType: 'image/png', md5Checksum: 'i1', modifiedTime: now, content: PNG },
      { id: 'old1', name: 'old.json', mimeType: 'application/json', md5Checksum: 'o1', modifiedTime: '2020-01-01T00:00:00Z', content: Buffer.from('{"posts":[]}') },
    ];
    const p = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/inbox/drive/poll`);
    expect(p.status).toBe(200);
    expect(p.json.results).toEqual([{ file: 'drive-posts.json', status: 'DRAFTED', drafted: 1 }]);
    expect(web.state.drive.downloads).toEqual(expect.arrayContaining(['pkg1', 'img1']));
    const again = await a.http('POST', `/workspaces/${wsA}/brands/${brandA}/news/inbox/drive/poll`);
    expect(again.json.imported).toBe(0);
    const imp = await prisma.contentImport.findFirstOrThrow({ where: { workspaceId: wsA, channel: 'gdrive' } });
    expect(imp.fileName).toBe('drive-posts.json');
    expect((await b.http('POST', `/workspaces/${wsB}/brands/${brandA}/news/inbox/drive/poll`)).status).toBe(404);
    // รอบอัตโนมัติ (ทุก 10 นาที) ต้องได้ล็อกและทำงานจริง — เคยล้มเงียบเพราะ Redis ยังไม่เชื่อม (lazyConnect)
    const tick = await app.get(ContentImportService).pollDrive();
    expect('skipped' in tick).toBe(false);
    expect(tick.runs.some(r => r.brandId === brandA)).toBe(true);
  });
});
