/**
 * บันทึกทุก call ที่ยิงไป Meta ลง DB (สเปกข้อ 5 หน้าที่ที่ 7)
 *
 * มีไว้ตอบคำถามเดียวที่จะถูกถามบ่อยที่สุด: **"ทำไมโพสต์ไม่ขึ้น"**
 * ถ้าไม่มี log นี้ คำตอบคือ "ไม่รู้" ซึ่งใช้กับลูกค้าไม่ได้
 *
 * ⚠️ ข้อบังคับจาก interface: `record()` ต้องไม่โยน error และไม่บล็อก call หลัก
 *
 * เหตุผลมาจากบั๊กจริงที่เจอตอน M-A: ถ้า `record()` โยน error มันจะถูกจับโดย
 * catch ของ retry loop แล้ว retry ทั้ง call ใหม่ — DB สะดุดหลังโพสต์ขึ้นเพจสำเร็จ
 * จึงกลายเป็นโพสต์ซ้ำบนเพจลูกค้า
 *
 * ที่นี่จึงเขียนแบบ "ยิงแล้วไม่รอ" และกลืน error ทุกกรณี แต่นับไว้ให้เห็น
 */
import { nullLogger, type Logger } from "@page-os/core";
import type { CallLogEntry, CallLogSink } from "@page-os/meta";
import type { PrismaClient } from "./client.js";

export interface PrismaCallLogOptions {
  prisma: PrismaClient;
  logger?: Logger;
}

export class PrismaCallLog implements CallLogSink {
  private readonly prisma: PrismaClient;
  private readonly logger: Logger;
  private dropped = 0;
  /** งานเขียนที่ยังไม่เสร็จ — ใช้ `flush()` รอตอนปิด process */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(opts: PrismaCallLogOptions) {
    this.prisma = opts.prisma;
    this.logger = opts.logger ?? nullLogger;
  }

  /** จำนวนรายการที่เขียนไม่สำเร็จ — ต้องมีคนเฝ้าตัวเลขนี้ */
  get droppedCount(): number {
    return this.dropped;
  }

  record(entry: CallLogEntry): void {
    const task = this.prisma.metaCallLog
      .create({
        data: {
          pageId: entry.pageId,
          method: entry.method,
          path: entry.path,
          httpStatus: entry.httpStatus,
          ok: entry.ok,
          durationMs: Math.round(entry.durationMs),
          attempts: entry.attempts,
          errorCode: entry.errorCode ?? null,
          errorSubcode: entry.errorSubcode ?? null,
          errorMessage: entry.errorMessage ?? null,
          errorTh: entry.errorTh ?? null,
          fbtraceId: entry.fbtraceId ?? null,
          appUsagePct: entry.appUsagePct ?? null,
          pageUsagePct: entry.pageUsagePct ?? null,
          priority: entry.priority,
          createdAt: new Date(entry.startedAtMs),
        },
      })
      .then(
        () => undefined,
        (err: unknown) => {
          // ห้ามโยนต่อเด็ดขาด — ดูเหตุผลในหัวไฟล์
          this.dropped += 1;
          this.logger.warn("บันทึก call log ไม่สำเร็จ", {
            path: entry.path,
            err,
          });
        },
      )
      .finally(() => {
        this.inFlight.delete(task);
      });

    this.inFlight.add(task);
  }

  /** รอให้งานเขียนที่ค้างอยู่เสร็จ — เรียกก่อนปิด worker ไม่งั้น log หายท้ายรอบ */
  async flush(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }
}
