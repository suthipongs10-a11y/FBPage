import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLES_PER_SLOT,
  MIN_TOTAL_SAMPLES,
  computeBestTimes,
  type PostPerformanceSample,
} from "./best-time.js";

const TZ = "Asia/Bangkok";

/** สร้างตัวอย่างโพสต์ที่เวลาไทยตามที่ระบุ */
function sample(
  isoLocal: string,
  engagement: number,
  reach?: number,
): PostPerformanceSample {
  // ไทย = UTC+7 ตลอดปี ไม่มี DST
  const ms = Date.parse(`${isoLocal}:00+07:00`);
  return reach === undefined
    ? { publishedAtMs: ms, engagement }
    : { publishedAtMs: ms, engagement, reach };
}

describe("computeBestTimes", () => {
  it("ข้อมูลน้อยเกินไป → บอกตรงๆ ว่ายังแนะนำไม่ได้", () => {
    const r = computeBestTimes({
      samples: [sample("2026-08-03T09:00", 10)],
      timeZone: TZ,
    });
    expect(r.confident).toBe(false);
    expect(r.slots).toEqual([]);
    expect(r.th).toContain(String(MIN_TOTAL_SAMPLES));
  });

  it("หาช่วงเวลาที่ engagement ดีที่สุดได้", () => {
    const samples: PostPerformanceSample[] = [];
    // จันทร์ 19:00 ดีมาก (3 ครั้ง)
    for (const d of ["03", "10", "17"]) {
      samples.push(sample(`2026-08-${d}T19:00`, 500));
    }
    // อังคาร 09:00 แย่ (3 ครั้ง)
    for (const d of ["04", "11", "18"]) {
      samples.push(sample(`2026-08-${d}T09:00`, 20));
    }
    // พุธ 12:00 กลางๆ (3 ครั้ง)
    for (const d of ["05", "12", "19"]) {
      samples.push(sample(`2026-08-${d}T12:00`, 100));
    }
    // เติมให้ครบขั้นต่ำ
    for (const d of ["06", "13", "20"]) {
      samples.push(sample(`2026-08-${d}T15:00`, 50));
    }

    const r = computeBestTimes({ samples, timeZone: TZ });

    expect(r.confident).toBe(true);
    expect(r.slots[0]!.label).toBe("จันทร์ 19:00");
    expect(r.slots[0]!.samples).toBe(3);
    expect(r.slots[1]!.label).toBe("พุธ 12:00");
    expect(r.th).toContain("จันทร์ 19:00");
  });

  it("ตัดช่วงที่ข้อมูลน้อยกว่าขั้นต่ำทิ้ง (ฟลุกครั้งเดียวไม่นับ)", () => {
    const samples: PostPerformanceSample[] = [];
    // อาทิตย์ 03:00 ครั้งเดียวแต่ engagement สูงลิ่ว — ต้องไม่ถูกแนะนำ
    samples.push(sample("2026-08-02T03:00", 99_999));
    for (const d of ["03", "10", "17"]) {
      samples.push(sample(`2026-08-${d}T19:00`, 500));
    }
    for (const d of ["04", "11", "18"]) {
      samples.push(sample(`2026-08-${d}T09:00`, 100));
    }
    for (const d of ["05", "12", "19"]) {
      samples.push(sample(`2026-08-${d}T12:00`, 80));
    }
    for (const d of ["06", "13"]) {
      samples.push(sample(`2026-08-${d}T15:00`, 50));
    }

    const r = computeBestTimes({ samples, timeZone: TZ });
    expect(r.slots.map((s) => s.label)).not.toContain("อาทิตย์ 03:00");
    expect(r.slots[0]!.label).toBe("จันทร์ 19:00");
    expect(MIN_SAMPLES_PER_SLOT).toBe(3);
  });

  it("normalize ด้วย reach — โพสต์ที่ยิงแอดต้องไม่บิดผล", () => {
    const samples: PostPerformanceSample[] = [];
    // เสาร์ 20:00: engagement สูงแต่ reach สูงมาก (ยิงแอด) → อัตราส่วนต่ำ
    for (const d of ["01", "08", "15"]) {
      samples.push(sample(`2026-08-${d}T20:00`, 1000, 100_000));
    }
    // ศุกร์ 18:00: engagement ต่ำกว่าแต่ reach น้อย → อัตราส่วนสูงกว่า
    for (const d of ["07", "14", "21"]) {
      samples.push(sample(`2026-08-${d}T18:00`, 300, 1_000));
    }
    for (const d of ["03", "10", "17"]) {
      samples.push(sample(`2026-08-${d}T09:00`, 10, 1_000));
    }
    for (const d of ["04", "11", "18"]) {
      samples.push(sample(`2026-08-${d}T11:00`, 5, 1_000));
    }

    const r = computeBestTimes({ samples, timeZone: TZ });
    expect(r.slots[0]!.label).toBe("ศุกร์ 18:00");
  });

  it("ข้อมูลกระจายจนไม่มีช่วงไหนถึงขั้นต่ำ → บอกให้โพสต์เวลาเดิมซ้ำๆ ก่อน", () => {
    const samples = Array.from({ length: 20 }, (_, i) =>
      sample(`2026-08-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00`, 10),
    );
    const r = computeBestTimes({ samples, timeZone: TZ });
    expect(r.confident).toBe(false);
    expect(r.th).toContain("กระจาย");
  });

  it("คืนตามจำนวนที่ขอ", () => {
    const samples: PostPerformanceSample[] = [];
    for (const [h, e] of [
      ["19", 500],
      ["12", 400],
      ["09", 300],
      ["15", 200],
    ] as const) {
      for (const d of ["03", "10", "17"]) {
        samples.push(sample(`2026-08-${d}T${h}:00`, e));
      }
    }
    expect(computeBestTimes({ samples, timeZone: TZ, topN: 2 }).slots).toHaveLength(2);
    expect(computeBestTimes({ samples, timeZone: TZ }).slots).toHaveLength(3);
  });

  it("ใช้ timezone ของเพจ ไม่ใช่ของเซิร์ฟเวอร์", () => {
    const samples: PostPerformanceSample[] = [];
    for (const d of ["03", "10", "17", "24"]) {
      // 19:00 เวลาไทย = 12:00 UTC
      samples.push(sample(`2026-08-${d}T19:00`, 500));
    }
    for (const d of ["04", "11", "18", "25"]) {
      samples.push(sample(`2026-08-${d}T21:00`, 100));
    }
    for (const d of ["05", "12", "19", "26"]) {
      samples.push(sample(`2026-08-${d}T08:00`, 50));
    }

    const th = computeBestTimes({ samples, timeZone: "Asia/Bangkok" });
    const utc = computeBestTimes({ samples, timeZone: "UTC" });

    expect(th.slots[0]!.hour).toBe(19);
    expect(utc.slots[0]!.hour).toBe(12);
  });
});
