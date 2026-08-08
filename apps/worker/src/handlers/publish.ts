/**
 * ตัวจัดการงาน "ยิงโพสต์ 1 เป้าหมาย"
 *
 * ตรรกะการตัดสินใจทั้งหมดอยู่ใน `PublishWorker` แล้ว (จองก่อนยิง, เช็คซ้ำ,
 * เช็คว่ารอบก่อนขึ้นไปแล้วหรือยัง) ที่นี่มีหน้าที่เดียวคือ **แปลผลลัพธ์เป็นการกระทำ**
 *
 * จุดที่พลาดง่ายและเป็นเหตุผลที่ไฟล์นี้ต้องมี:
 * `PublishWorker.process()` คืน `{kind:"retry", delayMs, nextAttempt}` แต่มัน
 * **ไม่ได้ใส่งานกลับเข้าคิวให้** ถ้าคนเรียกลืมทำต่อ ผลที่ได้คือโพสต์ที่ล้มเหลว
 * รอบแรกจะไม่ถูกลองใหม่เลย ทั้งที่ระบบบอกว่า "จะลองใหม่ใน 1 นาที"
 * — พังแบบเงียบสนิท เพราะทุกอย่างขึ้นว่าสำเร็จหมด
 */
import type { PublishScheduler, PublishWorker } from "@page-os/publish";
import { decodePublishJob } from "@page-os/queue";
import type { JobContext, JobHandler, JobOutcome } from "../router.js";

export const PUBLISH_JOB = "publish-post";

export interface PublishHandlerOptions {
  worker: PublishWorker;
  /** ใช้ใส่งาน retry กลับเข้าคิว */
  scheduler: PublishScheduler;
}

export function publishHandler(opts: PublishHandlerOptions): JobHandler {
  return {
    name: PUBLISH_JOB,
    async run(data: unknown, ctx: JobContext): Promise<JobOutcome> {
      const job = decodePublishJob(data);
      const log = ctx.logger.child({
        page_id: job.pageId,
        postId: job.postId,
        attempt: job.attempt,
      });

      const outcome = await opts.worker.process({
        postId: job.postId,
        pageId: job.pageId,
        attempt: job.attempt,
      });

      switch (outcome.kind) {
        case "published":
          return {
            th: outcome.th,
            details: { fbPostId: outcome.fbPostId },
          };

        case "retry":
          // ใส่กลับเข้าคิวเอง — ดูเหตุผลในหัวไฟล์
          await opts.scheduler.scheduleRetry(
            {
              postId: job.postId,
              pageId: job.pageId,
              attempt: outcome.nextAttempt,
            },
            outcome.delayMs,
          );
          log.warn("โพสต์ไม่สำเร็จ ตั้งเวลาลองใหม่แล้ว", {
            delayMs: outcome.delayMs,
            nextAttempt: outcome.nextAttempt,
          });
          return {
            th: outcome.th,
            details: { nextAttempt: outcome.nextAttempt, delayMs: outcome.delayMs },
          };

        case "failed":
          /**
           * ไม่โยน error ต่อโดยตั้งใจ
           *
           * "โพสต์ไม่สำเร็จและเลิกลองแล้ว" เป็นผลลัพธ์ที่ระบบตัดสินใจเองอย่างถูกต้อง
           * ไม่ใช่ความผิดพลาดของตัวงาน ถ้าโยน error BullMQ จะนับเป็นงานล้มเหลว
           * แล้วกลไก stalled/retry ของมันอาจหยิบไปทำใหม่ ซึ่งจะไปชนกับตัวตัดสิน
           * retry ของโดเมนที่บอกว่า "พอแล้ว" — สถานะที่ถูกต้องถูกบันทึกใน DB
           * และการแจ้งเตือนถูกส่งไปแล้วจากข้างใน PublishWorker
           */
          log.error("โพสต์ไม่สำเร็จและเลิกลองแล้ว", { th: outcome.th });
          return { th: outcome.th, details: { needsAlert: outcome.needsAlert } };

        case "skipped":
          log.info("ข้ามงานโพสต์", { reason: outcome.reason, th: outcome.th });
          return { th: outcome.th, details: { reason: outcome.reason } };
      }
    },
  };
}
