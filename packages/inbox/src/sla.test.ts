import { describe, expect, it } from "vitest";
import {
  PLAN_SLA_MINUTES,
  SLA_WARN_RATIO,
  prioritizeQueue,
  slaStatus,
  summarizeQueue,
  type ConversationForQueue,
} from "./sla.js";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe("PLAN_SLA_MINUTES ตรงกับแพ็กเกจในสเปกข้อ 8", () => {
  it("STARTER 4 ชม. / GROWTH 1 ชม. / FULL 30 นาที", () => {
    expect(PLAN_SLA_MINUTES.STARTER).toBe(240);
    expect(PLAN_SLA_MINUTES.GROWTH).toBe(60);
    expect(PLAN_SLA_MINUTES.FULL).toBe(30);
  });
});

describe("slaStatus", () => {
  it("ไม่มีข้อความค้างตอบ", () => {
    const s = slaStatus({ awaitingSinceMs: null, slaMinutes: 60, nowMs: NOW });
    expect(s.state).toBe("none");
    expect(s.tone).toBe("gray");
  });

  it("ยังมีเวลาเหลือเยอะ = เขียว", () => {
    const s = slaStatus({
      awaitingSinceMs: NOW - 10 * MIN,
      slaMinutes: 60,
      nowMs: NOW,
    });
    expect(s.state).toBe("ok");
    expect(s.tone).toBe("green");
    expect(s.remainingMs).toBe(50 * MIN);
  });

  it("เตือนที่ 75% ของ SLA (ตามสเปกข้อ M8)", () => {
    const s = slaStatus({
      awaitingSinceMs: NOW - 45 * MIN,
      slaMinutes: 60,
      nowMs: NOW,
    });
    expect(s.usedRatio).toBeCloseTo(SLA_WARN_RATIO, 5);
    expect(s.state).toBe("warning");
    expect(s.tone).toBe("amber");
  });

  it("ก่อนถึง 75% ยังเป็น ok", () => {
    const s = slaStatus({
      awaitingSinceMs: NOW - 44 * MIN,
      slaMinutes: 60,
      nowMs: NOW,
    });
    expect(s.state).toBe("ok");
  });

  it("เลยกำหนดแล้ว = แดง พร้อมบอกว่าเลยมานานแค่ไหน", () => {
    const s = slaStatus({
      awaitingSinceMs: NOW - 90 * MIN,
      slaMinutes: 60,
      nowMs: NOW,
    });
    expect(s.state).toBe("breached");
    expect(s.tone).toBe("red");
    expect(s.th).toContain("30 นาที");
  });

  it("ตอบทันเวลา → ประเมินย้อนหลังว่าทัน", () => {
    const s = slaStatus({
      awaitingSinceMs: NOW - 60 * MIN,
      answeredAtMs: NOW - 30 * MIN,
      slaMinutes: 60,
      nowMs: NOW,
    });
    expect(s.state).toBe("answered");
    expect(s.tone).toBe("green");
    expect(s.th).toContain("ทัน");
  });

  it("ตอบช้า → บอกว่าช้าไปเท่าไหร่", () => {
    const s = slaStatus({
      awaitingSinceMs: NOW - 120 * MIN,
      answeredAtMs: NOW - 30 * MIN,
      slaMinutes: 60,
      nowMs: NOW,
    });
    expect(s.state).toBe("answered");
    expect(s.tone).toBe("red");
    expect(s.th).toContain("ช้าไป 30 นาที");
  });

  it("SLA ต่างกันตามแพ็กเกจ ให้ผลต่างกันที่เวลาเดียวกัน", () => {
    const awaiting = NOW - 45 * MIN;
    expect(
      slaStatus({ awaitingSinceMs: awaiting, slaMinutes: 30, nowMs: NOW }).state,
    ).toBe("breached");
    expect(
      slaStatus({ awaitingSinceMs: awaiting, slaMinutes: 60, nowMs: NOW }).state,
    ).toBe("warning");
    expect(
      slaStatus({ awaitingSinceMs: awaiting, slaMinutes: 240, nowMs: NOW }).state,
    ).toBe("ok");
  });

  it("ทุกสถานะมีข้อความไทย", () => {
    const cases = [
      { awaitingSinceMs: null, slaMinutes: 60, nowMs: NOW },
      { awaitingSinceMs: NOW - MIN, slaMinutes: 60, nowMs: NOW },
      { awaitingSinceMs: NOW - 50 * MIN, slaMinutes: 60, nowMs: NOW },
      { awaitingSinceMs: NOW - 99 * MIN, slaMinutes: 60, nowMs: NOW },
    ];
    for (const c of cases) expect(slaStatus(c).th).toMatch(/[ก-๙]/);
  });
});

describe("prioritizeQueue — หัวใจของ Today View", () => {
  function conv(
    id: string,
    minutesAgo: number,
    slaMinutes: number,
  ): ConversationForQueue {
    return {
      conversationId: id,
      pageId: "p1",
      awaitingSinceMs: NOW - minutesAgo * MIN,
      slaMinutes,
      unread: 1,
    };
  }

  it("ลูกค้า SLA สั้นที่ทักทีหลัง ต้องได้ตอบก่อนลูกค้า SLA ยาวที่ทักก่อน", () => {
    const q = prioritizeQueue(
      [
        // ทักมา 60 นาทีแล้ว แต่ SLA 4 ชม. → เหลือ 180 นาที
        conv("starter", 60, 240),
        // ทักมา 10 นาที SLA 30 นาที → เหลือ 20 นาที
        conv("full", 10, 30),
      ],
      NOW,
    );
    expect(q[0]!.conversationId).toBe("full");
  });

  it("ที่เลยกำหนดแล้วขึ้นก่อนเสมอ และเรียงตามที่เลยมานานสุด", () => {
    const q = prioritizeQueue(
      [
        conv("ok", 5, 60),
        conv("late-a", 90, 60), // เลยมา 30 นาที
        conv("late-b", 180, 60), // เลยมา 120 นาที
      ],
      NOW,
    );
    expect(q.map((x) => x.conversationId)).toEqual(["late-b", "late-a", "ok"]);
  });

  it("บทสนทนาที่ตอบครบแล้วไม่อยู่ในคิว", () => {
    const q = prioritizeQueue(
      [
        {
          conversationId: "done",
          pageId: "p1",
          awaitingSinceMs: null,
          slaMinutes: 60,
          unread: 0,
        },
        conv("waiting", 5, 60),
      ],
      NOW,
    );
    expect(q).toHaveLength(1);
    expect(q[0]!.conversationId).toBe("waiting");
  });

  it("คิวว่างได้ไม่พัง", () => {
    expect(prioritizeQueue([], NOW)).toEqual([]);
  });

  it("รวมทุกเพจไว้ในคิวเดียว (มุมมอง cross-page ตามสเปก)", () => {
    const q = prioritizeQueue(
      [
        { ...conv("a", 5, 60), pageId: "p1" },
        { ...conv("b", 50, 60), pageId: "p2" },
      ],
      NOW,
    );
    expect(q.map((x) => x.pageId)).toEqual(["p2", "p1"]);
  });
});

describe("summarizeQueue — Today View", () => {
  function q(states: Array<[number, number]>) {
    return prioritizeQueue(
      states.map(([minutesAgo, sla], i) => ({
        conversationId: `c${i}`,
        pageId: "p1",
        awaitingSinceMs: NOW - minutesAgo * MIN,
        slaMinutes: sla,
        unread: 1,
      })),
      NOW,
    );
  }

  it("ตอบครบแล้ว", () => {
    const s = summarizeQueue([]);
    expect(s.total).toBe(0);
    expect(s.th).toContain("ตอบครบ");
  });

  it("มีที่เลยกำหนด → เตือนเป็นอันดับแรก", () => {
    const s = summarizeQueue(q([[90, 60], [5, 60]]));
    expect(s.breached).toBe(1);
    expect(s.th).toContain("เลยเวลา");
  });

  it("มีแต่ที่ใกล้ครบเวลา", () => {
    const s = summarizeQueue(q([[50, 60], [5, 60]]));
    expect(s.warning).toBe(1);
    expect(s.ok).toBe(1);
    expect(s.th).toContain("ใกล้ครบเวลา");
  });

  it("ทุกอันยังมีเวลาเหลือ", () => {
    const s = summarizeQueue(q([[5, 60], [10, 60]]));
    expect(s.ok).toBe(2);
    expect(s.th).toContain("ยังอยู่ในเวลา");
  });

  it("ทุกข้อความสรุปเป็นภาษาไทย", () => {
    for (const cases of [[], q([[90, 60]]), q([[50, 60]]), q([[5, 60]])]) {
      expect(summarizeQueue(cases).th).toMatch(/[ก-๙]/);
    }
  });
});
