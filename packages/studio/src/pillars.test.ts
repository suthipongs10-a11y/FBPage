import { describe, expect, it } from "vitest";
import { expectThaiThrow } from "@page-os/core/testing";
import {
  DEFAULT_PILLARS,
  buildPillarPlan,
  distributePillars,
  pillarFromKey,
  summarizePlan,
  validatePillars,
  type Pillar,
} from "./pillars.js";

/** จำนวนที่ยาวที่สุดในแถวเดียวกันของ key ที่กำหนด */
function longestRun(keys: readonly string[]): number {
  let best = 0;
  let cur = 0;
  let prev: string | null = null;
  for (const k of keys) {
    cur = k === prev ? cur + 1 : 1;
    prev = k;
    best = Math.max(best, cur);
  }
  return best;
}

describe("validatePillars", () => {
  it("สัดส่วนรวมไม่ถึง 100 → error ไทยบอกตัวเลขที่ได้จริง", () => {
    const err = expectThaiThrow(() =>
      validatePillars([pillarFromKey("educate", 40), pillarFromKey("sell", 30)]),
    );
    expect(err.th).toMatch(/70%/);
    expect(err.th).toMatch(/100%/);
  });

  it("ไม่ตั้งสัดส่วนเลย → error ไทย", () => {
    const err = expectThaiThrow(() => validatePillars([]));
    expect(err.th).toMatch(/อย่างน้อย 1 ประเภท/);
  });

  it("สัดส่วนติดลบ → error ไทยบอกว่าเสาไหน", () => {
    const err = expectThaiThrow(() =>
      validatePillars([
        pillarFromKey("educate", 110),
        pillarFromKey("sell", -10),
      ]),
    );
    expect(err.th).toMatch(/ขาย/);
  });

  it("ประเภทซ้ำกัน → error ไทย", () => {
    const err = expectThaiThrow(() =>
      validatePillars([pillarFromKey("sell", 50), pillarFromKey("sell", 50)]),
    );
    expect(err.th).toMatch(/ซ้ำกัน/);
  });

  it("ชุดเริ่มต้นตามสเปกต้องผ่าน", () => {
    expect(() => validatePillars(DEFAULT_PILLARS)).not.toThrow();
  });
});

describe("distributePillars", () => {
  it("ได้จำนวนโพสต์ตรงกับที่ขอเป๊ะ แม้สัดส่วนหารไม่ลงตัว", () => {
    // 40/30/20/10 ของ 30 = 12/9/6/3 พอดี แต่ของ 7 ไม่ลงตัว
    for (const n of [1, 7, 13, 30, 31, 100]) {
      expect(distributePillars(DEFAULT_PILLARS, n)).toHaveLength(n);
    }
  });

  it("สัดส่วนที่ได้ใกล้เคียงกับที่ตั้งไว้", () => {
    const keys = distributePillars(DEFAULT_PILLARS, 30);
    const count = (k: string): number => keys.filter((x) => x === k).length;
    expect(count("educate")).toBe(12);
    expect(count("sell")).toBe(9);
    expect(count("engage")).toBe(6);
    expect(count("behind_scenes")).toBe(3);
  });

  it("ไม่โพสต์ประเภทเดียวกันติดกันเป็นก้อน — นี่คือเหตุผลที่ไม่ใช้การสุ่ม", () => {
    const keys = distributePillars(DEFAULT_PILLARS, 30);
    // ถ้าเรียงเป็นก้อนจะได้ educate ติดกัน 12 ตัว
    expect(longestRun(keys)).toBeLessThanOrEqual(2);
  });

  it("เสาที่สัดส่วนมากสุดได้คิวแรก", () => {
    expect(distributePillars(DEFAULT_PILLARS, 30)[0]).toBe("educate");
  });

  it("ผลลัพธ์เหมือนเดิมทุกครั้ง (deterministic) — กด 2 ครั้งต้องได้แผนเดียวกัน", () => {
    const a = distributePillars(DEFAULT_PILLARS, 30);
    const b = distributePillars(DEFAULT_PILLARS, 30);
    expect(a).toEqual(b);
  });

  it("ขอ 0 โพสต์ → ได้แผนว่าง ไม่ throw", () => {
    expect(distributePillars(DEFAULT_PILLARS, 0)).toEqual([]);
    expect(distributePillars(DEFAULT_PILLARS, -5)).toEqual([]);
  });

  it("เสาที่ตั้ง 0% ไม่โผล่ในแผนเลย", () => {
    const pillars: Pillar[] = [
      pillarFromKey("educate", 100),
      pillarFromKey("sell", 0),
    ];
    const keys = distributePillars(pillars, 10);
    expect(keys.every((k) => k === "educate")).toBe(true);
  });

  it("โพสต์น้อยกว่าจำนวนเสา → เสาที่สัดส่วนสูงสุดได้ไปก่อน", () => {
    const keys = distributePillars(DEFAULT_PILLARS, 2);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("educate");
  });

  it("สัดส่วนที่มีทศนิยมก็ยังรวมได้ครบ", () => {
    const pillars: Pillar[] = [
      pillarFromKey("educate", 33.3),
      pillarFromKey("sell", 33.3),
      pillarFromKey("engage", 33.4),
    ];
    expect(distributePillars(pillars, 10)).toHaveLength(10);
  });
});

describe("buildPillarPlan", () => {
  it("แต่ละช่องมีคำแนะนำสำหรับ LLM ติดมาด้วย", () => {
    const plan = buildPillarPlan(DEFAULT_PILLARS, 4);
    expect(plan).toHaveLength(4);
    for (const e of plan) {
      expect(e.guidanceTh.length).toBeGreaterThan(10);
      expect(e.labelTh).not.toBe("");
    }
  });

  it("คำแนะนำของเสา 'ให้ความรู้' ต้องห้ามขายตรงๆ", () => {
    const plan = buildPillarPlan([pillarFromKey("educate", 100)], 1);
    expect(plan[0]!.guidanceTh).toMatch(/ห้ามขาย/);
  });

  it("คำแนะนำของ social_proof ห้ามแต่งรีวิว — เป็นเรื่องกฎหมาย", () => {
    const plan = buildPillarPlan([pillarFromKey("social_proof", 100)], 1);
    expect(plan[0]!.guidanceTh).toMatch(/ห้ามแต่งรีวิว/);
  });

  it("index เรียงจาก 0 ต่อเนื่อง", () => {
    const plan = buildPillarPlan(DEFAULT_PILLARS, 6);
    expect(plan.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("summarizePlan", () => {
  it("สรุปสัดส่วนที่ได้จริงเป็นเปอร์เซ็นต์", () => {
    const plan = buildPillarPlan(DEFAULT_PILLARS, 30);
    const s = summarizePlan(plan);
    const educate = s.find((x) => x.key === "educate")!;
    expect(educate.count).toBe(12);
    expect(educate.percent).toBe(40);
  });

  it("เรียงจากมากไปน้อย ให้คนเห็นเสาหลักก่อน", () => {
    const s = summarizePlan(buildPillarPlan(DEFAULT_PILLARS, 30));
    expect(s[0]!.key).toBe("educate");
    expect(s.at(-1)!.key).toBe("behind_scenes");
  });

  it("แผนว่าง → สรุปว่าง ไม่หารด้วยศูนย์", () => {
    expect(summarizePlan([])).toEqual([]);
  });
});
