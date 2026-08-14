/**
 * โควตาของ YouTube Data API — ข้อจำกัดที่กำหนดรูปร่างของทั้งโมดูลนี้
 *
 * ─── ทำไมเรื่องนี้สำคัญกว่าที่คิด ───
 *
 * Meta คิด rate limit เป็น "กี่ครั้งต่อชั่วโมง" ซึ่งเต็มแล้วรอเดี๋ยวก็หาย
 * แต่ YouTube ให้ **10,000 หน่วยต่อวันต่อโปรเจ็ค** และ**รีเซ็ตตอนเที่ยงคืน
 * แปซิฟิกเท่านั้น** — ใช้หมดตอนเช้า = ตาบอดทั้งวัน ไม่มีทางเร่งให้คืนมา
 *
 * และราคาต่อ endpoint ต่างกันถึง **100 เท่า**:
 *
 * | endpoint | ราคา | ใช้ทำอะไร |
 * |---|---|---|
 * | `search.list` | **100** | ค้นวิดีโอด้วยคำ |
 * | `playlistItems.list` | 1 | ดึงวิดีโอของช่อง ← ใช้ตัวนี้แทน |
 * | `commentThreads.list` | 1 | ดึงคอมเมนต์ (100 อันต่อครั้ง) |
 * | `channels.list` | 1 | ข้อมูลช่อง + ผู้ติดตาม |
 * | `videos.list` | 1 | ยอดวิว/ไลก์ของวิดีโอ |
 *
 * **`search.list` คือกับดักใหญ่ที่สุดของ API นี้** — เรียกแค่ 100 ครั้ง
 * โควตาหมดทั้งวัน ตัวอย่างโค้ดในเน็ตส่วนมากใช้มันเพราะเขียนง่ายกว่า
 * แต่วิธีที่ถูกคือ: `channels.list` → เอา id ของเพลย์ลิสต์ "อัปโหลด" →
 * `playlistItems.list` ซึ่งได้ผลเหมือนกันในราคา 1/100
 *
 * เราจึง **ไม่มีทางเรียก `search.list` เลย** และมีเทสต์บังคับไว้
 */

/** ราคาต่อการเรียกหนึ่งครั้ง (หน่วยโควตา) */
export const QUOTA_COST = {
  "channels.list": 1,
  "playlistItems.list": 1,
  "videos.list": 1,
  "commentThreads.list": 1,
  "comments.list": 1,
  /** ซ่อน/ลบคอมเมนต์ — เขียน ไม่ใช่อ่าน */
  "comments.setModerationStatus": 50,
  "comments.delete": 50,
} as const;

export type QuotaEndpoint = keyof typeof QUOTA_COST;

/** โควตาเริ่มต้นที่ Google ให้ทุกโปรเจ็ค — ขอเพิ่มได้แต่ต้องยื่นแบบฟอร์ม */
export const DEFAULT_DAILY_QUOTA = 10_000;

/**
 * กันไว้เท่าไรไม่ให้งานเบื้องหลังใช้จนหมด
 *
 * งานที่คนนั่งรออยู่ (กดปุ่มในหน้าเว็บ) ต้องมีโควตาเหลือให้เสมอ ถ้าปล่อยให้
 * cron ดูดจนเกลี้ยงตอนเช้า พอตอนบ่ายคนกดปุ่มแล้วไม่มีอะไรเกิดขึ้น
 * — อาการเดียวกับที่ `ingest.ts` ของฝั่ง Meta ป้องกันด้วย `priority: "low"`
 */
export const RESERVED_FOR_INTERACTIVE = 1_500;

/**
 * โควตารีเซ็ตตอนเที่ยงคืน **เวลาแปซิฟิก** ไม่ใช่ UTC และไม่ใช่เวลาไทย
 *
 * ต่างกับไทย 14–15 ชม. ขึ้นกับ DST — ซึ่งแปลว่าโควตารีเซ็ตราวบ่ายสองถึง
 * บ่ายสามของบ้านเรา ไม่ใช่ตอนเที่ยงคืนอย่างที่คนไทยจะเดา
 *
 * ใช้ `Intl` คำนวณแทนการบวกเลขเอง เพราะ DST ขยับปีละสองครั้ง
 */
export const QUOTA_RESET_ZONE = "America/Los_Angeles";

/** วันที่ตามเวลาแปซิฟิก ในรูป `YYYY-MM-DD` — ใช้เป็นคีย์ของถังโควตารายวัน */
export function quotaDayKey(atMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: QUOTA_RESET_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(atMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface QuotaSnapshot {
  dayKey: string;
  used: number;
  limit: number;
  remaining: number;
  /** เหลือให้งานเบื้องหลังใช้ได้อีกเท่าไร (กันส่วนของงานที่คนรอไว้แล้ว) */
  remainingForBackground: number;
  usedPct: number;
}

/**
 * ถังโควตารายวัน
 *
 * เก็บในหน่วยความจำโดยตั้งใจ — ตัวเลขจริงอยู่ที่ Google เราแค่ประมาณเอาไว้
 * เบรกตัวเอง**ก่อน**จะโดนปฏิเสธ ถ้าโปรเซสรีสตาร์ทแล้วนับใหม่จากศูนย์
 * ผลที่แย่ที่สุดคือยิงเกินไปแล้วโดน 403 ซึ่ง `classifyYouTubeError()` จับได้อยู่แล้ว
 *
 * (จะเก็บลง DB ให้ข้ามการรีสตาร์ทก็ได้ แต่ต้องรับว่าเลขจะเพี้ยนได้อีกทาง
 * คือหลายโปรเซสใช้โควตาก้อนเดียวกัน — ไว้ทำตอนมี worker หลายตัวจริงๆ)
 */
export class QuotaBucket {
  private dayKey: string;
  private used = 0;

  constructor(
    private readonly limit: number = DEFAULT_DAILY_QUOTA,
    nowMs: number = 0,
  ) {
    this.dayKey = quotaDayKey(nowMs);
  }

  /** ข้ามวันแล้วเริ่มนับใหม่ — เรียกก่อนอ่าน/เขียนทุกครั้ง */
  private roll(nowMs: number): void {
    const key = quotaDayKey(nowMs);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.used = 0;
    }
  }

  snapshot(nowMs: number): QuotaSnapshot {
    this.roll(nowMs);
    const remaining = Math.max(0, this.limit - this.used);
    return {
      dayKey: this.dayKey,
      used: this.used,
      limit: this.limit,
      remaining,
      remainingForBackground: Math.max(0, remaining - RESERVED_FOR_INTERACTIVE),
      usedPct: this.limit === 0 ? 100 : (this.used / this.limit) * 100,
    };
  }

  /**
   * ยิงได้ไหม — งานเบื้องหลังต้องเหลือเผื่อส่วนของงานที่คนรออยู่ด้วย
   *
   * ตอบเป็น "ได้/ไม่ได้ + เหตุผลไทย" ไม่ใช่ boolean เปล่าๆ เพราะคนที่เห็น
   * ผลลัพธ์ต้องรู้ว่าต้องรอถึงเมื่อไหร่ ไม่ใช่แค่ว่า "ตอนนี้ไม่ได้"
   */
  canSpend(args: {
    cost: number;
    nowMs: number;
    background: boolean;
  }): { ok: boolean; th: string } {
    const s = this.snapshot(args.nowMs);
    const budget = args.background ? s.remainingForBackground : s.remaining;
    if (args.cost <= budget) return { ok: true, th: "" };

    return {
      ok: false,
      th: args.background
        ? `โควตา YouTube วันนี้เหลือน้อย (ใช้ไป ${s.used}/${s.limit} หน่วย) — ` +
          `หยุดงานเบื้องหลังไว้ก่อนเพื่อกันโควตาให้งานที่กดเอง ` +
          `โควตารีเซ็ตเที่ยงคืนเวลาแปซิฟิก (ราวบ่าย 2–3 โมงบ้านเรา)`
        : `โควตา YouTube วันนี้หมดแล้ว (${s.used}/${s.limit} หน่วย) — ` +
          `รอรีเซ็ตเที่ยงคืนเวลาแปซิฟิก (ราวบ่าย 2–3 โมงบ้านเรา) ` +
          `หรือขอเพิ่มโควตาที่ Google Cloud Console`,
    };
  }

  /** จดว่าใช้ไปแล้ว — เรียกหลังยิงจริงเสมอ แม้ call จะล้มเหลว */
  spend(cost: number, nowMs: number): void {
    this.roll(nowMs);
    this.used += cost;
  }
}
