/**
 * Clock ที่ inject ได้ — ทำให้ rate limiter / backoff / SLA timer เทสต์ได้
 * โดยไม่ต้องรอเวลาจริง และบังคับให้ทุกที่ใช้ UTC epoch ms (กฎข้อ 4)
 */
export interface Clock {
  /** epoch milliseconds (UTC) */
  now(): number;
  /** รอ ms — cancel ได้ผ่าน AbortSignal */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** ปล่อยให้ microtask queue เดินจนสุด (setImmediate เป็น macrotask จึงมาหลัง microtask ทั้งหมด) */
function tick(): Promise<void> {
  return new Promise<void>((r) => setImmediate(r));
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

/**
 * นาฬิกาปลอมสำหรับเทสต์ — เวลาเดินเมื่อเรา advance เท่านั้น
 * sleep() จะ resolve เมื่อเวลาถูกดันไปถึงกำหนด
 */
export class FakeClock implements Clock {
  private current: number;
  private timers: Array<{ at: number; resolve: () => void; seq: number }> = [];
  private seq = 0;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      const entry = { at: this.current + ms, resolve, seq: this.seq++ };
      this.timers.push(entry);
      signal?.addEventListener(
        "abort",
        () => {
          this.timers = this.timers.filter((t) => t !== entry);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  /**
   * ดันเวลาไปข้างหน้าแล้วปล่อย timer ที่ถึงกำหนด (เรียงตามเวลา แล้วตามลำดับที่สร้าง)
   *
   * ต้อง drain microtask **ก่อน** ตรวจ timer ทุกรอบ เพราะโค้ดที่รออยู่ในคิว
   * (เช่น taker ตัวถัดไปของ TokenBucket) ยังไม่ทันได้เรียก sleep() ลงทะเบียน timer
   * ถ้าเช็คก่อน จะเห็นคิวว่างแล้วจบเร็วเกินไป งานที่เหลือค้างตลอดกาล
   */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    // กันลูปไม่รู้จบถ้ามีโค้ดตั้ง timer ซ้ำที่เวลาเดิมไม่หยุด
    const MAX_STEPS = 100_000;
    for (let step = 0; ; step++) {
      if (step > MAX_STEPS) {
        throw new Error(
          `FakeClock.advance: ปล่อย timer เกิน ${MAX_STEPS} ครั้ง — น่าจะมีลูป sleep ไม่รู้จบ`,
        );
      }
      await tick();
      const next = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.current = Math.max(this.current, next.at);
      next.resolve();
    }
    this.current = target;
    await tick();
  }

  /** จำนวน timer ที่ยังค้าง — ใช้ assert ว่าไม่มี sleep รั่ว */
  get pendingTimers(): number {
    return this.timers.length;
  }

  /**
   * เดินนาฬิกาไปเรื่อยๆ จนกว่า promise จะเสร็จ
   *
   * ใช้กับโค้ดที่มี backoff/retry ซ้อนกันหลายชั้นซึ่งเราไม่รู้ล่วงหน้าว่า
   * ต้องดันเวลาไปเท่าไหร่ (เช่น health check ที่วนหลายเพจ)
   */
  async runUntilSettled<T>(promise: Promise<T>, stepMs = 1000): Promise<T> {
    let settled = false;
    const tracked = promise.then(
      (v) => {
        settled = true;
        return v;
      },
      (e: unknown) => {
        settled = true;
        throw e;
      },
    );
    // กันลูปไม่รู้จบถ้า promise ไม่มีวันเสร็จ
    for (let i = 0; i < 100_000 && !settled; i++) {
      await this.advance(stepMs);
    }
    if (!settled) {
      throw new Error(
        "FakeClock.runUntilSettled: promise ไม่เสร็จสักที — น่าจะรออะไรที่ไม่ใช่ timer",
      );
    }
    return tracked;
  }
}
