/**
 * Best Time to Post (M4)
 *
 * "คำนวณจาก Insights ย้อนหลัง 90 วันของเพจนั้นเอง"
 *
 * จงใจไม่ใช้ค่ากลางของอุตสาหกรรม — เพจร้านกาแฟกับเพจคลินิกมีเวลาที่คนอ่านต่างกัน
 * และนี่คือสิ่งที่ทำให้บริการเราต่างจากการตั้งเวลามั่วๆ
 */

export interface PostPerformanceSample {
  /** เวลาที่โพสต์ (epoch ms, UTC) */
  publishedAtMs: number;
  /** engagement ที่ได้ (reactions + comments + shares หรือเมตริกที่เลือก) */
  engagement: number;
  /** จำนวนคนที่เห็น — ใช้ normalize ถ้ามี */
  reach?: number;
}

export interface TimeSlot {
  /** 0 = อาทิตย์ ... 6 = เสาร์ (ตาม timezone ของเพจ) */
  dayOfWeek: number;
  /** 0-23 (ตาม timezone ของเพจ) */
  hour: number;
}

export interface SlotScore extends TimeSlot {
  /** คะแนนเฉลี่ยของช่วงนี้ */
  score: number;
  /** มีข้อมูลกี่โพสต์ */
  samples: number;
  /** ป้ายไทยสำหรับแสดงผล เช่น "พฤหัส 19:00" */
  label: string;
}

const DAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];

/** ต้องมีข้อมูลอย่างน้อยเท่านี้ต่อช่วง ถึงจะเชื่อผลได้ */
export const MIN_SAMPLES_PER_SLOT = 3;

/** ถ้าข้อมูลทั้งเพจน้อยกว่านี้ อย่าเพิ่งแนะนำเวลา */
export const MIN_TOTAL_SAMPLES = 12;

function slotOf(ms: number, timeZone: string): TimeSlot {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
  }).formatToParts(new Date(ms));
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { dayOfWeek: Math.max(0, days.indexOf(weekday)), hour };
}

export interface BestTimeResult {
  /** ช่วงเวลาที่ดีที่สุด เรียงจากดีสุด */
  slots: SlotScore[];
  /** ข้อมูลพอให้เชื่อได้ไหม */
  confident: boolean;
  th: string;
}

/**
 * หาเวลาที่ควรโพสต์ จากผลงานย้อนหลังของเพจนั้น
 *
 * ใช้ engagement ต่อ reach ถ้ามี reach (ไม่งั้นโพสต์ที่ยิงแอดจะกลบทุกอย่าง)
 */
export function computeBestTimes(args: {
  samples: PostPerformanceSample[];
  timeZone: string;
  topN?: number;
}): BestTimeResult {
  const { samples, timeZone } = args;
  const topN = args.topN ?? 3;

  if (samples.length < MIN_TOTAL_SAMPLES) {
    return {
      slots: [],
      confident: false,
      th: `ยังมีข้อมูลไม่พอ (${samples.length} โพสต์ ต้องการอย่างน้อย ${MIN_TOTAL_SAMPLES}) — โพสต์ไปอีกสักพักแล้วค่อยดูใหม่`,
    };
  }

  const buckets = new Map<string, { total: number; count: number }>();
  for (const s of samples) {
    const slot = slotOf(s.publishedAtMs, timeZone);
    const key = `${slot.dayOfWeek}:${slot.hour}`;
    // normalize ด้วย reach ถ้ามี กันโพสต์ที่ยิงแอดมาบิดผล
    const value =
      s.reach && s.reach > 0 ? s.engagement / s.reach : s.engagement;
    const b = buckets.get(key) ?? { total: 0, count: 0 };
    b.total += value;
    b.count += 1;
    buckets.set(key, b);
  }

  const scored: SlotScore[] = [];
  for (const [key, b] of buckets) {
    if (b.count < MIN_SAMPLES_PER_SLOT) continue;
    const [d, h] = key.split(":").map(Number) as [number, number];
    scored.push({
      dayOfWeek: d,
      hour: h,
      score: b.total / b.count,
      samples: b.count,
      label: `${DAY_TH[d] ?? "?"} ${String(h).padStart(2, "0")}:00`,
    });
  }

  if (scored.length === 0) {
    return {
      slots: [],
      confident: false,
      th: `ข้อมูลกระจายเกินไป (ยังไม่มีช่วงเวลาไหนที่โพสต์ถึง ${MIN_SAMPLES_PER_SLOT} ครั้ง) — ลองโพสต์เวลาเดิมซ้ำๆ สักพักเพื่อให้เทียบได้`,
    };
  }

  scored.sort((a, b) => b.score - a.score || b.samples - a.samples);
  const slots = scored.slice(0, topN);

  return {
    slots,
    confident: true,
    th: `เวลาที่ได้ผลดีที่สุดของเพจนี้: ${slots.map((s) => s.label).join(", ")}`,
  };
}
