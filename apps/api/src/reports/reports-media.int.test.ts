/** Integration — Report service (§34/§64) + Media service (§63) กับ mock Graph/mock AI และ Chromium จริง (ข้ามส่วนเรนเดอร์ถ้าไม่มี Chromium) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
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
    const buf = Buffer.from(await res.arrayBuffer()); const text = buf.toString('utf8'); let json: any = null; try { json = JSON.parse(text); } catch { /* */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, json, text, buf, type: res.headers.get('content-type') };
  } };
  return c;
}

run('reports + media (integration)', () => {
  let app: INestApplication; let base: string; let prisma: PrismaClient; let graph: Awaited<ReturnType<typeof startMockGraph>>; let ai: Awaited<ReturnType<typeof startMockAi>>;
  const stamp = Date.now(); const A = { email: `rp-${stamp}@test.local`, name: 'Alice', password: 'alice-password-123' };
  let a: ReturnType<typeof client>; let ws = ''; let pageA = ''; let cid = '';
  beforeAll(async () => {
    graph = await startMockGraph(); ai = await startMockAi();
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars'; process.env.META_GRAPH_BASE_URL = graph.url; process.env.MEDIA_DIR = `/tmp/fbpm-media-test-${stamp}`;
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    a = client(base); prisma = new PrismaClient();
    ws = (await a.http('POST', '/auth/register', A)).json.workspace.id;
    const c = await a.http('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้า R' });
    const brand = (await a.http('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'แบรนด์ R' })).json.id;
    graph.state.validUserTokens.add('USER_OK_LONG_TOKEN_FOR_REPORT_TEST');
    const conn = await a.http('POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: 'USER_OK_LONG_TOKEN_FOR_REPORT_TEST' });
    pageA = (await a.http('POST', `/workspaces/${ws}/brands/${brand}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' })).json.id;
    cid = (await a.http('POST', `/workspaces/${ws}/content`, { pageId: pageA, title: 'การ์ด', caption: 'ไรฝุ่นคือตัวอันตราย ลดได้ด้วย 3 วิธี' })).json.id;
  }, 30_000);
  afterAll(async () => { delete process.env.META_GRAPH_BASE_URL; await prisma.workspace.deleteMany({ where: { id: ws } }); await prisma.user.deleteMany({ where: { email: A.email } }); await prisma.$disconnect(); await app.close(); graph.server.close(); ai.server.close(); });

  it('generates a report for the current period from saved data without AI, with honest limitations and shareable text', async () => {
    const now = new Date(); const from = new Date(now.getTime() - 10 * 86_400_000).toISOString(); const to = new Date(now.getTime() + 60_000).toISOString();
    const r = await a.http('POST', `/workspaces/${ws}/pages/${pageA}/reports`, { from, to, withAi: false });
    expect(r.status, r.text).toBe(200);
    const d = r.json.data;
    expect(d.publishing.posts).toBe(2); expect(d.metricsAvailable).toEqual({ shares: true, reactions: false, comments: false });
    expect(d.topPosts[0].facebookPostId).toBe('111_1'); expect(d.topPosts[0].shares).toBe(3);
    expect(d.dataLimitations.join(' ')).toMatch(/ถูกใจ.*อ่านไม่ได้/);
    expect(d.summary).toBeNull(); expect(d.text).toContain('รายงานเพจ ระเบียงบุญ'); expect(d.text).toContain('อ่านไม่ได้');
    const list = await a.http('GET', `/workspaces/${ws}/pages/${pageA}/reports`); expect(list.json).toHaveLength(1); expect(list.json[0].hasSummary).toBe(false);
    const one = await a.http('GET', `/workspaces/${ws}/reports/${r.json.id}`); expect(one.json.data.publishing.posts).toBe(2);
  });
  it('weekly trends come from saved data with null for unreadable metrics', async () => {
    const r = await a.http('GET', `/workspaces/${ws}/pages/${pageA}/trends?weeks=8`);
    expect(r.status, r.text).toBe(200); expect(r.json.weeks).toHaveLength(8); expect(r.json.weeks.reduce((n: number, w: { posts: number }) => n + w.posts, 0)).toBeGreaterThanOrEqual(2);
    expect(r.json.limitations.length).toBeGreaterThan(0); expect(JSON.stringify(r.json.weeks)).not.toMatch(/"reactions":0/);   // อ่านไม่ได้ = null ไม่ใช่ 0
  });
  it('PDF export renders with Chromium; client share link is public, read-only, expiring and never leaks internals', async () => {
    const list = await a.http('GET', `/workspaces/${ws}/pages/${pageA}/reports`); const id = list.json[0].id as string;
    const pdf = await fetch(`${base}/workspaces/${ws}/reports/${id}/pdf`, { headers: { cookie: a.cookie } });
    expect(pdf.status).toBe(200); expect(pdf.headers.get('content-type')).toContain('application/pdf'); expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
    const sh = await a.http('POST', `/workspaces/${ws}/reports/${id}/share`, { days: 7 });
    expect(sh.status, sh.text).toBe(200); expect(sh.json.url).toMatch(/\/share\/r\//); const token = sh.json.url.split('/share/r/')[1];
    const pub = await fetch(`${base}/share/reports/${token}`); const body = await pub.json() as { kind: string; data: { publishing: { posts: number } }; brand: string };
    expect(pub.status).toBe(200); expect(body.kind).toBe('facebook'); expect(body.data.publishing.posts).toBe(2); expect(body.brand).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/Encrypted|accessToken|pageAccessToken/);
    const pubPdf = await fetch(`${base}/share/reports/${token}/pdf`); expect(pubPdf.status).toBe(200); expect(pubPdf.headers.get('content-type')).toContain('application/pdf');
    expect((await fetch(`${base}/share/reports/${token.slice(0, -4)}xxxx`)).status).toBe(404);
    expect((await fetch(`${base}/share/reports/${token}`, { method: 'POST' })).status).toBe(404);   // อ่านอย่างเดียว
  });

  it('with AI configured, the report stores a structured executive summary (no re-run on read)', async () => {
    await a.http('PUT', `/workspaces/${ws}/ai/providers/compatible`, { apiKey: 'MOCK_KEY', baseUrl: ai.url });
    await a.http('PUT', `/workspaces/${ws}/ai/roles`, { roles: { analysis: { provider: 'compatible', model: 'm-analysis' }, content: { provider: 'compatible', model: 'm-content' } } });
    ai.state.replies.push({ text: JSON.stringify({ executiveSummary: 'เดือนนี้โพสต์ 2 รายการ', whatHappened: ['x'], whyItHappened: ['y'], repeat: ['โพสต์ความรู้'], stop: [], experiments: ['ลองวิดีโอ'], nextMonthFocus: ['ความสม่ำเสมอ'] }) });
    const r = await a.http('POST', `/workspaces/${ws}/pages/${pageA}/reports`, { month: new Date().toISOString().slice(0, 7) });
    expect(r.status, r.text).toBe(200); expect(r.json.data.summary.executiveSummary).toContain('2 รายการ'); expect(r.json.model).toBe('m-analysis');
    expect(r.json.data.text).toContain('[ สรุปผู้บริหาร ]');
    const before = ai.state.requests.length;
    await a.http('GET', `/workspaces/${ws}/reports/${r.json.id}`);
    expect(ai.state.requests.length).toBe(before);   // เปิดดูไม่เรียก AI ซ้ำ (§64)
  });

  it('media capabilities + card render + AI card design attach files to the content', async () => {
    const cap = await a.http('GET', `/workspaces/${ws}/media/capabilities`);
    expect(cap.json.templates).toContain('tips');
    if (!cap.json.chromium) { console.warn('skip: no Chromium'); return; }
    const r = await a.http('POST', `/workspaces/${ws}/content/${cid}/media/card`, { template: 'tips', data: { theme: 'ocean', kicker: 'รู้ไว้', title: 'ลดไรฝุ่น 3 วิธี', items: [{ title: 'ซักผ้าปูน้ำร้อน' }, { title: 'ตากที่นอน' }, { title: 'ดูดฝุ่นทุกสัปดาห์' }], brand: 'Phuket Maids' } });
    expect(r.status, r.text).toBe(200); expect(r.json.mimeType).toBe('image/png'); expect(r.json.bytes).toBeGreaterThan(10_000); expect(existsSync(r.json.path)).toBe(true);
    const c = await a.http('GET', `/workspaces/${ws}/content/${cid}`); expect(c.json.mediaPaths).toEqual([r.json.path]); expect(c.json.contentType).toBe('photo');
    const f = await a.http('GET', `/workspaces/${ws}/media/${r.json.id}/file`); expect(f.status).toBe(200); expect(f.type).toBe('image/png'); expect(f.buf.subarray(1, 4).toString()).toBe('PNG');
    const bad = await a.http('POST', `/workspaces/${ws}/content/${cid}/media/card`, { template: 'hero', data: { title: 'x', svg: '<svg onload="alert(1)"></svg>' } });
    expect(bad.status).toBe(200);   // svg ไม่ปลอดภัยถูกตัดทิ้ง ไม่ล้ม
    ai.state.replies.push({ text: JSON.stringify({ template: 'quote', data: { kicker: 'รู้ไหม', quote: 'ไรฝุ่นคือ *ตัวอันตราย*', sub: 'ลดได้ด้วย 3 วิธีง่ายๆ', theme: 'ocean' } }) });
    const aiCard = await a.http('POST', `/workspaces/${ws}/content/${cid}/media/card/ai`, { theme: 'ocean' });
    expect(aiCard.status, aiCard.text).toBe(200); expect(aiCard.json.design.template).toBe('quote'); expect(aiCard.json.design.data.brand).toBe('ระเบียงบุญ');
    const c2 = await a.http('GET', `/workspaces/${ws}/content/${cid}`); expect(c2.json.mediaPaths).toHaveLength(3);
    const list = await a.http('GET', `/workspaces/${ws}/media?contentId=${cid}`); expect(list.json).toHaveLength(3);
    const del = await a.http('DELETE', `/workspaces/${ws}/media/${r.json.id}`); expect(del.status).toBe(200);
    expect((await a.http('GET', `/workspaces/${ws}/content/${cid}`)).json.mediaPaths).toHaveLength(2); expect(existsSync(r.json.path)).toBe(false);
    // เผยแพร่พร้อมรูป (ไฟล์ในเครื่อง) → publisher อัปโหลด photos ก่อนแล้วแนบ (mock บันทึก 2 photos + 1 feed)
    ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
    const sub = await a.http('POST', `/workspaces/${ws}/content/${cid}/submit`, {}); expect(sub.json.status, sub.text).toBe('READY_FOR_APPROVAL');
    const ap = await a.http('POST', `/workspaces/${ws}/content/${cid}/approve`, {}); expect(ap.json.status, ap.text).toBe('APPROVED');
    const before = graph.state.published.length;
    const pub = await a.http('POST', `/workspaces/${ws}/content/${cid}/publish`, {});
    expect(pub.status, pub.text).toBe(200); expect(pub.json.outcome.status, pub.text).toBe('PUBLISHED'); expect(graph.state.published.length).toBe(before + 3);
    expect(graph.state.published.at(-1)!.body['attached_media[1]']).toContain('media_fbid');
  }, 60_000);
});
