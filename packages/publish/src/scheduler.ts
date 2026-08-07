/**
 * ตัวจับเวลาโพสต์ของเราเอง (M4)
 *
 * สเปกสั่งชัดว่า **ห้ามใช้ `scheduled_publish_time` ของ Meta** เพราะ:
 *   - แก้/ยกเลิกยาก ต้องไปยุ่งกับโพสต์ที่อยู่ในคิวของ Meta
 *   - ไม่มี log ให้ดูว่าทำไมไม่ขึ้น
 *   - cross-post หลายเพจพร้อมกันคุมลำดับไม่ได้
 *
 * แทนที่ด้วย: เก็บ scheduledAt (UTC) ใน DB → ตัวนี้หาโพสต์ที่ถึงเวลา → ยัดเข้าคิว
 */
import { systemClock, type Clock, type Logger } from "@page-os/core";
import { nullLogger } from "@page-os/core";
import type { PublishJob, ScheduledPost } from "./types.js";

/** คิวงาน — BullMQ จะมา implement ตัวนี้ */
export interface PublishQueue {
  /** ใส่งานเข้าคิว; jobKey ใช้กัน enqueue ซ้ำ */
  enqueue(args: {
    job: PublishJob;
    /** หน่วงกี่ ms ก่อนทำงาน (0 = ทันที) */
    delayMs: number;
    jobKey: string;
  }): Promise<void>;
  /** ยกเลิกงานที่ยังไม่ได้ทำของโพสต์นี้ */
  cancelForPost(postId: string): Promise<void>;
}

export interface DuePostSource {
  /** โพสต์ที่ถึงเวลาแล้วและยังไม่ได้ยิง */
  findDue(nowMs: number, limit: number): Promise<
    Array<{ post: ScheduledPost; targetPageIds: string[] }>
  >;
  markQueued(postId: string): Promise<void>;
}

export interface PublishSchedulerOptions {
  queue: PublishQueue;
  source: DuePostSource;
  clock?: Clock;
  logger?: Logger;
  /** หยิบมากี่โพสต์ต่อรอบ */
  batchSize?: number;
}

/** jobKey ที่แน่นอน — enqueue ซ้ำด้วย key เดิมต้องไม่เกิดงานซ้ำ */
export function publishJobKey(postId: string, pageId: string): string {
  return `publish:${postId}:${pageId}`;
}

export class PublishScheduler {
  private readonly queue: PublishQueue;
  private readonly source: DuePostSource;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly batchSize: number;

  constructor(opts: PublishSchedulerOptions) {
    this.queue = opts.queue;
    this.source = opts.source;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
    this.batchSize = opts.batchSize ?? 100;
  }

  /** เรียกทุกนาทีจาก cron */
  async tick(): Promise<{ enqueued: number; posts: number }> {
    const now = this.clock.now();
    const due = await this.source.findDue(now, this.batchSize);
    let enqueued = 0;

    for (const { post, targetPageIds } of due) {
      if (targetPageIds.length === 0) {
        this.logger.warn("โพสต์ถึงเวลาแล้วแต่ไม่มีเพจปลายทาง", {
          postId: post.id,
        });
        continue;
      }
      for (const pageId of targetPageIds) {
        await this.queue.enqueue({
          job: { postId: post.id, pageId, attempt: 1 },
          delayMs: 0,
          jobKey: publishJobKey(post.id, pageId),
        });
        enqueued++;
      }
      await this.source.markQueued(post.id);
    }

    if (enqueued > 0) {
      this.logger.info("ยัดงานโพสต์เข้าคิวแล้ว", {
        posts: due.length,
        enqueued,
      });
    }
    return { enqueued, posts: due.length };
  }

  /** ตั้งเวลาโพสต์ใหม่ / เลื่อนเวลา — ยกเลิกงานเก่าก่อนเสมอ */
  async reschedule(postId: string): Promise<void> {
    await this.queue.cancelForPost(postId);
  }

  /** ใส่งาน retry กลับเข้าคิว */
  async scheduleRetry(job: PublishJob, delayMs: number): Promise<void> {
    await this.queue.enqueue({
      job,
      delayMs,
      // ใส่รอบไว้ใน key ไม่งั้นจะชนกับงานเดิมที่เพิ่งจบ
      jobKey: `${publishJobKey(job.postId, job.pageId)}:retry:${job.attempt}`,
    });
  }
}

// ---------------------------------------------------------------------------

/**
 * แปลงเวลาที่ผู้ใช้เลือก (ตาม timezone ของเพจ) → epoch ms สำหรับเก็บใน DB
 *
 * กฎข้อ 4: DB เก็บ UTC เสมอ ที่แสดงให้ผู้ใช้เห็นค่อยแปลงตาม timezone เพจ
 * เขียนแยกเป็นฟังก์ชันเพื่อให้มีที่เดียวที่ทำเรื่องนี้ ลดโอกาสพลาดชั่วโมง
 */
export function localTimeToUtcMs(
  localIso: string,
  timeZone: string,
): number {
  // ตีความ localIso เป็นเวลาใน timeZone ที่กำหนด
  const m = localIso.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) {
    throw new Error(
      `รูปแบบเวลาไม่ถูกต้อง: "${localIso}" — ต้องเป็น YYYY-MM-DDTHH:mm`,
    );
  }
  const [, y, mo, d, h, mi, s] = m as unknown as string[];
  // เริ่มจากเดาว่าเป็น UTC แล้วหา offset จริงของ timeZone ณ เวลานั้น
  const guess = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? "0"),
  );
  const offset = timeZoneOffsetMs(guess, timeZone);
  // ปรับสองรอบ กันกรณีข้ามเส้นเปลี่ยน DST
  const first = guess - offset;
  const offset2 = timeZoneOffsetMs(first, timeZone);
  return guess - offset2;
}

/** offset ของ timeZone ณ เวลานั้น (ms) — บวกคือเร็วกว่า UTC */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
}

/** แปลงกลับ: epoch ms → ข้อความเวลาท้องถิ่นของเพจ สำหรับแสดงผล */
export function utcMsToLocalText(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(utcMs));
}
