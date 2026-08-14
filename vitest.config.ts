import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // ตอนเทสต์ให้ชี้ workspace package ไปที่ src ตรงๆ จะได้ไม่ต้อง build ก่อนทุกครั้ง
    // ลำดับสำคัญ: ตัวที่เจาะจงกว่าต้องมาก่อน ไม่งั้น "@page-os/meta" จะกินไปก่อน
    alias: [
      {
        find: "@page-os/meta/test-helpers",
        replacement: r("./packages/meta/src/test-helpers.ts"),
      },
      {
        find: "@page-os/core/testing",
        replacement: r("./packages/core/src/testing.ts"),
      },
      { find: "@page-os/core", replacement: r("./packages/core/src/index.ts") },
      { find: "@page-os/meta", replacement: r("./packages/meta/src/index.ts") },
      { find: "@page-os/db", replacement: r("./packages/db/src/index.ts") },
      {
        find: "@page-os/publish",
        replacement: r("./packages/publish/src/index.ts"),
      },
      {
        find: "@page-os/moderation",
        replacement: r("./packages/moderation/src/index.ts"),
      },
      {
        find: "@page-os/analytics",
        replacement: r("./packages/analytics/src/index.ts"),
      },
      {
        find: "@page-os/inbox",
        replacement: r("./packages/inbox/src/index.ts"),
      },
      {
        find: "@page-os/bot",
        replacement: r("./packages/bot/src/index.ts"),
      },
      {
        find: "@page-os/studio",
        replacement: r("./packages/studio/src/index.ts"),
      },
      {
        find: "@page-os/portal",
        replacement: r("./packages/portal/src/index.ts"),
      },
      {
        find: "@page-os/ops",
        replacement: r("./packages/ops/src/index.ts"),
      },
      {
        find: "@page-os/store",
        replacement: r("./packages/store/src/index.ts"),
      },
      {
        find: "@page-os/queue",
        replacement: r("./packages/queue/src/index.ts"),
      },
      {
        find: "@page-os/listening",
        replacement: r("./packages/listening/src/index.ts"),
      },
      {
        find: "@page-os/youtube",
        replacement: r("./packages/youtube/src/index.ts"),
      },
      /**
       * alias ของ `apps/web` — ต้องมีให้ตรงกับ `apps/web/tsconfig.json`
       *
       * ไฟล์ใน `apps/web` ที่ import **ค่าจริง** (ไม่ใช่แค่ type) จากไฟล์ข้างเคียง
       * ต้องเขียนเป็น `@/lib/...` ไม่ใช่ `./xxx.js` เพราะ webpack ของ Next
       * หานามสกุล `.js` ที่บนดิสก์เป็น `.ts` ไม่เจอ — ส่วน type ล้วนใช้ได้ทั้งสองแบบ
       * เพราะ TypeScript ลบทิ้งก่อน bundler จะเห็น
       *
       * ไม่ชนกับ `@page-os/*` ข้างบนเพราะขึ้นต้นคนละแบบ
       */
      { find: /^@\//, replacement: `${r("./apps/web/src")}/` },
    ],
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
    testTimeout: 15_000,
  },
});
