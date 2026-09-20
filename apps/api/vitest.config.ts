import { defineConfig } from 'vitest/config';

// หมายเหตุ: vitest ใช้ esbuild ซึ่งไม่ emit decorator metadata
// โค้ดใน apps/api จึงใช้ @Inject(TOKEN) อย่างชัดเจนเสมอ ไม่พึ่งการ inject จาก type
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['reflect-metadata'],
  },
});
