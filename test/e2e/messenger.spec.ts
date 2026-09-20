import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { PrismaClient, encryptSecret } from '../../packages/database/dist/index.js';
import { startMockMessenger } from '../../packages/messenger-core/dist/index.js';
import { Queue, Worker } from '../../workers/scheduler/node_modules/bullmq';
import { buildMessengerDeps, handleMessenger } from '../../workers/scheduler/dist/messenger.js';
import { redisConnectionFromUrl } from '../../workers/scheduler/dist/queues.js';

test('Messenger: separate OpenAI key, target Page toggle, automatic reply, takeover and mobile inbox', async ({ page }) => {
  const mock = await startMockMessenger(4998); const db = new PrismaClient();
  const secret = process.env.AUTH_SECRET ?? 'e2e-only-secret-at-least-32-characters-long!!';
  const redis = redisConnectionFromUrl(process.env.REDIS_URL!); const queue = new Queue('messenger', { connection: redis });
  const deps = buildMessengerDeps(db, secret, { APP_ENV: 'test', META_APP_ID: '123', META_GRAPH_BASE_URL: mock.url, MESSENGER_AI_MOCK_BASE_URL: `${mock.url}/v1` });
  const worker = new Worker('messenger', job => handleMessenger(deps, queue, job), { connection: redis, concurrency: 2 });
  let ws = ''; let userId = ''; const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto('/register'); await page.getByLabel('ชื่อ', { exact: true }).fill('ทีมแชททดสอบ'); await page.getByLabel('อีเมล').fill(`messenger-browser-${Date.now()}@test.local`); await page.getByLabel('รหัสผ่าน').fill('messenger-browser-password-123'); await page.getByRole('button', { name: 'สมัครใช้งาน' }).click();
    await expect(page.locator('h1.brand-gradient')).toBeVisible();
    const me = await (await page.request.get('/api/auth/me')).json(); ws = me.workspaces[0].id; userId = me.user.id;
    const client = await db.client.create({ data: { workspaceId: ws, name: 'ลูกค้าทดสอบแชท' } });
    const brand = await db.brand.create({ data: { clientId: client.id, name: 'แบรนด์แชท', knowledge: { create: { type: 'price', title: 'บริการ', content: 'บริการทำความสะอาดเริ่มต้น 900 บาทค่ะ' } } } });
    const connection = await db.facebookConnection.create({ data: { workspaceId: ws, userId, providerUserId: `browser-${Date.now()}`, encryptedAccessToken: encryptSecret('BROWSER_USER_TOKEN', secret), scopes: ['pages_messaging'] } });
    const target = await db.facebookPage.create({ data: { brandId: brand.id, connectionId: connection.id, facebookPageId: `browser-page-${Date.now()}`, name: 'เพจเป้าหมายทดสอบ', pageAccessTokenEncrypted: encryptSecret('BROWSER_PAGE_TOKEN', secret) } });
    await page.getByRole('link', { name: 'แชทอัตโนมัติ', exact: true }).click(); await expect(page.getByRole('heading', { name: 'แชทอัตโนมัติ', exact: true })).toBeVisible();
    await page.getByLabel('API key สำหรับแชท', { exact: true }).fill('BROWSER_MESSENGER_KEY'); await page.getByLabel('โมเดล OpenAI', { exact: true }).fill('mock-chat');
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click(); await expect(page.getByLabel('API key สำหรับแชท').first()).toHaveValue('');
    await page.getByRole('combobox', { name: 'เลือกเพจเป้าหมาย' }).selectOption(target.id);
    await expect(page.getByRole('button', { name: 'เปิดตอบอัตโนมัติ', exact: true })).toBeDisabled();
    await page.getByLabel('คำถามตัวอย่างจากลูกค้า').fill('บริการราคาเท่าไหร่คะ'); await page.getByRole('button', { name: 'วิเคราะห์และทดลองตอบ' }).click(); await expect(page.getByText('บริการทำความสะอาดเริ่มต้น 900 บาทค่ะ', { exact: true })).toBeVisible(); expect(mock.state.sends).toHaveLength(0);
    await page.getByRole('button', { name: 'เชื่อมรับข้อความจากเพจ', exact: true }).click(); await expect(page.getByRole('button', { name: 'เชื่อมรับข้อความแล้ว' })).toBeVisible();
    await page.getByRole('button', { name: 'เปิดตอบอัตโนมัติ', exact: true }).click(); await expect(page.getByRole('button', { name: 'ปิดตอบอัตโนมัติ', exact: true })).toBeVisible();
    const body = JSON.stringify({ object: 'page', entry: [{ id: target.facebookPageId, messaging: [{ sender: { id: 'browser-customer' }, recipient: { id: target.facebookPageId }, timestamp: Date.now(), message: { mid: 'browser-incoming-1', text: 'ราคาเท่าไหร่คะ' } }] }] });
    const r = await page.request.post('/api/facebook/webhook', { data: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'e2e-messenger-meta').update(body).digest('hex') } }); expect(r.ok(), await r.text()).toBe(true);
    await expect.poll(() => mock.state.sends.length, { timeout: 10000 }).toBe(1);
    await page.getByRole('button', { name: 'รีเฟรช', exact: true }).click(); await page.getByRole('button', { name: /ลูกค้า · customer/ }).click();
    await expect(page.getByText('ส่งแล้ว', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'หยุด AI และรับช่วง', exact: true }).click(); await expect(page.getByRole('button', { name: 'ให้ AI ตอบข้อความใหม่ต่อ' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'test-results/messenger-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(await page.locator('body').innerText()).not.toContain('BROWSER_MESSENGER_KEY'); expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'ปิดตอบอัตโนมัติ', exact: true }).click(); await expect(page.getByRole('button', { name: 'เปิดตอบอัตโนมัติ', exact: true })).toBeVisible();
  } finally {
    await worker.close(); await queue.close();
    if (ws) await db.workspace.delete({ where: { id: ws } }); if (userId) await db.user.delete({ where: { id: userId } }); await db.$disconnect(); mock.server.closeAllConnections(); mock.server.close();
  }
});
