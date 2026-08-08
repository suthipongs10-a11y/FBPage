import { describe, expect, it } from "vitest";
import {
  WEBHOOK_CRITICAL_MS,
  WEBHOOK_SILENT_MS,
  collectProblems,
  isTokenDead,
  type PageHealthSnapshot,
} from "./problems.js";

const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);
const MIN = 60_000;
const HOUR = 3_600_000;

function page(over: Partial<PageHealthSnapshot> = {}): PageHealthSnapshot {
  return {
    pageId: "p1",
    pageName: "ครัวคุณยาย",
    clientName: "ครัวคุณยาย",
    connectionState: "ok",
    lastWebhookAtMs: NOW - MIN,
    ...over,
  };
}

describe("token", () => {
  it("หมดอายุ = รุนแรง เพราะเพจหยุดทำงานทั้งหมด", () => {
    const p = collectProblems({ pages: [page({ connectionState: "expired" })], nowMs: NOW });
    expect(p[0]!.severity).toBe("critical");
    expect(p[0]!.kind).toBe("token");
    expect(p[0]!.th).toMatch(/ให้ลูกค้ากดเชื่อมใหม่/);
  });

  it("ใกล้หมดอายุ = เตือน พร้อมบอกว่าเหลือกี่วัน", () => {
    const p = collectProblems({
      pages: [page({ connectionState: "expiring_soon", hoursUntilExpiry: 96 })],
      nowMs: NOW,
    });
    expect(p[0]!.severity).toBe("warning");
    expect(p[0]!.th).toMatch(/เหลือ 4 วัน/);
  });

  it("ปกติ = ไม่มีปัญหา", () => {
    expect(collectProblems({ pages: [page()], nowMs: NOW })).toEqual([]);
  });
});

describe("webhook", () => {
  it("เงียบเกินเกณฑ์ → เตือน พร้อมบอกผลที่กำลังเกิด", () => {
    const p = collectProblems({
      pages: [page({ lastWebhookAtMs: NOW - WEBHOOK_SILENT_MS - MIN })],
      nowMs: NOW,
    });
    expect(p[0]!.kind).toBe("webhook");
    expect(p[0]!.th).toMatch(/ตกหล่น/);
  });

  it("เงียบนานมาก → ยกระดับเป็นรุนแรง", () => {
    const p = collectProblems({
      pages: [page({ lastWebhookAtMs: NOW - WEBHOOK_CRITICAL_MS - MIN })],
      nowMs: NOW,
    });
    expect(p[0]!.severity).toBe("critical");
  });

  it("ยังไม่ถึงเกณฑ์ → ไม่เตือน", () => {
    const p = collectProblems({
      pages: [page({ lastWebhookAtMs: NOW - WEBHOOK_SILENT_MS + MIN })],
      nowMs: NOW,
    });
    expect(p).toEqual([]);
  });

  it("ไม่เคยได้รับเลย → บอกให้ไปตรวจ subscribe", () => {
    const p = collectProblems({ pages: [page({ lastWebhookAtMs: null })], nowMs: NOW });
    expect(p[0]!.th).toMatch(/subscribe/);
  });

  it("token ตายแล้ว ไม่รายงาน webhook ซ้ำ — เป็นผลของเรื่องเดียวกัน", () => {
    const p = collectProblems({
      pages: [
        page({ connectionState: "expired", lastWebhookAtMs: NOW - 10 * HOUR }),
      ],
      nowMs: NOW,
    });
    expect(p).toHaveLength(1);
    expect(p[0]!.kind).toBe("token");
  });
});

describe("โพสต์ที่ล้มเหลว", () => {
  it("หลายโพสต์ของเพจเดียวกัน รวมเป็นบรรทัดเดียว", () => {
    const p = collectProblems({
      pages: [page()],
      failedPosts: [
        { postId: "a", pageId: "p1", failedAttempts: 1, lastErrorTh: "เน็ตหลุด" },
        { postId: "b", pageId: "p1", failedAttempts: 1, lastErrorTh: "เน็ตหลุด" },
        { postId: "c", pageId: "p1", failedAttempts: 1, lastErrorTh: "เน็ตหลุด" },
      ],
      nowMs: NOW,
    });
    const publish = p.filter((x) => x.kind === "publish");
    expect(publish).toHaveLength(1);
    expect(publish[0]!.th).toMatch(/3 โพสต์/);
  });

  it("ล้มครบ 3 ครั้ง = รุนแรง และบอกว่าหยุด retry แล้ว", () => {
    const p = collectProblems({
      pages: [page()],
      failedPosts: [
        { postId: "a", pageId: "p1", failedAttempts: 3, lastErrorTh: "รูปใหญ่ไป" },
      ],
      nowMs: NOW,
    });
    expect(p[0]!.severity).toBe("critical");
    expect(p[0]!.th).toMatch(/หยุด retry/);
  });

  it("แยกบรรทัดตามเพจ ไม่ยุบข้ามเพจ", () => {
    const p = collectProblems({
      pages: [page(), page({ pageId: "p2", pageName: "เพจสอง" })],
      failedPosts: [
        { postId: "a", pageId: "p1", failedAttempts: 1 },
        { postId: "b", pageId: "p2", failedAttempts: 1 },
      ],
      nowMs: NOW,
    });
    expect(p.filter((x) => x.kind === "publish")).toHaveLength(2);
  });

  it("โพสต์ของเพจที่ไม่รู้จัก ยังรายงานได้ ไม่ระเบิด", () => {
    const p = collectProblems({
      pages: [],
      failedPosts: [{ postId: "a", pageId: "ไม่รู้จัก", failedAttempts: 1 }],
      nowMs: NOW,
    });
    expect(p).toHaveLength(1);
    expect(p[0]!.clientName).toBe("ไม่ทราบลูกค้า");
  });
});

describe("การเรียงลำดับ", () => {
  it("เรื่องรุนแรงขึ้นก่อนเสมอ", () => {
    const p = collectProblems({
      pages: [
        page({ pageId: "p1", connectionState: "expiring_soon", hoursUntilExpiry: 48 }),
        page({
          pageId: "p2",
          clientName: "ลูกค้า ข",
          connectionState: "revoked",
        }),
      ],
      nowMs: NOW,
    });
    expect(p[0]!.severity).toBe("critical");
    expect(p[0]!.pageId).toBe("p2");
  });

  it("คีย์ของปัญหาคงที่ตลอดอายุ — Alert Center ใช้กันเตือนซ้ำ", () => {
    const args = { pages: [page({ connectionState: "expired" as const })], nowMs: NOW };
    const a = collectProblems(args);
    const b = collectProblems({ ...args, nowMs: NOW + HOUR });
    expect(a[0]!.id).toBe(b[0]!.id);
  });
});

describe("isTokenDead", () => {
  it("สถานะที่ใช้งานไม่ได้", () => {
    expect(isTokenDead("expired")).toBe(true);
    expect(isTokenDead("revoked")).toBe(true);
    expect(isTokenDead("no_token")).toBe(true);
  });

  it("สถานะที่ยังใช้ได้", () => {
    expect(isTokenDead("ok")).toBe(false);
    expect(isTokenDead("expiring_soon")).toBe(false);
    expect(isTokenDead("missing_permissions")).toBe(false);
  });
});
