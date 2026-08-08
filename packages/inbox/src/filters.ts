/**
 * ตัวกรอง Unified Inbox (M1)
 *
 * สเปกกำหนดไว้: "ยังไม่ตอบ / บอทตอบแล้วแต่ต้องรีวิว / escalate / เกิน SLA"
 *
 * ตัวกรองพวกนี้คือสิ่งที่ทำให้เปิด inbox แล้วรู้ทันทีว่าต้องทำอะไรก่อน
 * แทนที่จะไล่อ่านทีละบทสนทนาข้ามเพจ
 */
import { slaStatus, type SlaState } from "./sla.js";
import { windowStatus } from "./messaging-policy.js";

export type InboxFilter =
  /** ลูกค้าทักมาแล้วยังไม่มีใครตอบเลย */
  | "unanswered"
  /** บอทตอบไปแล้ว แต่ยังไม่มีคนตรวจว่าตอบถูกไหม */
  | "bot_replied_needs_review"
  /** บอทยกธงส่งต่อให้คน */
  | "escalated"
  /** เลยเวลาที่สัญญากับลูกค้าไว้ */
  | "sla_breached"
  /** ใกล้หมดหน้าต่าง 24 ชม. */
  | "window_closing"
  /** ทั้งหมด */
  | "all";

export interface InboxItem {
  conversationId: string;
  pageId: string;
  pageName?: string;
  contactName?: string;
  channel: string;
  lastMessagePreview?: string;
  lastMessageAtMs: number;
  /** ลูกค้าทักล่าสุดเมื่อไหร่ (ใช้คำนวณหน้าต่าง 24 ชม.) */
  lastCustomerMessageAtMs: number | null;
  /** ข้อความที่ยังไม่ได้ตอบเริ่มเมื่อไหร่ */
  awaitingSinceMs: number | null;
  slaMinutes: number;
  unread: number;
  /** ใครตอบข้อความล่าสุด */
  lastReplyBy: "human" | "bot" | "system" | null;
  /** บอทยกธงส่งต่อ */
  escalated: boolean;
  /** คนตรวจข้อความที่บอทตอบแล้วหรือยัง */
  reviewedByHuman: boolean;
  assignedTo: string | null;
  tags: string[];
}

export interface DecoratedInboxItem extends InboxItem {
  sla: ReturnType<typeof slaStatus>;
  window: ReturnType<typeof windowStatus>;
  /** ตรงกับตัวกรองไหนบ้าง — ใช้แสดง chip ในรายการ */
  matches: InboxFilter[];
}

const FILTER_LABEL_TH: Record<InboxFilter, string> = {
  all: "ทั้งหมด",
  unanswered: "ยังไม่ตอบ",
  bot_replied_needs_review: "บอทตอบแล้ว รอตรวจ",
  escalated: "บอทส่งต่อให้คน",
  sla_breached: "เกินเวลาที่สัญญาไว้",
  window_closing: "ใกล้หมด 24 ชม.",
};

export function filterLabelTh(f: InboxFilter): string {
  return FILTER_LABEL_TH[f];
}

/** ต่ำกว่านี้ถือว่า "ใกล้หมดหน้าต่าง" */
const WINDOW_CLOSING_MS = 3 * 60 * 60 * 1000;

function matchesFilter(
  item: DecoratedInboxItem,
  filter: InboxFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unanswered":
      // ยังไม่มีใครตอบเลย — บอทตอบแล้วไม่นับว่ายังไม่ตอบ
      return item.awaitingSinceMs !== null && item.lastReplyBy === null;
    case "bot_replied_needs_review":
      return item.lastReplyBy === "bot" && !item.reviewedByHuman;
    case "escalated":
      return item.escalated;
    case "sla_breached":
      return item.sla.state === "breached";
    case "window_closing":
      return (
        item.window.open && item.window.remainingMs <= WINDOW_CLOSING_MS
      );
  }
}

export function decorate(
  items: readonly InboxItem[],
  nowMs: number,
): DecoratedInboxItem[] {
  return items.map((item) => {
    const base: DecoratedInboxItem = {
      ...item,
      sla: slaStatus({
        awaitingSinceMs: item.awaitingSinceMs,
        slaMinutes: item.slaMinutes,
        nowMs,
      }),
      window: windowStatus(item.lastCustomerMessageAtMs, nowMs),
      matches: [],
    };
    base.matches = (
      [
        "unanswered",
        "bot_replied_needs_review",
        "escalated",
        "sla_breached",
        "window_closing",
      ] as const
    ).filter((f) => matchesFilter(base, f));
    return base;
  });
}

export interface FilterQuery {
  filter?: InboxFilter;
  /** จำกัดเฉพาะเพจนี้ — ไม่ระบุ = ทุกเพจ (ค่าเริ่มต้นตามสเปกคือ cross-page) */
  pageIds?: string[];
  /** ค้นจากชื่อผู้ติดต่อหรือข้อความล่าสุด */
  search?: string;
  tags?: string[];
  assignedTo?: string | null;
}

/**
 * กรองและเรียงรายการ inbox
 *
 * เรียงตามความเร่งด่วนเสมอ (เลย SLA → ใกล้ครบ → เหลือเวลาน้อยสุด)
 * ไม่ใช่เรียงตามเวลาล่าสุดแบบแอปแชททั่วไป เพราะเป้าหมายคือ "ตอบให้ทัน"
 * ไม่ใช่ "อ่านตามลำดับ"
 */
export function queryInbox(
  items: readonly InboxItem[],
  query: FilterQuery,
  nowMs: number,
): DecoratedInboxItem[] {
  const filter = query.filter ?? "all";
  let out = decorate(items, nowMs);

  if (query.pageIds && query.pageIds.length > 0) {
    const set = new Set(query.pageIds);
    out = out.filter((i) => set.has(i.pageId));
  }
  if (filter !== "all") {
    out = out.filter((i) => i.matches.includes(filter));
  }
  if (query.tags && query.tags.length > 0) {
    const set = new Set(query.tags);
    out = out.filter((i) => i.tags.some((t) => set.has(t)));
  }
  if (query.assignedTo !== undefined) {
    out = out.filter((i) => i.assignedTo === query.assignedTo);
  }
  if (query.search && query.search.trim() !== "") {
    const q = query.search.trim().toLowerCase();
    out = out.filter(
      (i) =>
        (i.contactName ?? "").toLowerCase().includes(q) ||
        (i.lastMessagePreview ?? "").toLowerCase().includes(q),
    );
  }

  return out.sort(compareUrgency);
}

const STATE_RANK: Record<SlaState, number> = {
  breached: 0,
  warning: 1,
  ok: 2,
  answered: 3,
  none: 4,
};

function compareUrgency(
  a: DecoratedInboxItem,
  b: DecoratedInboxItem,
): number {
  const rank = STATE_RANK[a.sla.state] - STATE_RANK[b.sla.state];
  if (rank !== 0) return rank;
  if (a.sla.state === "breached") {
    // เลยมานานสุดขึ้นก่อน
    return a.sla.remainingMs - b.sla.remainingMs;
  }
  if (a.sla.state === "ok" || a.sla.state === "warning") {
    return a.sla.remainingMs - b.sla.remainingMs;
  }
  // ที่เหลือเรียงตามข้อความล่าสุด
  return b.lastMessageAtMs - a.lastMessageAtMs;
}

export interface InboxCounts {
  all: number;
  unanswered: number;
  bot_replied_needs_review: number;
  escalated: number;
  sla_breached: number;
  window_closing: number;
  th: string;
}

/** นับจำนวนต่อตัวกรอง — ใช้แสดงตัวเลขบน chip และใน Today View */
export function countByFilter(
  items: readonly InboxItem[],
  nowMs: number,
): InboxCounts {
  const decorated = decorate(items, nowMs);
  const count = (f: InboxFilter): number =>
    decorated.filter((i) => i.matches.includes(f)).length;

  const counts: InboxCounts = {
    all: decorated.length,
    unanswered: count("unanswered"),
    bot_replied_needs_review: count("bot_replied_needs_review"),
    escalated: count("escalated"),
    sla_breached: count("sla_breached"),
    window_closing: count("window_closing"),
    th: "",
  };

  const parts: string[] = [];
  if (counts.sla_breached > 0)
    parts.push(`เกินเวลา ${counts.sla_breached}`);
  if (counts.escalated > 0) parts.push(`บอทส่งต่อ ${counts.escalated}`);
  if (counts.unanswered > 0) parts.push(`ยังไม่ตอบ ${counts.unanswered}`);
  if (counts.window_closing > 0)
    parts.push(`ใกล้หมด 24 ชม. ${counts.window_closing}`);

  counts.th =
    parts.length === 0
      ? "ไม่มีอะไรค้าง ตอบครบหมดแล้ว"
      : parts.join(" · ");
  return counts;
}
