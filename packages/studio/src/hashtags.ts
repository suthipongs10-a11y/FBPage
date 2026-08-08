/**
 * Hashtag ภาษาไทย (M5)
 *
 * สเปก: "ป้อนหัวข้อ 1 บรรทัด → ได้ 10 โพสต์พร้อมแคปชั่น + hashtag ไทย"
 *
 * เรื่องที่คนทำระบบมักพลาด: **แฮชแท็กไทยห้ามมีช่องว่าง**
 * "#ร้าน กาแฟ" จะกลายเป็นแท็ก "#ร้าน" เฉยๆ แล้วคำว่า "กาแฟ" ลอยออกมา
 * ซึ่งดูไม่เป็นมืออาชีพและเสียความหมายของแท็กไปเลย
 */
import { normalizeText } from "@page-os/moderation";

/** ยาวเกินนี้คนไม่กด และ Facebook แสดงผลไม่สวย */
export const MAX_HASHTAG_CHARS = 40;
/** จำนวนที่พอดี — มากกว่านี้ดูสแปม */
export const RECOMMENDED_HASHTAG_COUNT = 5;
export const MAX_HASHTAG_COUNT = 10;

/**
 * ตัดสตริงเป็นหน่วยที่คนไทยเห็นเป็น "ตัวอักษรหนึ่งตัว"
 *
 * "ก้" คือพยัญชนะ + วรรณยุกต์ = 2 code unit แต่คนเห็นเป็นตัวเดียว
 * ถ้าตัดตาม code unit วรรณยุกต์จะขาดจากพยัญชนะแล้วกลายเป็นขยะลอยๆ
 */
function graphemes(s: string): string[] {
  const seg = new Intl.Segmenter("th", { granularity: "grapheme" });
  return [...seg.segment(s)].map((g) => g.segment);
}

/** นับเฉพาะพยัญชนะ/สระเต็มตัว/ตัวเลข — วรรณยุกต์กับสระบนล่างไม่นับเป็นตัวอักษร */
function letterCount(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/**
 * แปลงข้อความเป็นแฮชแท็กที่ใช้ได้จริง
 *
 * คืน null ถ้าแปลงแล้วไม่เหลืออะไร หรือสั้นเกินจนไม่มีความหมาย
 */
export function toHashtag(text: string): string | null {
  const stripped = text
    .normalize("NFC")
    .replace(/^#+/, "")
    // ⚠️ ต้องเก็บ \p{M} ไว้ด้วย ไม่ใช่แค่ \p{L}\p{N}
    // วรรณยุกต์ (่ ้ ๊ ๋) และสระบน/ล่าง (ิ ี ุ ู ั ์) ของไทยเป็น Mark ไม่ใช่ Letter
    // ถ้าตัดทิ้ง "#ร้านกาแฟ" จะกลายเป็น "#รานกาแฟ" — สะกดผิดและเป็นคนละคำ
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "")
    // วรรณยุกต์ที่ลอยอยู่หน้าสุดโดยไม่มีพยัญชนะรองรับ = เศษที่เหลือจากการตัด
    .replace(/^\p{M}+/u, "");

  // ตัดตามหน่วยที่คนอ่านเห็น ไม่ใช่ตาม code unit
  const cleaned = graphemes(stripped).slice(0, MAX_HASHTAG_CHARS).join("");

  // แท็กตัวเดียวไม่มีความหมาย และแท็กที่เป็นตัวเลขล้วนก็ไม่มีใครค้น
  if (letterCount(cleaned) < 2) return null;
  if (/^[\p{N}\p{M}]+$/u.test(cleaned)) return null;

  return `#${cleaned}`;
}

export interface HashtagOptions {
  /** เอาแค่กี่แท็ก */
  limit?: number;
  /** แท็กประจำแบรนด์ที่ต้องมีเสมอ */
  brandTags?: string[];
}

/**
 * ทำความสะอาดรายการแฮชแท็กที่ AI สร้างมา
 *
 * AI มักคืนแท็กที่มีช่องว่าง มีอีโมจิ ซ้ำกัน หรือยาวเกิน
 * ตัวนี้คือด่านที่ทำให้ผลลัพธ์ใช้ได้จริงโดยไม่ต้องหวังว่า prompt จะพอ
 */
export function cleanHashtags(
  raw: readonly string[],
  opts: HashtagOptions = {},
): string[] {
  const limit = Math.min(
    opts.limit ?? RECOMMENDED_HASHTAG_COUNT,
    MAX_HASHTAG_COUNT,
  );
  const seen = new Set<string>();
  const out: string[] = [];

  // แท็กแบรนด์มาก่อนเสมอ
  for (const b of opts.brandTags ?? []) {
    const tag = toHashtag(b);
    if (!tag) continue;
    const key = normalizeText(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }

  for (const r of raw) {
    if (out.length >= limit) break;
    const tag = toHashtag(r);
    if (!tag) continue;
    const key = normalizeText(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }

  return out.slice(0, limit);
}

/**
 * ดึงแฮชแท็กออกจากแคปชั่น
 *
 * ใช้ตอนที่ AI ใส่แท็กปนมาในเนื้อโพสต์ — เราต้องแยกออกมาเก็บแยก
 * เพื่อให้แก้ไขและวิเคราะห์ได้
 */
export function extractHashtags(caption: string): {
  body: string;
  hashtags: string[];
} {
  const found: string[] = [];
  const body = caption
    // \p{M} ด้วยเหตุผลเดียวกับ toHashtag — ไม่งั้น "#ข้าวกล่อง" จะถูกดึงออกแค่ "#ข"
    // แล้วเหลือ "้าวกล่อง" ค้างอยู่ในเนื้อโพสต์ที่ลูกค้าเห็น
    .replace(/#[\p{L}\p{N}\p{M}_]+/gu, (m) => {
      found.push(m);
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { body, hashtags: cleanHashtags(found, { limit: MAX_HASHTAG_COUNT }) };
}

/** ประกอบแคปชั่นกับแฮชแท็กให้เป็นโพสต์สุดท้าย */
export function composeCaption(
  body: string,
  hashtags: readonly string[],
): string {
  const tags = cleanHashtags(hashtags, { limit: MAX_HASHTAG_COUNT });
  if (tags.length === 0) return body.trim();
  return `${body.trim()}\n\n${tags.join(" ")}`;
}

export interface HashtagIssue {
  tag: string;
  th: string;
}

/** ตรวจแฮชแท็กก่อนโพสต์ — ใช้เตือนในหน้ารีวิว */
export function checkHashtags(tags: readonly string[]): HashtagIssue[] {
  const issues: HashtagIssue[] = [];
  const seen = new Set<string>();

  for (const t of tags) {
    if (/\s/.test(t)) {
      issues.push({
        tag: t,
        th: `"${t}" มีช่องว่าง — Facebook จะตัดแท็กที่ช่องว่าง ทำให้เหลือแค่คำแรก`,
      });
    }
    if (!t.startsWith("#")) {
      issues.push({ tag: t, th: `"${t}" ไม่ได้ขึ้นต้นด้วย #` });
    }
    // นับเป็นตัวอักษรที่คนเห็น ให้ตรงกับเกณฑ์ที่ toHashtag ใช้ตัด
    if (graphemes(t.replace(/^#/, "")).length > MAX_HASHTAG_CHARS) {
      issues.push({
        tag: t,
        th: `"${t}" ยาวเกิน ${MAX_HASHTAG_CHARS} ตัวอักษร คนไม่กดและแสดงผลไม่สวย`,
      });
    }
    const key = normalizeText(t);
    if (seen.has(key)) {
      issues.push({ tag: t, th: `"${t}" ซ้ำกับแท็กอื่นในโพสต์เดียวกัน` });
    }
    seen.add(key);
  }

  if (tags.length > MAX_HASHTAG_COUNT) {
    issues.push({
      tag: "",
      th: `มีแท็ก ${tags.length} อัน เกิน ${MAX_HASHTAG_COUNT} — ดูเหมือนสแปม`,
    });
  }
  return issues;
}
