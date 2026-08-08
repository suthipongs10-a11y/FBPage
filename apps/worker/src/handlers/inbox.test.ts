import { describe, expect, it } from "vitest";
import { nullLogger } from "@page-os/core";
import type { InboxEvent, ProcessedEvent, WebhookProcessor } from "@page-os/inbox";
import { encodeWebhookEventJob, JobPayloadError } from "@page-os/queue";
import type { JobContext } from "../router.js";
import { inboxHandler } from "./inbox.js";

const ctx: JobContext = {
  nowMs: 1_700_000_000_000,
  logger: nullLogger,
  jobId: "j1",
  attemptsMade: 0,
};

const message: InboxEvent = {
  type: "message",
  channel: "messenger",
  pageId: "111222333",
  timestampMs: ctx.nowMs,
  mid: "m_1",
  senderId: "u1",
  recipientId: "111222333",
  contactId: "u1",
  text: "สนใจเมนูใหม่ค่ะ",
  attachments: [],
  isEcho: false,
};

const comment: InboxEvent = {
  type: "comment",
  channel: "comment",
  pageId: "111222333",
  timestampMs: ctx.nowMs,
  commentId: "c_1",
  authorId: "u1",
  message: "ราคาเท่าไหร่คะ",
  isFromPage: false,
  verb: "add",
};

function job(event: InboxEvent, key: string): unknown {
  return encodeWebhookEventJob({
    key,
    event,
    receivedAtMs: ctx.nowMs,
    deliveryId: "d1",
  });
}

function processorReturning(result: ProcessedEvent): WebhookProcessor {
  return {
    processAll: async () => [result],
  } as unknown as WebhookProcessor;
}

describe("ตัวจัดการ event จาก inbox", () => {
  it("ส่ง event เข้าไปให้ processor แล้วรายงานผล", async () => {
    let seen: readonly InboxEvent[] = [];
    const processor = {
      processAll: async (events: readonly InboxEvent[]) => {
        seen = events;
        return [
          {
            key: "msg:m_1",
            type: "message" as const,
            botShouldRespond: true,
            conversationId: "conv1",
            th: "รับข้อความแล้ว",
          },
        ];
      },
    } as unknown as WebhookProcessor;

    const out = await inboxHandler({ processor }).run(job(message, "msg:m_1"), ctx);
    expect(seen).toEqual([message]);
    expect(out.th).toBe("รับข้อความแล้ว");
    expect(out.details).toMatchObject({ type: "message", botShouldRespond: true });
  });

  /**
   * เทสต์ที่สำคัญที่สุดในไฟล์นี้
   *
   * `processAll()` กลืน error ของ event แต่ละใบโดยตั้งใจ เพราะออกแบบไว้ให้รับ
   * หลาย event ต่อ request แล้วใบหนึ่งพังต้องไม่ทำให้ใบที่เหลือไม่ได้ทำ
   *
   * แต่ที่นี่หนึ่งงาน = หนึ่ง event ถ้ายังกลืนต่อ งานจะขึ้นว่า "สำเร็จ"
   * ทั้งที่ข้อความลูกค้าหายไปแล้วไม่มีใครรู้
   */
  it("event ที่ประมวลผลไม่สำเร็จ → โยน error ไม่ใช่ขึ้นว่าสำเร็จ", async () => {
    const processor = processorReturning({
      key: "msg:m_1",
      type: "message",
      skipped: "error",
      th: "ประมวลผล event นี้ไม่สำเร็จ — ดู log ประกอบ",
    });
    await expect(
      inboxHandler({ processor }).run(job(message, "msg:m_1"), ctx),
    ).rejects.toThrow(/ไม่สำเร็จ/);
  });

  /** ข้ามเพราะเหตุผลปกติ (เคยเห็นแล้ว / เป็น echo) ไม่ใช่ความผิดพลาด */
  it("event ที่ข้ามด้วยเหตุผลปกติ → ถือว่าสำเร็จ", async () => {
    const processor = processorReturning({
      key: "msg:m_1",
      type: "message",
      skipped: "duplicate",
      th: "เคยประมวลผล event นี้แล้ว",
    });
    const out = await inboxHandler({ processor }).run(job(message, "msg:m_1"), ctx);
    expect(out.details).toMatchObject({ skipped: "duplicate" });
  });

  it("คอมเมนต์ → ส่งต่อให้คิว moderation", async () => {
    const forwarded: Array<{ commentId: string; pageId: string }> = [];
    const processor = processorReturning({
      key: "comment:c_1:add",
      type: "comment",
      th: "รับคอมเมนต์แล้ว",
    });

    await inboxHandler({
      processor,
      onComment: async (a) => {
        forwarded.push(a);
      },
    }).run(job(comment, "comment:c_1:add"), ctx);

    expect(forwarded).toEqual([{ commentId: "c_1", pageId: "111222333" }]);
  });

  it("ข้อความธรรมดาไม่ถูกส่งต่อให้คิว moderation", async () => {
    let called = 0;
    const processor = processorReturning({
      key: "msg:m_1",
      type: "message",
      th: "รับข้อความแล้ว",
    });
    await inboxHandler({
      processor,
      onComment: async () => {
        called++;
      },
    }).run(job(message, "msg:m_1"), ctx);
    expect(called).toBe(0);
  });

  it("งานรูปร่างผิด → ล้มก่อนแตะ processor", async () => {
    let called = 0;
    const processor = {
      processAll: async () => {
        called++;
        return [];
      },
    } as unknown as WebhookProcessor;

    await expect(
      inboxHandler({ processor }).run({ v: 1, key: "k" }, ctx),
    ).rejects.toThrow(JobPayloadError);
    expect(called).toBe(0);
  });

  it("processor ไม่คืนผลลัพธ์เลย → ดังทันที ไม่ใช่เงียบ", async () => {
    const processor = { processAll: async () => [] } as unknown as WebhookProcessor;
    await expect(
      inboxHandler({ processor }).run(job(message, "msg:m_1"), ctx),
    ).rejects.toThrow(/ไม่ได้ผลลัพธ์/);
  });
});
