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
      { find: "@page-os/core", replacement: r("./packages/core/src/index.ts") },
      { find: "@page-os/meta", replacement: r("./packages/meta/src/index.ts") },
      { find: "@page-os/db", replacement: r("./packages/db/src/index.ts") },
    ],
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
    testTimeout: 15_000,
  },
});
