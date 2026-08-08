/**
 * ปลายทางที่ `apps/webhook` ส่ง event ต่อให้ — ยัดลง BullMQ
 *
 * interface อยู่ที่ `packages/inbox` ตามแบบเดียวกับ `PublishQueue` ที่อยู่กับ
 * `packages/publish` — โดเมนเป็นคนบอกว่าต้องการอะไร ที่นี่เป็นคนทำให้เป็นจริง
 */
import type { Queue } from "bullmq";
import type { QueuedWebhookEvent, WebhookEventSink } from "@page-os/inbox";
import type { RedisConnection } from "./connection.js";
import { toJobId } from "./job-id.js";
import { encodeWebhookEventJob } from "./payloads.js";

export const WEBHOOK_EVENT_JOB_NAME = "inbox-event";

export interface BullWebhookEventSinkOptions {
  queue: Queue;
  /**
   * connection เดียวกับที่คิวใช้ — รับมาตรงๆ แทนที่จะไปควานเอาจากข้างในของ Queue
   * เพราะช่องทางนั้นเป็นของภายในของ BullMQ ที่ย้ายที่ทุกเวอร์ชันหลัก
   */
  redis: RedisConnection;
}

export class BullWebhookEventSink implements WebhookEventSink {
  private readonly queue: Queue;
  private readonly redis: RedisConnection;

  constructor(opts: BullWebhookEventSinkOptions) {
    this.queue = opts.queue;
    this.redis = opts.redis;
  }

  /**
   * ยัดทั้งชุดด้วย `addBulk` — หนึ่งรอบไปกลับ Redis ต่อ 1 request ของ Meta
   *
   * `jobId` ตั้งจากคีย์กันซ้ำ (กฎข้อ 6) ทำให้ Meta ส่ง event เดิมมาซ้ำกี่รอบ
   * ก็เกิดงานใบเดียว — เป็นด่านกันซ้ำด่านแรก ส่วนด่านที่สองคือ `hasSeen()` ใน DB
   * ที่ยังจำเป็นอยู่ เพราะ BullMQ ลบงานที่ทำเสร็จทิ้งตามอายุ พอเกินอายุแล้ว
   * jobId เดิมจะยัดเข้าได้อีก
   */
  async enqueue(events: readonly QueuedWebhookEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.queue.addBulk(
      events.map((e) => ({
        name: WEBHOOK_EVENT_JOB_NAME,
        data: encodeWebhookEventJob({
          key: e.key,
          event: e.event,
          receivedAtMs: e.receivedAtMs,
          deliveryId: e.deliveryId,
        }),
        opts: { jobId: toJobId(e.key) },
      })),
    );
  }

  /**
   * ให้ `/readyz` เรียก — ถ้า Redis ไม่ตอบ ต้องบอกว่ายังไม่พร้อมรับ webhook
   *
   * ยิง PING จริงทุกครั้ง ไม่ใช่จำผลตอนต่อครั้งแรก เพราะสิ่งที่อยากรู้คือ
   * "ตอนนี้ยังส่งงานต่อได้ไหม" ไม่ใช่ "เคยต่อได้ไหม"
   */
  async ping(): Promise<void> {
    await this.redis.ping();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
