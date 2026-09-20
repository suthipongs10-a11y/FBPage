import { expect, test } from '@playwright/test';
import { startMockTikTok } from '../../packages/tiktok-core/dist/mock.js';
import { readFile } from 'node:fs/promises';

test('TikTok: navigation, OAuth session, library, human approval and disabled upload in the browser', async ({ page }) => {
  const mock = await startMockTikTok(4994);
  try {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/register');
    await page.getByLabel('ชื่อ', { exact: true }).fill('TikTok Browser Test');
    await page.getByLabel('อีเมล').fill(`tiktok-browser-${Date.now()}@test.local`);
    await page.getByLabel('รหัสผ่าน').fill('browser-test-password-123');
    await page.getByRole('button', { name: 'สมัครใช้งาน' }).click();
    await expect(page.locator('h1.brand-gradient')).toBeVisible();
    const api = async (method: string, path: string, data?: unknown) => {
      const r = await page.request.fetch(`/api${path}`, { method, data });
      expect(r.ok(), await r.text()).toBe(true); return r.json();
    };
    const me = await api('GET', '/auth/me'); const ws = me.workspaces[0].id;
    const c = await api('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้า TikTok' });
    const b = await api('POST', `/workspaces/${ws}/clients/${c.id}/brands`, { name: 'แบรนด์ทดสอบ' });
    await page.getByRole('link', { name: 'TikTok', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'TikTok', exact: true })).toBeVisible();
    await expect(page.getByText('ยังไม่มีบัญชี TikTok ที่เชื่อมต่อ', { exact: true })).toBeVisible();
    const auth = await api('POST', `/workspaces/${ws}/tiktok/oauth/start`, { brandId: b.id });
    const state = new URL(auth.url).searchParams.get('state');
    // The callback and data APIs are real; only the external TikTok service is mocked.
    await page.goto(`/api/tiktok/oauth/callback?code=MOCK_CODE&state=${state}`);
    await expect(page.getByText('TikTok ทดสอบ · แบรนด์ทดสอบ', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ซิงก์ข้อมูล', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ซิงก์ข้อมูล', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'วิดีโอและผลงาน', exact: true }).click();
    await expect(page.getByText('วิดีโอ 2', { exact: true })).toBeVisible();
    await expect(page.getByText('แชร์: ไม่มีข้อมูล', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Content Studio', exact: true }).click();
    await page.getByLabel('ชื่อร่าง', { exact: true }).fill('ร่าง TikTok จากเบราว์เซอร์');
    await page.getByLabel('คำบรรยาย', { exact: true }).fill('คำบรรยายที่มนุษย์ตรวจแล้ว');
    await page.getByLabel('สคริปต์', { exact: true }).fill('เปิดคลิป อธิบายข้อมูลแบรนด์ ปิดท้ายชวนติดตาม');
    await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    const card = page.locator('article', { hasText: 'ร่าง TikTok จากเบราว์เซอร์' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'ส่งขออนุมัติ', exact: true })).toBeDisabled();
    await page.getByLabel('ฉันตรวจสคริปต์ คำบรรยาย ข้อมูลแบรนด์ และสิทธิ์ใช้วิดีโอแล้ว').check();
    await card.getByRole('button', { name: 'ส่งขออนุมัติ', exact: true }).click();
    await card.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await expect(card.getByRole('button', { name: 'ส่งเข้า Inbox', exact: true })).toBeDisabled();
    await expect(page.getByText(/เจ้าของบัญชีต้องเปิดการแจ้งเตือน/)).toBeVisible();
    expect(mock.state.inits).toBe(0);
    await expect(page.getByText(/ACCESS_SECRET|REFRESH_SECRET/)).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'test-results/tiktok-studio.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally { mock.server.closeAllConnections(); mock.server.close(); }
});

test('TikTok: prepare, approve and download a draft before connecting, then assign it and reapprove', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/register');
  await page.getByLabel('ชื่อ', { exact: true }).fill('ทีมเตรียมคอนเทนต์');
  await page.getByLabel('อีเมล').fill(`tiktok-offline-${Date.now()}@test.local`);
  await page.getByLabel('รหัสผ่าน').fill('offline-browser-password-12345');
  await page.getByRole('button', { name: 'สมัครใช้งาน' }).click();
  await expect(page.locator('h1.brand-gradient')).toBeVisible();
  const api = async (method: string, path: string, data?: unknown) => {
    const r = await page.request.fetch(`/api${path}`, { method, data }); expect(r.ok(), await r.text()).toBe(true); return r.json();
  };
  const ws = (await api('GET', '/auth/me')).workspaces[0].id;
  const c = await api('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้าเตรียมงาน' });
  const b = await api('POST', `/workspaces/${ws}/clients/${c.id}/brands`, { name: 'แบรนด์ยังไม่เชื่อมบัญชี' });
  await page.goto('/tiktok'); await page.getByRole('button', { name: 'Content Studio', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'แบรนด์', exact: true })).toHaveValue(b.id);
  await expect(page.getByRole('combobox', { name: 'เลือกบัญชี', exact: true })).toHaveValue('');
  await page.getByLabel('ชื่อร่าง', { exact: true }).fill('เตรียมงานก่อนมีคีย์');
  await page.getByLabel('สคริปต์', { exact: true }).fill('สคริปต์ภาษาไทยที่เตรียมได้โดยไม่เรียก AI');
  await page.getByLabel('คำบรรยาย', { exact: true }).fill('คำบรรยายฉบับตรวจแล้ว');
  await page.getByLabel('แฮชแท็ก', { exact: true }).fill('เตรียมงาน แบรนด์');
  await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  const card = page.locator('article', { hasText: 'เตรียมงานก่อนมีคีย์' }); await expect(card).toBeVisible();
  await page.getByLabel('ฉันตรวจสคริปต์ คำบรรยาย ข้อมูลแบรนด์ และสิทธิ์ใช้วิดีโอแล้ว').check();
  await card.getByRole('button', { name: 'ส่งขออนุมัติ', exact: true }).click();
  await card.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await expect(card.getByRole('button', { name: 'ส่งเข้า Inbox', exact: true })).toBeDisabled();
  expect(await api('GET', `/workspaces/${ws}/tiktok/accounts`)).toHaveLength(0);
  const downloadEvent = page.waitForEvent('download');
  await card.getByRole('button', { name: 'ดาวน์โหลดร่าง', exact: true }).click();
  const download = await downloadEvent; expect(download.suggestedFilename()).toMatch(/\.txt$/);
  expect(await readFile((await download.path())!, 'utf8')).toContain('สคริปต์ภาษาไทยที่เตรียมได้โดยไม่เรียก AI');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'test-results/tiktok-offline-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const mock = await startMockTikTok(4994);
  try {
    const auth = await api('POST', `/workspaces/${ws}/tiktok/oauth/start`, { brandId: b.id });
    const state = new URL(auth.url).searchParams.get('state'); await page.goto(`/api/tiktok/oauth/callback?code=MOCK_CODE&state=${state}`);
    await page.getByRole('button', { name: 'Content Studio', exact: true }).click();
    await card.getByRole('button', { name: 'ใช้บัญชีที่เลือกกับร่างนี้ (ต้องอนุมัติใหม่)', exact: true }).click();
    await expect(card.getByRole('button', { name: 'ส่งขออนุมัติ', exact: true })).toBeDisabled();
    const drafts = await api('GET', `/workspaces/${ws}/tiktok/content`); expect(drafts[0].status).toBe('DRAFT'); expect(drafts[0].tiktokAccountId).toBeTruthy();
    expect(mock.state.inits).toBe(0); expect(errors).toEqual([]);
  } finally { mock.server.closeAllConnections(); mock.server.close(); }
});
