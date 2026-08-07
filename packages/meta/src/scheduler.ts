/**
 * คิวต่อเพจแบบมีลำดับความสำคัญ วางไว้หน้า TokenBucket
 *
 * เหตุผล: TokenBucket เป็น FIFO ล้วน ถ้าโควตาใกล้เต็มแล้วมีงาน bulk 500 ตัว
 * เข้าคิวไว้ก่อน งาน "ตอบลูกค้าใน inbox" ที่เข้ามาทีหลังจะติดหลังทั้งหมด
 * ซึ่งทำให้ 24h window หลุด — จึงต้องให้แซงได้
 */
import type { Clock } from "@page-os/core";
import { PRIORITY_WEIGHT, type CallPriority } from "./types.js";
import type { TokenBucket } from "./rate-limit.js";

interface Waiter {
  weight: number;
  seq: number;
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface PageSchedulerOptions {
  bucket: TokenBucket;
  clock: Clock;
  /** คืนค่าหน่วงจาก UsageGovernor ก่อนปล่อยแต่ละ call */
  delayBeforeRelease?: () => number;
}

export class PageScheduler {
  private readonly waiters: Waiter[] = [];
  private readonly bucket: TokenBucket;
  private readonly clock: Clock;
  private readonly delayBeforeRelease: () => number;
  private draining = false;
  private seq = 0;
  /**
   * เวลาที่ปล่อยงานครั้งล่าสุด — ใช้เป็นหลักในการเว้นจังหวะ
   * -Infinity = ยังไม่เคยปล่อย จึงไม่ต้องหน่วงงานแรก
   */
  private lastReleaseAtMs = -Infinity;

  constructor(opts: PageSchedulerOptions) {
    this.bucket = opts.bucket;
    this.clock = opts.clock;
    this.delayBeforeRelease = opts.delayBeforeRelease ?? (() => 0);
  }

  get queueLength(): number {
    return this.waiters.length;
  }

  /** รอจนถึงคิวตัวเอง — resolve แล้วค่อยยิง HTTP ได้ */
  acquire(priority: CallPriority, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const waiter: Waiter = {
        weight: PRIORITY_WEIGHT[priority] ?? PRIORITY_WEIGHT.normal,
        seq: this.seq++,
        resolve,
        reject,
        signal,
      };
      if (signal) {
        waiter.onAbort = () => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) {
            this.waiters.splice(i, 1);
            reject(new DOMException("Aborted", "AbortError"));
          }
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      void this.drain();
    });
  }

  private cleanup(w: Waiter): void {
    if (w.signal && w.onAbort) {
      w.signal.removeEventListener("abort", w.onAbort);
    }
  }

  /** ดึงคนที่ควรได้ไปก่อนออกจากคิว: priority สูงสุด เท่ากันให้คนที่มาก่อน */
  private takeBest(): Waiter | undefined {
    if (this.waiters.length === 0) return undefined;
    let bestIdx = 0;
    for (let i = 1; i < this.waiters.length; i++) {
      const a = this.waiters[i]!;
      const b = this.waiters[bestIdx]!;
      if (a.weight > b.weight || (a.weight === b.weight && a.seq < b.seq)) {
        bestIdx = i;
      }
    }
    return this.waiters.splice(bestIdx, 1)[0]!;
  }

  /**
   * ลำดับสำคัญมาก: **รอให้ยิงได้ก่อน แล้วค่อยเลือกคน**
   *
   * ถ้าเลือกคนก่อนแล้วให้คนนั้นไปรอ token งานที่ priority สูงกว่าซึ่งเข้ามา
   * ระหว่างรอจะติดอยู่หลังงาน bulk — ซึ่งคือกรณีที่ทำให้ตอบ inbox ไม่ทัน 24h window
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.waiters.length > 0) {
        const now = this.clock.now();
        // เว้นจังหวะนับจาก "การปล่อยครั้งก่อน" ตามโควตาปัจจุบัน (สเปกข้อ 5.4)
        //
        // ต้อง anchor ที่ lastReleaseAtMs ไม่ใช่ now ไม่งั้นพอโควตาค้างที่ 90%
        // ค่าหน่วงจะถูกคิดใหม่ทุกรอบจนวนรอไม่มีวันได้ปล่อยงาน
        const paceWait = Math.max(
          0,
          this.lastReleaseAtMs + this.delayBeforeRelease() - now,
        );
        const tokenWait = this.bucket.msUntilAvailable(1);
        const wait = Math.max(paceWait, tokenWait);
        if (wait > 0) {
          await this.clock.sleep(wait);
          // วนกลับไปเลือกใหม่ — ระหว่างที่รอ อาจมีงานด่วนกว่าเข้ามา
          continue;
        }

        const next = this.takeBest();
        if (!next) continue;
        if (next.signal?.aborted) {
          this.cleanup(next);
          next.reject(new DOMException("Aborted", "AbortError"));
          continue;
        }

        try {
          // ถึงตรงนี้มี token แน่แล้ว take() จึงคืนทันทีไม่บล็อก
          await this.bucket.take(1, next.signal);
        } catch (err) {
          this.cleanup(next);
          next.reject(err);
          continue;
        }
        this.lastReleaseAtMs = this.clock.now();
        this.cleanup(next);
        next.resolve();
      }
    } finally {
      this.draining = false;
      // ถ้ามีคนเข้าคิวระหว่างที่กำลังปิด loop ให้เริ่มใหม่
      if (this.waiters.length > 0) void this.drain();
    }
  }
}
