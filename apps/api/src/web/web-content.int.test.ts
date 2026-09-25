/** Integration — W-3 web content: เชื่อม WordPress (mock) → AI ร่างจากคลิป YouTube + แบรนด์ (mock AI) → รีวิว → อนุมัติ → โพสต์ขึ้น WordPress กันซ้ำ → kill switch · ไม่แตะเว็บ/AI จริง */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@fbpm/database';
import { startMockAi } from '@fbpm/ai-core';
import { MOCK_WP_APP_PASSWORD, MOCK_WP_USER, startMockWeb } from '@fbpm/web-core';
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
const ARTICLE = { title: 'ราคาแม่บ้านรายวัน ภูเก็ต 2026 คิดอย่างไร', slug: 'ราคาแม่บ้านรายวัน-ภูเก็ต', excerpt: 'สรุปวิธีคิดราคาแม่บ้านรายวันจากคลิปของเรา', metaTitle: 'ราคาแม่บ้านรายวัน ภูเก็ต', metaDescription: 'สรุปปัจจัยที่ทำให้ราคาแม่บ้านรายวันต่างกัน', targetQuery: 'แม่บ้านรายวัน', outline: [{ heading: 'ปัจจัยราคา', points: ['ขนาดบ้าน', 'ความถี่'] }], bodyHtml: `<p>${'จากคลิป "ใส่ปุ๋ยยูเรียตอนไหนดีที่สุด" เราสรุปปัจจัยที่ทำให้ราคาแม่บ้านรายวันในภูเก็ตต่างกัน '.repeat(6)}</p><h2>ปัจจัยราคา</h2><ul><li>ขนาดบ้าน</li><li>ความถี่</li></ul><p onclick="x()">ติดต่อทีม <a href="javascript:alert(1)">ทักแชท</a></p><script>alert(1)</script>`, tags: ['ภูเก็ต', 'แม่บ้าน'], categories: ['บทความ'], internalLinkIdeas: [], missingInfo: [], aiInterpretation: ['ความถี่มีผลต่อราคา (การตีความ)'] };

run('web content → WordPress (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient;
  let web: Awaited<ReturnType<typeof startMockWeb>>; let ai: Awaited<ReturnType<typeof startMockAi>>;
  const stamp = Date.now(); const A = { email: `wc-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' }; const B = { email: `wc-b-${stamp}@test.local`, name: 'Bob', password: 'bob-password-12345' };
  let a: ReturnType<typeof client>; let b: ReturnType<typeof client>; let ws = ''; let wsB = ''; let brand = ''; let siteId = ''; let ytId = ''; let id = '';
  beforeAll(async () => {
    web = await startMockWeb(); ai = await startMockAi();
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
    Object.assign(process.env, { WEB_MOCK_BASE_URL: web.url, WEB_ALLOW_PRIVATE_TARGETS: 'true', WEB_PUBLISH_ENABLED: 'true', WEB_WP_ALLOW_INSECURE: 'true' });
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); b = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id; wsB = (await b.http('POST', '/auth/register', B)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${ws}/clients`, { name: 'ฟ้าแดง' });
    brand = (await a.http('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'ฟ้าแดง คลีนนิ่ง', industry: 'บริการทำความสะอาด', serviceArea: 'ภูเก็ต', primaryCTA: 'ทักแชท', preferredLanguage: 'th' })).json.id;
    await a.http('POST', `/workspaces/${ws}/brands/${brand}/knowledge`, { type: 'service', title: 'แม่บ้านรายวัน', content: 'บริการแม่บ้านรายวัน ทีมงานอบรมแล้ว ครอบคลุมทั้งภูเก็ต' });
    const aiConn = (await a.http('POST', `/workspaces/${ws}/ai/connections`, { preset: 'custom', label: 'Mock AI', apiKey: 'MOCK_KEY', baseUrl: ai.url, models: ['m-content', 'm-fast'] })).json.id;
    await a.http('PUT', `/workspaces/${ws}/ai/roles`, { roles: { content: { connectionId: aiConn, model: 'm-content' }, fast: { connectionId: aiConn, model: 'm-fast' } } });
    siteId = (await a.http('POST', `/workspaces/${ws}/web/sites`, { brandId: brand, url: web.siteUrl, platform: 'WORDPRESS' })).json.id;
    await a.http('PATCH', `/workspaces/${ws}/web/sites/${siteId}`, { monitorEnabled: false });   // เทสต์นี้สนใจการโพสต์บทความ ไม่ให้ worker ของเทสต์อื่นหยิบไปตรวจ
    // คลิป YouTube ต้นทาง (สร้างตรงใน DB — ช่องของแบรนด์เดียวกัน)
    const me = await a.http('GET', '/auth/me'); const conn = await prisma.googleConnection.create({ data: { workspaceId: ws, userId: me.json.user.id, providerUserId: `g-${stamp}`, email: 'g@test.local', accessTokenEncrypted: 'x', scopes: [] } });
    const ch = await prisma.youTubeChannel.create({ data: { brandId: brand, googleConnectionId: conn.id, accessMode: 'OAUTH', youtubeChannelId: `UC${stamp}`, title: 'เกษตรก้าวหน้า' } });
    ytId = (await prisma.contentItem.create({ data: { platform: 'YOUTUBE', youtubeChannelId: ch.id, status: 'PUBLISHED', ytStatus: 'PUBLISHED', contentType: 'YT_LONG_FORM', title: 'ใส่ปุ๋ยยูเรียตอนไหนดีที่สุด', externalPostId: 'vid123', youtubeMeta: { create: { title: 'ใส่ปุ๋ยยูเรียตอนไหนดีที่สุด', script: 'สคริปต์: ราคาแม่บ้านรายวันขึ้นกับขนาดบ้านและความถี่ ...', format: 'LONG_FORM' } } } })).id;
  }, 40_000);
  afterAll(async () => {
    for (const k of ['WEB_MOCK_BASE_URL', 'WEB_ALLOW_PRIVATE_TARGETS', 'WEB_PUBLISH_ENABLED', 'WEB_WP_ALLOW_INSECURE']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: { in: [ws, wsB] } } }); await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } }); await prisma.$disconnect();
    await app.close(); web.server.close(); ai.server.close();
  });

  it('connects WordPress with an application password (verified against the site, never echoed back); wrong password → 422 AUTH_FAILED', async () => {
    const bad = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/wordpress`, { username: MOCK_WP_USER, appPassword: 'wrong-password-1' });
    expect(bad.status).toBe(422); expect((await a.http('GET', `/workspaces/${ws}/web/sites/${siteId}`)).json.wpStatus).toBe('AUTH_FAILED');
    const ok = await a.http('POST', `/workspaces/${ws}/web/sites/${siteId}/wordpress`, { username: MOCK_WP_USER, appPassword: MOCK_WP_APP_PASSWORD });
    expect(ok.status, ok.text).toBe(200); expect(ok.json.status).toBe('OK'); expect(ok.json.userName).toBe('Somchai Editor');
    const site = await a.http('GET', `/workspaces/${ws}/web/sites/${siteId}`); expect(site.json.wpStatus).toBe('OK'); expect(site.json.platform).toBe('WORDPRESS'); expect(JSON.stringify(site.json)).not.toMatch(/abcd|Enc/);
    const srcs = await a.http('GET', `/workspaces/${ws}/web/sites/${siteId}/content-sources`); expect(srcs.json.youtube[0].id).toBe(ytId);
  });
  it('creates a WEB draft, AI writes the article from the YouTube source + brand knowledge (sanitized, related), cannot publish before approval', async () => {
    const d = await a.http('POST', `/workspaces/${ws}/web/content`, { siteId, topic: 'ราคาแม่บ้านรายวัน ภูเก็ต', targetQuery: 'แม่บ้านรายวัน' });
    expect(d.status, d.text).toBe(201); id = d.json.id; expect(d.json.platform).toBe('WEB'); expect(d.json.status).toBe('DRAFT');
    ai.state.replies.push({ text: JSON.stringify(ARTICLE) });
    const g = await a.http('POST', `/workspaces/${ws}/web/content/${id}/generate`, { youtubeContentIds: [ytId] });
    expect(g.status, g.text).toBe(200); expect(g.json.webMeta.title).toBe(ARTICLE.title); expect(g.json.webMeta.slug).toBe('ราคาแม่บ้านรายวัน-ภูเก็ต'); expect(g.json.webMeta.tags).toEqual(['ภูเก็ต', 'แม่บ้าน']);
    expect(g.json.webMeta.bodyHtml).not.toContain('<script'); expect(g.json.webMeta.bodyHtml).not.toContain('onclick'); expect(g.json.webMeta.bodyHtml).not.toContain('javascript:');
    expect(g.json.relationsTo[0].parent.id).toBe(ytId); expect(g.json.aiNotes.aiInterpretation).toHaveLength(1);
    const prompt = JSON.stringify(ai.state.requests.at(-1)!.messages); expect(prompt).toContain('ใส่ปุ๋ยยูเรียตอนไหนดีที่สุด'); expect(prompt).toContain('แม่บ้านรายวัน ทีมงานอบรมแล้ว'); expect(prompt).not.toMatch(/abcd|wpadmin/);
    expect((await a.http('POST', `/workspaces/${ws}/web/content/${id}/publish`, {})).status).toBe(409);
    expect((await a.http('GET', `/workspaces/${ws}/content/${id}`)).json.platform).toBe('WEB');   // เห็นในคิวคอนเทนต์รวมด้วย
  });
  it('submit runs the reviewer, approve, publish to WordPress once (idempotent), listed in the unified calendar', async () => {
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    const s = await a.http('POST', `/workspaces/${ws}/web/content/${id}/submit`, {}); expect(s.status, s.text).toBe(200); expect(s.json.status).toBe('READY_FOR_APPROVAL'); expect(s.json.reviewResult.result).toBe('PASS');
    expect((await a.http('GET', `/workspaces/${ws}/approvals`)).json.some((x: { content: { id: string } | null }) => x.content?.id === id)).toBe(true);
    expect((await a.http('GET', `/workspaces/${ws}/notifications`)).json.items.some((x: { title: string }) => x.title.includes('บทความเว็บ'))).toBe(true);
    const ap = await a.http('POST', `/workspaces/${ws}/web/content/${id}/approve`, { comment: 'ดี' }); expect(ap.json.status).toBe('APPROVED');
    const p = await a.http('POST', `/workspaces/${ws}/web/content/${id}/publish`, {});
    expect(p.status, p.text).toBe(200); expect(p.json.outcome.status).toBe('PUBLISHED'); expect(p.json.outcome.duplicateRecovered).toBe(false); expect(p.json.content.status).toBe('PUBLISHED'); expect(p.json.content.webMeta.wpLink).toContain('ราคาแม่บ้านรายวัน-ภูเก็ต');
    expect(web.state.wp.posts).toHaveLength(1); expect(web.state.wp.posts[0]!.status).toBe('publish'); expect(web.state.wp.posts[0]!.tags).toHaveLength(2); expect(web.state.wp.tags.map(t => t.name)).toContain('แม่บ้าน');
    // ยิงซ้ำ (เช่น worker retry) → ไม่สร้างโพสต์ที่สอง
    await prisma.contentItem.update({ where: { id }, data: { status: 'PUBLISH_FAILED' } });
    const again = await a.http('POST', `/workspaces/${ws}/web/content/${id}/publish`, {}); expect(again.json.outcome.duplicateRecovered).toBe(true); expect(web.state.wp.posts).toHaveLength(1);
    const cal = await a.http('GET', `/workspaces/${ws}/youtube/content/calendar?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`); expect(cal.json.some((x: { id: string; platform: string }) => x.id === id && x.platform === 'WEB')).toBe(true);
    const sum = await a.http('GET', `/workspaces/${ws}/web/content/summary`); expect(sum.json.published).toBe(1); expect(sum.json.wordpressConnected).toBe(1);
  });
  it('update published article on WordPress; kill switches block new publishes honestly; editing after approval returns to DRAFT', async () => {
    await a.http('PATCH', `/workspaces/${ws}/web/content/${id}`, { excerpt: 'อัปเดต' }).then(r => expect(r.status).toBe(409));   // เผยแพร่แล้ว แก้ผ่าน wordpress-update
    await prisma.webContentMetadata.update({ where: { contentItemId: id }, data: { excerpt: 'ข้อความย่อใหม่' } });
    const up = await a.http('POST', `/workspaces/${ws}/web/content/${id}/wordpress-update`, {}); expect(up.status, up.text).toBe(200); expect(web.state.wp.posts[0]!.excerpt).toBe('ข้อความย่อใหม่');
    // บทความที่สอง: อนุมัติแล้วแต่เว็บถูกหยุดโพสต์
    const d2 = await a.http('POST', `/workspaces/${ws}/web/content`, { siteId, title: 'บทความสอง', bodyHtml: '<p>เนื้อหา</p>' }); const id2 = d2.json.id;
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    await a.http('POST', `/workspaces/${ws}/web/content/${id2}/submit`, {}); await a.http('POST', `/workspaces/${ws}/web/content/${id2}/approve`, {});
    await a.http('PATCH', `/workspaces/${ws}/web/sites/${siteId}`, { publishingPaused: true });
    const blocked = await a.http('POST', `/workspaces/${ws}/web/content/${id2}/publish`, {}); expect(blocked.status).toBe(422); expect(blocked.json.message).toContain('หยุดการโพสต์'); expect(web.state.wp.posts).toHaveLength(1);
    await a.http('PATCH', `/workspaces/${ws}/web/sites/${siteId}`, { publishingPaused: false });
    const edit = await a.http('PATCH', `/workspaces/${ws}/web/content/${id2}`, { bodyHtml: '<p>เนื้อหาแก้ใหม่</p>' }); expect(edit.json.status).toBe('DRAFT'); expect(edit.json._count.revisions).toBe(2);
    // reviewer จับ [ต้องยืนยัน] → NEEDS_REVISION
    await a.http('PATCH', `/workspaces/${ws}/web/content/${id2}`, { bodyHtml: '<p>ราคา [ต้องยืนยัน: ราคาต่อชั่วโมง]</p>' }); await prisma.contentItem.update({ where: { id: id2 }, data: { aiNotes: { missingInfo: ['ราคาต่อชั่วโมง'] } } });
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    const nr = await a.http('POST', `/workspaces/${ws}/web/content/${id2}/submit`, {}); expect(nr.json.status).toBe('NEEDS_REVISION'); expect(nr.json.reviewResult.issues[0].type).toBe('missing_info');
  });
  it('tenant isolation + disconnect WordPress clears credentials', async () => {
    expect((await b.http('GET', `/workspaces/${wsB}/web/content/${id}`)).status).toBe(404);
    expect((await b.http('POST', `/workspaces/${wsB}/web/content/${id}/publish`, {})).status).toBe(404);
    expect((await b.http('GET', `/workspaces/${wsB}/web/content`)).json).toHaveLength(0);
    expect((await a.http('DELETE', `/workspaces/${ws}/web/sites/${siteId}/wordpress`)).status).toBe(200);
    const s = await prisma.site.findUniqueOrThrow({ where: { id: siteId } }); expect(s.wpAppPasswordEnc).toBeNull(); expect(s.wpStatus).toBe('UNKNOWN');
    const audit = await prisma.auditLog.findMany({ where: { workspaceId: ws } }); expect(JSON.stringify(audit)).not.toMatch(/abcd EFGH|abcdEFGH/);
  });
});
