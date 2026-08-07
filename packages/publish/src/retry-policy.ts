/**
 * Retry + Dead-letter ของงานโพสต์ (M4)
 *
 * สเปก: "โพสต์ล้มเหลว → retry 3 ครั้ง (1m, 5m, 30m) → แจ้งเตือน"
 *
 * ต่างจาก retry ใน gateway ตรงที่ระดับนั้นคือ "ยิง HTTP ไม่ผ่าน ลองใหม่ในไม่กี่วินาที"
 * ส่วนระดับนี้คือ "งานโพสต์ล้มเหลวทั้งงาน ลองใหม่ในอีกไม่กี่นาที"
 * เพราะบางสาเหตุ (Meta ล่ม, media ยังอัปไม่เสร็จ) ต้องรอนานกว่าจะหาย
 */
import type { MetaApiError, MetaErrorAction } from "@page-os/meta";

/** ตารางเวลา retry ตามสเปก — index = จำนวนครั้งที่ล้มเหลวมาแล้ว */
export const RETRY_SCHEDULE_MS = [60_000, 300_000, 1_800_000] as const;

export const MAX_PUBLISH_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

export type PublishDecision =
  | { kind: "retry"; delayMs: number; attempt: number; th: string }
  | { kind: "dead"; th: string; needsAlert: true }
  | { kind: "give_up"; th: string; needsAlert: true };

/**
 * error ระดับไหนที่ retry แล้วมีโอกาสหาย
 *
 * ตัดสินจาก `action` ของ MetaApiError ไม่ใช่เลข error — โค้ดที่นี่จะได้ไม่ต้อง
 * รู้จักเลข error ของ Meta เลย (ความรู้นั้นอยู่ที่ packages/meta ที่เดียว)
 */
const RETRYABLE_ACTIONS: ReadonlySet<MetaErrorAction> = new Set<MetaErrorAction>(
  ["retry", "throttle"],
);

/** สาเหตุที่ retry ไปก็เท่านั้น ต้องให้คนมาแก้ */
const TERMINAL_ACTIONS: ReadonlySet<MetaErrorAction> = new Set<MetaErrorAction>(
  ["reconnect", "permission", "fix_request", "deprecated"],
);

export interface DecideArgs {
  /** ครั้งที่เท่าไหร่ที่เพิ่งล้มเหลว (เริ่มที่ 1) */
  attempt: number;
  error: Pick<MetaApiError, "action" | "th">;
}

/** ตัดสินว่าจะลองใหม่ ยอมแพ้ หรือโยนเข้า dead-letter */
export function decideRetry(args: DecideArgs): PublishDecision {
  const { attempt, error } = args;

  if (TERMINAL_ACTIONS.has(error.action)) {
    // ยิงซ้ำไปก็ได้ผลเดิม — เรียกคนมาแก้เลยดีกว่าเสียเวลา 36 นาที
    return {
      kind: "give_up",
      th: `โพสต์ไม่สำเร็จและลองใหม่ไม่ช่วย: ${error.th}`,
      needsAlert: true,
    };
  }

  if (!RETRYABLE_ACTIONS.has(error.action)) {
    // action = "manual" — ไม่รู้จักสาเหตุ ให้คนดู
    return {
      kind: "give_up",
      th: `โพสต์ไม่สำเร็จด้วยสาเหตุที่ระบบยังไม่รู้จัก: ${error.th}`,
      needsAlert: true,
    };
  }

  const delayMs = RETRY_SCHEDULE_MS[attempt - 1];
  if (delayMs === undefined) {
    return {
      kind: "dead",
      th: `โพสต์ไม่สำเร็จหลังลองครบ ${MAX_PUBLISH_ATTEMPTS} ครั้ง: ${error.th}`,
      needsAlert: true,
    };
  }

  return {
    kind: "retry",
    delayMs,
    attempt: attempt + 1,
    th: `โพสต์ไม่สำเร็จ (ครั้งที่ ${attempt}) จะลองใหม่ในอีก ${Math.round(delayMs / 60_000)} นาที: ${error.th}`,
  };
}

/** สรุปให้คนอ่านว่าตารางลองใหม่เป็นยังไง — ใช้แสดงใน UI */
export function describeRetrySchedule(): string {
  const mins = RETRY_SCHEDULE_MS.map((ms) => `${Math.round(ms / 60_000)} นาที`);
  return `ลองใหม่อัตโนมัติ ${RETRY_SCHEDULE_MS.length} ครั้ง (หลังจาก ${mins.join(", ")}) แล้วแจ้งเตือน`;
}
