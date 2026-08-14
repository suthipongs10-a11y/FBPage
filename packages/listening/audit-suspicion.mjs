/**
 * Audit ตัวสแกนสัญญาณผิดปกติ
 *
 * ฟีเจอร์นี้ชี้นิ้วไปที่คนจริง — ความผิดพลาดที่แพงที่สุดคือ **false positive**
 * (กล่าวหาลูกค้าตัวจริงว่าเป็นบัญชีปลอม) audit นี้จึงเน้นไปทางนั้นเป็นหลัก
 *
 * ต้อง `pnpm build` ก่อน เพราะอ่านจาก dist
 *
 *   pnpm build && node packages/listening/audit-suspicion.mjs
 */
import { scanForSuspicion, SCAN_CAVEAT_TH } from "./dist/index.js";

let fail = 0;
const say = (ok, label, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
};

const T0 = Date.UTC(2026, 7, 10, 8);
let seed = 424242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// ── เพจไทยจำลอง: คนจริงล้วน ไม่มีบัญชีปลอมเลย ────────────────────────────
const REAL_TEXTS = [
  "อร่อยมากค่ะ", "ขอบคุณค่ะ", "❤️", "สนใจค่ะ", "cf 1", "ราคาเท่าไหร่คะ",
  "ค่าส่งกี่บาท", "สั่งไปแล้วนะคะ", "รอของอยู่ค่ะ", "555", "น่ากินมาก",
  "ของถึงแล้วค่ะ ขอบคุณมาก", "แพงไปนิดนึงนะ", "จองไว้ในใจ", "แท็กเพื่อนมาดู",
  "สวยมากเลยค่ะ ชอบสีนี้", "มีสีอื่นไหมคะ", "ส่งฟรีไหมคะ", "ของแท้ไหมคะ",
  "สั่ง 2 ชิ้นค่ะ รบกวนทักกลับด้วยนะคะ", "ใช้ดีจริงค่ะ แนะนำเลย",
];
const NAMES = Array.from({ length: 400 }, (_, i) => `ลูกค้าคนที่ ${i}`);

/** คนจริงคอมเมนต์กระจายทั้งเดือน 1–12 อันต่อคน */
const realComments = [];
for (const name of NAMES) {
  const n = 1 + Math.floor(rnd() ** 2 * 12);
  for (let i = 0; i < n; i++) {
    realComments.push({
      authorId: `u-${name}`,
      authorName: name,
      message: pick(REAL_TEXTS),
      // กระจายทั้ง 30 วัน
      createdAtMs: T0 + Math.floor(rnd() * 30 * 86_400_000),
      trackedPageId: "page-a",
    });
  }
}

const clean = scanForSuspicion(realComments);
say(
  clean.flagged.length === 0,
  `เพจที่มีแต่คนจริง ${clean.accountsScanned} บัญชี / ${realComments.length} คอมเมนต์ → ต้องไม่ติดธงเลย`,
  clean.flagged.length ? `ติดธงผิด: ${clean.flagged.map((f) => `${f.name}(${f.signals.map((s) => s.key)})`).slice(0, 5).join(", ")}` : "",
);

// ── เติมกลุ่มที่ประสานกันจริงเข้าไป — ต้องจับได้ และต้องจับ**เฉพาะ**พวกนั้น ──
const PLANT = "ร้านนี้ดีที่สุด บริการเยี่ยม ของแท้ส่งไว แนะนำทุกคนเลยครับ";
const mixed = [...realComments];
for (let i = 0; i < 8; i++) {
  mixed.push({
    authorId: `u-ปลอม${i}`,
    authorName: `บัญชีประสาน ${i}`,
    message: PLANT,
    createdAtMs: T0 + 5 * 86_400_000 + i * 30_000,
    trackedPageId: "page-a",
  });
}

const mixedScan = scanForSuspicion(mixed);
const caught = mixedScan.flagged.filter((f) => f.name.startsWith("บัญชีประสาน"));
const wrong = mixedScan.flagged.filter((f) => !f.name.startsWith("บัญชีประสาน"));
say(caught.length === 8, "จับกลุ่มที่ประสานกันได้ครบทั้ง 8 บัญชี", `จับได้ ${caught.length}`);
say(wrong.length === 0, "ไม่ลากคนจริงติดไปด้วย", wrong.length ? `ติดผิด ${wrong.length}: ${wrong.map((f) => f.name).slice(0, 5).join(", ")}` : "");

// ── บัญชีที่คอมเมนต์เยอะมากแต่เป็นคนจริง (แฟนตัวยง) ─────────────────────
const superFan = [];
for (let i = 0; i < 300; i++) {
  superFan.push({
    authorId: "u-แฟนพันธุ์แท้",
    authorName: "แฟนพันธุ์แท้",
    message: pick(REAL_TEXTS),
    createdAtMs: T0 + Math.floor(rnd() * 30 * 86_400_000),
    trackedPageId: "page-a",
  });
}
const fanScan = scanForSuspicion(superFan);
say(
  fanScan.flagged.length === 0,
  "แฟนตัวยงคอมเมนต์ 300 ครั้ง (ข้อความสั้นซ้ำๆ) → ต้องไม่ติดธง",
  fanScan.flagged.length ? `ติดธง: ${fanScan.flagged[0].signals.map((s) => s.key)}` : "",
);

// ── ประสิทธิภาพ — หน้าเว็บเรียกทุกครั้งที่โหลด สูงสุด 20,000 คอมเมนต์ ────
const big = [];
for (let i = 0; i < 20_000; i++) {
  big.push({
    authorId: `u${i % 3000}`,
    authorName: `คนที่ ${i % 3000}`,
    message: pick(REAL_TEXTS),
    createdAtMs: T0 + Math.floor(rnd() * 30 * 86_400_000),
    trackedPageId: "page-a",
  });
}
const t0 = process.hrtime.bigint();
const bigScan = scanForSuspicion(big);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
say(ms < 1500, "สแกน 20,000 คอมเมนต์ / 3,000 บัญชี ภายใน 1.5 วินาที", `ใช้จริง ${ms.toFixed(0)} ms`);
console.log(`  ติดธง ${bigScan.flagged.length} จาก ${bigScan.accountsScanned} บัญชี (${bigScan.flaggedPct.toFixed(2)}%)`);

// ── ผลลัพธ์ต้องคงที่ ────────────────────────────────────────────────────
say(
  JSON.stringify(scanForSuspicion(mixed)) === JSON.stringify(mixedScan),
  "เรียกซ้ำได้ผลเหมือนเดิมเป๊ะ",
);

// ── คำเตือนต้องติดมาเสมอ ────────────────────────────────────────────────
say(
  scanForSuspicion([]).caveatTh === SCAN_CAVEAT_TH && SCAN_CAVEAT_TH.includes("ไม่ใช่คำตัดสิน"),
  "คำเตือนติดมากับผลลัพธ์เสมอ แม้ตอนไม่มีข้อมูล",
);

console.log(fail === 0 ? "\nผ่านทั้งหมด" : `\nไม่ผ่าน ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
