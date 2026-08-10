#!/usr/bin/env node
/**
 * สร้าง Prisma Client ให้แน่ใจว่ามี ก่อน typecheck / build / รัน
 *
 * ─── ทำไมต้องมีสคริปต์นี้ ───
 *
 * `@prisma/client` ที่โหลดมาจาก npm เป็น "เปลือก" เปล่าๆ ตัวจริงถูกสร้างจาก
 * `schema.prisma` ตอนสั่ง `prisma generate` — ถ้ายังไม่สร้าง TypeScript จะมองว่า
 * ผลลัพธ์ของทุก query เป็น `any` แล้ว `tsc` (โปรเจ็คนี้เปิด noImplicitAny) จะพัง
 * ด้วย TS7006 ในไฟล์ที่ **ไม่ได้แตะเลยสักตัวอักษร**
 *
 * เกิดขึ้นจริงกับคนที่ clone ใหม่แล้วสั่ง `pnpm dev` ทันที — ได้ TS7006 11 จุด
 * ใน `packages/store` กับ `apps/worker` ทั้งที่โค้ดไม่มีอะไรผิด และข้อความ error
 * ไม่ได้ใบ้เลยแม้แต่นิดเดียวว่าสาเหตุคือ "ยังไม่ได้ generate"
 *
 * จึงเสียบไว้หน้าทุกคำสั่งที่ต้องพึ่ง type ของ Prisma แทนที่จะหวังว่าคนจะจำได้
 *
 * ราคาถูกมากเมื่อของมีอยู่แล้ว: แค่ resolve + stat สองไฟล์ แล้วจบ
 */
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT, SCHEMA, runPrisma } from "./prisma.mjs";

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};
const say = (s = "") => process.stdout.write(s + "\n");

/**
 * ที่อยู่ของ client ที่ generate แล้ว
 *
 * ไม่เดาจากโครงสร้างโฟลเดอร์ (pnpm ซ่อนของไว้ใน `.pnpm/<ชื่อ>@<เวอร์ชัน>_<hash>/`
 * ซึ่งเปลี่ยนทุกครั้งที่อัปเวอร์ชัน) แต่ resolve ด้วยวิธีเดียวกับที่
 * `@prisma/client` ใช้หาตัวเองตอนรันจริง — ถูกเสมอไม่ว่า layout จะเปลี่ยนยังไง
 */
function generatedClientPath() {
  try {
    const shell = createRequire(join(ROOT, "packages/store/package.json")).resolve(
      "@prisma/client/package.json",
    );
    return createRequire(shell).resolve(".prisma/client");
  } catch {
    return null;
  }
}

function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** ของที่ generate ไว้ยังตรงกับ schema ปัจจุบันไหม */
function isFresh() {
  const generated = generatedClientPath();
  if (generated === null) return false;

  const schemaAt = mtimeOf(SCHEMA);
  const generatedAt = mtimeOf(generated);
  if (schemaAt === null || generatedAt === null) return false;

  // schema ใหม่กว่าของที่สร้างไว้ = แก้ schema แล้วยังไม่ได้ generate ใหม่
  return generatedAt >= schemaAt;
}

function main() {
  if (isFresh()) return;

  say(`${c.dim}สร้าง Prisma Client จาก schema...${c.reset}`);

  /**
   * `prisma generate` ไม่ต้องใช้ DATABASE_URL (ต่างจาก `db push` / `migrate`)
   * จึงรันได้ตั้งแต่ตอน postinstall ที่ยังไม่มีไฟล์ .env ด้วยซ้ำ
   */
  const res = runPrisma(["generate"]);

  if (res.missingCli === true) {
    say(
      `${c.red}หา Prisma CLI ไม่เจอ${c.reset} — ยังไม่ได้ติดตั้ง dependency ` +
        `ให้รัน ${c.bold}pnpm install${c.reset} ก่อน`,
    );
    process.exit(1);
  }

  if (res.status !== 0) {
    say("");
    say(
      `${c.red}${c.bold}สร้าง Prisma Client ไม่สำเร็จ${c.reset} — ` +
        `typecheck/build จะพังด้วย TS7006 ต่อจากนี้`,
    );
    say(`  ลองสั่งตรงๆ เพื่อดู error เต็ม: ${c.cyan}pnpm db:generate${c.reset}`);
    process.exit(res.status === null ? 1 : res.status);
  }
}

main();
