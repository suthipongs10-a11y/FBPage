/** ชนิดข้อมูลของ Comment Automation (M3) */

export interface IncomingComment {
  /** id ของคอมเมนต์จาก Meta — ใช้เป็น idempotency key (กฎข้อ 6) */
  commentId: string;
  pageId: string;
  postId?: string;
  /** id ผู้เขียน (PSID/ASID) */
  authorId: string;
  authorName?: string;
  message: string;
  /** epoch ms (UTC) */
  createdAtMs: number;
  /** คอมเมนต์นี้เขียนโดยเพจเราเอง (ตอบกลับของเราเอง) */
  isFromPage: boolean;
  /** เป็นการตอบใต้คอมเมนต์อื่น */
  parentCommentId?: string;
}

export type ModerationActionKind =
  | "hide"
  | "unhide"
  | "delete"
  | "reply"
  | "private_reply"
  | "like"
  | "alert"
  | "flag";

export interface PlannedAction {
  kind: ModerationActionKind;
  /** ข้อความ (ใช้กับ reply / private_reply / alert) */
  message?: string;
  /** ทำไมถึงทำแบบนี้ — เก็บลง comments.action_taken และแสดงใน UI */
  reason: string;
  /** ความมั่นใจของกฎที่ทำให้เกิด action นี้ */
  confidence: number;
  /** กฎที่เป็นต้นเหตุ */
  ruleId?: string;
}

export type RuleTrigger =
  | { type: "keyword"; words: string[] }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "phone" }
  | { type: "external_link" }
  | { type: "line_id" }
  | { type: "profanity" }
  | { type: "buying_intent" }
  | { type: "complaint" }
  | { type: "negative_sentiment" }
  | { type: "positive_sentiment" };

export interface AutomationRule {
  id: string;
  pageId: string;
  name: string;
  trigger: RuleTrigger;
  actions: Array<{
    kind: ModerationActionKind;
    /** รองรับตัวแปร {ชื่อลูกค้า} {ชื่อร้าน} */
    message?: string;
  }>;
  /** เลขน้อย = ทำก่อน */
  priority: number;
  isActive: boolean;
}

/** ตัวแปรที่แทนค่าได้ในข้อความตอบกลับ */
export interface TemplateVars {
  ชื่อลูกค้า?: string;
  ชื่อร้าน?: string;
  [key: string]: string | undefined;
}

export interface ModerationDecision {
  commentId: string;
  pageId: string;
  actions: PlannedAction[];
  /** ผลวิเคราะห์ที่เก็บลง DB */
  sentiment: "positive" | "neutral" | "negative";
  /** ข้ามเพราะอะไร (ถ้าไม่ทำอะไรเลย) */
  skippedReason?: string;
  th: string;
}
