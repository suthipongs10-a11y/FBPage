/**
 * ตัวจัดการงานตามเวลา
 *
 * ทุกตัวรับ payload เปล่า (ดูเหตุผลใน `packages/queue/src/payloads.ts`) และ
 * ต้องอ่านเวลาจาก `ctx.nowMs` ซึ่งมาจาก Clock ที่ฉีดเข้ามา ไม่ใช่ `Date.now()`
 */
import type { AlertCenter, Problem } from "@page-os/ops";
import type { PublishScheduler } from "@page-os/publish";
import { CRON_JOB_NAME_PREFIX, decodeSweepJob } from "@page-os/queue";
import { NotWiredError, type JobContext, type JobHandler, type JobOutcome } from "../router.js";

/** ชื่องานที่ BullMQ เห็น = prefix + ชื่อตาราง */
export const cronJobName = (name: string): string =>
  `${CRON_JOB_NAME_PREFIX}${name}`;

/**
 * หาโพสต์ที่ถึงเวลาแล้วยัดเข้าคิว
 *
 * นี่คือรอบที่ทำให้ "ตั้งเวลาโพสต์" เป็นเรื่องจริง — ถ้ารอบนี้ไม่ทำงาน
 * โพสต์ที่ตั้งเวลาไว้จะนอนอยู่ใน DB เฉยๆ ตลอดไปโดยไม่มี error อะไรเลย
 */
export function publishTickHandler(scheduler: PublishScheduler): JobHandler {
  return {
    name: cronJobName("publish-tick"),
    async run(data: unknown): Promise<JobOutcome> {
      decodeSweepJob(data);
      const r = await scheduler.tick();
      return {
        th:
          r.enqueued === 0
            ? "ยังไม่มีโพสต์ที่ถึงเวลา"
            : `ยัดงานโพสต์เข้าคิวแล้ว ${r.enqueued} งาน จาก ${r.posts} โพสต์`,
        details: { enqueued: r.enqueued, posts: r.posts },
      };
    },
  };
}

export interface AlertsTickOptions {
  center: AlertCenter;
  /** ตรวจปัญหาทุกเพจ ณ เวลานี้ — ต้องอ่านข้อมูลสดจาก DB */
  collect: (nowMs: number) => Promise<readonly Problem[]>;
}

export function alertsTickHandler(opts: AlertsTickOptions): JobHandler {
  return {
    name: cronJobName("alerts-tick"),
    async run(data: unknown, ctx: JobContext): Promise<JobOutcome> {
      decodeSweepJob(data);
      const problems = await opts.collect(ctx.nowMs);
      const r = await opts.center.run(problems);
      return {
        th: r.th,
        details: {
          problems: problems.length,
          sent: r.sent.length,
          heldBack: r.heldBack,
          resolved: r.resolved.length,
        },
      };
    },
  };
}

/**
 * ตัวแทนของรอบที่ยังไม่ได้ต่อกับของจริง
 *
 * ลงทะเบียนไว้แทนที่จะปล่อยว่าง เพราะถ้าไม่ลงทะเบียน งานจะกองอยู่ในคิว
 * โดยมองไม่ออกว่าต่างจาก "ยังไม่ถึงคิว" — แบบนี้มันจะไปกอง `failed`
 * พร้อมข้อความบอกว่าต้องเขียนอะไรเพิ่ม
 */
export function notWiredHandler(cronName: string, missingTh: string): JobHandler {
  const name = cronJobName(cronName);
  return {
    name,
    async run(): Promise<JobOutcome> {
      throw new NotWiredError(name, missingTh);
    },
  };
}
