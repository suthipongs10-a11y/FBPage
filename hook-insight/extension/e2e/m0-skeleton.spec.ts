import type { ConsoleMessage, Page } from '@playwright/test';
import { expect, stubPlatformPage, test } from './fixtures';

/**
 * Gate ของ M0 (CLAUDE.md ข้อ 7)
 * - โหลด unpacked ใน Chrome ได้
 * - ไม่มี error ใน console
 * - content script ยิง log เข้า background ได้
 */

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error: Error) => {
    problems.push(error.message);
  });
  return problems;
}

test('ส่วนขยายโหลดได้ และ manifest ตรงกับ CLAUDE.md ข้อ 9', async ({
  serviceWorker,
  extensionId,
}) => {
  expect(extensionId).not.toHaveLength(0);

  const manifest = await serviceWorker.evaluate(() =>
    chrome.runtime.getManifest(),
  );

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions?.sort()).toEqual([
    'scripting',
    'sidePanel',
    'storage',
  ]);
  expect(manifest.host_permissions).toEqual([
    'https://www.tiktok.com/*',
    'https://www.instagram.com/*',
  ]);
});

test('คลิกไอคอนบนทูลบาร์แล้วแผงข้างเปิด', async ({ serviceWorker }) => {
  const behavior = await serviceWorker.evaluate(() =>
    chrome.sidePanel.getPanelBehavior(),
  );

  expect(behavior.openPanelOnActionClick).toBe(true);
});

test('แผงข้างเปิดได้ ไม่มี error ใน console', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const problems = watchConsole(page);

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(page.getByRole('heading', { name: 'Hook Insight' })).toBeVisible();
  await expect(
    page.getByText('ยังไม่มีคลิปในคลัง — เปิด TikTok แล้วกดปุ่มเก็บที่มุมคลิป'),
  ).toBeVisible();
  // Dexie ต่อติดจริง ไม่ใช่แค่ import ผ่าน
  await expect(page.getByText('คลังในเครื่อง (IndexedDB)')).toBeVisible();
  await expect(page.getByText('ต่อไม่ได้')).toHaveCount(0);

  expect(problems).toEqual([]);
});

test('หน้าตั้งค่าเปิดได้ ไม่มี error ใน console', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const problems = watchConsole(page);

  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(
    page.getByRole('heading', { name: 'ตั้งค่า · Hook Insight' }),
  ).toBeVisible();
  await expect(page.getByText('ข้อมูลของคุณไปไหนบ้าง')).toBeVisible();

  expect(problems).toEqual([]);
});

test('MAIN world → ISOLATED → background ส่งถึงกันจริง', async ({
  context,
  serviceWorker,
}) => {
  await stubPlatformPage(context, 'https://www.tiktok.com/**');

  const page = await context.newPage();
  const problems = watchConsole(page);
  await page.goto('https://www.tiktok.com/');

  await expect
    .poll(
      async () => {
        const stored = await serviceWorker.evaluate(() =>
          chrome.storage.local.get('diagnostics:lastProbe'),
        );
        const probe = stored['diagnostics:lastProbe'] as
          | { platform: string; bridgeReady: boolean }
          | undefined;
        return probe?.bridgeReady === true ? probe.platform : null;
      },
      { timeout: 10_000 },
    )
    .toBe('tiktok');

  expect(problems).toEqual([]);
});
