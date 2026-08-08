import { describe, expect, it } from "vitest";
import { buildDigest, type DigestInput } from "./digest.js";
import type { Problem } from "./problems.js";

const NOW = Date.UTC(2026, 7, 8, 0, 0, 0);

function problem(over: Partial<Problem> = {}): Problem {
  return {
    id: "token:p1",
    severity: "critical",
    kind: "token",
    pageId: "p1",
    pageName: "ครัวคุณยาย",
    clientName: "ครัวคุณยาย",
    colorIndex: 0,
    th: "หมดอายุแล้ว",
    ...over,
  };
}

function input(over: Partial<DigestInput> = {}): DigestInput {
  return {
    nowMs: NOW,
    problems: [],
    waitingConversations: 0,
    breachedConversations: 0,
    pendingApprovals: 0,
    lateApprovals: 0,
    postsToday: 0,
    pageCount: 10,
    ...over,
  };
}

describe("buildDigest", () => {
  it("ไม่มีอะไรค้าง → บอกตรงๆ ว่าเรียบร้อย", () => {
    const d = buildDigest(input());
    expect(d.hasWork).toBe(false);
    expect(d.th).toMatch(/ไม่มีอะไรค้าง/);
    expect(d.th).toMatch(/10 เพจ/);
  });

  it("ของพังขึ้นก่อนอย่างอื่นเสมอ", () => {
    const d = buildDigest(
      input({
        problems: [problem()],
        waitingConversations: 5,
        breachedConversations: 2,
      }),
    );
    const lines = d.th.split("\n");
    const critIdx = lines.findIndex((l) => l.includes("พังอยู่"));
    const slaIdx = lines.findIndex((l) => l.includes("เลยเวลา"));
    expect(critIdx).toBeGreaterThan(0);
    expect(critIdx).toBeLessThan(slaIdx);
  });

  it("แยกบทสนทนาที่เลยเวลาออกจากที่ยังมีเวลา", () => {
    const d = buildDigest(
      input({ waitingConversations: 5, breachedConversations: 2 }),
    );
    expect(d.th).toMatch(/เลยเวลาที่สัญญากับลูกค้าไว้ 2 บทสนทนา/);
    expect(d.th).toMatch(/รอตอบอีก 3 บทสนทนา/);
  });

  it("ไม่มีอันที่เลยเวลา → ไม่ขึ้นบรรทัดนั้นให้รก", () => {
    const d = buildDigest(input({ waitingConversations: 3 }));
    expect(d.th).not.toMatch(/เลยเวลาที่สัญญา/);
    expect(d.th).toMatch(/รอตอบอีก 3/);
  });

  it("แยกโพสต์ที่เลยเวลาอนุมัติออกจากที่ยังไม่ถึงเวลา", () => {
    const d = buildDigest(input({ pendingApprovals: 5, lateApprovals: 2 }));
    expect(d.th).toMatch(/2 โพสต์ที่เลยเวลาแล้ว/);
    expect(d.th).toMatch(/รอลูกค้าอนุมัติอีก 3 โพสต์/);
  });

  it("อ่านจบในหน้าจอเดียว — ปัญหาเยอะยุบเป็น 'และอีก N'", () => {
    // สรุปที่ต้องเลื่อนสามหน้าก็คือจออีกจอหนึ่ง ไม่ได้ช่วยอะไร
    const d = buildDigest({
      ...input(),
      problems: Array.from({ length: 12 }, (_, i) =>
        problem({ id: `t${i}`, pageName: `เพจ ${i}` }),
      ),
    });
    expect(d.th).toMatch(/และอีก \d+ เรื่อง/);
    expect(d.th.split("\n").length).toBeLessThanOrEqual(8);
  });

  it("เรื่องไม่ด่วนขึ้นเฉพาะตอนไม่มีเรื่องด่วน", () => {
    // มีเรื่องพังอยู่แล้วยังบอกเรื่องที่ 'ควรดูเมื่อว่าง' คือทำให้ไขว้เขว
    const withCrit = buildDigest(
      input({ problems: [problem(), problem({ id: "w", severity: "warning" })] }),
    );
    expect(withCrit.th).not.toMatch(/ควรดูเมื่อว่าง/);

    const onlyWarn = buildDigest(
      input({ problems: [problem({ id: "w", severity: "warning" })] }),
    );
    expect(onlyWarn.th).toMatch(/ควรดูเมื่อว่าง/);
  });

  it("โพสต์ที่จะขึ้นเอง บอกไว้ท้ายสุดพร้อมย้ำว่าไม่ต้องทำอะไร", () => {
    const d = buildDigest(input({ postsToday: 4 }));
    expect(d.th).toMatch(/4 โพสต์ที่จะขึ้นเอง/);
    expect(d.th).toMatch(/ไม่ต้องทำอะไร/);
  });

  it("มีแต่โพสต์ที่จะขึ้นเอง → ไม่นับว่ามีงานต้องทำ", () => {
    const d = buildDigest(input({ postsToday: 4 }));
    expect(d.hasWork).toBe(false);
    expect(d.taskCount).toBe(0);
  });

  it("taskCount รวมของที่ต้องแตะจริงๆ", () => {
    const d = buildDigest(
      input({
        problems: [problem()],
        waitingConversations: 3,
        pendingApprovals: 2,
        postsToday: 9,
      }),
    );
    expect(d.taskCount).toBe(6);
    expect(d.hasWork).toBe(true);
  });
});
