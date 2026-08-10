#!/usr/bin/env node
/**
 * ลบของที่ build ไว้ทั้งหมด
 *
 *   pnpm clean
 *
 * เขียนเป็น .mjs แทน `rm -rf` เพราะ `rm` ไม่มีบน Windows (cmd/PowerShell)
 * — คำสั่งเดิมพังทันทีที่ใครก็ตามที่ไม่ได้ใช้ macOS/Linux มาแตะ
 *
 * ไม่แตะ `node_modules` และไม่แตะ Prisma Client ที่ generate ไว้ เพราะสองอย่างนั้น
 * เอากลับมาด้วย `pnpm install` ซึ่งช้ากว่ากันมาก และไม่ใช่สิ่งที่คนสั่ง clean ต้องการ
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** โฟลเดอร์ที่มีแพ็กเกจย่อยอยู่ข้างใน */
const GROUPS = ["packages", "apps"];
/** ของที่ลบได้ในแต่ละแพ็กเกจ */
const PER_PACKAGE = ["dist", "tsconfig.tsbuildinfo", ".next", ".turbo"];
/** ของที่ลบได้ที่ราก */
const AT_ROOT = ["tsconfig.tsbuildinfo", ".logs"];

let removed = 0;

function remove(path) {
  try {
    statSync(path);
  } catch {
    return; // ไม่มีอยู่แล้ว ไม่ต้องบอกอะไร
  }
  rmSync(path, { recursive: true, force: true });
  removed += 1;
  process.stdout.write(`  ลบ ${path.slice(ROOT.length + 1)}\n`);
}

function packagesIn(group) {
  try {
    return readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(ROOT, group, e.name));
  } catch {
    return [];
  }
}

for (const group of GROUPS) {
  for (const pkg of packagesIn(group)) {
    for (const name of PER_PACKAGE) remove(join(pkg, name));
  }
}
for (const name of AT_ROOT) remove(join(ROOT, name));

process.stdout.write(
  removed === 0 ? "สะอาดอยู่แล้ว\n" : `เรียบร้อย — ลบไป ${removed} รายการ\n`,
);
