import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // ส่วนขยายต้องโหลดใน persistent context ตัวเดียว รันขนานไม่ได้
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
});
