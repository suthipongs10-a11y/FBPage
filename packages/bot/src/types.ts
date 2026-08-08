/** ชนิดข้อมูลของ Chatbot Engine (M2) */

/** ชั้นไหนเป็นคนตอบ — เก็บไว้วัด containment rate (M7) */
export type AnswerLayer = "rule" | "rag" | "flow" | "escalated";

export interface BotReply {
  layer: AnswerLayer;
  text: string;
  /** ปุ่มตอบเร็วที่แนบไปกับข้อความ */
  quickReplies?: Array<{ title: string; payload: string }>;
  /** 0-1 — ต่ำกว่าเกณฑ์ของเพจจะถูกส่งต่อให้คน */
  confidence: number;
  /** อ้างอิงว่าเอาคำตอบมาจากไหน (ใช้ debug และให้แอดมินตรวจ) */
  sources?: string[];
  /** ต้องแจ้งคนหรือไม่ */
  escalate?: boolean;
  th: string;
}

/**
 * บุคลิกการพูดของเพจ (M2 Tone Profile)
 * ต่างเพจต่างโทน — เพจคลินิกกับเพจร้านขนมพูดไม่เหมือนกัน
 */
export interface ToneProfile {
  /** คำลงท้าย เช่น "ค่ะ" "ครับ" "จ้า" */
  particle: string;
  /** เรียกลูกค้าว่าอะไร เช่น "คุณลูกค้า" "พี่" */
  customerPronoun: string;
  /** เรียกตัวเองว่าอะไร เช่น "เรา" "ทางร้าน" */
  selfPronoun: string;
  politeness: "formal" | "friendly" | "casual";
  emoji: "none" | "light" | "heavy";
  /** คำที่ห้ามใช้เด็ดขาด (เช่น คู่แข่ง หรือคำที่ผิดกฎหมายโฆษณา) */
  bannedWords: string[];
}

export const DEFAULT_TONE: ToneProfile = {
  particle: "ค่ะ",
  customerPronoun: "คุณลูกค้า",
  selfPronoun: "ทางร้าน",
  politeness: "friendly",
  emoji: "light",
  bannedWords: [],
};

export interface PageBotConfig {
  pageId: string;
  storeName: string;
  tone: ToneProfile;
  /** ต่ำกว่านี้ส่งต่อให้คน */
  minConfidence: number;
  /** ข้อความประกาศว่าเป็นบอท (Meta policy บังคับในหลายเขต) */
  botDisclosure?: string;
  /** คำถามยอดฮิตที่โชว์ก่อนลูกค้าพิมพ์ (Ice Breakers) */
  iceBreakers?: Array<{ question: string; payload: string }>;
  welcomeMessage?: string;
}

/** ข้อมูลใน Knowledge Base ของเพจ */
export interface KnowledgeChunk {
  id: string;
  pageId: string;
  title: string;
  text: string;
  source?: string;
  /** เวกเตอร์ — undefined ถ้ายังไม่ได้ embed */
  embedding?: number[];
}

export interface RetrievedChunk extends KnowledgeChunk {
  /** ความใกล้เคียง 0-1 */
  score: number;
}

export interface BotContext {
  pageId: string;
  conversationId: string;
  /** ข้อความล่าสุดของลูกค้า */
  message: string;
  /** ประวัติล่าสุด (ใหม่สุดอยู่ท้าย) */
  history?: Array<{ role: "customer" | "bot" | "human"; text: string }>;
  contactName?: string;
  /** ลูกค้าเคยได้รับข้อความประกาศว่าเป็นบอทแล้วหรือยัง */
  disclosureSent: boolean;
  nowMs: number;
}
