/**
 * กฎการส่งข้อความออกจากเพจ (M1) — จุดที่ผิดแล้วเจ็บที่สุดในระบบ
 *
 * ผิดกฎพวกนี้ Meta ระงับสิทธิ์ส่งข้อความของเพจลูกค้า ซึ่งแปลว่าลูกค้าเสียรายได้
 * และเราเสียลูกค้า จึงตรวจก่อนยิงทุกครั้ง ไม่ปล่อยให้ Meta ปฏิเสธเอง
 *
 * กฎที่บังคับในไฟล์นี้:
 *   - กฎข้อ 7: บอทห้ามใช้ HUMAN_AGENT tag เด็ดขาด (เฉพาะข้อความที่คนพิมพ์)
 *   - กฎข้อ 8: ห้ามใช้ legacy tags ที่ปลดระวาง 27 เม.ย. 2026
 *   - 24-hour window: นอกช่วงนี้ส่งฟรีไม่ได้ ต้องมีเหตุผลที่ Meta ยอมรับ
 */

/** ตอบฟรีได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด */
export const STANDARD_WINDOW_MS = 24 * 60 * 60 * 1000;

/** HUMAN_AGENT ขยายเป็น 7 วัน แต่ต้องเป็นข้อความที่คนพิมพ์ */
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** ใครเป็นคนส่งข้อความนี้ */
export type Sender = "human" | "bot" | "system";

/**
 * message tag ที่ยังใช้ได้
 * (CONFIRMED_EVENT_UPDATE / POST_PURCHASE_UPDATE / ACCOUNT_UPDATE
 *  ปลดระวาง 27 เม.ย. 2026 → ใช้ Utility Template แทน)
 */
export const ALLOWED_TAGS = ["HUMAN_AGENT"] as const;
export type MessageTag = (typeof ALLOWED_TAGS)[number];

/** tag ที่ปลดระวางแล้ว — ใช้แล้วจะได้ error 100 */
export const RETIRED_TAGS = [
  "CONFIRMED_EVENT_UPDATE",
  "POST_PURCHASE_UPDATE",
  "ACCOUNT_UPDATE",
] as const;

export class MessagingPolicyError extends Error {
  override readonly name = "MessagingPolicyError";
  readonly th: string;
  /** ระบบควรทำอะไรต่อ */
  readonly action: "wait_for_customer" | "use_utility_template" | "fix_code";
  constructor(args: {
    message: string;
    th: string;
    action: MessagingPolicyError["action"];
  }) {
    super(args.message);
    this.th = args.th;
    this.action = args.action;
  }
}

export interface SendContext {
  /** ลูกค้าทักล่าสุดเมื่อไหร่ (epoch ms) — null = ยังไม่เคยทัก */
  lastCustomerMessageAtMs: number | null;
  nowMs: number;
  sentBy: Sender;
  /** tag ที่อยากใช้ (ถ้ามี) */
  tag?: string;
}

export interface SendDecision {
  allowed: boolean;
  /** tag ที่ควรส่งไปจริง — undefined = ไม่ต้องใส่ tag */
  tag?: MessageTag;
  /** เหลือเวลาอีกกี่ ms ในหน้าต่างที่ใช้ได้ */
  remainingMs: number;
  th: string;
}

/**
 * ตัดสินว่าส่งข้อความนี้ได้ไหม และควรใส่ tag อะไร
 *
 * @throws MessagingPolicyError เมื่อผิดกฎที่ห้ามเด็ดขาด (บอทใช้ HUMAN_AGENT / legacy tag)
 *         — ตั้งใจให้ throw ไม่ใช่คืน allowed=false เพราะสองกรณีนี้เป็นบั๊กของโค้ดเรา
 *         ไม่ใช่สถานการณ์ปกติที่ต้องรับมือ
 */
export function decideSend(ctx: SendContext): SendDecision {
  // ---- กฎข้อ 8: legacy tag ----
  if (ctx.tag && (RETIRED_TAGS as readonly string[]).includes(ctx.tag)) {
    throw new MessagingPolicyError({
      message: `retired message tag: ${ctx.tag}`,
      th: `แท็ก ${ctx.tag} ถูกปลดระวางไปแล้ว (27 เม.ย. 2026) — ต้องใช้ Utility Template แทน`,
      action: "use_utility_template",
    });
  }

  // ---- กฎข้อ 7: บอทห้ามใช้ HUMAN_AGENT ----
  if (ctx.tag === "HUMAN_AGENT" && ctx.sentBy !== "human") {
    throw new MessagingPolicyError({
      message: "HUMAN_AGENT tag used by non-human sender",
      th: "บอทใช้แท็ก HUMAN_AGENT ไม่ได้ — Meta อนุญาตเฉพาะข้อความที่คนพิมพ์เท่านั้น",
      action: "fix_code",
    });
  }

  if (ctx.tag && !(ALLOWED_TAGS as readonly string[]).includes(ctx.tag)) {
    throw new MessagingPolicyError({
      message: `unknown message tag: ${ctx.tag}`,
      th: `ไม่รู้จักแท็ก "${ctx.tag}" — ระบบรองรับเฉพาะ ${ALLOWED_TAGS.join(", ")}`,
      action: "fix_code",
    });
  }

  // ---- 24-hour window ----
  if (ctx.lastCustomerMessageAtMs === null) {
    return {
      allowed: false,
      remainingMs: 0,
      th: "ลูกค้ายังไม่เคยทักมา — เพจทักไปก่อนไม่ได้",
    };
  }

  const age = ctx.nowMs - ctx.lastCustomerMessageAtMs;
  const withinStandard = age < STANDARD_WINDOW_MS;

  if (withinStandard) {
    return {
      allowed: true,
      remainingMs: STANDARD_WINDOW_MS - age,
      th: `อยู่ในช่วง 24 ชม. ส่งได้ตามปกติ (เหลืออีก ${formatRemaining(STANDARD_WINDOW_MS - age)})`,
    };
  }

  // เกิน 24 ชม. แล้ว — คนพิมพ์เองยังส่งได้ถึง 7 วันด้วย HUMAN_AGENT
  if (ctx.sentBy === "human" && age < HUMAN_AGENT_WINDOW_MS) {
    return {
      allowed: true,
      tag: "HUMAN_AGENT",
      remainingMs: HUMAN_AGENT_WINDOW_MS - age,
      th: `เกิน 24 ชม. แล้ว แต่คนพิมพ์เองจึงส่งได้ด้วยแท็ก HUMAN_AGENT (เหลืออีก ${formatRemaining(HUMAN_AGENT_WINDOW_MS - age)})`,
    };
  }

  if (ctx.sentBy !== "human" && age < HUMAN_AGENT_WINDOW_MS) {
    return {
      allowed: false,
      remainingMs: 0,
      th: "เกิน 24 ชม. แล้ว บอทส่งต่อไม่ได้ — ต้องให้คนพิมพ์เอง หรือใช้ Utility Template",
    };
  }

  return {
    allowed: false,
    remainingMs: 0,
    th: `ลูกค้าทักครั้งล่าสุดเกิน 7 วันแล้ว — ส่งไม่ได้ ต้องรอลูกค้าทักมาใหม่ หรือใช้ Utility Template`,
  };
}

function formatRemaining(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} นาที`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชม. ${mins % 60} นาที`;
  return `${Math.floor(hours / 24)} วัน ${hours % 24} ชม.`;
}

// ---------------------------------------------------------------------------

export interface WindowStatus {
  /** ยังส่งฟรีได้ไหม */
  open: boolean;
  remainingMs: number;
  /** ไว้ตัดสินสี badge ใน UI (สเปก M1: แดงเมื่อ < 2 ชม.) */
  tone: "green" | "amber" | "red" | "gray";
  /** ข้อความบน badge เช่น "⏰ เหลือ 3 ชม." */
  badgeTh: string;
}

/** ต่ำกว่านี้ badge เป็นสีแดง (สเปกข้อ M1) */
export const WINDOW_URGENT_MS = 2 * 60 * 60 * 1000;
const WINDOW_WARN_MS = 6 * 60 * 60 * 1000;

/** คำนวณสถานะ 24h window สำหรับแสดงใน conversation list */
export function windowStatus(
  lastCustomerMessageAtMs: number | null,
  nowMs: number,
): WindowStatus {
  if (lastCustomerMessageAtMs === null) {
    return {
      open: false,
      remainingMs: 0,
      tone: "gray",
      badgeTh: "ยังไม่เคยคุย",
    };
  }
  const remaining =
    STANDARD_WINDOW_MS - (nowMs - lastCustomerMessageAtMs);

  if (remaining <= 0) {
    return {
      open: false,
      remainingMs: 0,
      tone: "gray",
      badgeTh: "หมดเวลา 24 ชม.",
    };
  }
  const tone =
    remaining <= WINDOW_URGENT_MS
      ? "red"
      : remaining <= WINDOW_WARN_MS
        ? "amber"
        : "green";

  return {
    open: true,
    remainingMs: remaining,
    tone,
    badgeTh: `⏰ เหลือ ${formatRemaining(remaining)}`,
  };
}
