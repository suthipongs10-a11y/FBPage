/**
 * Human Handover Protocol (M2) — "สำคัญมาก ไม่งั้นบอทจะแทรกกลางบทสนทนา"
 *
 * สเปกข้อ M2: บอทหยุดอัตโนมัติ 30 นาทีเมื่อคนพิมพ์ตอบเอง
 * สเปกข้อ 6.3: `bot_paused_until` ต้องเซ็ตทุกครั้งที่คนพิมพ์เอง
 * สเปกข้อ 6.7: ลูกค้าแอบเข้าไปตอบเองในแอป FB — ต้องจับให้ได้ด้วย
 *
 * ข้อ 6.7 คือจุดที่คนมักลืม: ถ้าเจ้าของเพจเปิดแอป Facebook แล้วพิมพ์ตอบเอง
 * ระบบเราจะรู้ได้ทางเดียวคือดู echo ที่เด้งกลับมาโดยไม่มี app_id ของเรา
 * ถ้าไม่จับตรงนี้ บอทจะเด้งเข้าไปตอบซ้อนกลางบทสนทนาที่คนคุยอยู่
 */

/** บอทหยุดกี่นาทีหลังคนพิมพ์เอง (สเปกข้อ M2) */
export const HANDOVER_PAUSE_MS = 30 * 60 * 1000;

export type PauseReason =
  | "human_replied_in_app"
  | "human_replied_in_pageos"
  | "manual_pause"
  | "kill_switch";

export interface BotGateInput {
  /** บอทถูกพักถึงเมื่อไหร่ (epoch ms) — null = ไม่ได้พัก */
  botPausedUntilMs: number | null;
  /** สวิตช์ปิดบอทของเพจ (M2 Bot Kill Switch) */
  botEnabledForPage: boolean;
  /** บทสนทนานี้ถูกมอบหมายให้คนดูแลแล้ว */
  assignedToHuman: boolean;
  nowMs: number;
}

export interface BotGateDecision {
  shouldRespond: boolean;
  th: string;
  /** เหลือกี่ ms กว่าบอทจะกลับมาทำงาน */
  resumesInMs: number;
}

/** บอทควรตอบข้อความนี้ไหม — เช็คก่อนเรียก LLM ทุกครั้ง */
export function shouldBotRespond(input: BotGateInput): BotGateDecision {
  if (!input.botEnabledForPage) {
    return {
      shouldRespond: false,
      resumesInMs: 0,
      th: "บอทของเพจนี้ถูกปิดอยู่ (Kill Switch)",
    };
  }
  if (input.assignedToHuman) {
    return {
      shouldRespond: false,
      resumesInMs: 0,
      th: "บทสนทนานี้มอบหมายให้คนดูแลแล้ว บอทไม่ตอบ",
    };
  }
  if (
    input.botPausedUntilMs !== null &&
    input.botPausedUntilMs > input.nowMs
  ) {
    const left = input.botPausedUntilMs - input.nowMs;
    return {
      shouldRespond: false,
      resumesInMs: left,
      th: `คนกำลังคุยอยู่ บอทหยุดชั่วคราวอีก ${Math.ceil(left / 60_000)} นาที`,
    };
  }
  return { shouldRespond: true, resumesInMs: 0, th: "บอทตอบได้" };
}

export interface PauseDecision {
  /** ต้องพักบอทไหม */
  pause: boolean;
  pausedUntilMs: number;
  reason: PauseReason;
  th: string;
}

/**
 * คนเพิ่งพิมพ์ตอบ — คำนวณว่าต้องพักบอทถึงเมื่อไหร่
 *
 * ถ้ามีการพักอยู่แล้วและยาวกว่า ให้ใช้ของเดิม (ไม่ลดเวลาพักลง)
 */
export function pauseForHuman(args: {
  nowMs: number;
  reason: PauseReason;
  currentPausedUntilMs?: number | null;
  pauseMs?: number;
}): PauseDecision {
  const until = args.nowMs + (args.pauseMs ?? HANDOVER_PAUSE_MS);
  const effective = Math.max(until, args.currentPausedUntilMs ?? 0);

  const reasonTh: Record<PauseReason, string> = {
    human_replied_in_app:
      "ตรวจพบว่ามีคนตอบจากแอป Facebook โดยตรง — หยุดบอทกันแทรกกลางบทสนทนา",
    human_replied_in_pageos: "คนตอบเองผ่านระบบ — หยุดบอทกันแทรกกลางบทสนทนา",
    manual_pause: "สั่งหยุดบอทด้วยมือ",
    kill_switch: "ปิดบอททั้งเพจ",
  };

  return {
    pause: true,
    pausedUntilMs: effective,
    reason: args.reason,
    th: `${reasonTh[args.reason]} (ถึง ${new Date(effective).toISOString()})`,
  };
}

/**
 * ข้อความ echo นี้แปลว่ามีคนพิมพ์เองหรือไม่
 *
 * echo ที่ไม่มี `app_id` = พิมพ์จากแอป Facebook / Meta Business Suite โดยตรง
 * echo ที่มี `app_id` ของเรา = ระบบเราส่งเอง ไม่ต้องพักบอท
 */
export function isHumanTypedEcho(echo: {
  isEcho: boolean;
  isFromOtherApp?: boolean;
}): boolean {
  return echo.isEcho && echo.isFromOtherApp === true;
}
