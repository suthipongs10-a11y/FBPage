import { describe, expect, it } from "vitest";
import { FakeClock, nullLogger } from "@page-os/core";
import {
  PublishScheduler,
  localTimeToUtcMs,
  publishJobKey,
  utcMsToLocalText,
  type DuePostSource,
  type PublishQueue,
} from "./scheduler.js";
import type { PublishJob, ScheduledPost } from "./types.js";

const NOW = 1_700_000_000_000;

class MemQueue implements PublishQueue {
  readonly jobs: Array<{ job: PublishJob; delayMs: number; jobKey: string }> = [];
  readonly cancelled: string[] = [];
  async enqueue(a: {
    job: PublishJob;
    delayMs: number;
    jobKey: string;
  }): Promise<void> {
    // จำลองพฤติกรรม BullMQ: jobKey ซ้ำ = งานเดิม ไม่เพิ่มใหม่
    if (this.jobs.some((j) => j.jobKey === a.jobKey)) return;
    this.jobs.push(a);
  }
  async cancelForPost(postId: string): Promise<void> {
    this.cancelled.push(postId);
  }
}

class MemSource implements DuePostSource {
  readonly queued: string[] = [];
  constructor(
    private readonly due: Array<{
      post: ScheduledPost;
      targetPageIds: string[];
    }> = [],
  ) {}
  async findDue(): Promise<
    Array<{ post: ScheduledPost; targetPageIds: string[] }>
  > {
    return this.due;
  }
  async markQueued(postId: string): Promise<void> {
    this.queued.push(postId);
  }
}

function post(id: string): ScheduledPost {
  return {
    id,
    pageId: "p1",
    content: { type: "text", body: `เนื้อหา ${id}` },
    scheduledAtMs: NOW,
    status: "scheduled",
    contentHash: "h",
    approvalStatus: "approved",
  };
}

describe("PublishScheduler", () => {
  it("ยัดงานเข้าคิวทันทีเมื่อถึงเวลา (ไม่ใช้ scheduled_publish_time ของ Meta)", async () => {
    const queue = new MemQueue();
    const source = new MemSource([{ post: post("a"), targetPageIds: ["p1"] }]);
    const s = new PublishScheduler({
      queue,
      source,
      clock: new FakeClock(NOW),
      logger: nullLogger,
    });

    const r = await s.tick();

    expect(r).toEqual({ enqueued: 1, posts: 1 });
    expect(queue.jobs[0]!.job).toEqual({ postId: "a", pageId: "p1", attempt: 1 });
    expect(queue.jobs[0]!.delayMs).toBe(0);
    expect(source.queued).toEqual(["a"]);
  });

  it("cross-post สร้างงานแยกต่อเพจ — เพจหนึ่งพังไม่กระทบเพจอื่น", async () => {
    const queue = new MemQueue();
    const s = new PublishScheduler({
      queue,
      source: new MemSource([
        { post: post("a"), targetPageIds: ["p1", "p2", "p3"] },
      ]),
      clock: new FakeClock(NOW),
      logger: nullLogger,
    });

    const r = await s.tick();

    expect(r.enqueued).toBe(3);
    expect(queue.jobs.map((j) => j.job.pageId)).toEqual(["p1", "p2", "p3"]);
    expect(new Set(queue.jobs.map((j) => j.jobKey)).size).toBe(3);
  });

  it("tick ซ้ำด้วยโพสต์เดิมไม่สร้างงานซ้ำ (jobKey แน่นอน)", async () => {
    const queue = new MemQueue();
    const source = new MemSource([{ post: post("a"), targetPageIds: ["p1"] }]);
    const s = new PublishScheduler({
      queue,
      source,
      clock: new FakeClock(NOW),
      logger: nullLogger,
    });

    await s.tick();
    await s.tick();

    expect(queue.jobs).toHaveLength(1);
  });

  it("โพสต์ที่ไม่มีเพจปลายทางถูกข้าม ไม่สร้างงานลอย", async () => {
    const queue = new MemQueue();
    const source = new MemSource([{ post: post("a"), targetPageIds: [] }]);
    const s = new PublishScheduler({
      queue,
      source,
      clock: new FakeClock(NOW),
      logger: nullLogger,
    });

    const r = await s.tick();
    expect(r.enqueued).toBe(0);
    expect(source.queued).toEqual([]);
  });

  it("ไม่มีโพสต์ถึงเวลา → ไม่ทำอะไร", async () => {
    const queue = new MemQueue();
    const s = new PublishScheduler({
      queue,
      source: new MemSource([]),
      clock: new FakeClock(NOW),
      logger: nullLogger,
    });
    expect(await s.tick()).toEqual({ enqueued: 0, posts: 0 });
  });

  it("เลื่อนเวลาโพสต์ต้องยกเลิกงานเก่าก่อน", async () => {
    const queue = new MemQueue();
    const s = new PublishScheduler({
      queue,
      source: new MemSource([]),
      clock: new FakeClock(NOW),
      logger: nullLogger,
    });
    await s.reschedule("a");
    expect(queue.cancelled).toEqual(["a"]);
  });

  it("งาน retry ใช้ jobKey คนละตัวกับงานเดิม", async () => {
    const queue = new MemQueue();
    const s = new PublishScheduler({
      queue,
      source: new MemSource([]),
      clock: new FakeClock(NOW),
      logger: nullLogger,
    });

    await s.scheduleRetry({ postId: "a", pageId: "p1", attempt: 2 }, 60_000);
    await s.scheduleRetry({ postId: "a", pageId: "p1", attempt: 3 }, 300_000);

    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs[0]!.delayMs).toBe(60_000);
    expect(queue.jobs[1]!.delayMs).toBe(300_000);
    expect(queue.jobs[0]!.jobKey).not.toBe(queue.jobs[1]!.jobKey);
  });

  it("publishJobKey แน่นอนและแยกตามเพจ", () => {
    expect(publishJobKey("a", "p1")).toBe(publishJobKey("a", "p1"));
    expect(publishJobKey("a", "p1")).not.toBe(publishJobKey("a", "p2"));
  });
});

describe("แปลงเวลา — กฎข้อ 4 (DB เก็บ UTC, แสดงตาม timezone เพจ)", () => {
  it("เวลาไทย 09:00 = 02:00 UTC", () => {
    const utc = localTimeToUtcMs("2026-08-07T09:00", "Asia/Bangkok");
    expect(new Date(utc).toISOString()).toBe("2026-08-07T02:00:00.000Z");
  });

  it("รองรับวินาที", () => {
    const utc = localTimeToUtcMs("2026-08-07T09:00:30", "Asia/Bangkok");
    expect(new Date(utc).toISOString()).toBe("2026-08-07T02:00:30.000Z");
  });

  it("timezone อื่นก็แปลงถูก", () => {
    const utc = localTimeToUtcMs("2026-01-15T12:00", "UTC");
    expect(new Date(utc).toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("จัดการเขตที่มี DST ได้ (นิวยอร์กหน้าร้อน = UTC-4)", () => {
    const utc = localTimeToUtcMs("2026-07-15T12:00", "America/New_York");
    expect(new Date(utc).toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("เขตเดียวกันหน้าหนาวเปลี่ยน offset (UTC-5)", () => {
    const utc = localTimeToUtcMs("2026-01-15T12:00", "America/New_York");
    expect(new Date(utc).toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("รูปแบบเวลาผิด → error ภาษาไทยบอกรูปแบบที่ถูก", () => {
    expect(() => localTimeToUtcMs("7 ส.ค. 2026", "Asia/Bangkok")).toThrow(
      /YYYY-MM-DD/,
    );
  });

  it("แปลงกลับมาแสดงผลตาม timezone เพจได้", () => {
    const utc = Date.UTC(2026, 7, 7, 2, 0, 0);
    const text = utcMsToLocalText(utc, "Asia/Bangkok");
    expect(text).toContain("9:00");
  });

  it("ไป-กลับได้ค่าเดิม", () => {
    const iso = "2026-03-15T18:30";
    const utc = localTimeToUtcMs(iso, "Asia/Bangkok");
    expect(localTimeToUtcMs(iso, "Asia/Bangkok")).toBe(utc);
  });
});
