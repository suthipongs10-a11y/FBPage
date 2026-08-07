/**
 * Sentiment ภาษาไทยแบบ lexicon (M3 — Negative Sentiment Alert)
 *
 * ทำไมไม่ใช้ LLM: สเปกข้อ M2 วางหลักไว้ว่าอย่าใช้ LLM ตอบทุกข้อความ
 * เหตุผลเดียวกันใช้ที่นี่ — คอมเมนต์เข้ามาวันละหลายพัน ยิง LLM ทุกอันทั้งเปลืองทั้งช้า
 * และ alert ต้องถึงแอดมินภายใน 1 นาทีตามสเปก
 *
 * ตัวนี้ทำหน้าที่คัดกรองชั้นแรก: ตัวที่ชัดว่าลบ → alert ทันที
 * ตัวที่ก้ำกึ่ง → ปักธงไว้ให้คนดู (หรือส่งต่อให้ LLM ตอน M-F)
 */
import { containsAny, normalizeText } from "./normalize.js";
import { COMPLAINT_TH } from "./detectors.js";

export type Sentiment = "positive" | "neutral" | "negative";

export interface SentimentResult {
  sentiment: Sentiment;
  /** -1 (ลบสุด) ถึง 1 (บวกสุด) */
  score: number;
  /** 0-1; ต่ำ = ควรให้คนตัดสิน */
  confidence: number;
  /** คำที่ทำให้ตัดสินแบบนี้ */
  signals: string[];
  th: string;
}

const POSITIVE_TH = [
  "ดีมาก",
  "ดีจัง",
  "ชอบมาก",
  "ชอบ",
  "ประทับใจ",
  "สวยมาก",
  "สวย",
  "อร่อย",
  "คุ้มมาก",
  "คุ้ม",
  "แนะนำเลย",
  "บริการดี",
  "ส่งไว",
  "น่ารัก",
  "ขอบคุณ",
  "เยี่ยม",
  "สุดยอด",
  "ปัง",
  "ถูกใจ",
  "ครั้งหน้ามาอีก",
  "รีวิวดี",
] as const;

const NEGATIVE_TH = [
  ...COMPLAINT_TH,
  "ไม่ดี",
  "ไม่ชอบ",
  "ช้ามาก",
  "แพงเกิน",
  "ไม่คุ้ม",
  "เสียดายเงิน",
  "บริการแย่",
  "พนักงานแย่",
  "ไม่สุภาพ",
  "หยาบคาย",
  "ไม่รับผิดชอบ",
  "อย่าซื้อ",
  "อย่าไป",
  "ไม่แนะนำ",
  "เข็ด",
] as const;

/** คำที่พลิกความหมายของคำถัดไป */
const NEGATORS = ["ไม่", "ไม่ได้", "ไม่ค่อย", "หา", "อย่า"] as const;

/** คำที่มักตามหลังคำบวกแล้วทำให้กลายเป็นลบ เช่น "ดีมั้ย" = คำถาม ไม่ใช่ชม */
const QUESTION_MARKERS = ["ไหม", "มั้ย", "หรอ", "เหรอ", "ป่าว", "รึเปล่า"];

/**
 * นับคำบวก/ลบ แล้วให้คะแนน
 *
 * จุดที่ระวังเป็นพิเศษ: "ไม่ดี" ต้องไม่ถูกนับเป็นบวกเพราะมีคำว่า "ดี" อยู่ข้างใน
 * จึงต้องเช็คคำปฏิเสธที่นำหน้าเสมอ
 */
function countSignals(
  text: string,
  words: readonly string[],
): { hits: string[]; negated: string[] } {
  const normal = normalizeText(text);
  const hits: string[] = [];
  const negated: string[] = [];

  for (const w of words) {
    const nw = normalizeText(w);
    if (nw === "") continue;
    let from = 0;
    for (;;) {
      const idx = normal.indexOf(nw, from);
      if (idx === -1) break;
      from = idx + nw.length;
      // ดูข้อความ 6 ตัวก่อนหน้าว่ามีคำปฏิเสธไหม
      const before = normal.slice(Math.max(0, idx - 6), idx);
      const isNegated = NEGATORS.some((n) => before.endsWith(normalizeText(n)));
      if (isNegated) negated.push(w);
      else hits.push(w);
    }
  }
  return { hits, negated };
}

export function analyzeSentiment(text: string): SentimentResult {
  const normal = normalizeText(text);

  if (normal === "") {
    return {
      sentiment: "neutral",
      score: 0,
      confidence: 0,
      signals: [],
      th: "คอมเมนต์ว่าง ตัดสินอารมณ์ไม่ได้",
    };
  }

  const pos = countSignals(text, POSITIVE_TH);
  const neg = countSignals(text, NEGATIVE_TH);

  // คำบวกที่ถูกปฏิเสธกลายเป็นลบ ("ไม่ดี", "ไม่คุ้ม")
  // คำลบที่ถูกปฏิเสธไม่นับเป็นบวก เพราะ "ไม่แย่" ก็ไม่ได้แปลว่าชม
  const posCount = pos.hits.length;
  const negCount = neg.hits.length + pos.negated.length;

  const signals = [
    ...pos.hits,
    ...neg.hits,
    ...pos.negated.map((w) => `ไม่${w}`),
  ];

  // เป็นคำถาม → ไม่ใช่การชมหรือด่า
  const isQuestion =
    normal.includes("?") ||
    QUESTION_MARKERS.some((q) => normal.includes(normalizeText(q)));

  if (posCount === 0 && negCount === 0) {
    return {
      sentiment: "neutral",
      score: 0,
      confidence: 0.4,
      signals: [],
      th: "ไม่พบคำที่บอกอารมณ์ชัดเจน",
    };
  }

  const total = posCount + negCount;
  const score = (posCount - negCount) / total;
  // สัญญาณเยอะ = มั่นใจมากขึ้น แต่ไม่เกิน 0.95
  let confidence = Math.min(0.95, 0.5 + total * 0.15);
  // "ของดีมากไหมคะ" คือคำถาม ไม่ใช่คำชม — ลดความมั่นใจเสมอเมื่อเป็นคำถาม
  // ไม่ว่าคำที่เจอจะเป็นบวกล้วนหรือปนกัน
  if (isQuestion) confidence *= 0.6;

  if (score <= -0.34) {
    return {
      sentiment: "negative",
      score,
      confidence,
      signals,
      th: `คอมเมนต์เชิงลบ (พบ: ${signals.slice(0, 3).join(", ")})`,
    };
  }
  if (score >= 0.34) {
    return {
      sentiment: "positive",
      score,
      confidence,
      signals,
      th: `คอมเมนต์เชิงบวก (พบ: ${signals.slice(0, 3).join(", ")})`,
    };
  }
  return {
    sentiment: "neutral",
    score,
    confidence: confidence * 0.7,
    signals,
    th: "มีทั้งคำบวกและคำลบ ตัดสินไม่ได้ชัด — ควรให้คนอ่าน",
  };
}

/** ต่ำกว่านี้ไม่ควรยิง alert เพราะจะรบกวนแอดมินจนเลิกอ่าน */
export const ALERT_CONFIDENCE_THRESHOLD = 0.6;

/** ควรยิง alert เข้า LINE ไหม (สเปก: ภายใน 1 นาที) */
export function shouldAlert(result: SentimentResult): boolean {
  return (
    result.sentiment === "negative" &&
    result.confidence >= ALERT_CONFIDENCE_THRESHOLD
  );
}
