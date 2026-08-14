/**
 * Audit ตัวจัดหมวดคอมเมนต์ไทย — เรื่องที่เทสต์ที่เขียนมือครอบไม่ถึง
 *
 *   1. ยิงคอมเมนต์ธรรมดาที่ "ต้องไม่เข้าหัวข้อไหนเลย" ดูว่ามีนับเกินไหม
 *   2. ตรวจว่าวลียกเว้นทุกอันทำงานจริง (ไม่ใช่แค่ที่เขียนเทสต์ไว้)
 *   3. วัดเวลา — หน้าเว็บเรียกตัวนี้ทุกครั้งที่โหลด กับคอมเมนต์ได้ถึง 20,000 อัน
 *
 * ต้อง `pnpm build` ก่อน เพราะอ่านจาก dist
 *
 *   pnpm build && node packages/listening/audit-topics.mjs
 */
import {
  analyzeComment,
  tallyTopics,
  QUESTION_MARKERS,
  TOPICS,
  TOPIC_EXCEPTIONS,
} from "./dist/index.js";

let fail = 0;
const say = (ok, label, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
};

// ── 1. คอมเมนต์ทั่วไปที่ต้องไม่เข้าหัวข้อไหนเลย ──────────────────────────
const HARMLESS = [
  "ขอบคุณค่ะ", "ขอบคุณครับ", "ขอบพระคุณมากค่ะ", "ขอโทษนะคะ", "ขออนุญาตแชร์ค่ะ",
  "ขอให้โชคดีนะคะ", "สวัสดีค่ะ", "ยินดีด้วยนะคะ", "สู้ๆ นะคะ", "น่ารักจัง",
  "❤️", "😂😂😂", "555555", "แท็กเพื่อนมาดู", "จองไว้ในใจ",
  "ถูกใจมากค่ะ", "ถูกต้องแล้วค่ะ", "ข้อมูลถูกต้อง", "เสียงเพราะมาก", "เสียใจด้วยนะคะ",
  "เสียดายจัง", "ช้างน่ารัก", "สวนสัตว์เปิด", "ผ้าไหมสวย", "ไหมพรมนุ่มมาก",
  "โครงการส่งเสริมการเกษตร", "ส่งท้ายปีเก่า", "ต้องสั่งสอนกันหน่อย",
  "พังงาน่าเที่ยว", "คิดถึงจัง", "รอติดตามนะคะ", "ชอบมากเลย", "เก่งมากค่ะ",
  "ขอบใจนะ", "โชคดีมีชัย", "ทำต่อไปนะคะ", "เป็นกำลังใจให้",
];
const falsePositives = HARMLESS.filter((t) => analyzeComment(t).topics.length > 0);
say(
  falsePositives.length === 0,
  `คอมเมนต์ธรรมดา ${HARMLESS.length} อัน ต้องไม่เข้าหัวข้อไหนเลย`,
  falsePositives.length ? `นับเกิน: ${falsePositives.map((t) => `"${t}"→${analyzeComment(t).topics}`).join(", ")}` : "",
);

// ── 2. คอมเมนต์ที่ต้องเข้าหัวข้อจริง ────────────────────────────────────
const SHOULD_HIT = [
  ["อร่อยมากค่ะ", "quality"], ["รสชาติดี ใช้ได้", "quality"], ["ของแท้ไหมคะ", "quality"],
  ["แพงไป", "price"], ["ราคาเท่าไหร่", "price"], ["กี่บาทคะ", "price"], ["ของถูกและดี", "price"],
  ["สั่ง 3 ชิ้นค่ะ", "buyIntent"], ["สนใจค่ะ", "buyIntent"], ["cf 2", "buyIntent"],
  ["แอดมินไม่ตอบเลย", "service"], ["ตอบช้ามากค่ะ", "service"],
  ["ค่าส่งกี่บาท", "shipping"], ["เลขพัสดุคะ", "shipping"], ["ส่งช้ามาก", "shipping"],
  ["ขอคืนเงินค่ะ", "complaint"], ["ของไม่ตรงปก", "complaint"], ["สินค้าชำรุด", "complaint"],
];
const misses = SHOULD_HIT.filter(([t, k]) => !analyzeComment(t).topics.includes(k));
say(misses.length === 0, `คอมเมนต์ที่ต้องเข้าหัวข้อ ${SHOULD_HIT.length} อัน`, misses.length ? `พลาด: ${misses.map((m) => m[0]).join(", ")}` : "");

// ── 3. วลียกเว้นทุกอันต้องมีผลจริง ──────────────────────────────────────
// วิธีตรวจ: เอาวลียกเว้นมาเป็นคอมเมนต์ตรงๆ แล้วต้องไม่เข้าหัวข้อไหนเลย
const uselessExceptions = TOPIC_EXCEPTIONS.filter((ex) => analyzeComment(ex).topics.length > 0);
say(
  uselessExceptions.length === 0,
  `วลียกเว้นทั้ง ${TOPIC_EXCEPTIONS.length} อัน กันได้จริง`,
  uselessExceptions.length ? `ยังหลุด: ${uselessExceptions.join(", ")}` : "",
);

// วลียกเว้นที่ไม่มีคำสำคัญอยู่ข้างในเลย = ของค้างที่ไม่ได้ทำอะไร
// ⚠️ ต้องนับ QUESTION_MARKERS ด้วย — รอบแรกลืม แล้วรายงานว่า "ผ้าไหม" เป็นของค้าง
//    ทั้งที่มันกันคำถาม "ไหม" อยู่จริง
const allWords = [...TOPICS.flatMap((t) => t.words), ...QUESTION_MARKERS];
const deadExceptions = TOPIC_EXCEPTIONS.filter(
  (ex) => !allWords.some((w) => ex.includes(w)),
);
say(
  deadExceptions.length === 0,
  "ไม่มีวลียกเว้นที่ไม่ได้กันอะไรเลย",
  deadExceptions.length ? `ไม่จำเป็น: ${deadExceptions.join(", ")}` : "",
);

// ── 4. คำสำคัญต้องไม่ซ้อนทับกันเองข้ามหัวข้อโดยไม่ตั้งใจ ────────────────
const overlaps = [];
for (const a of TOPICS) {
  for (const b of TOPICS) {
    if (a.key >= b.key) continue;
    for (const wa of a.words) {
      for (const wb of b.words) {
        if (wa !== wb && (wa.includes(wb) || wb.includes(wa))) {
          overlaps.push(`${a.key}:"${wa}" ⊃ ${b.key}:"${wb}"`);
        }
      }
    }
  }
}
console.log(`  คำที่ซ้อนกันข้ามหัวข้อ: ${overlaps.length}${overlaps.length ? " → " + overlaps.join(", ") : ""}`);

// ── 5. เวลา — หน้าเว็บเรียกทุกครั้งที่โหลด สูงสุด 20,000 คอมเมนต์ ────────
const CORPUS = [...HARMLESS, ...SHOULD_HIT.map((s) => s[0])];
const big = Array.from({ length: 20_000 }, (_, i) => CORPUS[i % CORPUS.length]);

const t0 = process.hrtime.bigint();
const summary = tallyTopics(big);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

say(ms < 1000, `จัดหมวด 20,000 คอมเมนต์ภายใน 1 วินาที`, `ใช้จริง ${ms.toFixed(0)} ms`);
console.log(`  หัวข้อที่จับได้: ${summary.topics.map((t) => `${t.labelTh} ${t.count}`).join(" · ")}`);
console.log(`  คำถาม ${summary.questions} (${summary.questionPct.toFixed(1)}%) · ไม่เข้าหัวข้อ ${summary.uncategorized}`);

// ── 6. ผลลัพธ์ต้องคงที่ — เรียกซ้ำได้ค่าเดิมเป๊ะ ────────────────────────
const again = tallyTopics(big);
say(JSON.stringify(again) === JSON.stringify(summary), "เรียกซ้ำได้ผลเหมือนเดิมเป๊ะ");

console.log(fail === 0 ? "\nผ่านทั้งหมด" : `\nไม่ผ่าน ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
