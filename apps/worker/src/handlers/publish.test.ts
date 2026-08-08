import { describe, expect, it, vi } from "vitest";
import { nullLogger } from "@page-os/core";
import type { PublishJob, PublishOutcome, PublishScheduler, PublishWorker } from "@page-os/publish";
import { encodePublishJob, JobPayloadError } from "@page-os/queue";
import type { JobContext } from "../router.js";
import { publishHandler } from "./publish.js";

const ctx: JobContext = {
  nowMs: 1_700_000_000_000,
  logger: nullLogger,
  jobId: "j1",
  attemptsMade: 0,
};

interface Harness {
  processed: PublishJob[];
  retries: Array<{ job: PublishJob; delayMs: number }>;
  handler: ReturnType<typeof publishHandler>;
}

function harness(outcome: PublishOutcome): Harness {
  const processed: PublishJob[] = [];
  const retries: Array<{ job: PublishJob; delayMs: number }> = [];

  const worker = {
    process: async (job: PublishJob) => {
      processed.push(job);
      return outcome;
    },
  } as unknown as PublishWorker;

  const scheduler = {
    scheduleRetry: async (job: PublishJob, delayMs: number) => {
      retries.push({ job, delayMs });
    },
  } as unknown as PublishScheduler;

  return { processed, retries, handler: publishHandler({ worker, scheduler }) };
}

const job = encodePublishJob({ postId: "post1", pageId: "1234567890", attempt: 1 });

describe("ตัวจัดการงานโพสต์", () => {
  it("ส่ง postId/pageId/attempt จากงานไปให้ตัวยิงตรงๆ", async () => {
    const h = harness({ kind: "published", fbPostId: "fb_1", th: "โพสต์ขึ้นแล้ว" });
    const out = await h.handler.run(job, ctx);
    expect(h.processed).toEqual([{ postId: "post1", pageId: "1234567890", attempt: 1 }]);
    expect(out.details).toMatchObject({ fbPostId: "fb_1" });
  });

  /**
   * เทสต์ที่สำคัญที่สุดในไฟล์นี้
   *
   * `PublishWorker.process()` บอกว่า "จะลองใหม่ใน 1 นาที" แต่มันไม่ได้ใส่งาน
   * กลับเข้าคิวให้ ถ้าตรงนี้ลืมทำต่อ โพสต์ที่ล้มเหลวจะไม่ถูกลองใหม่เลย
   * โดยที่ทุกอย่างขึ้นว่าสำเร็จหมด — ไม่มี error ให้เห็นที่ไหนเลย
   */
  it("ผลลัพธ์เป็น retry → ต้องใส่งานกลับเข้าคิวด้วยรอบถัดไปและเวลาที่บอกมา", async () => {
    const h = harness({
      kind: "retry",
      delayMs: 60_000,
      nextAttempt: 2,
      th: "Meta ล่ม จะลองใหม่",
    });
    await h.handler.run(job, ctx);
    expect(h.retries).toEqual([
      { job: { postId: "post1", pageId: "1234567890", attempt: 2 }, delayMs: 60_000 },
    ]);
  });

  /**
   * "เลิกลองแล้ว" เป็นการตัดสินใจที่ถูกต้องของโดเมน ไม่ใช่ความผิดพลาดของงาน
   * ถ้าโยน error ออกไป กลไก retry/stalled ของ BullMQ อาจหยิบไปทำใหม่
   * ซึ่งจะขัดกับตัวตัดสิน retry ของโดเมนที่บอกว่าพอแล้ว
   */
  it("ผลลัพธ์เป็น failed → ไม่โยน error และไม่ใส่งานกลับเข้าคิว", async () => {
    const h = harness({ kind: "failed", th: "token หมดอายุ", needsAlert: true });
    const out = await h.handler.run(job, ctx);
    expect(out.th).toBe("token หมดอายุ");
    expect(h.retries).toEqual([]);
  });

  it("ผลลัพธ์เป็น skipped → คืนเหตุผลออกมาให้เห็นใน log", async () => {
    const h = harness({
      kind: "skipped",
      reason: "already_published",
      th: "โพสต์ไปแล้ว",
    });
    const out = await h.handler.run(job, ctx);
    expect(out.details).toMatchObject({ reason: "already_published" });
    expect(h.retries).toEqual([]);
  });

  /**
   * งานรูปร่างผิดต้องล้มตั้งแต่ก่อนแตะ Meta — ไม่ใช่ไปพังกลางทางหลังยิงไปแล้ว
   */
  it("งานรูปร่างผิด → ล้มก่อนเรียกตัวยิงโพสต์", async () => {
    const h = harness({ kind: "published", fbPostId: "x", th: "" });
    await expect(h.handler.run({ v: 1, postId: "p" }, ctx)).rejects.toThrow(
      JobPayloadError,
    );
    expect(h.processed).toEqual([]);
  });

  it("งานจากเวอร์ชันก่อน → ล้มก่อนเรียกตัวยิงโพสต์", async () => {
    const h = harness({ kind: "published", fbPostId: "x", th: "" });
    await expect(
      h.handler.run({ v: 0, postId: "p", pageId: "g", attempt: 1 }, ctx),
    ).rejects.toThrow(JobPayloadError);
    expect(h.processed).toEqual([]);
  });

  it("ตัวยิงโพสต์โยน error → ทะลุออกไปให้ BullMQ นับเป็นงานล้มเหลว", async () => {
    const worker = {
      process: vi.fn().mockRejectedValue(new Error("DB ล่ม")),
    } as unknown as PublishWorker;
    const scheduler = { scheduleRetry: vi.fn() } as unknown as PublishScheduler;
    const handler = publishHandler({ worker, scheduler });
    await expect(handler.run(job, ctx)).rejects.toThrow("DB ล่ม");
  });
});
