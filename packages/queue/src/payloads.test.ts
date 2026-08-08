import { describe, expect, it } from "vitest";
import type { CommentEvent, InboxEvent } from "@page-os/inbox";
import {
  decodeAnalyticsJob,
  decodeModerationJob,
  decodePublishJob,
  decodeSweepJob,
  decodeWebhookEventJob,
  encodeAnalyticsJob,
  encodeModerationJob,
  encodePublishJob,
  encodeSweepJob,
  encodeWebhookEventJob,
  JobPayloadError,
  JOB_SCHEMA_VERSION,
} from "./payloads.js";

const message: InboxEvent = {
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
};

const comment: CommentEvent = {
  type: "comment",
  channel: "comment",
  pageId: "p1",
  timestampMs: 1,
  commentId: "c_1",
  authorId: "u1",
  message: "สนใจค่ะ",
  isFromPage: false,
  verb: "add",
};

/** งานเดินทางผ่าน Redis เป็น JSON — เทสต์ต้องผ่านทางเดียวกัน ไม่ใช่ส่งอ็อบเจ็กต์ตรงๆ */
function roundTrip<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v));
}

function th(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof JobPayloadError) return err.th;
    throw err;
  }
  throw new Error("ไม่ได้โยน JobPayloadError อย่างที่คาด");
}

describe("webhook event job", () => {
  it("เข้ารหัสแล้วถอดกลับได้เหมือนเดิม", () => {
    const encoded = encodeWebhookEventJob({
      key: "msg:m_1",
      event: message,
      receivedAtMs: 1_700_000_000_000,
      deliveryId: "d1",
    });
    const back = decodeWebhookEventJob(roundTrip(encoded));
    expect(back.key).toBe("msg:m_1");
    expect(back.event.pageId).toBe("p1");
    expect(back.receivedAtMs).toBe(1_700_000_000_000);
  });

  /**
   * เคสจริงที่จะเกิดตอน deploy: ในคิวยังมีงานรูปแบบเก่าค้างอยู่
   * ต้องรู้ตัวตั้งแต่ปากทางพร้อมบอกว่าต้องทำอะไร ไม่ใช่ไปพังลึกๆ ข้างใน
   */
  it("งานจากรูปแบบเวอร์ชันก่อน → บอกว่าเป็นของค้างจากก่อน deploy", () => {
    const msg = th(() =>
      decodeWebhookEventJob({ v: 0, key: "k", event: message, receivedAtMs: 1, deliveryId: "d" }),
    );
    expect(msg).toContain("ก่อน deploy");
  });

  it("ไม่มี key กันซ้ำ → ปฏิเสธ (กฎข้อ 6 จะพังถ้าปล่อยผ่าน)", () => {
    expect(() =>
      decodeWebhookEventJob({
        v: JOB_SCHEMA_VERSION,
        event: message,
        receivedAtMs: 1,
        deliveryId: "d",
      }),
    ).toThrow(JobPayloadError);
  });

  it("event ชนิดที่ไม่รู้จัก → ปฏิเสธพร้อมบอกชนิดที่เจอ", () => {
    const msg = th(() =>
      decodeWebhookEventJob({
        v: JOB_SCHEMA_VERSION,
        key: "k",
        event: { ...message, type: "telepathy" },
        receivedAtMs: 1,
        deliveryId: "d",
      }),
    );
    expect(msg).toContain("telepathy");
  });

  it("event ไม่มี pageId → ปฏิเสธ", () => {
    const bad = { ...message } as Record<string, unknown>;
    delete bad["pageId"];
    expect(() =>
      decodeWebhookEventJob({
        v: JOB_SCHEMA_VERSION,
        key: "k",
        event: bad,
        receivedAtMs: 1,
        deliveryId: "d",
      }),
    ).toThrow(JobPayloadError);
  });

  it("ข้อมูลไม่ใช่อ็อบเจ็กต์ → ปฏิเสธ", () => {
    for (const v of [null, "x", 1, []]) {
      expect(() => decodeWebhookEventJob(v), String(v)).toThrow(JobPayloadError);
    }
  });
});

describe("publish job", () => {
  it("เข้ารหัสแล้วถอดกลับได้", () => {
    const back = decodePublishJob(
      roundTrip(encodePublishJob({ postId: "p1", pageId: "pg1", attempt: 1 })),
    );
    expect(back).toMatchObject({ postId: "p1", pageId: "pg1", attempt: 1 });
  });

  /**
   * `attempt` ไม่ใช่แค่ตัวเลขนับ — `PublishWorker` ใช้มันตัดสินว่าต้องไปเช็คก่อนไหม
   * ว่ารอบก่อนโพสต์ขึ้นไปแล้ว (ทำเฉพาะ attempt > 1) ถ้าปล่อยให้เป็น 0 หรือติดลบ
   * ผ่านเข้าไป การเช็คนั้นจะถูกข้าม แล้วโพสต์ซ้ำในเพจลูกค้า
   */
  it("attempt เป็น 0 → ปฏิเสธ", () => {
    expect(() =>
      decodePublishJob({ v: JOB_SCHEMA_VERSION, postId: "p", pageId: "g", attempt: 0 }),
    ).toThrow(JobPayloadError);
  });

  it("attempt เป็นทศนิยม → ปฏิเสธ", () => {
    expect(() =>
      decodePublishJob({ v: JOB_SCHEMA_VERSION, postId: "p", pageId: "g", attempt: 1.5 }),
    ).toThrow(JobPayloadError);
  });

  it("ไม่มี pageId → ปฏิเสธ (โพสต์ผิดเพจกู้คืนไม่ได้)", () => {
    expect(() =>
      decodePublishJob({ v: JOB_SCHEMA_VERSION, postId: "p", attempt: 1 }),
    ).toThrow(JobPayloadError);
  });
});

describe("moderation job", () => {
  it("เข้ารหัสแล้วถอดกลับได้", () => {
    const back = decodeModerationJob(
      roundTrip(encodeModerationJob({ comment, receivedAtMs: 5 })),
    );
    expect(back.comment.commentId).toBe("c_1");
    expect(back.receivedAtMs).toBe(5);
  });

  it("ไม่มี commentId → ปฏิเสธ (กันซ้ำใช้ commentId)", () => {
    const bad = { ...comment } as Record<string, unknown>;
    delete bad["commentId"];
    expect(() =>
      decodeModerationJob({ v: JOB_SCHEMA_VERSION, comment: bad, receivedAtMs: 1 }),
    ).toThrow(JobPayloadError);
  });
});

describe("analytics job", () => {
  it("ไม่ใส่ fromDate ก็ได้", () => {
    const back = decodeAnalyticsJob(roundTrip(encodeAnalyticsJob({ pageId: "p1" })));
    expect(back.pageId).toBe("p1");
    expect(back.fromDate).toBeUndefined();
  });

  it("fromDate รูปแบบถูก → ผ่าน", () => {
    const back = decodeAnalyticsJob(
      roundTrip(encodeAnalyticsJob({ pageId: "p1", fromDate: "2026-08-01" })),
    );
    expect(back.fromDate).toBe("2026-08-01");
  });

  it("fromDate รูปแบบผิด → ปฏิเสธพร้อมบอกรูปแบบที่ต้องการ", () => {
    const msg = th(() =>
      decodeAnalyticsJob({ v: JOB_SCHEMA_VERSION, pageId: "p1", fromDate: "1 ส.ค. 69" }),
    );
    expect(msg).toContain("YYYY-MM-DD");
  });
});

describe("sweep job (งานจาก cron)", () => {
  /**
   * งาน cron ใช้ template ใบเดียวสร้างงานทุกรอบ ข้อมูลข้างในจึงถูกแช่แข็ง
   * ไว้ตั้งแต่ตอนตั้งตาราง — ห้ามมีเวลาอยู่ในนั้น ไม่งั้นทุกรอบจะรายงานเวลาเดิม
   */
  it("ไม่มีฟิลด์เวลาอยู่ข้างใน", () => {
    const encoded = encodeSweepJob() as unknown as Record<string, unknown>;
    for (const key of Object.keys(encoded)) {
      expect(key).not.toMatch(/(at|ms|time|date)$/i);
    }
  });

  it("ถอดกลับได้", () => {
    expect(decodeSweepJob(roundTrip(encodeSweepJob())).kind).toBe("sweep");
  });

  it("เวอร์ชันไม่ตรง → ปฏิเสธ", () => {
    expect(() => decodeSweepJob({ v: 99, kind: "sweep" })).toThrow(JobPayloadError);
  });
});
