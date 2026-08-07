import { describe, expect, it } from "vitest";
import {
  computeContainment,
  findUnansweredQuestions,
  type ConversationOutcome,
} from "./bot-performance.js";

const NOW = Date.parse("2026-08-10T10:00:00+07:00");

function conv(over: Partial<ConversationOutcome> = {}): ConversationOutcome {
  return {
    conversationId: "c1",
    botMessages: 2,
    humanMessages: 0,
    escalated: false,
    firstUserMessage: "สนใจสินค้าค่ะ",
    startedAtMs: NOW,
    ...over,
  };
}

describe("computeContainment", () => {
  it("บอทตอบจบเองทั้งหมด → 100%", () => {
    const r = computeContainment([conv(), conv(), conv()]);
    expect(r.containmentRate).toBe(1);
    expect(r.contained).toBe(3);
    expect(r.th).toContain("ผ่านเกณฑ์");
  });

  it("คนเข้าไปตอบ ถือว่าบอทจบเองไม่ได้", () => {
    const r = computeContainment([
      conv(),
      conv({ humanMessages: 1 }),
      conv(),
      conv({ humanMessages: 3 }),
    ]);
    expect(r.contained).toBe(2);
    expect(r.containmentRate).toBe(0.5);
  });

  it("บอทยกธงส่งต่อ ถือว่าจบเองไม่ได้แม้คนยังไม่ได้ตอบ", () => {
    const r = computeContainment([conv({ escalated: true }), conv()]);
    expect(r.contained).toBe(1);
    expect(r.escalated).toBe(1);
  });

  it("บทสนทนาที่บอทไม่ได้ตอบเลยไม่นับเป็นตัวหาร", () => {
    // ปิดบอทไว้ 3 บทสนทนา บอททำงานจริง 2 และจบเองทั้งคู่
    const r = computeContainment([
      conv({ botMessages: 0, humanMessages: 5 }),
      conv({ botMessages: 0, humanMessages: 2 }),
      conv({ botMessages: 0, humanMessages: 1 }),
      conv(),
      conv(),
    ]);
    expect(r.total).toBe(2);
    expect(r.containmentRate).toBe(1);
  });

  it("ต่ำกว่าเกณฑ์ 50% → บอกให้ไปเติม Knowledge Base", () => {
    const r = computeContainment([
      conv(),
      conv({ escalated: true }),
      conv({ escalated: true }),
    ]);
    expect(r.containmentRate).toBeCloseTo(0.333, 2);
    expect(r.th).toContain("Knowledge Base");
  });

  it("ไม่มีข้อมูล → บอกตรงๆ ไม่ใช่แสดง 0% ให้เข้าใจผิด", () => {
    const r = computeContainment([]);
    expect(r.total).toBe(0);
    expect(r.th).toContain("ยังไม่ได้ทำงาน");
  });

  it("ทุกผลลัพธ์เป็นภาษาไทย", () => {
    for (const cases of [[], [conv()], [conv({ escalated: true })]]) {
      expect(computeContainment(cases).th).toMatch(/[ก-๙]/);
    }
  });
});

describe("findUnansweredQuestions — เอาไปเติม Knowledge Base", () => {
  it("จัดกลุ่มคำถามที่ซ้ำกันแล้วเรียงตามความถี่", () => {
    const convs = [
      conv({ escalated: true, firstUserMessage: "ส่งต่างจังหวัด กี่วันถึง" }),
      conv({ escalated: true, firstUserMessage: "ส่งต่างจังหวัด ใช้เวลานานไหม" }),
      conv({ escalated: true, firstUserMessage: "ส่งต่างจังหวัด ค่าส่งเท่าไหร่" }),
      conv({ escalated: true, firstUserMessage: "ผ่อนได้ไหม มีบัตรเครดิต" }),
    ];
    const r = findUnansweredQuestions(convs);
    expect(r[0]!.count).toBe(3);
    expect(r[0]!.sample).toContain("ส่งต่างจังหวัด");
  });

  it("นับเฉพาะบทสนทนาที่บอทตอบไม่ได้", () => {
    const r = findUnansweredQuestions([
      conv({ escalated: false, firstUserMessage: "ตอบได้ ตอบได้" }),
      conv({ escalated: true, firstUserMessage: "ตอบไม่ได้ ตอบไม่ได้" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.sample).toContain("ตอบไม่ได้");
  });

  it("ข้ามข้อความว่าง", () => {
    expect(
      findUnansweredQuestions([
        conv({ escalated: true, firstUserMessage: "   " }),
      ]),
    ).toEqual([]);
  });

  it("ไม่มีอะไรตอบไม่ได้ → array ว่าง", () => {
    expect(findUnansweredQuestions([conv()])).toEqual([]);
  });

  it("จำกัดจำนวนผลลัพธ์ได้", () => {
    const convs = Array.from({ length: 30 }, (_, i) =>
      conv({ escalated: true, firstUserMessage: `คำถาม${i} เรื่อง${i}` }),
    );
    expect(findUnansweredQuestions(convs, 5)).toHaveLength(5);
  });

  it("ผลลัพธ์เรียงเสมอกันแบบคาดเดาได้ (ไม่สุ่มสลับ)", () => {
    const convs = [
      conv({ escalated: true, firstUserMessage: "ข ข" }),
      conv({ escalated: true, firstUserMessage: "ก ก" }),
    ];
    const a = findUnansweredQuestions(convs).map((x) => x.sample);
    const b = findUnansweredQuestions(convs).map((x) => x.sample);
    expect(a).toEqual(b);
  });
});
