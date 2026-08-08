/**
 * `PublishQueue` ของโดเมนโพสต์ ที่ต่อ BullMQ จริง
 */
import type { Queue } from "bullmq";
import { nullLogger, type Logger } from "@page-os/core";
import type { PublishJob, PublishQueue } from "@page-os/publish";
import type { RedisConnection } from "./connection.js";
import { toJobId } from "./job-id.js";
import { encodePublishJob } from "./payloads.js";

export const PUBLISH_JOB_NAME = "publish-post";

/**
 * ดัชนีจาก postId → jobId ที่ยังค้างอยู่ มีไว้ให้ `cancelForPost()` ทำงานได้
 *
 * BullMQ ไม่มีวิธีค้นงานจากเนื้อในของงาน มีแต่หาจาก jobId ตรงๆ และ jobId ของงาน
 * retry มีเลขรอบอยู่ข้างใน (`...:retry:2`) เราจึงเดาชื่อทั้งหมดล่วงหน้าไม่ได้
 * ต้องจดไว้เองตอนยัดเข้าคิว
 */
const INDEX_TTL_SECONDS = 24 * 60 * 60;

export interface BullPublishQueueOptions {
  queue: Queue;
  /** connection เดียวกับที่ Queue ใช้ก็ได้ — คำสั่งที่ใช้ตรงนี้ไม่ block */
  redis: RedisConnection;
  /** ต้องตรงกับ prefix ของคิว ไม่งั้นดัชนีของ dev กับ prod จะปนกัน */
  prefix: string;
  logger?: Logger;
}

export class BullPublishQueue implements PublishQueue {
  private readonly queue: Queue;
  private readonly redis: RedisConnection;
  private readonly prefix: string;
  private readonly logger: Logger;

  constructor(opts: BullPublishQueueOptions) {
    this.queue = opts.queue;
    this.redis = opts.redis;
    this.prefix = opts.prefix;
    this.logger = opts.logger ?? nullLogger;
  }

  private indexKey(postId: string): string {
    return `${this.prefix}:publish-index:${postId}`;
  }

  async enqueue(args: {
    job: PublishJob;
    delayMs: number;
    jobKey: string;
  }): Promise<void> {
    const jobId = toJobId(args.jobKey);

    // จดดัชนี **ก่อน** ยัดงาน — ถ้าสลับลำดับแล้วขั้นจดพัง เราจะได้งานที่ยกเลิกไม่ได้
    // (กลับกัน ถ้าจดแล้วงานยัดไม่เข้า ดัชนีจะมีชื่อที่หาไม่เจอ ซึ่งไม่มีผลอะไร)
    const key = this.indexKey(args.job.postId);
    await this.redis
      .multi()
      .sadd(key, jobId)
      .expire(key, INDEX_TTL_SECONDS)
      .exec();

    await this.queue.add(PUBLISH_JOB_NAME, encodePublishJob(args.job), {
      jobId,
      delay: Math.max(0, Math.round(args.delayMs)),
    });
  }

  /**
   * ลบงานที่ยังไม่เริ่มของโพสต์นี้
   *
   * เป็นแค่การเก็บกวาด ไม่ใช่ตัวกันโพสต์ตัวจริง — งานที่ **กำลังทำอยู่** ลบไม่ได้
   * (BullMQ ล็อกไว้) ตัวที่กันจริงคือ `PublishWorker` ซึ่งอ่านสถานะโพสต์ใหม่
   * ทุกครั้งก่อนยิงและข้ามให้เองถ้าเห็นว่า `cancelled`
   */
  async cancelForPost(postId: string): Promise<void> {
    const key = this.indexKey(postId);
    const ids = await this.redis.smembers(key);

    for (const id of ids) {
      const job = await this.queue.getJob(id);
      if (!job) continue;
      try {
        await job.remove();
      } catch (err) {
        // ลบไม่ได้เพราะกำลังทำอยู่ — ปล่อยไป ดูเหตุผลในคอมเมนต์ข้างบน
        this.logger.debug("ลบงานโพสต์ที่ค้างไม่ได้ (น่าจะกำลังทำอยู่)", {
          postId,
          jobId: id,
          err,
        });
      }
    }

    await this.redis.del(key);
  }
}
