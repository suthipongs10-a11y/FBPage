/**
 * เทสต์บังคับกฎใน CLAUDE.md
 *
 * กฎพวกนี้ถ้าอยู่แต่ในเอกสาร วันหนึ่งจะมีคน (หรือเรานี่แหละ) เผลอละเมิด
 * แล้วรู้ตัวตอน production — จึงทำเป็นเทสต์ที่สแกนซอร์สจริง
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGES_DIR = fileURLToPath(new URL("../..", import.meta.url));

interface SourceFile {
  /** path แบบสั้นสำหรับแสดงใน error */
  rel: string;
  pkg: string;
  content: string;
  isTest: boolean;
}

function collect(dir: string, pkg: string, out: SourceFile[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      collect(full, pkg, out);
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    out.push({
      rel: `packages/${pkg}/src/${entry}`,
      pkg,
      content: readFileSync(full, "utf8"),
      isTest: entry.endsWith(".test.ts") || entry === "test-helpers.ts",
    });
  }
}

function allSources(): SourceFile[] {
  const out: SourceFile[] = [];
  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, pkg, "src");
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    collect(src, pkg, out);
  }
  return out;
}

const SOURCES = allSources();
/** โค้ดที่ใช้งานจริง (ไม่รวมไฟล์เทสต์) */
const PROD = SOURCES.filter((f) => !f.isTest);

/** ตัดคอมเมนต์ออก เพื่อไม่ให้คำอธิบายทำให้เทสต์ fail ผิดๆ */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * ดึงอาร์กิวเมนต์ของ `throw new Error(...)` ทั้งก้อน โดยนับวงเล็บให้สมดุล
 * (regex ธรรมดาตัดกลาง template literal ที่มี quote ข้างในจนได้ผลผิด)
 */
function extractThrowArgs(code: string): string[] {
  const out: string[] = [];
  const marker = "throw new Error(";
  let idx = code.indexOf(marker);
  while (idx !== -1) {
    let depth = 1;
    let i = idx + marker.length;
    const start = i;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    out.push(code.slice(start, i - 1));
    idx = code.indexOf(marker, i);
  }
  return out;
}

describe("สแกนซอร์สได้จริง", () => {
  it("เจอไฟล์ที่ต้องตรวจ", () => {
    expect(PROD.length).toBeGreaterThan(8);
    expect(PROD.map((f) => f.rel)).toContain("packages/meta/src/gateway.ts");
  });
});

describe("กฎข้อ 1 — ทุก call ไป Meta ต้องผ่าน gateway", () => {
  it("มีแค่ gateway.ts เท่านั้นที่รู้จักโฮสต์ API ของ Meta", () => {
    // ครอบทั้ง graph (API ปกติ) และ rupload (อัปสื่อ) — เพิ่มโฮสต์ใหม่ต้องมาแก้ที่นี่
    const apiHost = /\b(graph|rupload|graph-video)\.facebook\.com/;
    const offenders = PROD.filter(
      (f) =>
        f.rel !== "packages/meta/src/gateway.ts" &&
        apiHost.test(stripComments(f.content)),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("www.facebook.com ใช้ได้เฉพาะสร้างลิงก์ OAuth ให้ลูกค้ากด (ไม่ใช่ API call)", () => {
    const offenders = PROD.filter(
      (f) =>
        f.rel !== "packages/meta/src/tokens.ts" &&
        /www\.facebook\.com/.test(stripComments(f.content)),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("ไม่มีโมดูลไหนเรียก fetch() ไปหา Meta เอง", () => {
    const offenders = PROD.filter((f) => {
      if (f.rel === "packages/meta/src/gateway.ts") return false;
      const code = stripComments(f.content);
      // มองหา fetch( ที่ไม่ใช่การประกาศ type
      return /\bfetch\s*\(/.test(code);
    }).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("packages/db ไม่ import อะไรจาก Meta นอกจากผ่าน @page-os/meta", () => {
    const dbFiles = PROD.filter((f) => f.pkg === "db");
    expect(dbFiles.length).toBeGreaterThan(0);
    for (const f of dbFiles) {
      expect(stripComments(f.content), f.rel).not.toMatch(/graph\.facebook/);
    }
  });
});

describe("กฎข้อ 2 — Graph version อ่านจาก env ห้าม hardcode", () => {
  it("มีที่เดียวในโค้ดจริงที่เขียนเลขเวอร์ชันไว้ คือค่า default ใน gateway.ts", () => {
    const offenders: string[] = [];
    for (const f of PROD) {
      const code = stripComments(f.content);
      const matches = code.match(/["'`]v\d+\.\d+["'`]/g) ?? [];
      if (matches.length === 0) continue;
      if (f.rel === "packages/meta/src/gateway.ts") continue;
      offenders.push(`${f.rel}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("gateway.ts เขียนเลขเวอร์ชันไว้แค่ครั้งเดียว (ค่า default)", () => {
    const gw = PROD.find((f) => f.rel === "packages/meta/src/gateway.ts")!;
    const matches = stripComments(gw.content).match(/["'`]v\d+\.\d+["'`]/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe("กฎข้อ 3 — ห้าม log token แม้บางส่วน", () => {
  it("ไม่มี console.* หลงเหลือในโค้ดจริง (เลี่ยง logger ที่ redact ให้)", () => {
    const offenders = PROD.filter((f) =>
      /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(
        stripComments(f.content),
      ),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("ไม่มีการส่งค่า token ดิบเข้า logger", () => {
    const offenders: string[] = [];
    for (const f of PROD) {
      const code = stripComments(f.content);
      // logger.xxx("...", { ... accessToken ... }) หรือ token: <ตัวแปร>
      const bad =
        /logger\.\w+\([^)]*\b(accessToken|access_token|encryptedToken|plaintext)\b/s;
      if (bad.test(code)) offenders.push(f.rel);
    }
    expect(offenders).toEqual([]);
  });

  it("gateway ใส่ token ใน header ไม่ใช่ query string", () => {
    const gw = PROD.find((f) => f.rel === "packages/meta/src/gateway.ts")!;
    const code = stripComments(gw.content);
    // ใช้ [\s\S] แทน . เพราะค่า header เขียนคร่อมหลายบรรทัดได้
    expect(code).toMatch(/authorization:[\s\S]{0,200}(Bearer|OAuth)/i);
    // ต้องไม่มีการเซ็ต access_token ลง searchParams ไม่ว่าจะที่ไหน
    expect(code).not.toMatch(/searchParams\.set\(\s*["']access_token["']/);
    expect(code).not.toMatch(/[?&]access_token=/);
  });

  it("ทุกโมดูลที่ยิง Meta ส่ง token ผ่าน gateway ไม่ประกอบ header เอง", () => {
    const offenders = PROD.filter(
      (f) =>
        f.rel !== "packages/meta/src/gateway.ts" &&
        /authorization\s*[:=]/i.test(stripComments(f.content)),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

describe("กฎข้อ 4 — เวลาใน DB เป็น UTC เสมอ", () => {
  it("คอลัมน์ DateTime ทุกตัวใน schema เป็น Timestamptz หรือ Date", () => {
    const schema = readFileSync(
      join(PACKAGES_DIR, "db", "prisma", "schema.prisma"),
      "utf8",
    );
    const lines = schema
      .split("\n")
      .filter((l) => /\bDateTime\b/.test(l) && !l.trim().startsWith("//"));
    expect(lines.length).toBeGreaterThan(10);
    const bad = lines.filter(
      (l) => !/@db\.Timestamptz\(\d+\)/.test(l) && !/@db\.Date/.test(l),
    );
    expect(bad).toEqual([]);
  });

  it("ไม่มีการใช้ new Date() แบบไม่ส่ง argument ในโค้ดจริง (ต้องผ่าน Clock)", () => {
    const offenders = PROD.filter((f) =>
      /new Date\(\s*\)/.test(stripComments(f.content)),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

describe("กฎข้อ 7 และ 8 — message tag", () => {
  /**
   * ไฟล์ที่หน้าที่คือ "บังคับกฎ" จึงต้องเอ่ยชื่อแท็กพวกนี้ได้
   * เพิ่มไฟล์เข้ารายการนี้ต้องมีเหตุผลว่าไฟล์นั้นปฏิเสธแท็ก ไม่ใช่ใช้แท็ก
   */
  const TAG_POLICY_FILES = new Set([
    "packages/meta/src/errors.ts",
    "packages/inbox/src/messaging-policy.ts",
    "packages/inbox/src/index.ts",
  ]);

  it("HUMAN_AGENT ปรากฏได้เฉพาะในไฟล์ที่บังคับกฎ", () => {
    const offenders = PROD.filter(
      (f) =>
        !TAG_POLICY_FILES.has(f.rel) &&
        /HUMAN_AGENT/.test(stripComments(f.content)),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("ตัวบังคับกฎต้องปฏิเสธ HUMAN_AGENT เมื่อผู้ส่งไม่ใช่คน", () => {
    // ไม่พอที่จะให้ไฟล์นี้เอ่ยชื่อแท็กได้ ต้องพิสูจน์ว่ามันตรวจผู้ส่งจริง
    const policy = PROD.find(
      (f) => f.rel === "packages/inbox/src/messaging-policy.ts",
    )!;
    const code = stripComments(policy.content);
    expect(code).toMatch(/HUMAN_AGENT[\s\S]{0,200}sentBy\s*!==\s*["']human["']/);
  });

  it("legacy tag ที่ปลดระวางแล้วปรากฏได้แค่ในไฟล์ที่ปฏิเสธมัน", () => {
    const legacy =
      /(CONFIRMED_EVENT_UPDATE|POST_PURCHASE_UPDATE|ACCOUNT_UPDATE)/;
    const offenders = PROD.filter(
      (f) => !TAG_POLICY_FILES.has(f.rel) && legacy.test(stripComments(f.content)),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

describe("เมตริกที่ Meta ปลดระวาง มิ.ย. 2026 (สเปกข้อ 0)", () => {
  it("ไม่มีโค้ดไหนยิงเมตริกที่ปลดระวางแล้ว", () => {
    // page_impressions / page_reach ฯลฯ ปลดระวางแล้ว รายงานลูกค้าจะว่างเปล่าถ้าเผลอใช้
    const deprecated =
      /["'`](page_impressions\w*|page_reach|post_impressions\w*|post_reach|page_engaged_users|page_consumptions)["'`]/;
    const offenders = PROD.filter(
      (f) =>
        // metrics.ts เก็บรายการไว้เพื่อ "ปฏิเสธ" โดยเฉพาะ
        f.rel !== "packages/analytics/src/metrics.ts" &&
        deprecated.test(stripComments(f.content)),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

describe("ความสม่ำเสมอของข้อความ error", () => {
  it("ทุก error ที่โยนจากโค้ดจริงมีข้อความไทย", () => {
    const offenders: string[] = [];
    for (const f of PROD) {
      for (const stmt of extractThrowArgs(stripComments(f.content))) {
        if (!/[ก-๙]/.test(stmt)) {
          offenders.push(`${f.rel}: ${stmt.slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
