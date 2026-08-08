/**
 * SLA timer ต่อลูกค้า (M8 — แต่ใช้ตั้งแต่ M1)
 *
 * สเปก: "สัญญาไว้ตอบใน 1 ชม. → นับถอยหลัง + เตือนที่ 75%"
 * และแพ็กเกจกำหนด SLA ไว้ 4 ชม. / 1 ชม. / 30 นาที
 *
 * ตัวนี้คือสิ่งที่ทำให้ "คนเดียวดูแล 20 เพจ" เป็นไปได้ — เพราะเรารู้ว่า
 * ต้องรีบตอบอันไหนก่อน ไม่ใช่ไล่ตอบตามลำดับที่เข้ามา
 */

/** SLA ตามแพ็กเกจ (นาที) */
export const PLAN_SLA_MINUTES: Record<string, number> = {
  STARTER: 240,
  GROWTH: 60,
  FULL: 30,
};

/** เตือนเมื่อใช้เวลาไปถึงสัดส่วนนี้ของ SLA */
export const SLA_WARN_RATIO = 0.75;

export type SlaState = "ok" | "warning" | "breached" | "answered" | "none";

export interface SlaStatus {
  state: SlaState;
  /** ครบกำหนดเมื่อไหร่ (epoch ms) */
  dueAtMs: number | null;
  /** เหลืออีกกี่ ms; ติดลบ = เลยกำหนดมาแล้ว */
  remainingMs: number;
  /** ใช้เวลาไปกี่ % ของ SLA */
  usedRatio: number;
  tone: "green" | "amber" | "red" | "gray";
  th: string;
}

export interface SlaInput {
  /** ลูกค้าทักมาเมื่อไหร่ (ข้อความที่ยังไม่ได้ตอบ) — null = ตอบครบแล้ว */
  awaitingSinceMs: number | null;
  slaMinutes: number;
  nowMs: number;
  /** ตอบไปแล้วเมื่อไหร่ (ถ้าตอบแล้ว) */
  answeredAtMs?: number | null;
}

function fmt(ms: number): string {
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60_000);
  if (mins < 60) return `${mins} นาที`;
  const hours = Math.floor(mins / 60);
  return hours < 24
    ? `${hours} ชม. ${mins % 60} นาที`
    : `${Math.floor(hours / 24)} วัน ${hours % 24} ชม.`;
}

export function slaStatus(input: SlaInput): SlaStatus {
  const slaMs = input.slaMinutes * 60_000;

  if (input.awaitingSinceMs === null) {
    return {
      state: "none",
      dueAtMs: null,
      remainingMs: 0,
      usedRatio: 0,
      tone: "gray",
      th: "ไม่มีข้อความค้างตอบ",
    };
  }

  const dueAtMs = input.awaitingSinceMs + slaMs;

  // ตอบไปแล้ว — ประเมินย้อนหลังว่าทันไหม
  if (input.answeredAtMs != null) {
    const took = input.answeredAtMs - input.awaitingSinceMs;
    const onTime = took <= slaMs;
    return {
      state: "answered",
      dueAtMs,
      remainingMs: dueAtMs - input.answeredAtMs,
      usedRatio: slaMs === 0 ? 1 : took / slaMs,
      tone: onTime ? "green" : "red",
      th: onTime
        ? `ตอบภายใน ${fmt(took)} — ทันตามที่สัญญาไว้`
        : `ตอบช้าไป ${fmt(took - slaMs)} จากที่สัญญาไว้`,
    };
  }

  const elapsed = input.nowMs - input.awaitingSinceMs;
  const remainingMs = dueAtMs - input.nowMs;
  const usedRatio = slaMs === 0 ? 1 : elapsed / slaMs;

  if (remainingMs <= 0) {
    return {
      state: "breached",
      dueAtMs,
      remainingMs,
      usedRatio,
      tone: "red",
      th: `เลยเวลาที่สัญญาไว้มาแล้ว ${fmt(-remainingMs)} — ต้องรีบตอบ`,
    };
  }
  if (usedRatio >= SLA_WARN_RATIO) {
    return {
      state: "warning",
      dueAtMs,
      remainingMs,
      usedRatio,
      tone: "amber",
      th: `ใกล้ครบเวลาที่สัญญาไว้ เหลืออีก ${fmt(remainingMs)}`,
    };
  }
  return {
    state: "ok",
    dueAtMs,
    remainingMs,
    usedRatio,
    tone: "green",
    th: `เหลือเวลาตอบอีก ${fmt(remainingMs)}`,
  };
}

export interface ConversationForQueue {
  conversationId: string;
  pageId: string;
  awaitingSinceMs: number | null;
  slaMinutes: number;
  /** ยังไม่ได้อ่านกี่ข้อความ */
  unread: number;
}

export interface QueuedConversation extends ConversationForQueue {
  sla: SlaStatus;
}

/**
 * เรียงคิวว่าควรตอบอันไหนก่อน — หัวใจของ Today View (M8)
 *
 * เรียงตาม "เหลือเวลาน้อยสุดก่อน" ไม่ใช่ "เข้ามาก่อนตอบก่อน"
 * เพราะลูกค้าแพ็กเกจ FULL (SLA 30 นาที) ที่ทักทีหลัง ต้องได้ตอบก่อน
 * ลูกค้าแพ็กเกจ STARTER (SLA 4 ชม.) ที่ทักมาก่อน
 */
export function prioritizeQueue(
  conversations: readonly ConversationForQueue[],
  nowMs: number,
): QueuedConversation[] {
  return conversations
    .map((c) => ({
      ...c,
      sla: slaStatus({
        awaitingSinceMs: c.awaitingSinceMs,
        slaMinutes: c.slaMinutes,
        nowMs,
      }),
    }))
    .filter((c) => c.sla.state !== "none")
    .sort((a, b) => {
      // เลยกำหนดแล้วขึ้นก่อนเสมอ และในกลุ่มนั้นเรียงตามที่เลยมานานสุด
      if (a.sla.state === "breached" && b.sla.state !== "breached") return -1;
      if (b.sla.state === "breached" && a.sla.state !== "breached") return 1;
      return a.sla.remainingMs - b.sla.remainingMs;
    });
}

export interface SlaSummary {
  total: number;
  breached: number;
  warning: number;
  ok: number;
  th: string;
}

/** สรุปสถานะทั้งหมดสำหรับ Today View */
export function summarizeQueue(queue: readonly QueuedConversation[]): SlaSummary {
  const breached = queue.filter((q) => q.sla.state === "breached").length;
  const warning = queue.filter((q) => q.sla.state === "warning").length;
  const ok = queue.filter((q) => q.sla.state === "ok").length;

  let th: string;
  if (queue.length === 0) th = "ตอบครบทุกข้อความแล้ว 🎉";
  else if (breached > 0)
    th = `มี ${breached} บทสนทนาเลยเวลาที่สัญญาไว้แล้ว — ต้องรีบตอบ`;
  else if (warning > 0)
    th = `มี ${warning} บทสนทนาใกล้ครบเวลา และอีก ${ok} ที่ยังมีเวลาเหลือ`;
  else th = `มี ${ok} บทสนทนารอตอบ ยังอยู่ในเวลาทั้งหมด`;

  return { total: queue.length, breached, warning, ok, th };
}
