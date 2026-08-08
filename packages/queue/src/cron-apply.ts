/**
 * เอาแผนจาก `planCronReconcile()` ไปทำจริงกับ BullMQ
 *
 * แยกจาก `cron.ts` เพื่อให้ตัวคิดแผนเทสต์ได้โดยไม่ต้องมี Redis
 */
import type { Queue } from "bullmq";
import { nullLogger, type Logger } from "@page-os/core";
import {
  assertValidCronPattern,
  CRON_JOBS,
  CRON_TZ,
  planCronReconcile,
  type CronReconcilePlan,
  type CronSpec,
  type ExistingRepeat,
} from "./cron.js";
import { encodeSweepJob } from "./payloads.js";

export const CRON_JOB_NAME_PREFIX = "cron:";

export interface ApplyCronOptions {
  /** คิวที่เก็บงาน cron ทั้งหมด */
  queue: Queue;
  specs?: readonly CronSpec[];
  logger?: Logger;
}

export async function applyCronSchedule(
  opts: ApplyCronOptions,
): Promise<CronReconcilePlan> {
  const specs = opts.specs ?? CRON_JOBS;
  const log = opts.logger ?? nullLogger;

  for (const s of specs) assertValidCronPattern(s.pattern);

  const raw = await opts.queue.getJobSchedulers();
  const existing: ExistingRepeat[] = raw.map((r) => ({
    key: r.key,
    pattern: r.pattern,
    tz: r.tz,
  }));

  const plan = planCronReconcile(existing, specs);

  for (const r of plan.toRemove) {
    await opts.queue.removeJobScheduler(r.key);
    log.warn("ลบตารางงานที่ไม่ได้ใช้แล้ว", { name: r.key, th: r.reasonTh });
  }

  for (const s of plan.toUpsert) {
    await opts.queue.upsertJobScheduler(
      s.name,
      { pattern: s.pattern, tz: CRON_TZ },
      {
        name: `${CRON_JOB_NAME_PREFIX}${s.name}`,
        data: encodeSweepJob(),
      },
    );
    log.info("ตั้งตารางงาน", { name: s.name, pattern: s.pattern, th: s.th });
  }

  return plan;
}
