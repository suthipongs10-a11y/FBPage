import { describe, expect, it } from "vitest";
import {
  countByFilter,
  filterLabelTh,
  queryInbox,
  type InboxFilter,
  type InboxItem,
} from "./filters.js";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;

function item(over: Partial<InboxItem> = {}): InboxItem {
  return {
    conversationId: "c1",
    pageId: "p1",
    pageName: "ร้านกาแฟ",
    contactName: "สมชาย",
    channel: "messenger",
    lastMessagePreview: "สนใจค่ะ",
    lastMessageAtMs: NOW - 5 * MIN,
    lastCustomerMessageAtMs: NOW - 5 * MIN,
    awaitingSinceMs: NOW - 5 * MIN,
    slaMinutes: 60,
    unread: 1,
    lastReplyBy: null,
    escalated: false,
    reviewedByHuman: false,
    assignedTo: null,
    tags: [],
    ...over,
  };
}

describe("ตัวกรองตามที่สเปกข้อ M1 สั่ง", () => {
  it("ยังไม่ตอบ — ไม่มีใครตอบเลย", () => {
    const r = queryInbox(
      [
        item({ conversationId: "new", lastReplyBy: null }),
        item({ conversationId: "bot-answered", lastReplyBy: "bot" }),
        item({ conversationId: "human-answered", lastReplyBy: "human" }),
      ],
      { filter: "unanswered" },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["new"]);
  });

  it("บอทตอบแล้วแต่ยังไม่มีคนตรวจ", () => {
    const r = queryInbox(
      [
        item({ conversationId: "needs-review", lastReplyBy: "bot", reviewedByHuman: false }),
        item({ conversationId: "reviewed", lastReplyBy: "bot", reviewedByHuman: true }),
        item({ conversationId: "human", lastReplyBy: "human" }),
      ],
      { filter: "bot_replied_needs_review" },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["needs-review"]);
  });

  it("บอทส่งต่อให้คน", () => {
    const r = queryInbox(
      [item({ conversationId: "esc", escalated: true }), item({ conversationId: "normal" })],
      { filter: "escalated" },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["esc"]);
  });

  it("เกิน SLA", () => {
    const r = queryInbox(
      [
        item({ conversationId: "late", awaitingSinceMs: NOW - 90 * MIN }),
        item({ conversationId: "ok", awaitingSinceMs: NOW - 5 * MIN }),
      ],
      { filter: "sla_breached" },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["late"]);
  });

  it("ใกล้หมดหน้าต่าง 24 ชม.", () => {
    const r = queryInbox(
      [
        item({
          conversationId: "closing",
          lastCustomerMessageAtMs: NOW - 22 * HOUR,
        }),
        item({ conversationId: "fresh", lastCustomerMessageAtMs: NOW - HOUR }),
        item({
          conversationId: "closed",
          lastCustomerMessageAtMs: NOW - 30 * HOUR,
        }),
      ],
      { filter: "window_closing" },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["closing"]);
  });

  it("ทุกตัวกรองมีป้ายไทย", () => {
    const all: InboxFilter[] = [
      "all",
      "unanswered",
      "bot_replied_needs_review",
      "escalated",
      "sla_breached",
      "window_closing",
    ];
    for (const f of all) expect(filterLabelTh(f), f).toMatch(/[ก-๙]/);
  });
});

describe("มุมมอง cross-page เป็นค่าเริ่มต้น (ตามสเปกข้อ 1)", () => {
  it("ไม่ระบุเพจ = เห็นทุกเพจ", () => {
    const r = queryInbox(
      [item({ conversationId: "a", pageId: "p1" }), item({ conversationId: "b", pageId: "p2" })],
      {},
      NOW,
    );
    expect(r).toHaveLength(2);
  });

  it("กรองเฉพาะบางเพจได้", () => {
    const r = queryInbox(
      [item({ conversationId: "a", pageId: "p1" }), item({ conversationId: "b", pageId: "p2" })],
      { pageIds: ["p2"] },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["b"]);
  });
});

describe("เรียงตามความเร่งด่วน ไม่ใช่เวลาล่าสุด", () => {
  it("เลย SLA ขึ้นก่อน แม้ข้อความจะเก่ากว่า", () => {
    const r = queryInbox(
      [
        item({
          conversationId: "recent-ok",
          awaitingSinceMs: NOW - MIN,
          lastMessageAtMs: NOW,
        }),
        item({
          conversationId: "old-breached",
          awaitingSinceMs: NOW - 5 * HOUR,
          lastMessageAtMs: NOW - 5 * HOUR,
        }),
      ],
      {},
      NOW,
    );
    expect(r[0]!.conversationId).toBe("old-breached");
  });

  it("ลูกค้า SLA สั้นที่ทักทีหลังขึ้นก่อน", () => {
    const r = queryInbox(
      [
        item({ conversationId: "starter", awaitingSinceMs: NOW - 60 * MIN, slaMinutes: 240 }),
        item({ conversationId: "full", awaitingSinceMs: NOW - 10 * MIN, slaMinutes: 30 }),
      ],
      {},
      NOW,
    );
    expect(r[0]!.conversationId).toBe("full");
  });

  it("ที่ตอบครบแล้วอยู่ท้ายสุด", () => {
    const r = queryInbox(
      [
        item({ conversationId: "done", awaitingSinceMs: null }),
        item({ conversationId: "waiting", awaitingSinceMs: NOW - MIN }),
      ],
      {},
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["waiting", "done"]);
  });
});

describe("ค้นหาและ tag", () => {
  it("ค้นจากชื่อผู้ติดต่อ", () => {
    const r = queryInbox(
      [
        item({ conversationId: "a", contactName: "สมชาย ใจดี" }),
        item({ conversationId: "b", contactName: "สมหญิง" }),
      ],
      { search: "สมชาย" },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["a"]);
  });

  it("ค้นจากข้อความล่าสุด", () => {
    const r = queryInbox(
      [
        item({ conversationId: "a", lastMessagePreview: "ขอราคาส่งด่วน" }),
        item({ conversationId: "b", lastMessagePreview: "สวัสดีค่ะ" }),
      ],
      { search: "ราคา" },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["a"]);
  });

  it("กรองตาม tag ผู้ติดต่อ", () => {
    const r = queryInbox(
      [
        item({ conversationId: "a", tags: ["สนใจ"] }),
        item({ conversationId: "b", tags: ["สแปม"] }),
      ],
      { tags: ["สนใจ"] },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["a"]);
  });

  it("กรองตามผู้รับผิดชอบ", () => {
    const r = queryInbox(
      [
        item({ conversationId: "mine", assignedTo: "admin1" }),
        item({ conversationId: "unassigned", assignedTo: null }),
      ],
      { assignedTo: "admin1" },
      NOW,
    );
    expect(r.map((x) => x.conversationId)).toEqual(["mine"]);
  });

  it("ค้นด้วยคำว่างไม่กรองอะไร", () => {
    expect(queryInbox([item()], { search: "   " }, NOW)).toHaveLength(1);
  });
});

describe("countByFilter — ตัวเลขบน chip และ Today View", () => {
  it("นับแต่ละตัวกรองถูกต้อง", () => {
    const c = countByFilter(
      [
        item({ conversationId: "a", awaitingSinceMs: NOW - 90 * MIN }),
        item({ conversationId: "b", escalated: true }),
        item({ conversationId: "c", lastReplyBy: "bot" }),
        item({ conversationId: "d" }),
      ],
      NOW,
    );
    expect(c.all).toBe(4);
    expect(c.sla_breached).toBe(1);
    expect(c.escalated).toBe(1);
    expect(c.bot_replied_needs_review).toBe(1);
  });

  it("ไม่มีอะไรค้าง → บอกว่าตอบครบแล้ว", () => {
    const c = countByFilter([item({ awaitingSinceMs: null, lastReplyBy: "human" })], NOW);
    expect(c.th).toContain("ตอบครบ");
  });

  it("สรุปเป็นภาษาไทยเรียงตามความเร่งด่วน", () => {
    const c = countByFilter(
      [item({ awaitingSinceMs: NOW - 90 * MIN }), item({ conversationId: "b", escalated: true })],
      NOW,
    );
    expect(c.th).toMatch(/[ก-๙]/);
    expect(c.th.indexOf("เกินเวลา")).toBeLessThan(c.th.indexOf("บอทส่งต่อ"));
  });

  it("รายการว่างไม่พัง", () => {
    expect(countByFilter([], NOW).all).toBe(0);
  });
});

describe("decorate ติด chip ให้ทุกรายการ", () => {
  it("รายการหนึ่งตรงหลายตัวกรองได้", () => {
    const r = queryInbox(
      [item({ awaitingSinceMs: NOW - 90 * MIN, escalated: true })],
      {},
      NOW,
    );
    expect(r[0]!.matches).toContain("sla_breached");
    expect(r[0]!.matches).toContain("escalated");
    expect(r[0]!.matches).toContain("unanswered");
  });

  it("มีข้อมูล SLA และหน้าต่าง 24 ชม. ให้ UI ใช้ได้เลย", () => {
    const r = queryInbox([item()], {}, NOW);
    expect(r[0]!.sla.tone).toBeTruthy();
    expect(r[0]!.window.badgeTh).toContain("⏰");
  });
});
