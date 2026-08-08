import { describe, expect, it } from "vitest";
import { idempotencyKey, type InboxEvent } from "@page-os/inbox";
import { publishJobKey } from "@page-os/publish";
import { toJobId } from "./job-id.js";

/**
 * กฎของ BullMQ ที่เราต้องไม่ละเมิด (ถอดมาจากซอร์สของมันตรงๆ):
 *   1. jobId ห้ามมี `:` เว้นแต่แยกแล้วได้ 3 ท่อนพอดี
 *   2. jobId ห้ามเป็นตัวเลขล้วน
 * ข้อ 1 ที่มีข้อยกเว้นแบบนั้นอันตรายมาก เพราะคีย์บางแบบของเราผ่านโดยบังเอิญ
 */
function assertBullMqAccepts(jobId: string): void {
  expect(jobId.includes(":"), `jobId "${jobId}" ยังมี : อยู่`).toBe(false);
  expect(`${parseInt(jobId, 10)}`).not.toBe(jobId);
  expect(jobId.length).toBeGreaterThan(0);
}

describe("toJobId", () => {
  it("ตัด : ออกหมด", () => {
    assertBullMqAccepts(toJobId("msg:m_1"));
    assertBullMqAccepts(toJobId("publish:p1:page1:retry:2"));
  });

  it("คีย์ที่ต่างกันแค่ : กับ - ต้องไม่กลายเป็น jobId เดียวกัน", () => {
    // ถ้าแทนที่ : เฉยๆ โดยไม่ต่อแฮช สองอันนี้จะชนกัน แล้วงานใบหนึ่งจะหายเงียบๆ
    expect(toJobId("a:b")).not.toBe(toJobId("a-b"));
  });

  it("คีย์เดิมได้ jobId เดิมเสมอ (ไม่งั้นกันซ้ำไม่ได้)", () => {
    expect(toJobId("msg:m_1")).toBe(toJobId("msg:m_1"));
  });

  it("ยังพออ่านออกว่ามาจากคีย์ไหน", () => {
    expect(toJobId("comment:c_1:add")).toContain("comment-c_1-add");
  });

  it("คีย์ตัวเลขล้วนก็ยังใช้ได้ (BullMQ ห้าม jobId เป็นตัวเลขล้วน)", () => {
    assertBullMqAccepts(toJobId("12345"));
  });

  it("คีย์ยาวมากก็ไม่ทำให้ jobId ยาวไม่จำกัด", () => {
    const id = toJobId("msg:" + "x".repeat(500));
    expect(id.length).toBeLessThanOrEqual(80 + 1 + 12);
  });

  it("คีย์ยาวที่ต่างกันตรงท้ายสุดยังได้ jobId ต่างกัน", () => {
    // ตัดให้สั้นเฉยๆ จะชนกัน — แฮชคือตัวที่ทำให้ไม่ชน
    const a = toJobId("msg:" + "x".repeat(200) + "A");
    const b = toJobId("msg:" + "x".repeat(200) + "B");
    expect(a).not.toBe(b);
  });

  it("ข้อความไทยในคีย์ไม่ทำให้พัง", () => {
    assertBullMqAccepts(toJobId("comment:คอมเมนต์:add"));
  });

  it("คีย์ว่าง → โยน error ไม่ใช่สร้าง jobId แปลกๆ", () => {
    expect(() => toJobId("")).toThrow();
  });
});

/**
 * เทสต์ชุดนี้คือตัวจับว่ามีคีย์แบบไหนของโดเมนที่ BullMQ จะไม่รับ
 * ถ้าวันหนึ่งมีคนเพิ่ม event ชนิดใหม่แล้วคีย์รูปแบบใหม่ ตรงนี้จะจับได้ทันที
 */
describe("คีย์จริงของโดเมนทุกแบบต้องผ่านกฎของ BullMQ", () => {
  const events: InboxEvent[] = [
    {
      type: "message",
      channel: "messenger",
      pageId: "p1",
      timestampMs: 1,
      mid: "m_1",
      senderId: "u1",
      recipientId: "p1",
      contactId: "u1",
      attachments: [],
      isEcho: false,
    },
    {
      type: "postback",
      channel: "messenger",
      pageId: "p1",
      timestampMs: 1,
      mid: "pb_1",
      senderId: "u1",
      payload: "MENU",
    },
    {
      type: "reaction",
      channel: "messenger",
      pageId: "p1",
      timestampMs: 1,
      senderId: "u1",
      targetMid: "m_1",
      action: "react",
    },
    {
      type: "comment",
      channel: "comment",
      pageId: "p1",
      timestampMs: 1,
      commentId: "c_1",
      authorId: "u1",
      message: "สนใจค่ะ",
      isFromPage: false,
      verb: "add",
    },
    {
      type: "rating",
      channel: "rating",
      pageId: "p1",
      timestampMs: 1,
      ratingId: "r_1",
      reviewerId: "u1",
      recommendation: "negative",
      verb: "add",
    },
  ];

  for (const ev of events) {
    it(`event ชนิด ${ev.type}`, () => {
      assertBullMqAccepts(toJobId(idempotencyKey(ev)));
    });
  }

  it("คีย์งานโพสต์รอบแรก", () => {
    assertBullMqAccepts(toJobId(publishJobKey("post1", "page1")));
  });

  it("คีย์งานโพสต์รอบ retry (คีย์นี้คือตัวที่ BullMQ ปฏิเสธถ้าไม่แปลง)", () => {
    const raw = `${publishJobKey("post1", "page1")}:retry:2`;
    expect(raw.split(":").length).toBe(5); // ยืนยันว่าเป็นรูปที่ BullMQ ไม่รับ
    assertBullMqAccepts(toJobId(raw));
  });
});
