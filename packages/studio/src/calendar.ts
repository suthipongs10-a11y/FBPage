/**
 * One-click ปฏิทินเดือนเต็ม (M5)
 *
 * สเปก: "กดปุ่มเดียวได้ปฏิทิน 30 วันของเพจนั้น → คุณแค่รีวิว/แก้
 *        (นี่คือฟีเจอร์ที่ทำให้คนเดียวดูแล 20 เพจได้)"
 *
 * ไฟล์นี้คือจุดที่ M5 มาบรรจบกับ M4 — เอาสัดส่วนเสาหลัก (pillars) มาจับคู่กับ
 * เวลาที่เพจนั้นได้ผลจริง (Best Time to Post) แล้วสั่ง LLM สร้างคอนเทนต์ให้ครบ
 *
 * สองเรื่องที่ต้องระวังเป็นพิเศษ:
 *
 * 1. **เวลาใน DB เป็น UTC เสมอ (กฎข้อ 4)** แต่คนตั้งปฏิทินคิดเป็นเวลาไทย
 *    ทุกช่องเวลาจึงคำนวณจาก "วันที่ตามปฏิทินท้องถิ่น" แล้วค่อยแปลงเป็น UTC
 *    ทีละวัน — ไม่ใช่บวก 86,400,000 มิลลิวินาทีรวดเดียว เพราะโซนเวลาที่มี DST
 *    จะเพี้ยนไปหนึ่งชั่วโมงกลางเดือน (ไทยไม่มี DST แต่โค้ดต้องถูกไว้ก่อน)
 *
 * 2. **ห้ามสร้างปฏิทินจาก Brand Brief ที่ยังกรอกไม่ครบ** — ได้โพสต์กลางๆ 20 อัน
 *    ที่ต้องมานั่งแก้ทีละอัน เสียเวลากว่าเขียนเองอีก
 */
import { nullLogger, type Logger } from "@page-os/core";
import { localTimeToUtcMs, utcMsToLocalText } from "@page-os/publish";
import type { SlotScore } from "@page-os/publish";
import { checkBrief, type BrandBrief } from "./brand.js";
import { generateBatch, type ContentLlm, type GeneratedPost } from "./generator.js";
import {
  buildPillarPlan,
  summarizePlan,
  type Pillar,
  type PillarKey,
} from "./pillars.js";

/** ปฏิทินหนึ่งรอบยาวกี่วัน */
export const DEFAULT_CALENDAR_DAYS = 30;
/** โพสต์กี่ครั้งต่อสัปดาห์ถ้าไม่ได้ระบุ */
export const DEFAULT_POSTS_PER_WEEK = 5;
/** โพสต์สองอันในวันเดียวกันต้องห่างกันอย่างน้อยเท่านี้ ไม่งั้นแย่ง reach กันเอง */
export const MIN_GAP_HOURS = 4;
/**
 * โพสต์ได้วันละไม่เกินเท่านี้
 *
 * จำเป็นเพราะ Best Time เรียงตามคะแนนล้วน ถ้าเพจหนึ่งมีช่วงที่ดี 5 อันดับแรก
 * อยู่ในวันพฤหัสทั้งหมด (เกิดขึ้นได้จริงกับเพจที่โพสต์วันเดียวกันทุกสัปดาห์)
 * ตารางจะกลายเป็นโพสต์พฤหัส 5 ครั้งแล้วเงียบอีกหกวัน
 */
export const MAX_POSTS_PER_DAY = 2;
/**
 * เวลาสำรองตอนที่ยังไม่มีข้อมูล Insights พอ
 *
 * เรียงตามช่วงที่คนไทยเปิดมือถือมากที่สุด: พักเที่ยง → หลังเลิกงาน → ก่อนเข้างาน
 * ใช้ชั่วคราวเท่านั้น พอเพจมีข้อมูลครบ 12 โพสต์ระบบจะเปลี่ยนไปใช้ของจริงเอง
 */
export const FALLBACK_HOURS = [12, 19, 9, 21, 15] as const;

const DAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];

export class CalendarError extends Error {
  override readonly name = "CalendarError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface CalendarSlot {
  /** เวลาโพสต์จริง (epoch ms, UTC — กฎข้อ 4) */
  atMs: number;
  /** ข้อความเวลาตาม timezone ของเพจ ใช้แสดงผลเท่านั้น */
  localText: string;
  dayOfWeek: number;
  hour: number;
  /** มาจากข้อมูล Insights จริง หรือเป็นเวลาสำรอง */
  fromBestTime: boolean;
}

interface WeeklySlot {
  dayOfWeek: number;
  hour: number;
  fromBestTime: boolean;
}

interface LocalDate {
  y: number;
  m: number;
  d: number;
}

/** วันที่ตามปฏิทินของ timezone นั้น (ไม่ใช่ UTC) */
function localDateOf(utcMs: number, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** บวกวันแบบปฏิทิน — ปลอดภัยกับ DST เพราะไม่ได้บวกเป็นมิลลิวินาที */
function addDays(date: LocalDate, n: number): LocalDate {
  const t = Date.UTC(date.y, date.m - 1, date.d + n);
  const dt = new Date(t);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function dayOfWeekOf(date: LocalDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

function isoDate(date: LocalDate): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${date.y}-${p(date.m)}-${p(date.d)}`;
}

/** ระยะห่างของวันในสัปดาห์แบบวงกลม (จันทร์กับอาทิตย์ห่างกัน 1 ไม่ใช่ 6) */
function circularDayDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 7 - raw);
}

function conflicts(
  template: readonly WeeklySlot[],
  dayOfWeek: number,
  hour: number,
): boolean {
  const sameDay = template.filter((t) => t.dayOfWeek === dayOfWeek);
  if (sameDay.length >= MAX_POSTS_PER_DAY) return true;
  return sameDay.some((t) => Math.abs(t.hour - hour) < MIN_GAP_HOURS);
}

/**
 * สร้างตารางประจำสัปดาห์
 *
 * เอาช่วงเวลาที่ได้ผลดีที่สุดของเพจก่อน แล้วค่อยเติมวันที่ยังว่าง
 * — เติมโดยเลือก "วันที่ห่างจากวันที่มีโพสต์อยู่แล้วมากที่สุด" ไม่ใช่ไล่จันทร์ไปอาทิตย์
 * เพราะโพสต์กระจุกต้นสัปดาห์แล้วเงียบไปสี่วันดูเหมือนเพจร้าง
 */
export function buildWeeklySlots(args: {
  bestTimes: readonly SlotScore[];
  postsPerWeek: number;
}): WeeklySlot[] {
  const want = Math.max(0, Math.min(args.postsPerWeek, 7 * MAX_POSTS_PER_DAY));
  const template: WeeklySlot[] = [];

  for (const s of args.bestTimes) {
    if (template.length >= want) break;
    if (conflicts(template, s.dayOfWeek, s.hour)) continue;
    template.push({ dayOfWeek: s.dayOfWeek, hour: s.hour, fromBestTime: true });
  }

  // ชั่วโมงสำรอง: ถ้ารู้เวลาที่ดีของเพจแล้ว ใช้ชั่วโมงนั้นเป็นตัวตั้ง
  // (เพจที่คนอ่านตอนดึก ไม่ควรโดนยัดโพสต์เที่ยงวันเพราะเป็นค่า default)
  const preferredHours: number[] = [
    ...args.bestTimes.map((s) => s.hour),
    ...FALLBACK_HOURS,
  ];

  let guard = 0;
  while (template.length < want && guard++ < want * 8) {
    const used = new Map<number, number>();
    for (const t of template) used.set(t.dayOfWeek, (used.get(t.dayOfWeek) ?? 0) + 1);

    let bestDay = 0;
    let bestKey = [Infinity, -Infinity, 0] as [number, number, number];
    for (let d = 0; d < 7; d++) {
      const count = used.get(d) ?? 0;
      const nearest = template.length
        ? Math.min(...template.map((t) => circularDayDistance(t.dayOfWeek, d)))
        : 0;
      // เรียงตาม: วันที่มีโพสต์น้อยสุด → ห่างจากของเดิมมากสุด → วันที่มาก่อน
      const key: [number, number, number] = [count, -nearest, d];
      if (
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])
      ) {
        bestKey = key;
        bestDay = d;
      }
    }

    const hour = preferredHours.find((h) => !conflicts(template, bestDay, h));
    if (hour === undefined) {
      // วันนี้เต็มแล้วทุกชั่วโมงที่ยอมรับได้ — ยัดต่อไปก็ได้โพสต์ชนกันเอง
      break;
    }
    template.push({ dayOfWeek: bestDay, hour, fromBestTime: false });
  }

  return template.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour);
}

export interface PlanSlotsArgs {
  /** เริ่มปฏิทินจากวันไหน (epoch ms, UTC) */
  startAtMs: number;
  /** เวลาปัจจุบัน — ช่องที่ผ่านไปแล้วจะถูกข้าม */
  nowMs: number;
  timeZone: string;
  days?: number;
  postsPerWeek?: number;
  bestTimes?: readonly SlotScore[];
  /** จำกัดจำนวนโพสต์สูงสุด (เช่น โควตาของแพ็กเกจลูกค้า) */
  maxPosts?: number;
}

/**
 * กางตารางประจำสัปดาห์ออกเป็นวันที่จริงตลอดช่วงปฏิทิน
 *
 * ช่องที่เวลาผ่านไปแล้วถูกข้าม — กดสร้างปฏิทินตอนบ่ายสามแล้วได้โพสต์
 * ที่ตั้งเวลาไว้เที่ยงวันนี้ คือบั๊กที่ทำให้โพสต์หลุดออกทันทีที่ worker มาถึง
 */
export function planCalendarSlots(args: PlanSlotsArgs): CalendarSlot[] {
  const days = args.days ?? DEFAULT_CALENDAR_DAYS;
  const postsPerWeek = args.postsPerWeek ?? DEFAULT_POSTS_PER_WEEK;
  if (days <= 0) return [];

  const weekly = buildWeeklySlots({
    bestTimes: args.bestTimes ?? [],
    postsPerWeek,
  });
  if (weekly.length === 0) return [];

  const byDay = new Map<number, WeeklySlot[]>();
  for (const w of weekly) {
    const list = byDay.get(w.dayOfWeek) ?? [];
    list.push(w);
    byDay.set(w.dayOfWeek, list);
  }

  const start = localDateOf(args.startAtMs, args.timeZone);
  const out: CalendarSlot[] = [];
  const limit = args.maxPosts ?? Infinity;

  for (let i = 0; i < days && out.length < limit; i++) {
    const date = addDays(start, i);
    const dow = dayOfWeekOf(date);
    for (const w of byDay.get(dow) ?? []) {
      if (out.length >= limit) break;
      const atMs = localTimeToUtcMs(
        `${isoDate(date)}T${String(w.hour).padStart(2, "0")}:00`,
        args.timeZone,
      );
      if (atMs <= args.nowMs) continue;
      out.push({
        atMs,
        localText: utcMsToLocalText(atMs, args.timeZone),
        dayOfWeek: dow,
        hour: w.hour,
        fromBestTime: w.fromBestTime,
      });
    }
  }

  return out.sort((a, b) => a.atMs - b.atMs);
}

export type CalendarEntryStatus = "draft" | "needs_content";

export interface CalendarEntry {
  /** ลำดับในปฏิทิน (0-based) — ใช้อ้างอิงตอนแก้/เลื่อน */
  index: number;
  slot: CalendarSlot;
  pillar: PillarKey;
  pillarLabelTh: string;
  post?: GeneratedPost;
  status: CalendarEntryStatus;
  th: string;
}

export interface ContentCalendar {
  pageId: string;
  timeZone: string;
  entries: CalendarEntry[];
  /** สัดส่วนที่ได้จริง — เทียบกับที่ตั้งไว้ */
  mix: ReturnType<typeof summarizePlan>;
  /** ช่วงของปฏิทิน */
  startAtMs: number;
  endAtMs: number;
  /** เรื่องที่ต้องบอกคนใช้ก่อนกดอนุมัติ */
  warnings: string[];
  th: string;
}

export interface BuildCalendarArgs {
  brief: BrandBrief;
  topic: string;
  llm: ContentLlm;
  timeZone: string;
  startAtMs: number;
  nowMs: number;
  pillars: readonly Pillar[];
  bestTimes?: readonly SlotScore[];
  /** ข้อมูล Insights พอให้เชื่อ bestTimes ได้ไหม (มาจาก computeBestTimes) */
  bestTimesConfident?: boolean;
  days?: number;
  postsPerWeek?: number;
  maxPosts?: number;
  brandTags?: string[];
  logger?: Logger;
}

/**
 * กดปุ่มเดียว ได้ปฏิทินทั้งเดือน
 *
 * ปฏิเสธตั้งแต่ต้นถ้า Brand Brief ยังไม่ครบ — เจตนา ไม่ใช่ความขี้เกียจ
 * ปล่อยให้สร้างจาก brief ครึ่งๆ = ได้โพสต์กลางๆ 20 อันที่ต้องแก้ทุกอัน
 * ซึ่งช้ากว่าเขียนเองตั้งแต่แรก
 */
export async function buildMonthCalendar(
  args: BuildCalendarArgs,
): Promise<ContentCalendar> {
  const logger = args.logger ?? nullLogger;
  const completeness = checkBrief(args.brief);
  if (!completeness.ready) {
    throw new CalendarError(
      `brief incomplete: ${completeness.missing.join(",")}`,
      completeness.th,
    );
  }

  const slots = planCalendarSlots({
    startAtMs: args.startAtMs,
    nowMs: args.nowMs,
    timeZone: args.timeZone,
    ...(args.days !== undefined ? { days: args.days } : {}),
    ...(args.postsPerWeek !== undefined
      ? { postsPerWeek: args.postsPerWeek }
      : {}),
    ...(args.bestTimes !== undefined ? { bestTimes: args.bestTimes } : {}),
    ...(args.maxPosts !== undefined ? { maxPosts: args.maxPosts } : {}),
  });

  if (slots.length === 0) {
    throw new CalendarError(
      "no slots available",
      "หาเวลาโพสต์ในช่วงที่เลือกไม่ได้เลย — ลองขยายจำนวนวัน หรือเพิ่มจำนวนโพสต์ต่อสัปดาห์",
    );
  }

  const plan = buildPillarPlan(args.pillars, slots.length);
  const generated = await generateBatch({
    brief: args.brief,
    topic: args.topic,
    plan,
    llm: args.llm,
    ...(args.brandTags !== undefined ? { brandTags: args.brandTags } : {}),
    logger,
  });

  const warnings: string[] = [];
  if (args.bestTimesConfident === false) {
    warnings.push(
      "ยังไม่มีข้อมูล Insights พอจะรู้เวลาที่ดีที่สุดของเพจนี้ — ใช้เวลามาตรฐานไปก่อน แล้วระบบจะปรับให้เองเมื่อมีข้อมูลครบ",
    );
  }
  if (completeness.score < 1) warnings.push(completeness.th);

  // generateBatch ตัดโพสต์ที่ซ้ำกันเองออกได้ จำนวนจึงไม่ตรงกับแผนเสมอไป
  // ห้ามจับคู่ด้วย index ตรงๆ — เสาหลักจะเลื่อน แล้วโพสต์แนว "ให้ความรู้"
  // จะไปขึ้นในปฏิทินว่าเป็น "ขาย" ซึ่งทำให้สัดส่วนที่แสดงผิดไปทั้งเดือน
  // โพสต์แต่ละอันรู้เสาหลักของตัวเองอยู่แล้ว จึงเชื่อค่าจากโพสต์
  // ส่วนช่องที่ไม่มีโพสต์ ใช้เสาที่เหลือจากแผนเพื่อบอกคนเขียนว่าควรเขียนแนวไหน
  const leftover = plan.map((p) => ({ pillar: p.pillar, labelTh: p.labelTh }));
  for (const p of generated.posts) {
    const i = leftover.findIndex((e) => e.pillar === p.pillar);
    if (i >= 0) leftover.splice(i, 1);
  }

  const entries: CalendarEntry[] = slots.map((slot, index) => {
    const post = generated.posts[index];
    const planned = post
      ? { pillar: post.pillar, labelTh: post.pillarLabelTh }
      : (leftover.shift() ?? {
          pillar: plan[index]!.pillar,
          labelTh: plan[index]!.labelTh,
        });
    const base = {
      index,
      slot,
      pillar: planned.pillar,
      pillarLabelTh: planned.labelTh,
      status: (post ? "draft" : "needs_content") as CalendarEntryStatus,
    };
    if (!post) {
      return {
        ...base,
        th: `${slot.localText} · ${planned.labelTh} — AI ยังไม่ได้สร้างโพสต์ช่องนี้ ต้องเติมเอง`,
      };
    }
    return {
      ...base,
      post,
      th: `${slot.localText} · ${planned.labelTh} — ${post.idea}`,
    };
  });

  const missing = entries.filter((e) => e.status === "needs_content").length;
  if (missing > 0) {
    warnings.push(
      `มี ${missing} ช่องที่ AI สร้างไม่ครบ (ส่วนใหญ่เพราะเขียนซ้ำกันเองแล้วโดนตัดออก) — ต้องเติมเองก่อนอนุมัติ`,
    );
  }
  const flagged = entries.filter((e) => (e.post?.warnings.length ?? 0) > 0).length;
  if (flagged > 0) {
    warnings.push(`มี ${flagged} โพสต์ที่ระบบขึ้นเตือน ควรอ่านก่อนอนุมัติ`);
  }

  const first = entries[0]!;
  const last = entries[entries.length - 1]!;

  return {
    pageId: args.brief.pageId,
    timeZone: args.timeZone,
    entries,
    // สรุปจากของที่ได้จริง ไม่ใช่จากแผนที่ขอไป — ถ้าโดนตัดไปสองโพสต์
    // สัดส่วนที่คนเห็นต้องเป็นสัดส่วนที่จะโพสต์จริง
    mix: mixOf(entries),
    startAtMs: first.slot.atMs,
    endAtMs: last.slot.atMs,
    warnings,
    th: `ได้ปฏิทิน ${entries.length} โพสต์ ตั้งแต่ ${first.slot.localText} ถึง ${last.slot.localText}`,
  };
}

function mixOf(
  entries: readonly CalendarEntry[],
): ReturnType<typeof summarizePlan> {
  return summarizePlan(
    entries.map((e) => ({
      index: e.index,
      pillar: e.pillar,
      labelTh: e.pillarLabelTh,
      guidanceTh: "",
    })),
  );
}

export interface RescheduleResult {
  ok: boolean;
  /**
   * ปฏิทินหลังเลื่อน — ถ้าเลื่อนไม่ได้จะเป็นตัวเดิมไม่แตะ
   *
   * คืนทั้งปฏิทินไม่ใช่แค่รายการ เพราะ startAtMs/endAtMs ต้องขยับตามด้วย
   * ถ้าคืนแค่ entries คนเรียกจะถือปฏิทินที่ช่วงวันที่ผิดโดยไม่รู้ตัว
   */
  calendar: ContentCalendar;
  th: string;
}

/**
 * เลื่อนเวลาโพสต์ (drag & drop ในหน้าปฏิทิน)
 *
 * ตรวจสองอย่างที่ UI ป้องกันเองไม่ได้:
 *   - ลากไปวางในอดีต → worker จะหยิบไปโพสต์ทันทีที่รอบถัดไปมาถึง
 *   - ลากไปชนโพสต์อื่น → สองโพสต์ในชั่วโมงเดียวกันแย่ง reach กันเอง
 */
export function rescheduleEntry(args: {
  calendar: ContentCalendar;
  index: number;
  toAtMs: number;
  nowMs: number;
}): RescheduleResult {
  const { calendar, index, toAtMs, nowMs } = args;
  const target = calendar.entries.find((e) => e.index === index);
  if (!target) {
    return {
      ok: false,
      calendar,
      th: `ไม่พบโพสต์ลำดับที่ ${index} ในปฏิทินนี้`,
    };
  }

  if (toAtMs <= nowMs) {
    return {
      ok: false,
      calendar,
      th: "เลื่อนไปเวลาที่ผ่านมาแล้วไม่ได้ — ระบบจะโพสต์ทันทีที่รอบถัดไปมาถึง",
    };
  }

  const gapMs = MIN_GAP_HOURS * 3_600_000;
  const clash = calendar.entries.find(
    (e) => e.index !== index && Math.abs(e.slot.atMs - toAtMs) < gapMs,
  );
  if (clash) {
    return {
      ok: false,
      calendar,
      th: `ชนกับโพสต์ที่ตั้งไว้ ${clash.slot.localText} — ต้องห่างกันอย่างน้อย ${MIN_GAP_HOURS} ชั่วโมง ไม่งั้นสองโพสต์แย่ง reach กันเอง`,
    };
  }

  const localText = utcMsToLocalText(toAtMs, calendar.timeZone);
  const dow = dayOfWeekOf(localDateOf(toAtMs, calendar.timeZone));
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: calendar.timeZone,
      hourCycle: "h23",
      hour: "2-digit",
    }).format(new Date(toAtMs)),
  );

  const entries = calendar.entries
    .map((e) =>
      e.index === index
        ? {
            ...e,
            slot: {
              atMs: toAtMs,
              localText,
              dayOfWeek: dow,
              hour,
              // เลื่อนเองแล้ว ไม่ใช่เวลาที่ระบบคำนวณให้อีกต่อไป
              fromBestTime: false,
            },
            th: e.post
              ? `${localText} · ${e.pillarLabelTh} — ${e.post.idea}`
              : `${localText} · ${e.pillarLabelTh} — ยังไม่มีเนื้อหา`,
          }
        : e,
    )
    .sort((a, b) => a.slot.atMs - b.slot.atMs);

  return {
    ok: true,
    calendar: {
      ...calendar,
      entries,
      startAtMs: entries[0]!.slot.atMs,
      endAtMs: entries[entries.length - 1]!.slot.atMs,
    },
    th: `เลื่อนไป ${localText} เรียบร้อย`,
  };
}

/** สรุปปฏิทินให้อ่านเข้าใจในบรรทัดเดียว — ใช้บนการ์ดของแต่ละเพจในแดชบอร์ด */
export function describeCalendar(calendar: ContentCalendar): string {
  const ready = calendar.entries.filter((e) => e.status === "draft").length;
  const mix = calendar.mix
    .map((m) => `${m.labelTh} ${m.percent}%`)
    .join(" · ");
  const days = new Set(
    calendar.entries.map((e) => `${e.slot.dayOfWeek}`),
  ).size;
  return `${ready}/${calendar.entries.length} โพสต์พร้อมรีวิว · กระจาย ${days} วันต่อสัปดาห์ · ${mix}`;
}

/** จัดกลุ่มตามวันสำหรับหน้าปฏิทิน (คีย์เป็น YYYY-MM-DD ตาม timezone ของเพจ) */
export function groupByLocalDate(
  calendar: ContentCalendar,
): Array<{ date: string; dayLabelTh: string; entries: CalendarEntry[] }> {
  const groups = new Map<string, CalendarEntry[]>();
  for (const e of calendar.entries) {
    const key = isoDate(localDateOf(e.slot.atMs, calendar.timeZone));
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, entries]) => ({
      date,
      dayLabelTh: DAY_TH[entries[0]!.slot.dayOfWeek] ?? "?",
      entries,
    }));
}
