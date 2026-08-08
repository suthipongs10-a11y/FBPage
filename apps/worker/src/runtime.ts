/**
 * ตัวรัน worker บน BullMQ
 *
 * ชั้นนี้บางที่สุดเท่าที่ทำได้: หยิบงาน → ส่งให้ `JobRouter` → เขียน log
 * ตรรกะทั้งหมดอยู่ที่ router และตัวจัดการงาน ซึ่งเทสต์ได้โดยไม่ต้องมี Redis
 */
import { Worker, type Job } from "bullmq";
import { systemClock, type Clock, type Logger } from "@page-os/core";
import { queuePrefix, type QueueName, type RedisConnection } from "@page-os/queue";
import { JobRouter, NotWiredError, UnknownJobError } from "./router.js";

export interface QueueRuntimeOptions {
  queue: QueueName;
  router: JobRouter;
  connection: RedisConnection;
  env: string;
  logger: Logger;
  clock?: Clock;
  /** ทำพร้อมกันกี่งาน */
  concurrency?: number;
}

/**
 * ค่า concurrency ต่อคิว
 *
 * คิวโพสต์ตั้งไว้ต่ำโดยตั้งใจ: งานหนึ่งใบ = การยิง Graph API หลายครั้ง และ
 * rate limit ของ Meta นับรวมทั้งแอป การเปิดพร้อมกันเยอะจะทำให้ชนเพดานเร็วขึ้น
 * โดยไม่ได้เร็วขึ้นจริง เพราะสุดท้ายก็ต้องรออยู่ดี
 */
export const DEFAULT_CONCURRENCY: Record<QueueName, number> = {
  "webhook-events": 10,
  publish: 2,
  moderation: 4,
  analytics: 2,
  "token-health": 2,
  alerts: 1,
  cron: 1,
};

export function startQueueWorker(opts: QueueRuntimeOptions): Worker {
  const clock = opts.clock ?? systemClock;
  const log = opts.logger.child({ queue: opts.queue });

  const worker = new Worker(
    opts.queue,
    async (job: Job) => {
      const startedAt = clock.now();
      const jobLog = log.child({ jobId: job.id ?? "?", jobName: job.name });

      const outcome = await opts.router.dispatch(job.name, job.data, {
        nowMs: startedAt,
        logger: jobLog,
        jobId: job.id ?? "?",
        attemptsMade: job.attemptsMade,
      });

      jobLog.info("ทำงานเสร็จ", {
        th: outcome.th,
        ms: clock.now() - startedAt,
        ...(outcome.details ?? {}),
      });
      return outcome;
    },
    {
      connection: opts.connection,
      prefix: queuePrefix(opts.env),
      concurrency: opts.concurrency ?? DEFAULT_CONCURRENCY[opts.queue],
    },
  );

  worker.on("failed", (job, err) => {
    // ข้อความไทยของ error โปรเจ็คนี้อยู่ในฟิลด์ `th` ซึ่ง Error ปกติไม่มี
    const th =
      err instanceof NotWiredError || err instanceof UnknownJobError
        ? err.th
        : ((err as { th?: string }).th ?? err.message);
    log.error("งานล้มเหลว", {
      jobId: job?.id ?? "?",
      jobName: job?.name ?? "?",
      th,
      err,
    });
  });

  /**
   * `error` คือปัญหาระดับตัว worker เอง (ต่อ Redis ไม่ได้, สคริปต์ Lua พัง)
   * ไม่ใช่ปัญหาของงานใบไหน — ถ้าไม่ดักไว้ Node จะถือเป็น unhandled แล้วปิดโปรเซส
   */
  worker.on("error", (err) => {
    log.error("worker มีปัญหาระดับระบบ", { err });
  });

  worker.on("stalled", (jobId) => {
    // งานค้างแปลว่ารอบก่อนโปรเซสตายกลางคัน — ต้องเห็น เพราะถ้าเกิดถี่
    // แปลว่ามีงานที่กินเวลานานกว่าเวลาที่ BullMQ ยอมให้ถือล็อก
    log.warn("เจองานที่ค้างจากรอบก่อน — เอากลับมาทำใหม่", { jobId });
  });

  return worker;
}
