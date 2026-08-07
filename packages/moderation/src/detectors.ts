/**
 * ตัวตรวจจับเนื้อหาในคอมเมนต์ (M3)
 *
 * หลักการที่ยึด: **false positive แพงกว่า false negative**
 * ซ่อนคอมเมนต์ลูกค้าจริงเพราะเข้าใจผิด = ลูกค้าโกรธและเราไม่รู้ตัว
 * ส่วนคอมเมนต์สแปมที่หลุดไป เราเห็นแล้วกดซ่อนเองได้
 * ทุกตัวตรวจจับจึงเลือกเข้มกับ pattern และคืนค่า "ความมั่นใจ" มาให้ตัดสินใจต่อ
 */
import {
  containsAny,
  extractDigitRuns,
  normalizeText,
} from "./normalize.js";


export interface DetectionHit {
  /** เจออะไร */
  kind: DetectionKind;
  /** ส่วนของข้อความที่ทำให้เข้าเงื่อนไข */
  matched: string;
  /** 0-1 — ต่ำกว่า 0.8 ไม่ควรซ่อนอัตโนมัติ ให้แค่ปักธง */
  confidence: number;
  th: string;
}

export type DetectionKind =
  | "phone"
  | "external_link"
  | "line_id"
  | "profanity"
  | "buying_intent"
  | "complaint";

// --------------------------------------------------------------- เบอร์โทร

/** เบอร์มือถือไทยขึ้นต้น 06/08/09 ยาว 10 หลัก; เบอร์บ้าน 0 + 8-9 หลัก */
function looksLikeThaiPhone(run: string): boolean {
  if (/^0[689]\d{8}$/.test(run)) return true; // มือถือ
  if (/^0\d{8}$/.test(run)) return true; // เบอร์บ้าน 9 หลัก
  if (/^66[689]\d{8}$/.test(run)) return true; // +66
  return false;
}

/**
 * หาเบอร์โทรในคอมเมนต์ — ใช้จับ "คู่แข่งมาแปะเบอร์ในเพจเรา"
 * ซึ่งเป็นเคสที่ลูกค้าเจ็บที่สุดและยอมจ่ายให้เราคุมให้
 */
export function detectPhone(text: string): DetectionHit | null {
  for (const run of extractDigitRuns(text)) {
    if (looksLikeThaiPhone(run)) {
      return {
        kind: "phone",
        matched: run,
        confidence: 0.95,
        th: `พบเบอร์โทรในคอมเมนต์ (${run}) — มักเป็นคู่แข่งมาแย่งลูกค้า`,
      };
    }
    // เลขยาวผิดปกติที่ไม่ตรงรูปแบบเบอร์ — น่าสงสัยแต่ไม่ฟันธง
    if (run.length >= 9 && run.length <= 13) {
      return {
        kind: "phone",
        matched: run,
        confidence: 0.6,
        th: `พบเลขยาวที่อาจเป็นเบอร์โทร (${run}) — ควรดูด้วยตาก่อนซ่อน`,
      };
    }
  }
  return null;
}

// ------------------------------------------------------------------ ลิงก์

/** โดเมนที่ปกติแล้วไม่ถือว่าเป็นสแปมในคอมเมนต์เพจ */
const SAFE_LINK_HOSTS = [
  "facebook.com",
  "fb.com",
  "fb.watch",
  "instagram.com",
  "m.me",
];

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
/** โดเมนเปล่าๆ ที่ไม่มี http:// นำหน้า เช่น "shopee.co.th/xxx" */
const BARE_DOMAIN_RE =
  /\b[a-z0-9][a-z0-9-]{1,60}\.(?:com|net|co|co\.th|in\.th|shop|store|online|xyz|top|club|site|me|ly|link)\b(?:\/\S*)?/gi;

export function detectExternalLink(text: string): DetectionHit | null {
  const normal = normalizeText(text);
  const candidates: string[] = [];

  URL_RE.lastIndex = 0;
  candidates.push(...(normal.match(URL_RE) ?? []));
  BARE_DOMAIN_RE.lastIndex = 0;
  candidates.push(...(normal.match(BARE_DOMAIN_RE) ?? []));

  for (const raw of candidates) {
    const host = raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]!;
    if (SAFE_LINK_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) {
      continue;
    }
    return {
      kind: "external_link",
      matched: raw,
      confidence: 0.85,
      th: `พบลิงก์ออกนอกเพจ (${host}) — มักเป็นสแปมหรือคู่แข่ง`,
    };
  }
  return null;
}

/** คนไทยชอบทิ้ง LINE ID ในคอมเมนต์เพื่อดึงลูกค้าออกจากเพจ */
const LINE_MARKERS = [
  "ไลน์ไอดี",
  "ไอดีไลน์",
  "line id",
  "lineid",
  "แอดไลน์",
  "add line",
  "@line",
];

export function detectLineId(text: string): DetectionHit | null {
  const found = containsAny(text, LINE_MARKERS);
  if (found) {
    return {
      kind: "line_id",
      matched: found,
      confidence: 0.8,
      th: "พบการทิ้ง LINE ID — มักเป็นการดึงลูกค้าออกจากเพจ",
    };
  }
  // @xxxxx ที่ไม่ใช่การแท็กคน
  const at = normalizeText(text).match(/@[a-z0-9._-]{4,}/);
  if (at) {
    return {
      kind: "line_id",
      matched: at[0],
      confidence: 0.55,
      th: `พบ ${at[0]} ที่อาจเป็น LINE ID — ควรดูด้วยตาก่อนซ่อน`,
    };
  }
  return null;
}

// --------------------------------------------------------------- คำหยาบ

/**
 * รายการคำหยาบพื้นฐาน — ตั้งใจให้สั้นและชัด
 *
 * ไม่ใส่คำก้ำกึ่งอย่าง "ควาย" หรือ "โง่" เพราะลูกค้าจริงใช้พูดเล่นกันเยอะ
 * ถ้าลูกค้าอยากเข้มกว่านี้ให้เพิ่มเองผ่าน customKeywords ของแต่ละเพจ
 *
 * **ห้ามใส่คำที่เป็นส่วนหนึ่งของคำสุภาพ** ภาษาไทยไม่เว้นวรรคระหว่างคำ
 * การแมตช์จึงเป็น substring ล้วน คำอย่าง "สัตว์" จะไปโดน "สัตว์เลี้ยง"
 * และ "กู" จะไปโดน "กูเกิล" ทำให้เพจร้านสัตว์เลี้ยงโดนซ่อนคอมเมนต์ลูกค้าทั้งวัน
 * คำที่มีความเสี่ยงแบบนี้ต้องใส่ในรูปที่ยาวพอจะไม่กำกวม (เช่น "ไอ้สัตว์")
 */
export const PROFANITY_TH = [
  "เหี้ย",
  "สัส",
  "ไอ้สัตว์",
  "อีสัตว์",
  "ควย",
  "เย็ด",
  "แม่ง",
  "อีดอก",
  "ระยำ",
  "ชิบหาย",
  "ฉิบหาย",
  "ไอ้เวร",
  "อีเวร",
] as const;

export const PROFANITY_EN = ["fuck", "shit", "bitch", "asshole"] as const;

/**
 * คำสุภาพที่มีคำหยาบเป็นส่วนประกอบ — เจอคำพวกนี้ให้ยกเว้นตำแหน่งนั้น
 *
 * ใช้เมื่อลูกค้าเพิ่มคำเข้มๆ เองผ่าน `extra` ซึ่งเราคุมไม่ได้ว่าจะกำกวมแค่ไหน
 */
export const PROFANITY_EXCEPTIONS = [
  "สัตว์เลี้ยง",
  "สัตวแพทย์",
  "สัตว์แพทย์",
  "อาหารสัตว์",
  "โรงพยาบาลสัตว์",
  "สวนสัตว์",
  "สัตว์น้ำ",
  "สัตว์ป่า",
  "กูเกิล",
  "google",
  "มึงเอ็ง", // สำนวน
] as const;

/**
 * ตัดคำที่ได้รับการยกเว้นออกจากข้อความก่อน แล้วค่อยหาคำหยาบในส่วนที่เหลือ
 * ทำให้ "รับฝากสัตว์เลี้ยงไหมคะ" ไม่ถูกจับ แต่ "ไอ้สัตว์" ยังถูกจับอยู่
 */
function stripExceptions(text: string): string {
  let out = normalizeText(text);
  for (const ex of PROFANITY_EXCEPTIONS) {
    const nex = normalizeText(ex);
    if (nex === "") continue;
    out = out.split(nex).join(" ");
  }
  return out;
}

export function detectProfanity(
  text: string,
  extra: readonly string[] = [],
): DetectionHit | null {
  const cleaned = stripExceptions(text);
  const found = containsAny(
    cleaned,
    [...PROFANITY_TH, ...PROFANITY_EN, ...extra],
    { aggressive: true },
  );
  if (!found) return null;
  return {
    kind: "profanity",
    matched: found,
    confidence: 0.9,
    th: `พบคำหยาบ ("${found}") ในคอมเมนต์`,
  };
}

// -------------------------------------------------- คำที่บอกว่าสนใจซื้อ

/**
 * คำที่แปลว่า "ลูกค้าสนใจ" — ตัวนี้คือหัวใจของ Comment → Inbox
 * สเปกยกตัวอย่างไว้: สนใจ / ราคา / CF
 */
export const BUYING_INTENT_TH = [
  "สนใจ",
  "ราคา",
  "เท่าไหร่",
  "เท่าไร",
  "กี่บาท",
  "cf",
  "ซีเอฟ",
  "จอง",
  "สั่งซื้อ",
  "สั่ง",
  "รับไหม",
  "มีไหม",
  "ยังมีไหม",
  "ส่งไหม",
  "ทักแล้ว",
  "inbox",
  "ib",
] as const;

export function detectBuyingIntent(
  text: string,
  extra: readonly string[] = [],
): DetectionHit | null {
  const found = containsAny(text, [...BUYING_INTENT_TH, ...extra]);
  if (!found) return null;
  return {
    kind: "buying_intent",
    matched: found,
    confidence: 0.85,
    th: `ลูกค้าน่าจะสนใจซื้อ (พิมพ์ว่า "${found}")`,
  };
}

// --------------------------------------------------------- คำร้องเรียน

/** คำที่บอกว่าลูกค้ากำลังไม่พอใจ — ต้องรีบแจ้งแอดมินภายใน 1 นาที */
export const COMPLAINT_TH = [
  "ไม่ได้ของ",
  "ของไม่ตรง",
  "ของเสีย",
  "ชำรุด",
  "หลอกลวง",
  "โกง",
  "หลอก",
  "แจ้งความ",
  "สคบ",
  "ทนาย",
  "คืนเงิน",
  "รีฟัน",
  "เคลม",
  "รอนานมาก",
  "ไม่ตอบ",
  "ติดต่อไม่ได้",
  "แย่มาก",
  "ห่วยมาก",
  "ผิดหวัง",
  "ไม่ประทับใจ",
  "เสียความรู้สึก",
] as const;

export function detectComplaint(
  text: string,
  extra: readonly string[] = [],
): DetectionHit | null {
  const found = containsAny(text, [...COMPLAINT_TH, ...extra]);
  if (!found) return null;
  return {
    kind: "complaint",
    matched: found,
    confidence: 0.8,
    th: `ลูกค้าอาจกำลังร้องเรียน (พิมพ์ว่า "${found}")`,
  };
}
