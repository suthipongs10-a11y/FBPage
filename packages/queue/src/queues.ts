/**
 * คิวจริงบน BullMQ — ที่เดียวในระบบที่ `import` BullMQ
 *
 * เหตุผลเดียวกับที่ `packages/store` เป็นที่เดียวที่รู้จัก Prisma: โดเมนประกาศแค่
 * interface (`PublishQueue`, `WebhookEventSink`) แล้วที่นี่ทำให้เป็นจริง โดเมนจึง
 * ยังเทสต์ได้โดยไม่ต้องมี Redis และถ้าวันหนึ่งเปลี่ยนไปใช้อย่างอื่นก็แก้ที่เดียว
 */
import { Queue, type JobsOptions } from "bullmq";
import type { RedisConnection } from "./connection.js";
import { QUEUE, queuePrefix, type QueueName } from "./names.js";

export interface QueueSetOptions {
  connection: RedisConnection;
  /** ชื่อ environment เช่น "dev" / "prod" — กันไม่ให้ dev หยิบงานของ prod ไปทำ */
  env: string;
}

/**
 * ค่า default ของทุกคิว
 *
 * ⚠️ `attempts: 1` ไม่ใช่ความประมาท — **โดเมนเป็นคนตัดสิน retry เอง**
 * `PublishWorker` มีตารางเวลา retry ของตัวเอง (`RETRY_SCHEDULE_MS`) และมีสถานะ
 * ใน DB (`markTargetFailed` / `releaseTarget`) ที่ต้องเดินไปพร้อมกัน
 * ถ้าเปิด retry ของ BullMQ ด้วย จะกลายเป็นสองระบบ retry ซ้อนกัน: BullMQ ยิงใหม่
 * โดย `attempt` ในข้อมูลงานยังเป็นเลขเดิม → ตัวเช็ค "เคยโพสต์ไปแล้วหรือยัง"
 * (ซึ่งทำงานเฉพาะ attempt > 1) ถูกข้าม → โพสต์ซ้ำบนเพจลูกค้า
 *
 * ส่วนงานที่ตายกลางคันเพราะโปรเซสดับ BullMQ ยังกู้ให้ผ่านกลไก stalled job
 * ซึ่งเป็นคนละเรื่องกับ retry และมี `claimTarget` กันซ้ำอยู่แล้ว
 */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  // เก็บของที่สำเร็จไว้พอให้ไล่ดูย้อนหลังได้ แต่ไม่ให้กินหน่วยความจำ Redis
  removeOnComplete: { count: 1_000, age: 7 * 24 * 60 * 60 },
  // ของที่พังเก็บนานกว่าและเยอะกว่า — นี่คือของที่คนจะมานั่งเปิดดูจริงๆ
  removeOnFail: { count: 10_000, age: 30 * 24 * 60 * 60 },
};

export type QueueSet = Record<QueueName, Queue>;

export function createQueues(opts: QueueSetOptions): QueueSet {
  const prefix = queuePrefix(opts.env);
  const make = (name: QueueName): Queue =>
    new Queue(name, {
      connection: opts.connection,
      prefix,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });

  return {
    [QUEUE.webhookEvents]: make(QUEUE.webhookEvents),
    [QUEUE.publish]: make(QUEUE.publish),
    [QUEUE.moderation]: make(QUEUE.moderation),
    [QUEUE.analytics]: make(QUEUE.analytics),
    [QUEUE.tokenHealth]: make(QUEUE.tokenHealth),
    [QUEUE.alerts]: make(QUEUE.alerts),
    [QUEUE.cron]: make(QUEUE.cron),
  };
}

export async function closeQueues(set: QueueSet): Promise<void> {
  await Promise.allSettled(Object.values(set).map((q) => q.close()));
}

export { DEFAULT_JOB_OPTIONS };
