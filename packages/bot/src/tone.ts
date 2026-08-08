/**
 * Tone Profile ต่อเพจ (M2)
 *
 * สเปก: "กำหนดสรรพนาม (ค่ะ/ครับ/จ้า), ระดับความสุภาพ, emoji มาก/น้อย
 *        → ใส่ใน system prompt"
 *
 * ทำสองอย่าง:
 *   1. สร้าง system prompt ให้ LLM (ชั้น 2)
 *   2. ปรับข้อความที่เขียนไว้ตายตัว (ชั้น 1) ให้เข้ากับโทนของเพจ
 *
 * ข้อ 2 สำคัญกว่าที่คิด เพราะคำตอบจากกฎ keyword คือคำตอบส่วนใหญ่ที่ลูกค้าได้รับ
 * ถ้าโทนไม่ตรงกับที่เพจใช้ ลูกค้าจะรู้สึกได้ทันทีว่าคุยกับหุ่นยนต์
 */
import { DEFAULT_TONE, type PageBotConfig, type ToneProfile } from "./types.js";

const POLITENESS_TH: Record<ToneProfile["politeness"], string> = {
  formal: "สุภาพเป็นทางการ ใช้ภาษาเขียนที่ถูกต้อง",
  friendly: "สุภาพแต่เป็นกันเอง เหมือนพนักงานร้านที่คุยง่าย",
  casual: "เป็นกันเองมาก เหมือนคุยกับเพื่อน แต่ยังให้เกียรติลูกค้า",
};

const EMOJI_TH: Record<ToneProfile["emoji"], string> = {
  none: "ห้ามใช้อีโมจิเลย",
  light: "ใช้อีโมจิได้บ้าง ไม่เกิน 1 ตัวต่อข้อความ",
  heavy: "ใช้อีโมจิได้ตามสบาย 2-3 ตัวต่อข้อความ",
};

/**
 * ประกอบ system prompt สำหรับ LLM
 *
 * เขียนเป็นภาษาไทยทั้งหมดโดยตั้งใจ — โมเดลตอบภาษาไทยได้ดีกว่าเมื่อคำสั่ง
 * เป็นภาษาไทย และคนที่มาแก้ทีหลังอ่านรู้เรื่อง
 */
export function buildSystemPrompt(config: PageBotConfig): string {
  const t = config.tone;
  const lines = [
    `คุณคือผู้ช่วยตอบข้อความของ "${config.storeName}" ทาง Facebook Messenger`,
    "",
    "วิธีพูด:",
    `- ลงท้ายประโยคด้วย "${t.particle}"`,
    `- เรียกลูกค้าว่า "${t.customerPronoun}" และเรียกตัวเองว่า "${t.selfPronoun}"`,
    `- ${POLITENESS_TH[t.politeness]}`,
    `- ${EMOJI_TH[t.emoji]}`,
    "- ตอบสั้น กระชับ ไม่เกิน 3 ประโยค เพราะลูกค้าอ่านบนมือถือ",
    "",
    "กฎที่ห้ามละเมิด:",
    "- ตอบจากข้อมูลที่ให้ไว้เท่านั้น ห้ามแต่งข้อมูลขึ้นเอง",
    "- ถ้าไม่มีข้อมูลตอบ ให้บอกตรงๆ ว่าจะให้เจ้าหน้าที่มาตอบ อย่าเดา",
    "- ห้ามสัญญาเรื่องราคา ส่วนลด หรือกำหนดส่ง ที่ไม่ได้อยู่ในข้อมูล",
    "- ห้ามขอข้อมูลบัตรเครดิต รหัสผ่าน หรือเลขบัตรประชาชน",
  ];

  if (t.bannedWords.length > 0) {
    lines.push(`- ห้ามใช้คำเหล่านี้เด็ดขาด: ${t.bannedWords.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * ปรับข้อความที่เขียนไว้ตายตัวให้เข้ากับโทนของเพจ
 *
 * แทน `{ค่ะ}` ด้วยคำลงท้ายของเพจ และ `{ลูกค้า}` `{ร้าน}` ด้วยสรรพนามที่ตั้งไว้
 * ทำให้เขียนกฎ keyword ครั้งเดียวใช้ได้ทุกเพจ
 */
export function applyTone(
  template: string,
  config: PageBotConfig,
  vars: Record<string, string | undefined> = {},
): string {
  const t = config.tone;
  const table: Record<string, string> = {
    "ค่ะ": t.particle,
    ลูกค้า: t.customerPronoun,
    ร้าน: t.selfPronoun,
    ชื่อร้าน: config.storeName,
    ...Object.fromEntries(
      Object.entries(vars).filter(([, v]) => v !== undefined),
    ),
  } as Record<string, string>;

  let out = template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const k = key.trim();
    return table[k] ?? "";
  });

  if (t.emoji === "none") out = stripEmoji(out);

  return out.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?])/g, "$1").trim();
}

/** ลบอีโมจิออกจากข้อความ (สำหรับเพจที่ตั้งค่าไม่ใช้อีโมจิ) */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface ToneViolation {
  word: string;
  th: string;
}

/**
 * ตรวจว่าข้อความที่จะส่งมีคำต้องห้ามของเพจไหม
 *
 * ต้องตรวจ **หลัง** LLM ตอบเสมอ ไม่ใช่หวังว่า prompt จะพอ
 * — โมเดลไม่ทำตามคำสั่ง 100% และคำต้องห้ามส่วนใหญ่มีเหตุผลทางกฎหมาย
 *   (เช่น เพจคลินิกห้ามพูดว่า "รักษาหายขาด")
 */
export function checkBannedWords(
  text: string,
  config: PageBotConfig,
): ToneViolation | null {
  const lower = text.toLowerCase();
  for (const w of config.tone.bannedWords) {
    const nw = w.trim().toLowerCase();
    if (nw !== "" && lower.includes(nw)) {
      return {
        word: w,
        th: `ข้อความที่บอทจะส่งมีคำต้องห้ามของเพจนี้ ("${w}") — ไม่ส่ง และเรียกคนมาตอบแทน`,
      };
    }
  }
  return null;
}

/** ข้อความประกาศว่าเป็นบอท (Meta policy บังคับในหลายเขต — สเปกข้อ M2) */
export function botDisclosure(config: PageBotConfig): string {
  if (config.botDisclosure) return applyTone(config.botDisclosure, config);
  return applyTone(
    "สวัสดี{ค่ะ} นี่คือผู้ช่วยตอบอัตโนมัติของ{ชื่อร้าน} หากต้องการคุยกับเจ้าหน้าที่ พิมพ์ว่า \"ขอคุยกับแอดมิน\" ได้เลย{ค่ะ}",
    config,
  );
}

export function defaultConfig(
  pageId: string,
  storeName: string,
  over: Partial<PageBotConfig> = {},
): PageBotConfig {
  return {
    pageId,
    storeName,
    tone: { ...DEFAULT_TONE, ...(over.tone ?? {}) },
    minConfidence: over.minConfidence ?? 0.6,
    ...(over.botDisclosure !== undefined
      ? { botDisclosure: over.botDisclosure }
      : {}),
    ...(over.iceBreakers !== undefined ? { iceBreakers: over.iceBreakers } : {}),
    ...(over.welcomeMessage !== undefined
      ? { welcomeMessage: over.welcomeMessage }
      : {}),
  };
}
