import { expect, test } from '@playwright/test';
import { PrismaClient, encryptSecret, startMockLine } from '../../packages/database/dist/index.js';
import { startMockGraph } from '../../packages/facebook-core/dist/index.js';

/** พอร์ทัลลูกค้า + LINE: ทีมเชิญเจ้าของร้าน → เจ้าของตอบคอมเมนต์ อนุมัติโพสต์ ผูก LINE บนมือถือ (Graph/LINE จำลองเท่านั้น) */
test('client portal: invite owner, reply, approve, link LINE on a phone', async ({ page, browser }) => {
  const graph = await startMockGraph(4998); const line = await startMockLine(4993); const db = new PrismaClient();
  const secret = process.env.AUTH_SECRET ?? 'e2e-only-secret-at-least-32-characters-long!!';
  const stamp = Date.now(); const ownerEmail = `portal-owner-${stamp}@test.local`;
  let ws = ''; let userId = ''; const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  line.state.validTokens.add('E2E_LINE_TOKEN_LONG_ENOUGH_1234');
  try {
    await page.goto('/register'); await page.getByLabel('ชื่อ', { exact: true }).fill('ทีมพอร์ทัล'); await page.getByLabel('อีเมล').fill(`portal-team-${stamp}@test.local`); await page.getByLabel('รหัสผ่าน').fill('portal-password-123');
    await page.getByRole('button', { name: 'สมัครใช้งาน' }).click(); await expect(page.locator('h1.brand-gradient')).toBeVisible();
    const me = await (await page.request.get('/api/auth/me')).json(); ws = me.workspaces[0].id; userId = me.user.id;
    const client = await db.client.create({ data: { workspaceId: ws, name: 'ร้านข้าวมันไก่ทดสอบ' } });
    const brand = await db.brand.create({ data: { clientId: client.id, name: 'ข้าวมันไก่' } });
    const conn = await db.facebookConnection.create({ data: { workspaceId: ws, userId, providerUserId: `portal-${stamp}`, encryptedAccessToken: encryptSecret('PORTAL_USER_TOKEN', secret), scopes: ['pages_manage_engagement'] } });
    const fbPage = await db.facebookPage.create({ data: { brandId: brand.id, connectionId: conn.id, facebookPageId: '111', name: 'เพจข้าวมันไก่', pageAccessTokenEncrypted: encryptSecret('PAGE_111', secret) } });
    await db.pageComment.create({ data: { pageId: fbPage.id, facebookCommentId: `cmt_${stamp}`, fromId: 'u1', fromName: 'คุณเอ', message: 'เปิดกี่โมงคะ', createdTime: new Date(Date.now() - 3_600_000), draftReply: 'เปิด 7 โมงเช้าค่ะ' } });
    await db.contentItem.create({ data: { pageId: fbPage.id, title: 'โปรจันทร์', caption: 'ข้าวมันไก่ 2 จาน 99 บาท', status: 'READY_FOR_APPROVAL' } });

    // ทีม: ตั้ง LINE OA
    await page.goto('/settings');
    await page.getByLabel('Channel secret').fill('e2e-line-channel-secret'); await page.getByLabel('Channel access token (long-lived)').fill('E2E_LINE_TOKEN_LONG_ENOUGH_1234');
    await page.getByRole('button', { name: 'บันทึกและตรวจสอบ' }).click();
    await expect(page.getByText('Webhook URL (ใส่ใน LINE Developers)')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('E2E_LINE_TOKEN_LONG_ENOUGH_1234');

    // ทีม: เชิญเจ้าของร้าน
    await page.goto(`/clients/${client.id}`);
    await page.getByLabel(/อีเมลเจ้าของธุรกิจ/).fill(ownerEmail); await page.getByRole('button', { name: 'สร้างลิงก์เชิญ' }).click();
    const link = (await page.locator('code', { hasText: '/portal/join/' }).innerText()).trim();
    expect(link).toContain('/portal/join/');

    // เจ้าของร้าน (มือถือ, คนละ session)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'th-TH' }); const owner = await ctx.newPage(); owner.on('pageerror', e => errors.push(e.message));
    await owner.goto(new URL(link).pathname);
    await expect(owner.getByText('ร้านข้าวมันไก่ทดสอบ')).toBeVisible();
    await owner.getByLabel(/ชื่อ/).fill('เจ้าของร้าน'); await owner.getByLabel('รหัสผ่าน').fill('owner-password-123');
    await owner.getByRole('button', { name: 'เข้าใช้งาน' }).click();
    await expect(owner.getByRole('heading', { name: 'ร้านข้าวมันไก่ทดสอบ' })).toBeVisible();
    await expect(owner.getByText('เปิดกี่โมงคะ')).toBeVisible();
    await expect(owner.getByLabel('คำตอบ')).toHaveValue('เปิด 7 โมงเช้าค่ะ');
    await owner.getByLabel('คำตอบ').fill('เปิด 7 โมงเช้าถึงบ่ายสองค่ะ'); await owner.getByRole('button', { name: 'ส่งคำตอบ' }).click();
    await expect.poll(() => graph.state.replies.length).toBe(1);
    await expect(owner.getByText('ไม่มีคอมเมนต์ค้างตอบ 🎉')).toBeVisible();

    await owner.getByRole('tab', { name: /อนุมัติโพสต์/ }).click();
    await expect(owner.getByText('ข้าวมันไก่ 2 จาน 99 บาท')).toBeVisible();
    await owner.getByRole('button', { name: /อนุมัติ$/ }).click();
    await expect(owner.getByText(/อนุมัติแล้ว — ทีมงานได้รับแจ้ง/)).toBeVisible();

    await owner.getByRole('tab', { name: /LINE/ }).click();
    await owner.getByRole('button', { name: 'ขอรหัสผูก LINE' }).click();
    await expect(owner.getByText(/^\d{6}$/)).toBeVisible();
    await expect(owner.getByRole('link', { name: /@fbpm-test/ })).toHaveAttribute('href', 'https://line.me/R/ti/p/%40fbpm-test');
    expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await owner.screenshot({ path: 'test-results/portal-mobile.png', fullPage: true });

    // เจ้าของร้านเข้าหน้าทีมไม่ได้ → ถูกพากลับพอร์ทัล
    await owner.goto('/');
    await expect(owner).toHaveURL(new RegExp(`/portal/${client.id}`));
    await ctx.close();
    expect(errors).toEqual([]);
  } finally {
    if (ws) await db.workspace.delete({ where: { id: ws } }); await db.user.deleteMany({ where: { OR: [{ id: userId || undefined }, { email: ownerEmail }] } });
    await db.$disconnect(); graph.server.closeAllConnections(); graph.server.close(); line.server.close();
  }
});
