/**
 * E2E (Playwright) — ขับหน้าเว็บจริงผ่าน Next proxy กับ API ที่ชี้ไป mock Graph/mock YouTube/mock AI เท่านั้น
 * รัน: pnpm build && pnpm test:e2e   (ต้องมี Postgres/Redis; API/web จะถูกเปิดให้เองถ้ายังไม่เปิด)
 * ใช้ Chromium ที่ติดตั้งไว้แล้ว (PLAYWRIGHT_CHROMIUM หรือ /opt/pw-browsers/chromium) — ไม่ดาวน์โหลดเบราว์เซอร์ใน CI
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineConfig } from '@playwright/test';

const windowsChrome = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((p): p is string => !!p).flatMap(p => [join(p, 'Google/Chrome/Application/chrome.exe'), join(p, 'Microsoft/Edge/Application/msedge.exe')]);
const chromium = [process.env.PLAYWRIGHT_CHROMIUM, process.env.CHROME_BIN, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', ...windowsChrome].find(p => p && existsSync(p));
const env = {
  ...process.env,
  APP_ENV: process.env.APP_ENV ?? 'test', APP_URL: 'http://127.0.0.1:3000', API_PORT: '4000', PORT: '4000',
  AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-only-secret-at-least-32-characters-long!!',
  MEDIA_DIR: process.env.MEDIA_DIR ?? join(tmpdir(), 'fbpm-e2e-media'),
  TIKTOK_CLIENT_KEY: 'MOCK_CLIENT', TIKTOK_CLIENT_SECRET: 'MOCK_SECRET', TIKTOK_REDIRECT_URI: 'http://127.0.0.1:3000/api/tiktok/oauth/callback', TIKTOK_MOCK_BASE_URL: 'http://127.0.0.1:4994', SOCIAL_PUBLISHING_ENABLED: 'false',
  META_GRAPH_BASE_URL: 'http://127.0.0.1:4998',
  META_APP_ID: '123', META_APP_SECRET: 'e2e-messenger-meta', META_WEBHOOK_VERIFY_TOKEN: 'e2e-messenger-verify',
  MESSENGER_AI_MOCK_BASE_URL: 'http://127.0.0.1:4998/v1',
  YOUTUBE_MOCK_BASE_URL: 'http://127.0.0.1:4997', GOOGLE_CLIENT_ID: 'gclient', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_OAUTH_REDIRECT_URI: 'http://127.0.0.1:4000/youtube/oauth/callback', YOUTUBE_API_KEY: 'APIKEY_OK', YOUTUBE_UPLOAD_ENABLED: 'true',
  WEB_MOCK_BASE_URL: 'http://127.0.0.1:4996', WEB_ALLOW_PRIVATE_TARGETS: 'true', PAGESPEED_API_KEY: 'PSI_OK', WEB_PUBLISH_ENABLED: 'true', WEB_WP_ALLOW_INSECURE: 'true',
  EMAIL_MOCK_BASE_URL: 'http://127.0.0.1:4995', EMAIL_SEND_ENABLED: 'true',
} as Record<string, string>;

export default defineConfig({
  testDir: 'test/e2e', timeout: 60_000, retries: 0, workers: 1, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3000', locale: 'th-TH', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure', ...(chromium && { launchOptions: { executablePath: chromium } }) },
  webServer: [
    { command: 'node apps/api/dist/main.js', url: 'http://127.0.0.1:4000/health', reuseExistingServer: true, timeout: 60_000, env },
    { command: 'pnpm --filter @fbpm/web exec next start -p 3000', url: 'http://127.0.0.1:3000/health', reuseExistingServer: true, timeout: 90_000, env: { ...env, API_URL: 'http://127.0.0.1:4000' } },
  ],
});
