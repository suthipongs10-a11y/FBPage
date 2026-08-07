/**
 * Rate limiting 2 ชั้น (สเปกข้อ 5 หน้าที่ 3 และ 4)
 *
 *  ชั้น 1  TokenBucket ต่อเพจ  — กันไม่ให้ยิงถี่เกินตั้งแต่ต้นทาง (proactive)
 *  ชั้น 2  UsageGovernor       — อ่าน X-App-Usage / X-Page-Usage ที่ Meta ตอบกลับ
 *                                ถ้า > 80% ชะลออัตโนมัติ (reactive)
 *
 * ทั้งคู่รับ Clock เข้ามา → เทสต์ได้โดยไม่ต้องรอเวลาจริง
 */
import type { Clock } from "@page-os/core";

export interface TokenBucketOptions {
  /** จำนวน token สูงสุดที่สะสมได้ = ยิงรัวติดกันได้กี่ครั้ง */
  capacity: number;
  /** เติม token กี่ตัวต่อวินาที */
  refillPerSec: number;
  clock: Clock;
  /** เริ่มต้นด้วย token เต็มถังหรือไม่ (ค่าเริ่มต้น: เต็ม) */
  initialTokens?: number;
}

/**
 * Token bucket แบบ FIFO — คนที่ขอก่อนได้ก่อน
 * ป้องกันปัญหา job ที่มาทีหลังแซงคิวจนงานเก่าค้างตลอด
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly clock: Clock;
  /** ล่ามคิวไว้ให้ take() ทำงานทีละคนตามลำดับที่เรียก */
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  constructor(opts: TokenBucketOptions) {
    if (opts.capacity <= 0) throw new Error("TokenBucket: capacity ต้อง > 0");
    if (opts.refillPerSec <= 0)
      throw new Error("TokenBucket: refillPerSec ต้อง > 0");
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerSec / 1000;
    this.clock = opts.clock;
    this.tokens = opts.initialTokens ?? opts.capacity;
    this.lastRefillMs = opts.clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) return;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerMs,
    );
    this.lastRefillMs = now;
  }

  /** token ที่มีอยู่ตอนนี้ (สำหรับ metric/เทสต์) */
  get available(): number {
    this.refill();
    return this.tokens;
  }

  /** จำนวนคนที่รออยู่ในคิว */
  get queueLength(): number {
    return this.waiting;
  }

  /**
   * อีกกี่ ms ถึงจะมี token พอ — ดูอย่างเดียว ไม่จองไม่หัก
   *
   * PageScheduler ใช้ตัวนี้เพื่อ "รอก่อน แล้วค่อยเลือกคน" ถ้าเลือกคนก่อนแล้วให้ไปรอ
   * ที่ take() งาน priority สูงที่มาระหว่างรอจะแซงไม่ได้ (priority inversion)
   */
  msUntilAvailable(cost = 1): number {
    this.refill();
    if (this.tokens >= cost) return 0;
    return Math.max(1, Math.ceil((cost - this.tokens) / this.refillPerMs));
  }

  /**
   * ขอ token — ถ้าไม่พอจะรอจนเติมครบ (นี่คือ "เข้าคิวถ้าใกล้เต็ม" ของสเปก)
   * @throws AbortError ถ้า signal ถูกยกเลิกระหว่างรอ
   */
  async take(cost = 1, signal?: AbortSignal): Promise<void> {
    if (cost <= 0) return;
    if (cost > this.capacity) {
      throw new Error(
        `TokenBucket: ขอ ${cost} token แต่ถังจุได้แค่ ${this.capacity} — จะรอไม่มีวันจบ`,
      );
    }
    this.waiting++;
    const run = this.tail.then(
      () => this.acquire(cost, signal),
      () => this.acquire(cost, signal),
    );
    // tail ต้องไม่พก rejection ต่อ ไม่งั้นคนถัดไปพังตาม
    this.tail = run.catch(() => undefined);
    try {
      await run;
    } finally {
      this.waiting--;
    }
  }

  private async acquire(cost: number, signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      const deficit = cost - this.tokens;
      const waitMs = Math.max(1, Math.ceil(deficit / this.refillPerMs));
      await this.clock.sleep(waitMs, signal);
    }
  }
}

// ---------------------------------------------------------------------------

/** ตัวเลขที่ Meta ส่งกลับใน X-App-Usage / X-Page-Usage (หน่วยเป็น %) */
export interface UsageSnapshot {
  callCount: number;
  totalTime: number;
  totalCputime: number;
  /** วินาทีที่ต้องรอก่อนใช้ได้อีก (มากับ X-Business-Use-Case-Usage) */
  estimatedTimeToRegainAccessSec?: number;
}

export interface UsageReading extends UsageSnapshot {
  /** ค่าสูงสุดในสามตัว = ตัวที่จะชนเพดานก่อน */
  peakPct: number;
  observedAtMs: number;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** แปลง header X-App-Usage / X-Page-Usage (JSON string) → snapshot */
export function parseUsageHeader(raw: string | null): UsageSnapshot | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o === null || typeof o !== "object") return null;
    return {
      callCount: num(o["call_count"]),
      totalTime: num(o["total_time"]),
      totalCputime: num(o["total_cputime"]),
    };
  } catch {
    return null;
  }
}

/**
 * X-Business-Use-Case-Usage มีหน้าตาเป็น { "<businessId>": [ {...}, ... ] }
 * เอาตัวที่แย่ที่สุดมาใช้ และดึง estimated_time_to_regain_access ถ้ามี
 */
export function parseBusinessUsageHeader(
  raw: string | null,
): UsageSnapshot | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o === null || typeof o !== "object") return null;
    let worst: UsageSnapshot | null = null;
    for (const entries of Object.values(o)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (e === null || typeof e !== "object") continue;
        const rec = e as Record<string, unknown>;
        const snap: UsageSnapshot = {
          callCount: num(rec["call_count"]),
          totalTime: num(rec["total_time"]),
          totalCputime: num(rec["total_cputime"]),
          estimatedTimeToRegainAccessSec: num(
            rec["estimated_time_to_regain_access"],
          ),
        };
        const peak = Math.max(
          snap.callCount,
          snap.totalTime,
          snap.totalCputime,
        );
        const worstPeak = worst
          ? Math.max(worst.callCount, worst.totalTime, worst.totalCputime)
          : -1;
        // เลือกตัวที่ใช้โควตาไปมากที่สุด หรือตัวที่บอกว่าต้องรอนานที่สุด
        if (
          peak > worstPeak ||
          (snap.estimatedTimeToRegainAccessSec ?? 0) >
            (worst?.estimatedTimeToRegainAccessSec ?? 0)
        ) {
          worst = snap;
        }
      }
    }
    return worst;
  } catch {
    return null;
  }
}

/** ระดับการชะลอตาม % ที่ใช้ไป — สเปกกำหนดเส้นไว้ที่ 80% */
export const THROTTLE_THRESHOLD_PCT = 80;

const TIERS: Array<{ atLeast: number; delayMs: number }> = [
  { atLeast: 100, delayMs: 60_000 },
  { atLeast: 95, delayMs: 15_000 },
  { atLeast: 90, delayMs: 5_000 },
  { atLeast: THROTTLE_THRESHOLD_PCT, delayMs: 1_000 },
];

/** อ่านค่า % แล้วบอกว่าควรหน่วงกี่ ms ก่อนยิงครั้งถัดไป */
export function delayForUsagePct(pct: number): number {
  for (const t of TIERS) {
    if (pct >= t.atLeast) return t.delayMs;
  }
  return 0;
}

export interface UsageGovernorOptions {
  clock: Clock;
  /** ค่าที่อ่านมาเก่ากว่านี้ถือว่าหมดอายุ (ms) — ค่าเริ่มต้น 5 นาที */
  staleAfterMs?: number;
}

/**
 * เก็บสถานะโควตาที่ Meta บอกมา แล้วแปลงเป็น "ต้องหน่วงกี่ ms"
 *
 * scope: ใช้ "app" สำหรับ X-App-Usage และ pageId สำหรับ X-Page-Usage
 * เวลาจะยิง ให้เอาค่าหน่วงที่มากที่สุดของทุก scope ที่เกี่ยวข้อง
 */
export class UsageGovernor {
  private readonly readings = new Map<string, UsageReading>();
  /** เวลาที่ห้ามยิงจนกว่าจะถึง (จาก estimated_time_to_regain_access) */
  private readonly blockedUntil = new Map<string, number>();
  private readonly clock: Clock;
  private readonly staleAfterMs: number;

  constructor(opts: UsageGovernorOptions) {
    this.clock = opts.clock;
    this.staleAfterMs = opts.staleAfterMs ?? 5 * 60_000;
  }

  observe(scope: string, snap: UsageSnapshot | null): void {
    if (!snap) return;
    const peakPct = Math.max(snap.callCount, snap.totalTime, snap.totalCputime);
    const now = this.clock.now();
    this.readings.set(scope, { ...snap, peakPct, observedAtMs: now });
    const regain = snap.estimatedTimeToRegainAccessSec ?? 0;
    if (regain > 0) {
      this.blockedUntil.set(scope, now + regain * 1000);
    }
  }

  reading(scope: string): UsageReading | undefined {
    const r = this.readings.get(scope);
    if (!r) return undefined;
    if (this.clock.now() - r.observedAtMs > this.staleAfterMs) return undefined;
    return r;
  }

  /** ต้องหน่วงกี่ ms ก่อนยิง scope นี้ */
  delayFor(scope: string): number {
    const now = this.clock.now();
    const blocked = this.blockedUntil.get(scope);
    if (blocked !== undefined) {
      if (blocked > now) return blocked - now;
      this.blockedUntil.delete(scope);
    }
    const r = this.reading(scope);
    if (!r) return 0;
    return delayForUsagePct(r.peakPct);
  }

  /** หน่วงตามค่าที่แย่ที่สุดของทุก scope ที่ส่งมา */
  delayForAll(scopes: string[]): number {
    let max = 0;
    for (const s of scopes) max = Math.max(max, this.delayFor(s));
    return max;
  }

  /** ใกล้เต็มโควตาแล้วหรือยัง — ใช้ยิง alert เข้า LINE (M8) */
  isNearLimit(scope: string): boolean {
    const r = this.reading(scope);
    return r !== undefined && r.peakPct >= THROTTLE_THRESHOLD_PCT;
  }

  snapshotAll(): Record<string, UsageReading> {
    const out: Record<string, UsageReading> = {};
    for (const [k] of this.readings) {
      const r = this.reading(k);
      if (r) out[k] = r;
    }
    return out;
  }
}
