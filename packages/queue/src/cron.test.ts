import { describe, expect, it } from "vitest";
import {
  assertValidCronPattern,
  CRON_JOBS,
  CRON_TZ,
  planCronReconcile,
  type CronSpec,
  type ExistingRepeat,
} from "./cron.js";

const spec = (name: string, pattern: string): CronSpec => ({
  name,
  queue: "cron",
  pattern,
  th: name,
});

describe("ตารางงานที่ประกาศไว้", () => {
  it("ทุกตัวเป็น cron 5 ช่อง", () => {
    for (const j of CRON_JOBS) {
      expect(() => assertValidCronPattern(j.pattern), j.name).not.toThrow();
    }
  });

  it("ชื่อไม่ซ้ำกัน", () => {
    const names = CRON_JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ทุกตัวมีคำอธิบายไทย", () => {
    for (const j of CRON_JOBS) {
      expect(j.th.length, j.name).toBeGreaterThan(5);
    }
  });

  it("มีรอบที่สเปกสั่งไว้ครบ", () => {
    const byName = new Map(CRON_JOBS.map((j) => [j.name, j]));
    // สเปกข้อ 1: health check ทุก 6 ชม.
    expect(byName.get("token-health")?.pattern).toBe("0 */6 * * *");
    // สเปกข้อ 4: sync Insights รายวัน cron 03:00
    expect(byName.get("analytics-sync")?.pattern).toBe("0 3 * * *");
    // ตัวจับเวลาโพสต์ต้องละเอียดระดับนาที ไม่งั้นโพสต์ 9:00 อาจขึ้น 9:05
    expect(byName.get("publish-tick")?.pattern).toBe("* * * * *");
  });
});

describe("assertValidCronPattern", () => {
  it("6 ช่องแบบที่มีวินาที → ล้มพร้อมอธิบายว่าจะเพี้ยนยังไง", () => {
    expect(() => assertValidCronPattern("0 0 3 * * *")).toThrow(/5 ช่อง/);
  });

  it("ช่องว่างเกินไม่ทำให้นับผิด", () => {
    expect(() => assertValidCronPattern("  0   3 * * *  ")).not.toThrow();
  });
});

describe("planCronReconcile", () => {
  it("ยังไม่มีอะไรใน Redis → ต้องสร้างทุกตัว", () => {
    const plan = planCronReconcile([], [spec("a", "* * * * *"), spec("b", "0 3 * * *")]);
    expect(plan.toUpsert.map((s) => s.name)).toEqual(["a", "b"]);
    expect(plan.toRemove).toEqual([]);
  });

  it("มีครบและตรงกันแล้ว → ไม่ต้องทำอะไร", () => {
    const existing: ExistingRepeat[] = [
      { key: "a", pattern: "* * * * *", tz: CRON_TZ },
    ];
    const plan = planCronReconcile(existing, [spec("a", "* * * * *")]);
    expect(plan.toUpsert).toEqual([]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.unchanged).toEqual(["a"]);
  });

  /**
   * นี่คือเหตุผลหลักที่ต้องมีตัว reconcile: ตารางที่ถูกลบออกจากโค้ดแล้ว
   * ยังค้างอยู่ใน Redis และยังยิงงานต่อไปทุกวันโดยไม่มีใครรู้
   */
  it("ตารางที่ไม่มีในโค้ดแล้ว → ต้องลบทิ้ง", () => {
    const existing: ExistingRepeat[] = [
      { key: "a", pattern: "* * * * *", tz: CRON_TZ },
      { key: "ของเก่าที่เลิกใช้", pattern: "0 0 * * *", tz: CRON_TZ },
    ];
    const plan = planCronReconcile(existing, [spec("a", "* * * * *")]);
    expect(plan.toRemove.map((r) => r.key)).toEqual(["ของเก่าที่เลิกใช้"]);
    expect(plan.toRemove[0]?.reasonTh).toContain("เวอร์ชันก่อน");
  });

  it("เวลาเปลี่ยน → เขียนทับ ไม่ใช่ปล่อยให้มีสองรอบ", () => {
    const existing: ExistingRepeat[] = [{ key: "a", pattern: "0 3 * * *", tz: CRON_TZ }];
    const plan = planCronReconcile(existing, [spec("a", "0 4 * * *")]);
    expect(plan.toUpsert.map((s) => s.name)).toEqual(["a"]);
    // ต้องไม่สั่งลบด้วย ไม่งั้นจะมีช่วงที่ไม่มีตารางนี้อยู่เลย
    expect(plan.toRemove).toEqual([]);
  });

  /**
   * timezone ผิดคือบั๊กที่เงียบที่สุดในกลุ่มนี้ — งานยังทำงานทุกวัน แค่ผิดเวลา 7 ชม.
   * รายงานเดือนที่ควรส่ง 9 โมงเช้าจะไปส่งตอนตีสองของลูกค้า
   */
  it("timezone ไม่ตรง → เขียนทับ", () => {
    const existing: ExistingRepeat[] = [{ key: "a", pattern: "0 3 * * *", tz: "UTC" }];
    const plan = planCronReconcile(existing, [spec("a", "0 3 * * *")]);
    expect(plan.toUpsert.map((s) => s.name)).toEqual(["a"]);
  });

  it("ตารางเก่าที่ไม่มี tz เก็บไว้เลย → ถือว่าไม่ตรงและเขียนทับ", () => {
    const existing: ExistingRepeat[] = [{ key: "a", pattern: "0 3 * * *" }];
    const plan = planCronReconcile(existing, [spec("a", "0 3 * * *")]);
    expect(plan.toUpsert.map((s) => s.name)).toEqual(["a"]);
  });

  it("แผนสำหรับตารางจริงทั้งชุดจาก Redis ว่างเปล่า ต้องครบทุกตัวและไม่ลบอะไร", () => {
    const plan = planCronReconcile([]);
    expect(plan.toUpsert).toHaveLength(CRON_JOBS.length);
    expect(plan.toRemove).toEqual([]);
  });
});
