/**
 * E2E ผ่านเบราว์เซอร์จริง — สมัคร/ล็อกอิน → ภาพรวม → เชื่อมเพจ (mock Graph) → อนุมัติคอนเทนต์ในหน้าเว็บ → YouTube (mock) → กราฟแนวโน้ม → ลิงก์แชร์รายงาน
 * ข้อมูลตั้งต้นบางส่วนสร้างผ่าน API (ผ่าน Next proxy) เพื่อให้ test สั้นและตรวจเฉพาะสิ่งที่ผู้ใช้เห็นจริง
 * ห้ามชี้ไปเพจ/ช่อง/AI จริง — mock ทั้งหมดเปิดบนพอร์ตคงที่ที่ playwright.config.ts ตั้งให้ API
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { startMockGraph } from '../../packages/facebook-core/dist/mock-graph.js';
import { startMockYouTube } from '../../packages/youtube-core/dist/mock-youtube.js';
import { startMockAi } from '../../packages/ai-core/dist/mock-ai.js';
import { startMockWeb } from '../../packages/web-core/dist/mock-web.js';

const stamp = Date.now();
const USER = { email: `e2e-${stamp}@test.local`, name: 'E2E User', password: 'e2e-password-12345' };
let graph: Awaited<ReturnType<typeof startMockGraph>>; let yt: Awaited<ReturnType<typeof startMockYouTube>>; let ai: Awaited<ReturnType<typeof startMockAi>>; let web: Awaited<ReturnType<typeof startMockWeb>>;
let ws = ''; let pageId = ''; let channelId = ''; let contentId = '';

test.beforeAll(async () => {
  graph = await startMockGraph(4998); yt = await startMockYouTube(4997); ai = await startMockAi(); web = await startMockWeb(4996);
  graph.state.validUserTokens.add('USER_OK_E2E_TOKEN_1234567890');
});
test.afterAll(async () => { graph.server.close(); yt.server.close(); ai.server.close(); web.server.close(); });

test.describe.configure({ mode: 'serial' });

test('register through the UI lands on the overview with the workspace', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('ชื่อ', { exact: true }).fill(USER.name);
  await page.getByLabel('อีเมล').fill(USER.email);
  await page.getByLabel('รหัสผ่าน').fill(USER.password);
  await page.getByRole('button', { name: 'สมัครใช้งาน' }).click();
  await expect(page.locator('h1.brand-gradient')).toBeVisible();   // hero ของหน้าภาพรวม
  await expect(page.getByText('ลูกค้า', { exact: true }).first()).toBeVisible();
});

test('login, seed a client/brand/page via API, and see the page on the Pages screen', async ({ page }) => {
  await login(page);
  const me = await api(page.request, 'GET', '/auth/me'); ws = me.workspaces[0].id;
  const c = await api(page.request, 'POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้า E2E' });
  const b = await api(page.request, 'POST', `/workspaces/${ws}/clients/${c.id}/brands`, { name: 'แบรนด์ E2E', primaryCTA: 'ทักแชท' });
  const conn = await api(page.request, 'POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: 'USER_OK_E2E_TOKEN_1234567890' });
  const pg = await api(page.request, 'POST', `/workspaces/${ws}/brands/${b.id}/pages/connect`, { connectionId: conn.connection.id, facebookPageId: '111' }); pageId = pg.id;
  await api(page.request, 'PUT', `/workspaces/${ws}/ai/providers/compatible`, { apiKey: 'MOCK_KEY', baseUrl: ai.url });
  await api(page.request, 'PUT', `/workspaces/${ws}/ai/roles`, { roles: { strategy: { provider: 'compatible', model: 'm' }, content: { provider: 'compatible', model: 'm' }, analysis: { provider: 'compatible', model: 'm' }, community: { provider: 'compatible', model: 'm' }, fast: { provider: 'compatible', model: 'm' } } });
  await page.goto('/pages');
  await expect(page.getByText(pg.name).first()).toBeVisible();
  await expect(page.getByText('USER_OK_E2E_TOKEN')).toHaveCount(0);   // token ไม่หลุดมาหน้าเว็บ
});

test('content approval happens in the browser: draft → submit → approve', async ({ page }) => {
  await login(page);
  const d = await api(page.request, 'POST', `/workspaces/${ws}/content`, { pageId, title: 'e2e draft', caption: `โพสต์ทดสอบ e2e ${stamp}`, hashtags: ['e2e'] }); contentId = d.id;
  ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
  await api(page.request, 'POST', `/workspaces/${ws}/content/${contentId}/submit`, {});
  await page.goto('/content');
  const card = page.locator('div.rounded-xl', { hasText: 'e2e draft' }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await expect(card.getByText('อนุมัติแล้ว')).toBeVisible();
  const fresh = await api(page.request, 'GET', `/workspaces/${ws}/content/${contentId}`); expect(fresh.status).toBe('APPROVED');
});

test('YouTube: connect via pasted refresh token (mock Google), channel and videos appear, analytics charts render', async ({ page }) => {
  await login(page);
  const brand = (await api(page.request, 'GET', `/workspaces/${ws}/clients`))[0];
  const detail = await api(page.request, 'GET', `/workspaces/${ws}/clients/${brand.id}`);
  await page.goto('/youtube');
  await expect(page.getByRole('heading', { name: 'YouTube Channel Manager' })).toBeVisible();
  await page.getByRole('button', { name: 'วาง refresh token' }).click();
  await page.getByPlaceholder('1//0g…').fill('REFRESH_OK');
  await page.getByRole('button', { name: 'บันทึก' }).click();
  await expect(page.getByText('owner@example.com').first()).toBeVisible();
  await expect(page.getByText('REFRESH_OK')).toHaveCount(0);
  await page.getByRole('button', { name: 'เชื่อมช่อง' }).click();
  await expect(page.getByText('เกษตรก้าวหน้า').first()).toBeVisible({ timeout: 20_000 });
  const chans = await api(page.request, 'GET', `/workspaces/${ws}/youtube/channels`); channelId = chans[0].id; expect(chans[0].brandId).toBe(detail.brands[0].id);
  await page.goto('/youtube/videos');
  await expect(page.getByText('ใส่ปุ๋ยยูเรียตอนไหนดีที่สุด')).toBeVisible();
  await expect(page.locator('td', { hasText: 'Shorts' }).first()).toBeVisible();
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'วิเคราะห์แนวโน้ม' })).toBeVisible();
  await expect(page.getByText('โพสต์ต่อสัปดาห์').first()).toBeVisible();
  await expect(page.getByText('วิดีโอต่อสัปดาห์').first()).toBeVisible();
  await expect(page.locator('svg[role="img"]').first()).toBeVisible();
});

test('Websites: add a site in the UI, see status/SEO issues, connect Search Console and see top queries', async ({ page }) => {
  await login(page);
  await page.goto('/web');
  await page.getByRole('button', { name: 'เพิ่มเว็บไซต์' }).click();
  await page.getByPlaceholder('https://www.example.com').fill(web.siteUrl);
  await page.getByRole('button', { name: 'บันทึก' }).click();
  await expect(page.getByText('ปกติ').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/รูป 1\/2 ไม่มี alt/).first()).toBeVisible();
  await page.getByRole('button', { name: 'เชื่อม Search Console', exact: true }).click();
  await expect(page.getByText('ทำความสะอาดบ้าน ภูเก็ต').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('sc-domain:127.0.0.1').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('เว็บไซต์', { exact: true }).first()).toBeVisible();
});

test('report share link opens without a session and offers PDF', async ({ page, browser }) => {
  await login(page);
  const rep = await api(page.request, 'POST', `/workspaces/${ws}/youtube/channels/${channelId}/reports`, { month: new Date().toISOString().slice(0, 7), withAi: false });
  const sh = await api(page.request, 'POST', `/workspaces/${ws}/youtube/reports/${rep.id}/share`, { days: 7 });
  const anon = await browser.newContext(); const p2 = await anon.newPage();
  await p2.goto(sh.url);
  await expect(p2.getByRole('heading', { name: /รายงานช่อง YouTube/ })).toBeVisible();
  await expect(p2.getByText('ไม่มีข้อมูล').first()).toBeVisible();   // รายได้ไม่มีสิทธิ์อ่าน → ไม่ใช่ 0
  await expect(p2.getByRole('link', { name: 'ดาวน์โหลด PDF' })).toBeVisible();
  await anon.close();
});

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('อีเมล').fill(USER.email);
  await page.getByLabel('รหัสผ่าน').fill(USER.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.locator('h1.brand-gradient')).toBeVisible();   // hero ของหน้าภาพรวม
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(request: APIRequestContext, method: string, path: string, data?: unknown): Promise<any> {
  const res = await request.fetch(`http://127.0.0.1:3000/api${path}`, { method, data, headers: { 'content-type': 'application/json' } });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return res.json();
}
