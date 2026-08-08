/**
 * เทสต์ที่รัน worker จริงบน Redis จริง
 *
 * ข้ามทั้งไฟล์ถ้าไม่ได้ตั้ง `REDIS_URL`
 *
 * ที่ต้องมีเทสต์ชั้นนี้ ทั้งที่ router กับตัวจัดการงานมีเทสต์ของตัวเองแล้ว:
 * ความผิดพลาดที่เหลืออยู่คือ **การต่อสาย** — prefix ไม่ตรง, ชื่อคิวไม่ตรง,
 * ชื่องานไม่ตรง ซึ่งทุกอย่างจะ "สำเร็จ" หมดในเทสต์ที่ใช้ของปลอม
 * แล้วออกมาเป็น "งานเข้าคิวแล้วแต่ไม่มีใครทำ" ในของจริง
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Queue, type Worker } from "bullmq";
import { FakeClock, nullLogger } from "@page-os/core";
import {
  createRedisConnection,
  encodePublishJob,
  encodeSweepJob,
  queuePrefix,
  toJobId,
  type RedisConnection,
} from "@page-os/queue";
import type { PublishJob, PublishScheduler, PublishWorker } from "@page-os/publish";
import { publishTickHandler } from "./handlers/cron.js";
import { publishHandler } from "./handlers/publish.js";
import { JobRouter } from "./router.js";
import { startQueueWorker } from "./runtime.js";

const REDIS_URL = process.env["REDIS_URL"];
const HAS_REDIS = Boolean(REDIS_URL);
const ENV = "vitest-runtime";
const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);

let redis: RedisConnection;
let blocking: RedisConnection;
const started: Worker[] = [];

/** รอจนเงื่อนไขเป็นจริง — งานใน BullMQ ทำแบบไม่ประสานกับเทสต์ */
async function until(
  check: () => boolean | Promise<boolean>,
  whatTh: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`รอ "${whatTh}" จนหมดเวลาแล้วยังไม่เกิดขึ้น`);
}

describe.skipIf(!HAS_REDIS)("worker จริงบน Redis", () => {
  beforeEach(async () => {
    redis ??= createRedisConnection({
      url: REDIS_URL as string,
      forBlockingUse: false,
      name: "vitest-rt",
    });
    blocking ??= createRedisConnection({
      url: REDIS_URL as string,
      forBlockingUse: true,
      name: "vitest-rt-consume",
    });
    const keys = await redis.keys(`${queuePrefix(ENV)}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await Promise.allSettled(started.map((w) => w.close()));
    if (HAS_REDIS) {
      await Promise.allSettled([redis?.quit(), blocking?.quit()]);
    }
  });

  /**
   * เส้นทางเต็มของงานโพสต์: ยัดเข้าคิว → worker หยิบ → router ส่งต่อ →
   * ตัวจัดการเรียก PublishWorker
   */
  it("งานที่ยัดเข้าคิวถูกหยิบไปทำจริง", async () => {
    const seen: PublishJob[] = [];
    const worker = {
      process: async (job: PublishJob) => {
        seen.push(job);
        return { kind: "published" as const, fbPostId: "fb_1", th: "ขึ้นแล้ว" };
      },
    } as unknown as PublishWorker;
    const scheduler = { scheduleRetry: async () => {} } as unknown as PublishScheduler;

    started.push(
      startQueueWorker({
        queue: "publish",
        router: new JobRouter([publishHandler({ worker, scheduler })]),
        connection: blocking,
        env: ENV,
        logger: nullLogger,
        clock: new FakeClock(NOW),
      }),
    );

    const q = new Queue("publish", { connection: redis, prefix: queuePrefix(ENV) });
    await q.add(
      "publish-post",
      encodePublishJob({ postId: "post1", pageId: "pg1", attempt: 1 }),
      { jobId: toJobId("publish:post1:pg1") },
    );

    await until(() => seen.length === 1, "งานโพสต์ถูกหยิบไปทำ");
    expect(seen[0]).toEqual({ postId: "post1", pageId: "pg1", attempt: 1 });
    await q.close();
  });

  /**
   * ชื่องานที่ cron สร้างต้องตรงกับชื่อที่ตัวจัดการลงทะเบียนไว้เป๊ะ
   * ถ้าไม่ตรง งานจะยิงทุกนาทีแล้วล้มทุกนาที
   */
  it("ชื่องานของ cron ตรงกับตัวจัดการที่ลงทะเบียนไว้", async () => {
    let ticks = 0;
    const scheduler = {
      tick: async () => {
        ticks++;
        return { enqueued: 0, posts: 0 };
      },
    } as unknown as PublishScheduler;

    const handler = publishTickHandler(scheduler);
    started.push(
      startQueueWorker({
        queue: "cron",
        router: new JobRouter([handler]),
        connection: blocking,
        env: ENV,
        logger: nullLogger,
        clock: new FakeClock(NOW),
      }),
    );

    const q = new Queue("cron", { connection: redis, prefix: queuePrefix(ENV) });
    await q.add(handler.name, encodeSweepJob());

    await until(() => ticks === 1, "รอบ publish-tick ถูกเรียก");
    await q.close();
  });

  it("งานชื่อที่ไม่มีใครรับ → ตกไปกองรายการที่ล้มเหลว ไม่ใช่ขึ้นว่าสำเร็จ", async () => {
    started.push(
      startQueueWorker({
        queue: "moderation",
        router: new JobRouter([]),
        connection: blocking,
        env: ENV,
        logger: nullLogger,
        clock: new FakeClock(NOW),
      }),
    );

    const q = new Queue("moderation", { connection: redis, prefix: queuePrefix(ENV) });
    await q.add("งานที่ไม่มีใครรู้จัก", { v: 1 });

    await until(
      async () => (await q.getFailedCount()) === 1,
      "งานตกไปกองรายการที่ล้มเหลว",
    );
    expect(await q.getCompletedCount()).toBe(0);
    await q.close();
  });
});
