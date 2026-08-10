#!/usr/bin/env node
/**
 * เรียก Prisma CLI จาก **รากโปรเจ็ค** เสมอ
 *
 *   node scripts/prisma.mjs db push
 *   node scripts/prisma.mjs studio
 *
 * ─── ทำไมต้องมีตัวคั่นกลาง แทนที่จะเรียก prisma ตรงๆ ───
 *
 * Prisma หาไฟล์ `.env` จาก **cwd** กับโฟลเดอร์ที่ schema อยู่ เท่านั้น
 * ของโปรเจ็คนี้ `.env` อยู่ที่รากไฟล์เดียว แต่ schema อยู่ที่
 * `packages/db/prisma/` — พอสั่งผ่าน `pnpm --filter @page-os/db` ซึ่งย้าย cwd
 * ไปที่ `packages/db` Prisma จึงหา `.env` ไม่เจอ แล้วล้มด้วย
 *
 *   Error code: P1012
 *   error: Environment variable not found: DATABASE_URL.
 *
 * ซึ่งอ่านแล้วเข้าใจผิดเต็มๆ ว่า "ยังไม่ได้ตั้งค่า" ทั้งที่ตั้งครบแล้ว
 * แค่มันมองไม่เห็น — เคยทำให้ติดอยู่ตรงนี้จริงมาแล้ว
 *
 * ตัวนี้จึงล็อก cwd ไว้ที่รากและส่ง `--schema` ให้เอง ไม่ว่าจะถูกเรียกจากที่ไหน
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SCHEMA = join(ROOT, "packages/db/prisma/schema.prisma");

/**
 * ที่อยู่ของ Prisma CLI ตัวจริง — `null` ถ้ายังไม่ได้ติดตั้ง dependency
 *
 * เรียกด้วย `node <path>` ตรงๆ ไม่ผ่าน `pnpm exec` / `npx` เพราะสองตัวนั้น
 * พาเรากลับไปสู่ปัญหา cwd เดิม และบน Windows ยังต้องผ่าน shim `.cmd` อีกชั้น
 */
export function prismaCliPath() {
  try {
    const pkg = createRequire(join(ROOT, "packages/db/package.json")).resolve(
      "prisma/package.json",
    );
    return join(dirname(pkg), "build/index.js");
  } catch {
    return null;
  }
}

/**
 * รัน Prisma CLI แล้วคืนผลลัพธ์ดิบของ spawnSync
 *
 * @param {string[]} args อาร์กิวเมนต์ของ prisma เช่น `["db", "push"]`
 */
export function runPrisma(args) {
  const cli = prismaCliPath();
  if (cli === null) {
    return { status: 127, missingCli: true };
  }
  // ถ้าคนสั่งระบุ --schema มาเองแล้ว ไม่ต้องใส่ซ้ำ (prisma จะด่าเรื่องซ้ำ)
  const full = args.includes("--schema") ? args : [...args, "--schema", SCHEMA];

  return spawnSync(process.execPath, [cli, ...full], {
    cwd: ROOT, // ← หัวใจของไฟล์นี้: Prisma จะเห็น .env ที่รากก็เพราะบรรทัดนี้
    stdio: "inherit",
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "true" },
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stdout.write(
      "ต้องบอกด้วยว่าจะให้ prisma ทำอะไร เช่น:\n" +
        "  node scripts/prisma.mjs db push\n" +
        "  node scripts/prisma.mjs studio\n",
    );
    process.exit(1);
  }

  const res = runPrisma(args);
  if (res.missingCli === true) {
    process.stdout.write(
      "หา Prisma CLI ไม่เจอ — ยังไม่ได้ติดตั้ง dependency ให้รัน pnpm install ก่อน\n",
    );
    process.exit(1);
  }
  process.exit(res.status === null ? 1 : res.status);
}

// รันเป็นคำสั่งเมื่อถูกเรียกตรงๆ เท่านั้น — ตอนถูก import มาใช้ต้องไม่ทำอะไร
if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main();
}
