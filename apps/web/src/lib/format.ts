/**
 * การจัดรูปแบบสำหรับสายตาคนไทย
 *
 * ทุกฟังก์ชันรับ epoch ms (UTC ตามกฎข้อ 4) แล้วแปลงตาม timezone ของเพจ
 * — ไม่ใช่ timezone ของเครื่องที่เปิดหน้าเว็บ เพราะเอเจนซี่อาจนั่งทำงานคนละที่
 * กับที่ตั้งของร้านลูกค้า
 *
 * เรียกจาก server component เท่านั้น ผลลัพธ์จึงเป็นสตริงคงที่
 * ไม่เกิด hydration mismatch
 */

const DAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const DAY_TH_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTH_TH_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/** แยกส่วนของเวลาตาม timezone ที่กำหนด */
export function partsIn(atMs: number, timeZone: string): Parts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const map = new Map(
    dtf.formatToParts(new Date(atMs)).map((p) => [p.type, p.value]),
  );
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    weekday: Math.max(0, days.indexOf(map.get("weekday") ?? "Sun")),
  };
}

/** "14:30" */
export function timeTh(atMs: number, timeZone: string): string {
  const p = partsIn(atMs, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "8 ส.ค." */
export function dateShortTh(atMs: number, timeZone: string): string {
  const p = partsIn(atMs, timeZone);
  return `${p.day} ${MONTH_TH_SHORT[p.month - 1]}`;
}

/** "ศุกร์ 8 ส.ค. 14:30" */
export function dateTimeTh(atMs: number, timeZone: string): string {
  const p = partsIn(atMs, timeZone);
  return `${DAY_TH[p.weekday]} ${dateShortTh(atMs, timeZone)} ${timeTh(atMs, timeZone)}`;
}

export function dayNameShortTh(weekday: number): string {
  return DAY_TH_SHORT[weekday] ?? "?";
}

export function dayNameTh(weekday: number): string {
  return DAY_TH[weekday] ?? "?";
}

/** คีย์วันแบบ YYYY-MM-DD ตาม timezone ของเพจ — ใช้จัดกลุ่มในปฏิทิน */
export function dayKey(atMs: number, timeZone: string): string {
  const p = partsIn(atMs, timeZone);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * ระยะเวลาแบบสั้น: "3 นาที" "2 ชม." "4 วัน"
 *
 * ไม่ใส่ "ที่แล้ว" หรือ "อีก" — ให้ที่เรียกเป็นคนใส่เอง
 * เพราะบริบทต่างกัน (เลยมาแล้ว vs เหลืออีก) แต่ตัวเลขชุดเดียวกัน
 */
export function durationTh(ms: number): string {
  const mins = Math.floor(Math.abs(ms) / 60_000);
  if (mins < 1) return "ไม่ถึงนาที";
  if (mins < 60) return `${mins} นาที`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest === 0 ? `${hours} ชม.` : `${hours} ชม. ${rest} น.`;
  }
  return `${Math.floor(hours / 24)} วัน`;
}

/** "เมื่อ 3 นาทีที่แล้ว" / "อีก 2 ชม." */
export function relativeTh(atMs: number, nowMs: number): string {
  const diff = atMs - nowMs;
  return diff >= 0 ? `อีก ${durationTh(diff)}` : `${durationTh(diff)}ที่แล้ว`;
}

/** ตัวเลขที่อ่านง่ายบนการ์ด: 18420 → "18,420" */
export function numTh(n: number): string {
  return n.toLocaleString("th-TH");
}

/** ย่อจำนวนคนติดตาม: 18420 → "1.8 หมื่น" */
export function compactTh(n: number): string {
  if (n < 1_000) return numTh(n);
  if (n < 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")} พัน`;
  if (n < 1_000_000)
    return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")} หมื่น`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} ล้าน`;
}

/** ตัดข้อความยาวโดยไม่ตัดกลางพยางค์ไทย */
export function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const seg = new Intl.Segmenter("th", { granularity: "grapheme" });
  const units = [...seg.segment(t)].map((g) => g.segment);
  return units.length <= max ? t : `${units.slice(0, max).join("")}…`;
}
