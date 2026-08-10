/**
 * ชื่อคำสั่งใน package.json ต้องไม่ชนกับคำสั่งในตัวของ pnpm
 *
 * ─── ทำไมต้องมีเทสต์นี้ ───
 *
 * เคยตั้งชื่อคำสั่งว่า `setup` กับ `doctor` แล้วเขียน README ว่าให้พิมพ์
 * `pnpm setup` — ปรากฏว่าสองชื่อนั้นเป็นคำสั่งในตัวของ pnpm อยู่แล้ว
 * pnpm จึงรัน**ของตัวเอง** โดยไม่บอกสักคำว่ามีสคริปต์ชื่อเดียวกันอยู่
 *
 *   PS C:\...\FBPage> pnpm setup
 *   Next configuration changes were made:
 *   PNPM_HOME=C:\Users\thana\AppData\Local\pnpm
 *   ...
 *   Setup complete. Open a new terminal to start using pnpm.
 *
 * ดูเหมือนสำเร็จทุกประการ แต่ `.env` ไม่ถูกสร้าง แล้วพังต่อเป็นทอดๆ ที่
 * `pnpm db:push` (P1012 ไม่มี DATABASE_URL) โดยที่คนใช้ไม่มีทางเดาออกเลย
 * ว่าต้นเหตุคือชื่อคำสั่งชนกัน
 *
 * เทสต์นี้ล็อกไว้สองชั้น: ชื่อคำสั่งห้ามชน และเอกสารห้ามสั่งให้พิมพ์คำสั่งที่ไม่มีจริง
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Manifest {
  scripts?: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as Manifest;
const scriptNames = Object.keys(manifest.scripts ?? {});

/**
 * คำสั่งในตัวของ pnpm 10 ที่ "กิน" ชื่อไปเลย — จาก `pnpm help -a` บวก `setup`
 * ซึ่งมีอยู่จริงแต่ไม่โผล่ในหน้า help (ยืนยันด้วย `pnpm setup --help`)
 *
 * ไม่รวม `test` / `start` เพราะสองตัวนั้น pnpm ส่งต่อไปหาสคริปต์ให้อยู่แล้ว
 * ตามที่ help เขียนไว้ว่า "Runs a package's test script, if one was provided"
 */
const PNPM_BUILTINS: ReadonlySet<string> = new Set([
  "add",
  "approve-builds",
  "audit",
  "bin",
  "cache",
  "cat-file",
  "cat-index",
  "config",
  "create",
  "dedupe",
  "deploy",
  "dlx",
  "doctor",
  "env",
  "exec",
  "fetch",
  "find-hash",
  "ignored-builds",
  "import",
  "init",
  "install",
  "install-test",
  "licenses",
  "link",
  "list",
  "ls",
  "outdated",
  "pack",
  "patch",
  "patch-commit",
  "patch-remove",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "root",
  "run",
  "self-update",
  "setup",
  "store",
  "unlink",
  "update",
  "why",
]);

/** คำสั่งของ pnpm เองที่เอกสารเรียกใช้ได้ตามปกติ */
const ALLOWED_IN_DOCS: ReadonlySet<string> = new Set(["install", "exec", "dlx", "add"]);

/** ไฟล์เอกสารที่บอกคนอ่านว่าต้องพิมพ์อะไร */
function docFiles(): string[] {
  const files = [join(ROOT, "README.md"), join(ROOT, "CLAUDE.md")];
  const docs = join(ROOT, "docs");
  try {
    for (const entry of readdirSync(docs, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(docs, entry.name));
    }
  } catch {
    // ไม่มีโฟลเดอร์ docs ก็ไม่เป็นไร
  }
  return files;
}

/**
 * ดึงชื่อคำสั่งที่ตามหลัง `pnpm ` เฉพาะใน code block ที่ครอบด้วย ```
 *
 * ดูแค่ code block เพราะนั่นคือที่ที่คนก๊อปไปวาง — ส่วนที่เป็นคำอธิบายต้อง
 * พูดถึงคำสั่งที่ **ห้าม**พิมพ์ได้ด้วย (เช่นเตือนว่า `pnpm setup` เป็นของ pnpm เอง)
 * ถ้าเหมารวมทั้งไฟล์ คำเตือนพวกนั้นจะทำให้เทสต์แดงทั้งที่เขียนถูกแล้ว
 */
function pnpmCommandsIn(markdown: string): string[] {
  const found = new Set<string>();
  for (const block of markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) {
    const body = block[1] ?? "";
    // ข้าม flag (-r, --filter) เพื่อให้ `pnpm -r build` อ่านออกว่าเรียก build
    for (const m of body.matchAll(/\bpnpm\s+((?:-{1,2}[\w-]+\s+)*)([\w:@./-]+)/g)) {
      const name = m[2];
      if (name !== undefined && name !== "") found.add(name);
    }
  }
  return [...found];
}

describe("ชื่อคำสั่งใน package.json", () => {
  it("ไม่ชนกับคำสั่งในตัวของ pnpm", () => {
    const clashes = scriptNames.filter((name) => PNPM_BUILTINS.has(name));
    expect(
      clashes,
      `ชื่อพวกนี้ pnpm เอาไปใช้เองแล้ว — พิมพ์ \`pnpm <ชื่อ>\` จะไม่ได้รันสคริปต์ของเรา ` +
        `และ pnpm จะไม่เตือนอะไรเลย ให้เปลี่ยนชื่อ: ${clashes.join(", ")}`,
    ).toEqual([]);
  });

  it("มีคำสั่งที่จำเป็นต่อการติดตั้งครบ", () => {
    for (const name of ["configure", "preflight", "dev", "build", "check", "db:push"]) {
      expect(scriptNames, name).toContain(name);
    }
  });
});

describe("คำสั่งใน code block ของเอกสาร", () => {
  it("มีอยู่จริงทุกตัว", () => {
    const known = new Set([...scriptNames, ...ALLOWED_IN_DOCS]);
    const bad: string[] = [];

    for (const file of docFiles()) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const cmd of pnpmCommandsIn(text)) {
        if (!known.has(cmd)) bad.push(`${file.slice(ROOT.length + 1)}: pnpm ${cmd}`);
      }
    }

    expect(
      bad,
      "เอกสารสั่งให้พิมพ์คำสั่งที่ไม่มีใน package.json — " +
        "คนทำตามจะได้ error หรือ (แย่กว่า) ได้คำสั่งในตัวของ pnpm ที่ชื่อเหมือนกัน",
    ).toEqual([]);
  });
});
