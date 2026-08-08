import {
  chromium,
  test as base,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../.output/chrome-mv3',
);

/**
 * บาง environment มี Chromium ติดตั้งไว้ให้แล้วคนละ build กับที่ Playwright คาดหวัง
 * ถ้าเจอก็ใช้ตัวนั้น ถ้าไม่เจอก็ปล่อยให้ Playwright เลือกเอง
 */
function findPrebuiltChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;

  const candidates = readdirSync(root)
    .filter((entry) => entry.startsWith('chromium-'))
    .map((entry) => join(root, entry, 'chrome-linux', 'chrome'))
    .filter((path) => existsSync(path));

  return candidates[0];
}

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

/** โหลด unpacked จริงเหมือนที่ผู้ใช้กด "Load unpacked" ใน Chrome */
export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'hook-insight-'));
    const executablePath = findPrebuiltChromium();
    const context = await chromium.launchPersistentContext(userDataDir, {
      // ต้องใช้ Chrome ตัวเต็ม ไม่ใช่ headless shell ไม่งั้นโหลดส่วนขยายไม่ได้
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const existing = context.serviceWorkers()[0];
    const worker = existing ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

export const expect = test.expect;

/**
 * หน้า TikTok ปลอมที่เสิร์ฟจากเครื่อง — ทดสอบการฉีด content script ได้
 * โดยไม่ต้องยิง request จริงไปหาแพลตฟอร์ม
 */
export async function stubPlatformPage(
  context: BrowserContext,
  urlPattern: string,
): Promise<void> {
  await context.route(urlPattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="en"><head><title>stub</title></head><body>stub</body></html>',
    }),
  );
}
