import { expect, test } from '@playwright/test';
import { PrismaClient, encryptSecret } from '../../packages/database/dist/index.js';

/** แพ็กเกจ + โควต้า + ภาพรวมทุกเพจ: สร้างแพ็กเกจจากตัวอย่าง → กำหนดให้เพจ → เห็นโควต้า/รายได้ → CSV (ไม่แตะเพจจริง) */
test('portfolio: create a package from a template, assign it, see quota and revenue', async ({ page }) => {
  const db = new PrismaClient(); const secret = process.env.AUTH_SECRET ?? 'e2e-only-secret-at-least-32-characters-long!!';
  const stamp = Date.now(); let ws = ''; let userId = ''; const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto('/register'); await page.getByLabel('ชื่อ', { exact: true }).fill('ทีมแพ็กเกจ'); await page.getByLabel('อีเมล').fill(`portfolio-${stamp}@test.local`); await page.getByLabel('รหัสผ่าน').fill('portfolio-password-123');
    await page.getByRole('button', { name: 'สมัครใช้งาน' }).click(); await expect(page.locator('h1.brand-gradient')).toBeVisible();
    const me = await (await page.request.get('/api/auth/me')).json(); ws = me.workspaces[0].id; userId = me.user.id;
    const client = await db.client.create({ data: { workspaceId: ws, name: 'คลินิกฟันสวย' } });
    const brand = await db.brand.create({ data: { clientId: client.id, name: 'ฟันสวย' } });
    const conn = await db.facebookConnection.create({ data: { workspaceId: ws, userId, providerUserId: `pf-${stamp}`, encryptedAccessToken: encryptSecret('PF_USER_TOKEN', secret), scopes: [] } });
    const p1 = await db.facebookPage.create({ data: { brandId: brand.id, connectionId: conn.id, facebookPageId: `pf1-${stamp}`, name: 'เพจคลินิกฟันสวย', pageAccessTokenEncrypted: encryptSecret('PF_PAGE_1', secret) } });
    await db.facebookPage.create({ data: { brandId: brand.id, connectionId: conn.id, facebookPageId: `pf2-${stamp}`, name: 'เพจสาขาสอง', pageAccessTokenEncrypted: encryptSecret('PF_PAGE_2', secret) } });
    await db.contentItem.create({ data: { pageId: p1.id, caption: 'a', status: 'PUBLISHED', publishedAt: new Date(Date.now() - 60_000) } });
    await db.contentItem.create({ data: { pageId: p1.id, caption: 'b', status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 30 * 60_000) } });

    await page.getByRole('link', { name: 'ภาพรวมทุกเพจ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ภาพรวมทุกเพจ' })).toBeVisible();
    await page.getByRole('tab', { name: /แพ็กเกจ/ }).click();
    await page.getByRole('button', { name: /มาตรฐาน ฿990/ }).click();
    await expect(page.getByLabel('ชื่อแพ็กเกจ')).toHaveValue('มาตรฐาน');
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(page.getByText('12 โพสต์/เดือน · Reels 2')).toBeVisible();

    await page.getByRole('tab', { name: 'เพจ', exact: true }).click();
    const card = page.locator('section', { hasText: 'เพจคลินิกฟันสวย' });
    await card.getByRole('button', { name: 'กำหนดแพ็กเกจ' }).click();
    await card.getByLabel('แพ็กเกจ').selectOption({ label: 'มาตรฐาน (12)' }); await card.getByLabel('วันตัดรอบ').selectOption('1');
    await card.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(card.getByText('เหลือ 10')).toBeVisible();
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    await expect(page.getByText('฿990').first()).toBeVisible();
    await page.getByRole('button', { name: 'ยังไม่มีแพ็กเกจ' }).click();
    await expect(page.locator('section', { hasText: 'เพจสาขาสอง' })).toBeVisible(); await expect(page.locator('section', { hasText: 'เพจคลินิกฟันสวย' })).toHaveCount(0);

    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /CSV/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^portfolio-.*\.csv$/);
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click();
    await page.screenshot({ path: 'test-results/portfolio-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.goto(`/pages/${p1.id}`); await expect(page.getByText('โควต้าโพสต์').first()).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/PF_PAGE|PF_USER_TOKEN/);
    expect(errors).toEqual([]);
  } finally {
    if (ws) await db.workspace.delete({ where: { id: ws } }); if (userId) await db.user.delete({ where: { id: userId } }); await db.$disconnect();
  }
});
