/**
 * กฎการเขียน import ใน `apps/web` ที่ถ้าผิดแล้ว**เห็นตอนเปิดหน้าเว็บเท่านั้น**
 *
 * ─── อาการที่เคยเกิดจริง ───
 *
 * เพิ่มไฟล์ `lib/workspace-mapping.ts` ที่ import ค่าจริงมาจากไฟล์ข้างเคียง:
 *
 *   import { CLIENT_COLOR_COUNT, type ClientPage } from "./workspace.js";
 *
 * `pnpm typecheck` ผ่าน · `pnpm test` ผ่าน · แต่พอเปิดหน้าเว็บได้ 500:
 *
 *   Module not found: Can't resolve './workspace.js'
 *
 * เพราะบนดิสก์ไฟล์ชื่อ `workspace.ts` — `tsc` กับ vitest ยอมให้เขียน `.js`
 * (มันแปลงให้เอง) แต่ webpack ของ Next ไม่แปลงให้ มันหาไฟล์ชื่อนั้นตรงๆ
 *
 * ─── แล้วทำไมไฟล์อื่นเขียน `./workspace.js` แล้วไม่พัง ───
 *
 * เพราะไฟล์พวกนั้นเป็น `import type` ล้วน ซึ่ง TypeScript ลบทิ้งทั้งบรรทัด
 * ตอน compile — bundler ไม่เคยเห็นเลย ต่างกับ import ที่ดึงค่าจริงตอนรัน
 * ซึ่งต้องรอดไปถึง bundler
 *
 * กฎจึงเป็น: ใน `apps/web` ถ้าจะ import แบบ relative ที่ลงท้าย `.js`
 * ต้องเป็น `import type` เท่านั้น ที่เหลือใช้ alias `@/` (ไม่ใส่นามสกุล)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

/**
 * ไฟล์ที่ Next เอาไปมัดจริง — **ไม่รวมไฟล์เทสต์**
 *
 * webpack ไม่เคยเห็นไฟล์เทสต์ กฎนี้จึงไม่บังคับกับมัน (และ `today.test.ts`
 * ที่ import `./today.js` อยู่ก็ทำงานได้ปกติมาตลอด)
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * หา import/export ที่อ้างไฟล์ข้างเคียงด้วยนามสกุล `.js`
 *
 * คืนเฉพาะตัวที่**ไม่ใช่** `import type` — พวกนั้นคือตัวที่จะรอดไปถึง bundler
 *
 * `[^;]*?` ไม่ใช่ `[\s\S]*?` โดยตั้งใจ: ประโยค import จบด้วย `;` เสมอ
 * การห้ามข้ามอัฒภาคจึงกันไม่ให้ match ลากยาวข้ามหลายประโยครวดเดียว
 * (เขียนเป็น `[\s\S]*?` ตอนแรกแล้วมันกลืน import ทั้งไฟล์มาเป็นก้อนเดียว)
 */
function riskyJsImports(source: string): string[] {
  const found: string[] = [];
  const re = /(?:^|\n)[ \t]*(import|export)\b([^;]*?)from\s*["'](\.[^"']*\.js)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const clause = m[2] ?? "";
    // `import type { … }` / `export type { … }` ถูกลบทิ้งตอน compile — ปลอดภัย
    if (/^\s*type\b/.test(clause)) continue;
    found.push(`${m[1]}${clause}from "${m[3]}"`.replace(/\s+/g, " ").trim());
  }
  return found;
}

describe("กฎ import ของ apps/web", () => {
  it("ไม่มีไฟล์ไหน import ค่าจริงแบบ relative ที่ลงท้าย .js", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      for (const line of riskyJsImports(readFileSync(file, "utf8"))) {
        offenders.push(`${file.slice(SRC.length)} → ${line}`);
      }
    }

    expect(
      offenders,
      `ใช้ alias "@/..." แทน (ไม่ใส่นามสกุล) — ${offenders.length} จุดนี้จะทำให้หน้าเว็บ 500 ทั้งที่ typecheck ผ่าน:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  /** เทสต์ตัวตรวจเอง — ไม่งั้นวันหนึ่ง regex พังแล้วเทสต์ผ่านตลอดโดยไม่ตรวจอะไรเลย */
  describe("ตัวตรวจทำงานถูก", () => {
    it("จับ import ที่ดึงค่าจริง", () => {
      expect(riskyJsImports('import { X } from "./a.js";')).toHaveLength(1);
      expect(riskyJsImports('import X from "./a.js";')).toHaveLength(1);
      expect(riskyJsImports('export { X } from "./a.js";')).toHaveLength(1);
      expect(
        riskyJsImports('import {\n  A,\n  type B,\n} from "./a.js";'),
      ).toHaveLength(1);
    });

    it("ปล่อยผ่าน import type ที่ถูกลบทิ้งตอน compile", () => {
      expect(riskyJsImports('import type { X } from "./a.js";')).toEqual([]);
      expect(riskyJsImports('import type {\n  X,\n} from "./a.js";')).toEqual([]);
      expect(riskyJsImports('export type { X } from "./a.js";')).toEqual([]);
    });

    it("ไม่ยุ่งกับ import ที่ไม่ได้ลงท้าย .js หรือไม่ใช่ relative", () => {
      expect(riskyJsImports('import { X } from "@/lib/a";')).toEqual([]);
      expect(riskyJsImports('import { X } from "@page-os/store";')).toEqual([]);
      expect(riskyJsImports('import { X } from "./a";')).toEqual([]);
      expect(riskyJsImports('import "server-only";')).toEqual([]);
    });

    /**
     * เคสที่ทำให้ตัวตรวจรุ่นแรกรายงานผิด — match ลากข้ามหลายประโยค
     * แล้วไปเหมาว่า `import type` ที่ปลอดภัยเป็นตัวมีปัญหา
     */
    it("ไม่ลากข้ามหลายประโยค import", () => {
      const src = [
        'import { a } from "@page-os/ops";',
        'import { b } from "@page-os/inbox";',
        'import type { C } from "./workspace.js";',
      ].join("\n");
      expect(riskyJsImports(src)).toEqual([]);
    });

    it("ยังจับตัวจริงเจอแม้มี import อื่นนำหน้า", () => {
      const src = [
        'import { a } from "@page-os/ops";',
        'import { CONST } from "./workspace.js";',
      ].join("\n");
      expect(riskyJsImports(src)).toHaveLength(1);
    });
  });
});
