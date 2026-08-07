/**
 * Normalize ข้อความไทยก่อนเอาไปแมตช์กฎ
 *
 * นี่คือส่วนที่สำคัญกว่ารายการคำต้องห้ามเสียอีก เพราะคนที่ตั้งใจหลบ filter
 * จะไม่พิมพ์คำตรงๆ อยู่แล้ว วิธีหลบที่เจอจริงในเพจไทย:
 *
 *   - แทรกช่องว่าง/จุด:  "เ ห ี ้ ย"  "0 8 1 - 2 3 4"
 *   - ซ้ำตัวอักษร:        "เหี้ยยยยยย"
 *   - เลขไทย:            "๐๘๑๒๓๔๕๖๗๘"
 *   - สลับเลขเป็นตัวอักษร: "o81" (โอ) "O8I"
 *   - แทรกอักขระล่องหน:   zero-width space ที่ copy มาจากที่อื่น
 *
 * ภาษาไทยไม่มีการเว้นวรรคระหว่างคำ → ใช้ \b ของ regex ไม่ได้เลย
 * ทุกการแมตช์จึงเป็น substring matching บนข้อความที่ normalize แล้ว
 */

/** อักขระล่องหนที่ต้องลบทิ้งเสมอ */
const INVISIBLE = /[​-‍⁠﻿­]/g;

/** สระ/วรรณยุกต์ไทยที่ลอยอยู่บนล่าง — ลบได้เมื่อแมตช์แบบเข้มงวด */
const THAI_DIACRITICS = /[ัิ-ฺ็-๎]/g;

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/** ตัวอักษรที่คนใช้แทนตัวเลขเวลาหลบ filter */
const LOOKALIKE_DIGITS: Record<string, string> = {
  o: "0",
  O: "0",
  "โ": "0",
  l: "1",
  I: "1",
  "|": "1",
  i: "1",
  z: "2",
  Z: "2",
  e: "3",
  a: "4",
  s: "5",
  S: "5",
  b: "6",
  t: "7",
  B: "8",
  g: "9",
  q: "9",
};

/** แปลงเลขไทยเป็นเลขอารบิก */
export function thaiDigitsToArabic(text: string): string {
  let out = "";
  for (const ch of text) {
    const i = THAI_DIGITS.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

/**
 * normalize ระดับพื้นฐาน — ใช้กับการแมตช์ทั่วไป
 * ยังคงรูปคำไว้พออ่านออก แต่ตัดสิ่งที่ใช้หลบ filter ได้ทิ้ง
 */
export function normalizeText(text: string): string {
  return thaiDigitsToArabic(text)
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    // ยุบตัวอักษรที่ซ้ำเกิน 2 ตัวให้เหลือ 2 ("เหี้ยยยยย" → "เหี้ยย")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * normalize แบบเข้มงวด — ใช้เฉพาะตอนหาคำหยาบ
 *
 * ลบช่องว่าง เครื่องหมายวรรคตอน และสระ/วรรณยุกต์ทั้งหมด
 * ทำให้ "เ ห ี ้ ย" กับ "เหี้ย" กลายเป็นสตริงเดียวกัน
 *
 * ระวัง: การลบสระทำให้คำที่ไม่เกี่ยวกันชนกันได้ จึงใช้กับรายการคำที่คัดมาแล้วเท่านั้น
 * ห้ามเอาไปใช้กับคีย์เวิร์ดทั่วไปที่ลูกค้าตั้งเอง
 */
export function normalizeAggressive(text: string): string {
  return normalizeText(text)
    .replace(THAI_DIACRITICS, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * ดึงเฉพาะตัวเลขออกมา โดยแปลงตัวอักษรที่ใช้แทนเลขด้วย
 * ใช้หาเบอร์โทรที่ถูกพรางไว้
 */
export function extractDigitRuns(text: string): string[] {
  const base = thaiDigitsToArabic(text).replace(INVISIBLE, "");
  // แปลงตัวอักษรที่หน้าตาเหมือนเลข เฉพาะเมื่ออยู่ติดกับเลขจริง
  // (ถ้าแปลงทุกที่ คำภาษาอังกฤษปกติจะกลายเป็นตัวเลขหมด)
  const chars = [...base];
  const mapped = chars.map((ch, i) => {
    const alt = LOOKALIKE_DIGITS[ch];
    if (alt === undefined) return ch;
    const prev = chars[i - 1] ?? "";
    const next = chars[i + 1] ?? "";
    const nearDigit = /\d/.test(prev) || /\d/.test(next);
    return nearDigit ? alt : ch;
  });

  const runs: string[] = [];
  let current = "";
  // ตัวคั่นที่คนใช้แทรกกลางเบอร์แล้วยังถือว่าเป็นเบอร์เดียวกัน
  const separators = new Set([" ", "-", ".", "_", "/", "(", ")", "+"]);
  for (const ch of mapped) {
    if (/\d/.test(ch)) {
      current += ch;
    } else if (separators.has(ch)) {
      // ข้ามไป ยังไม่ตัดท่อน
    } else {
      if (current.length > 0) runs.push(current);
      current = "";
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * ข้อความนี้มีคำใดคำหนึ่งในรายการหรือไม่
 * เทียบทั้งแบบปกติและแบบเข้มงวด เพื่อจับกรณีแทรกช่องว่าง
 */
export function containsAny(
  text: string,
  words: readonly string[],
  opts: { aggressive?: boolean } = {},
): string | null {
  const normal = normalizeText(text);
  for (const w of words) {
    const nw = normalizeText(w);
    if (nw !== "" && normal.includes(nw)) return w;
  }
  if (opts.aggressive) {
    const strict = normalizeAggressive(text);
    for (const w of words) {
      const sw = normalizeAggressive(w);
      // คำสั้นเกินไปหลังลบสระจะชนมั่ว
      if (sw.length >= 3 && strict.includes(sw)) return w;
    }
  }
  return null;
}
