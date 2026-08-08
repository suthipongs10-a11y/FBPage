/**
 * Canned replies + Escalation (M1)
 *
 * สเปกกำหนด:
 *   - "Canned replies (บันทึกคำตอบซ้ำ) แยกตามเพจ + ตัวแปร {ชื่อลูกค้า} {ชื่อร้าน}"
 *   - "Escalation: บอทตอบไม่ได้ → ปักธง + ส่ง LINE Notify หาคุณพร้อมลิงก์ deep link"
 */

export interface CannedReply {
  id: string;
  pageId: string;
  /** ปุ่มลัดที่พิมพ์แล้วเรียกใช้ เช่น "/ราคา" */
  shortcut: string;
  title: string;
  /** รองรับ {ชื่อลูกค้า} {ชื่อร้าน} และตัวแปรอื่นที่ส่งเข้ามา */
  body: string;
  /** เรียงในรายการ */
  order?: number;
}

export interface CannedVars {
  ชื่อลูกค้า?: string;
  ชื่อร้าน?: string;
  [key: string]: string | undefined;
}

/**
 * แทนค่าตัวแปรในคำตอบสำเร็จรูป
 *
 * ตัวแปรที่ไม่มีค่าถูกตัดทิ้งพร้อมช่องว่างที่ติดมา ไม่ทิ้ง "{ชื่อลูกค้า}"
 * ไว้ให้ลูกค้าเห็น (เคยเจอบ่อยในระบบอื่นแล้วดูไม่เป็นมืออาชีพ)
 */
export function renderCanned(body: string, vars: CannedVars = {}): string {
  return body
    .replace(/\{([^}]+)\}/g, (_, key: string) => vars[key.trim()] ?? "")
    // เก็บกวาดช่องว่างซ้ำที่เหลือจากตัวแปรที่ถูกตัด
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?])/g, "$1")
    .trim();
}

/** หาคำตอบสำเร็จรูปจาก shortcut ที่พิมพ์ */
export function findByShortcut(
  replies: readonly CannedReply[],
  pageId: string,
  typed: string,
): CannedReply | null {
  const q = typed.trim().toLowerCase();
  if (q === "") return null;
  return (
    replies.find(
      (r) => r.pageId === pageId && r.shortcut.toLowerCase() === q,
    ) ?? null
  );
}

/** ค้นคำตอบสำเร็จรูปของเพจนี้ */
export function searchCanned(
  replies: readonly CannedReply[],
  pageId: string,
  query: string,
): CannedReply[] {
  const q = query.trim().toLowerCase();
  const ofPage = replies.filter((r) => r.pageId === pageId);
  const sorted = [...ofPage].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, "th"),
  );
  if (q === "") return sorted;
  return sorted.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      r.shortcut.toLowerCase().includes(q) ||
      r.body.toLowerCase().includes(q),
  );
}

// ---------------------------------------------------------------------------

export type EscalationReason =
  /** บอทหาคำตอบไม่เจอใน Knowledge Base */
  | "low_confidence"
  /** ลูกค้าขอคุยกับคน */
  | "customer_asked_for_human"
  /** เจอคำที่ต้องให้คนดู (ร้องเรียน/กฎหมาย) */
  | "sensitive_topic"
  /** ตอบไปหลายรอบแล้วลูกค้ายังถามเรื่องเดิม */
  | "repeated_question"
  /** ใกล้หมดหน้าต่าง 24 ชม. แล้วยังไม่จบ */
  | "window_closing";

const REASON_TH: Record<EscalationReason, string> = {
  low_confidence: "บอทไม่มีข้อมูลพอจะตอบ",
  customer_asked_for_human: "ลูกค้าขอคุยกับคน",
  sensitive_topic: "เรื่องที่ต้องให้คนตัดสิน",
  repeated_question: "ลูกค้าถามเรื่องเดิมซ้ำ บอทตอบไม่ตรงจุด",
  window_closing: "ใกล้หมดเวลา 24 ชม. แล้วยังไม่จบเรื่อง",
};

export interface EscalationAlert {
  conversationId: string;
  pageId: string;
  pageName?: string;
  contactName?: string;
  reason: EscalationReason;
  /** ข้อความล่าสุดของลูกค้า */
  lastMessage: string;
  /** ลิงก์เข้า thread โดยตรง (สเปกสั่งให้มี deep link) */
  deepLink: string;
  /** เหลือเวลาในหน้าต่าง 24 ชม. */
  windowRemainingMs: number;
  severity: "warn" | "critical";
  th: string;
}

export interface EscalationSink {
  send(alert: EscalationAlert): Promise<void>;
}

export const noopEscalationSink: EscalationSink = { send: async () => {} };

/** ข้อความที่บอทตอบระหว่างรอคนมาต่อ (สเปกข้อ M2 ชั้นที่ 3) */
export const HOLDING_REPLY_TH =
  "รอสักครู่นะคะ กำลังตรวจสอบให้ค่ะ 🙏";

export interface BuildEscalationArgs {
  conversationId: string;
  pageId: string;
  pageName?: string;
  contactName?: string;
  reason: EscalationReason;
  lastMessage: string;
  /** base URL ของระบบ เช่น https://pageos.app */
  baseUrl: string;
  windowRemainingMs: number;
}

/** ประกอบ alert ที่จะยิงเข้า LINE */
export function buildEscalation(
  args: BuildEscalationArgs,
): EscalationAlert {
  const deepLink = `${args.baseUrl.replace(/\/+$/, "")}/inbox/${encodeURIComponent(
    args.conversationId,
  )}`;

  // ใกล้หมดหน้าต่างแล้วถือว่าด่วน เพราะพลาดแล้วตอบฟรีไม่ได้อีก
  const urgent = args.windowRemainingMs > 0 && args.windowRemainingMs <= 2 * 3600_000;
  const severity: "warn" | "critical" =
    urgent || args.reason === "sensitive_topic" ? "critical" : "warn";

  const where = args.pageName ? `เพจ ${args.pageName}` : `เพจ ${args.pageId}`;
  const who = args.contactName ? ` — ${args.contactName}` : "";
  const timeNote =
    args.windowRemainingMs > 0
      ? ` (เหลือเวลาตอบ ${Math.floor(args.windowRemainingMs / 60_000)} นาที)`
      : " (หมดหน้าต่าง 24 ชม. แล้ว)";

  return {
    conversationId: args.conversationId,
    pageId: args.pageId,
    ...(args.pageName !== undefined ? { pageName: args.pageName } : {}),
    ...(args.contactName !== undefined ? { contactName: args.contactName } : {}),
    reason: args.reason,
    lastMessage: args.lastMessage,
    deepLink,
    windowRemainingMs: args.windowRemainingMs,
    severity,
    th: `${where}${who}: ${REASON_TH[args.reason]}${timeNote}`,
  };
}

export function escalationReasonTh(reason: EscalationReason): string {
  return REASON_TH[reason];
}
