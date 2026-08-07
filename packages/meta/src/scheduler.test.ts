import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import { TokenBucket } from "./rate-limit.js";
import { PageScheduler } from "./scheduler.js";
import type { CallPriority } from "./types.js";

function setup(opts: {
  capacity?: number;
  refillPerSec?: number;
  initialTokens?: number;
  delay?: () => number;
} = {}) {
  const clock = new FakeClock();
  const bucket = new TokenBucket({
    capacity: opts.capacity ?? 1,
    refillPerSec: opts.refillPerSec ?? 1,
    clock,
    initialTokens: opts.initialTokens ?? 0,
  });
  const scheduler = new PageScheduler({
    bucket,
    clock,
    delayBeforeRelease: opts.delay,
  });
  return { clock, bucket, scheduler };
}

describe("PageScheduler", () => {
  it("งาน priority สูงแซงคิวได้ — ไม่งั้น 24h window หลุดเพราะงาน bulk", async () => {
    const { clock, scheduler } = setup();
    const order: string[] = [];

    const jobs: Array<[string, CallPriority]> = [
      ["bulk1", "bulk"],
      ["bulk2", "bulk"],
      ["low1", "low"],
      ["inbox", "realtime"],
      ["post", "high"],
    ];
    const ps = jobs.map(([name, p]) =>
      scheduler.acquire(p).then(() => {
        order.push(name);
      }),
    );

    await clock.advance(10_000);
    await Promise.all(ps);

    expect(order).toEqual(["inbox", "post", "low1", "bulk1", "bulk2"]);
  });

  it("priority เท่ากันให้คนที่มาก่อนไปก่อน", async () => {
    const { clock, scheduler } = setup();
    const order: number[] = [];
    const ps = [1, 2, 3].map((n) =>
      scheduler.acquire("normal").then(() => {
        order.push(n);
      }),
    );
    await clock.advance(5000);
    await Promise.all(ps);
    expect(order).toEqual([1, 2, 3]);
  });

  it("ปล่อยได้ทันทีเมื่อยังมี token เหลือ", async () => {
    const { clock, scheduler } = setup({ capacity: 5, initialTokens: 5 });
    let done = false;
    const p = scheduler.acquire("normal").then(() => {
      done = true;
    });
    await clock.advance(0);
    await p;
    expect(done).toBe(true);
  });

  it("เว้นจังหวะ *ระหว่าง* การปล่อยตาม delayBeforeRelease (มาจาก X-App-Usage)", async () => {
    let delay = 0;
    const { clock, scheduler } = setup({
      capacity: 5,
      initialTokens: 5,
      delay: () => delay,
    });

    // งานแรกไม่ถูกหน่วง — ยังไม่มีค่าโควตาให้อ่าน
    let first = false;
    const p1 = scheduler.acquire("normal").then(() => {
      first = true;
    });
    await clock.advance(0);
    await p1;
    expect(first).toBe(true);

    // อ่าน X-App-Usage ได้ 92% → งานถัดไปต้องเว้นระยะจากงานก่อนหน้า
    delay = 5000;
    let second = false;
    const p2 = scheduler.acquire("normal").then(() => {
      second = true;
    });
    await clock.advance(4998);
    expect(second).toBe(false);
    await clock.advance(3);
    await p2;
    expect(second).toBe(true);

    // โควตากลับมาปกติ → ปล่อยทันที
    delay = 0;
    let third = false;
    const p3 = scheduler.acquire("normal").then(() => {
      third = true;
    });
    await clock.advance(0);
    await p3;
    expect(third).toBe(true);
  });

  it("โควตาค้างสูงต้องยังปล่อยงานได้ ไม่วนรอไม่รู้จบ", async () => {
    // ถ้า anchor ค่าหน่วงที่ now แทน lastRelease ลูปจะคิดหน่วงใหม่ทุกรอบจนไม่มีวันปล่อย
    const { clock, scheduler } = setup({
      capacity: 10,
      initialTokens: 10,
      delay: () => 1000,
    });
    const done: number[] = [];
    const ps = [1, 2, 3].map((n) =>
      scheduler.acquire("normal").then(() => {
        done.push(n);
      }),
    );
    await clock.advance(10_000);
    await Promise.all(ps);
    expect(done).toEqual([1, 2, 3]);
  });

  it("ยกเลิกงานที่ยังรออยู่ในคิวได้ และไม่ทำให้คิวที่เหลือค้าง", async () => {
    const { clock, scheduler } = setup();
    const ctl = new AbortController();
    const cancelled = scheduler.acquire("low", ctl.signal);
    let ok = false;
    const other = scheduler.acquire("low").then(() => {
      ok = true;
    });

    await clock.advance(0);
    ctl.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    await clock.advance(5000);
    await other;
    expect(ok).toBe(true);
  });

  it("ปฏิเสธทันทีถ้า signal ถูกยกเลิกไปแล้วก่อนเข้าคิว", async () => {
    const { scheduler } = setup();
    const ctl = new AbortController();
    ctl.abort();
    await expect(scheduler.acquire("normal", ctl.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
  });

  it("นับความยาวคิวได้ถูกต้อง", async () => {
    const { clock, scheduler } = setup();
    const ps = [
      scheduler.acquire("normal"),
      scheduler.acquire("normal"),
      scheduler.acquire("normal"),
    ];
    await clock.advance(0);
    expect(scheduler.queueLength).toBeGreaterThan(0);
    await clock.advance(10_000);
    await Promise.all(ps);
    expect(scheduler.queueLength).toBe(0);
  });

  it("งานที่เข้ามาหลัง drain loop จบแล้ว ยังถูกปล่อย", async () => {
    const { clock, scheduler } = setup({ capacity: 2, initialTokens: 2 });
    await scheduler.acquire("normal");
    await clock.advance(0);

    // รอบสอง — drain loop ปิดไปแล้ว ต้องเริ่มใหม่ได้เอง
    let done = false;
    const p = scheduler.acquire("normal").then(() => {
      done = true;
    });
    await clock.advance(0);
    await p;
    expect(done).toBe(true);
  });
});
