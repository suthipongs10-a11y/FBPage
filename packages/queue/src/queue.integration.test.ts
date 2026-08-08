/**
 * เทสต์ที่รันกับ Redis จริง
 *
 * ข้ามทั้งไฟล์ถ้าไม่ได้ตั้ง `REDIS_URL`
 *
 *   docker compose up -d redis
 *   REDIS_URL=redis://localhost:6379 pnpm test
 *
 * ที่ต้องเทสต์กับของจริง เพราะสิ่งที่พิสูจน์อยู่คือ **ข้อบังคับของ BullMQ**
 * ไม่ใช่ตรรกะของเรา — โดยเฉพาะกฎเรื่อง jobId ที่ห้ามมี ":" ซึ่งเป็นกฎที่
 * บังคับตอน `add()` เท่านั้น อ่านจากซอร์สแล้วเดาเอาไม่พอ
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { nullLogger } from "@page-os/core";
import { idempotencyKey, type InboxEvent } from "@page-os/inbox";
import { publishJobKey } from "@page-os/publish";
import { applyCronSchedule } from "./cron-apply.js";
import { CRON_JOBS, CRON_TZ } from "./cron.js";
import { createRedisConnection, type RedisConnection } from "./connection.js";
import { toJobId } from "./job-id.js";
import { BullPublishQueue } from "./publish-queue.js";
import { BullWebhookEventSink } from "./webhook-sink.js";

const REDIS_URL = process.env["REDIS_URL"];
const HAS_REDIS = Boolean(REDIS_URL);
const PREFIX = "pageos:vitest";
const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);

let redis: RedisConnection;

function makeQueue(name: string): Queue {
  return new Queue(name, { connection: redis, prefix: PREFIX });
}

const message: InboxEvent = {
  type: "message",
  channel: "messenger",
  pageId: "p1",
  timestampMs: NOW,
  mid: "m_1",
  senderId: "u1",
  recipientId: "p1",
  contactId: "u1",
  attachments: [],
  isEcho: false,
};

const reaction: InboxEvent = {
  type: "reaction",
  channel: "messenger",
  pageId: "p1",
  timestampMs: NOW,
  senderId: "u1",
  targetMid: "m_1",
  action: "react",
};

describe.skipIf(!HAS_REDIS)("คิวจริงบน Redis", () => {
  beforeEach(async () => {
    redis ??= createRedisConnection({
      url: REDIS_URL as string,
      forBlockingUse: false,
      name: "vitest",
    });
    // ล้างเฉพาะคีย์ของเทสต์ ไม่แตะของอื่นใน Redis เครื่องเดียวกัน
    const keys = await redis.keys(`${PREFIX}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    if (HAS_REDIS && redis) await redis.quit();
  });

  describe("BullWebhookEventSink", () => {
    it("ยัด event เข้าคิวได้และอ่านกลับมาได้ครบ", async () => {
      const q = makeQueue("webhook-events");
      const sink = new BullWebhookEventSink({ queue: q, redis });

      await sink.enqueue([
        { key: idempotencyKey(message), event: message, receivedAtMs: NOW, deliveryId: "d1" },
      ]);

      const jobs = await q.getJobs(["waiting", "delayed", "prioritized"]);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.data).toMatchObject({ key: "msg:m_1", deliveryId: "d1" });
      await q.close();
    });

    /**
     * เทสต์ที่พิสูจน์ว่า `toJobId()` จำเป็นจริง
     *
     * `idempotencyKey()` ของ event ทั้งสองแบบนี้มี ":" คนละจำนวนท่อน
     * ถ้าส่งดิบๆ BullMQ จะโยน "Custom Id cannot contain :" ตอน add
     */
    it("คีย์กันซ้ำทุกรูปแบบยัดเข้าคิวได้ (ไม่โดนกฎ jobId ของ BullMQ ปฏิเสธ)", async () => {
      const q = makeQueue("webhook-events");
      const sink = new BullWebhookEventSink({ queue: q, redis });

      await sink.enqueue([
        { key: idempotencyKey(message), event: message, receivedAtMs: NOW, deliveryId: "d1" },
        { key: idempotencyKey(reaction), event: reaction, receivedAtMs: NOW, deliveryId: "d1" },
      ]);
      expect(await q.getWaitingCount()).toBe(2);
      await q.close();
    });

    /** ยืนยันว่ากฎที่เราเลี่ยงอยู่มีจริง ไม่ใช่ระวังเกินเหตุ */
    it("ส่งคีย์ดิบเป็น jobId → BullMQ ปฏิเสธจริง", async () => {
      const q = makeQueue("webhook-events");
      await expect(
        q.add("x", {}, { jobId: idempotencyKey(reaction) }),
      ).rejects.toThrow(/Custom Id cannot contain/);
      await q.close();
    });

    it("Meta ส่ง event เดิมซ้ำ → เกิดงานใบเดียว (กฎข้อ 6)", async () => {
      const q = makeQueue("webhook-events");
      const sink = new BullWebhookEventSink({ queue: q, redis });
      const item = {
        key: idempotencyKey(message),
        event: message,
        receivedAtMs: NOW,
        deliveryId: "d1",
      };

      await sink.enqueue([item]);
      await sink.enqueue([{ ...item, deliveryId: "d2" }]);
      expect(await q.getWaitingCount()).toBe(1);
      await q.close();
    });

    it("ping ผ่านเมื่อ Redis ตอบ", async () => {
      const q = makeQueue("webhook-events");
      await expect(
        new BullWebhookEventSink({ queue: q, redis }).ping(),
      ).resolves.toBeUndefined();
      await q.close();
    });

    it("ชุดว่างไม่ยิงอะไรไป Redis", async () => {
      const q = makeQueue("webhook-events");
      await new BullWebhookEventSink({ queue: q, redis }).enqueue([]);
      expect(await q.getWaitingCount()).toBe(0);
      await q.close();
    });
  });

  describe("BullPublishQueue", () => {
    function make(q: Queue): BullPublishQueue {
      return new BullPublishQueue({ queue: q, redis, prefix: PREFIX, logger: nullLogger });
    }

    it("ยัดงานโพสต์เข้าคิวพร้อมเวลาหน่วง", async () => {
      const q = makeQueue("publish");
      await make(q).enqueue({
        job: { postId: "post1", pageId: "pg1", attempt: 1 },
        delayMs: 60_000,
        jobKey: publishJobKey("post1", "pg1"),
      });
      expect(await q.getDelayedCount()).toBe(1);
      await q.close();
    });

    /** คีย์ของงาน retry มี 5 ท่อน — รูปที่ BullMQ ปฏิเสธถ้าไม่แปลง */
    it("งาน retry ยัดเข้าคิวได้", async () => {
      const q = makeQueue("publish");
      await make(q).enqueue({
        job: { postId: "post1", pageId: "pg1", attempt: 2 },
        delayMs: 0,
        jobKey: `${publishJobKey("post1", "pg1")}:retry:2`,
      });
      expect(await q.getWaitingCount()).toBe(1);
      await q.close();
    });

    it("ยกเลิกโพสต์ → ลบทั้งงานรอบแรกและงาน retry ที่ค้างอยู่", async () => {
      const q = makeQueue("publish");
      const pq = make(q);

      await pq.enqueue({
        job: { postId: "post1", pageId: "pg1", attempt: 1 },
        delayMs: 60_000,
        jobKey: publishJobKey("post1", "pg1"),
      });
      await pq.enqueue({
        job: { postId: "post1", pageId: "pg2", attempt: 2 },
        delayMs: 60_000,
        jobKey: `${publishJobKey("post1", "pg2")}:retry:2`,
      });
      // งานของโพสต์อื่นต้องไม่โดนลบไปด้วย
      await pq.enqueue({
        job: { postId: "post2", pageId: "pg1", attempt: 1 },
        delayMs: 60_000,
        jobKey: publishJobKey("post2", "pg1"),
      });
      expect(await q.getDelayedCount()).toBe(3);

      await pq.cancelForPost("post1");
      expect(await q.getDelayedCount()).toBe(1);
      const left = await q.getJobs(["delayed"]);
      expect(left[0]?.data).toMatchObject({ postId: "post2" });
      await q.close();
    });

    it("ยกเลิกโพสต์ที่ไม่มีงานค้าง → ไม่พัง", async () => {
      const q = makeQueue("publish");
      await expect(make(q).cancelForPost("ไม่มีโพสต์นี้")).resolves.toBeUndefined();
      await q.close();
    });

    it("jobId ที่ใช้จริงตรงกับที่ toJobId คำนวณ", async () => {
      const q = makeQueue("publish");
      const key = publishJobKey("post1", "pg1");
      await make(q).enqueue({
        job: { postId: "post1", pageId: "pg1", attempt: 1 },
        delayMs: 0,
        jobKey: key,
      });
      expect(await q.getJob(toJobId(key))).toBeDefined();
      await q.close();
    });
  });

  describe("ตารางงาน cron", () => {
    it("ตั้งครบทุกตารางที่ประกาศไว้ พร้อม timezone ที่ถูก", async () => {
      const q = makeQueue("cron");
      const plan = await applyCronSchedule({ queue: q, logger: nullLogger });
      expect(plan.toUpsert).toHaveLength(CRON_JOBS.length);

      const stored = await q.getJobSchedulers();
      expect(stored).toHaveLength(CRON_JOBS.length);
      for (const s of stored) expect(s.tz).toBe(CRON_TZ);
      await q.close();
    });

    it("รันซ้ำไม่เกิดตารางซ้ำ", async () => {
      const q = makeQueue("cron");
      await applyCronSchedule({ queue: q, logger: nullLogger });
      const second = await applyCronSchedule({ queue: q, logger: nullLogger });

      expect(second.toUpsert).toEqual([]);
      expect(second.unchanged).toHaveLength(CRON_JOBS.length);
      expect(await q.getJobSchedulers()).toHaveLength(CRON_JOBS.length);
      await q.close();
    });

    /**
     * เหตุผลหลักที่ต้องมีตัวเก็บกวาด — ตารางที่ลบจากโค้ดแล้วยังยิงงานต่อไป
     * ทุกวันโดยไม่มีใครรู้
     */
    it("ตารางที่ไม่มีในโค้ดแล้วถูกลบทิ้ง", async () => {
      const q = makeQueue("cron");
      await q.upsertJobScheduler(
        "ของเก่าที่เลิกใช้",
        { pattern: "0 0 * * *", tz: CRON_TZ },
        { name: "cron:ของเก่า", data: {} },
      );
      expect(await q.getJobSchedulers()).toHaveLength(1);

      const plan = await applyCronSchedule({ queue: q, logger: nullLogger });
      expect(plan.toRemove.map((r) => r.key)).toEqual(["ของเก่าที่เลิกใช้"]);
      const stored = await q.getJobSchedulers();
      expect(stored.map((s) => s.key)).not.toContain("ของเก่าที่เลิกใช้");
      await q.close();
    });

    it("เปลี่ยนเวลาแล้วเขียนทับของเดิม ไม่ใช่มีสองรอบ", async () => {
      const q = makeQueue("cron");
      const specs = [
        { name: "ทดสอบ", queue: "cron" as const, pattern: "0 3 * * *", th: "รอบทดสอบ" },
      ];
      await applyCronSchedule({ queue: q, specs, logger: nullLogger });

      const changed = [{ ...specs[0]!, pattern: "0 4 * * *" }];
      await applyCronSchedule({ queue: q, specs: changed, logger: nullLogger });

      const stored = await q.getJobSchedulers();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.pattern).toBe("0 4 * * *");
      await q.close();
    });
  });
});
