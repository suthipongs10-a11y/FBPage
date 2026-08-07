import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import {
  THROTTLE_THRESHOLD_PCT,
  TokenBucket,
  UsageGovernor,
  delayForUsagePct,
  parseBusinessUsageHeader,
  parseUsageHeader,
} from "./rate-limit.js";

describe("TokenBucket", () => {
  it("ยิงรัวได้ตามขนาดถัง แล้วต้องรอ", async () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 3, refillPerSec: 1, clock });

    await b.take();
    await b.take();
    await b.take();
    expect(Math.floor(b.available)).toBe(0);

    let done = false;
    const p = b.take().then(() => {
      done = true;
    });
    await clock.advance(0);
    expect(done).toBe(false); // ยังไม่มี token

    await clock.advance(1000); // เติม 1 token
    await p;
    expect(done).toBe(true);
  });

  it("เติม token ตามเวลาที่ผ่านไป และไม่เกินความจุ", async () => {
    const clock = new FakeClock();
    const b = new TokenBucket({
      capacity: 5,
      refillPerSec: 2,
      clock,
      initialTokens: 0,
    });
    await clock.advance(1000);
    expect(Math.floor(b.available)).toBe(2);
    await clock.advance(60_000);
    expect(b.available).toBe(5); // ไม่ล้นถัง
  });

  it("ปล่อยตามลำดับที่ขอ (FIFO)", async () => {
    const clock = new FakeClock();
    const b = new TokenBucket({
      capacity: 1,
      refillPerSec: 1,
      clock,
      initialTokens: 0,
    });
    const order: number[] = [];
    const ps = [1, 2, 3].map((n) =>
      b.take().then(() => {
        order.push(n);
      }),
    );
    await clock.advance(3000);
    await Promise.all(ps);
    expect(order).toEqual([1, 2, 3]);
  });

  it("นับคิวที่รออยู่ได้", async () => {
    const clock = new FakeClock();
    const b = new TokenBucket({
      capacity: 1,
      refillPerSec: 1,
      clock,
      initialTokens: 0,
    });
    const ps = [b.take(), b.take()];
    await clock.advance(0);
    expect(b.queueLength).toBe(2);
    await clock.advance(2000);
    await Promise.all(ps);
    expect(b.queueLength).toBe(0);
  });

  it("ยกเลิกด้วย AbortSignal ได้ระหว่างรอ", async () => {
    const clock = new FakeClock();
    const b = new TokenBucket({
      capacity: 1,
      refillPerSec: 1,
      clock,
      initialTokens: 0,
    });
    const ctl = new AbortController();
    const p = b.take(1, ctl.signal);
    await clock.advance(0);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("คนที่ถูก abort ไม่ทำให้คิวคนถัดไปพัง", async () => {
    const clock = new FakeClock();
    const b = new TokenBucket({
      capacity: 1,
      refillPerSec: 1,
      clock,
      initialTokens: 0,
    });
    const ctl = new AbortController();
    const p1 = b.take(1, ctl.signal);
    let ok = false;
    const p2 = b.take().then(() => {
      ok = true;
    });
    await clock.advance(0);
    ctl.abort();
    await expect(p1).rejects.toThrow();
    await clock.advance(2000);
    await p2;
    expect(ok).toBe(true);
  });

  it("ปฏิเสธการขอที่มากกว่าความจุ (ไม่งั้นรอไม่มีวันจบ)", async () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 2, refillPerSec: 1, clock });
    await expect(b.take(5)).rejects.toThrow(/จุได้แค่/);
  });

  it("ปฏิเสธ config ที่ไม่สมเหตุสมผล", () => {
    const clock = new FakeClock();
    expect(
      () => new TokenBucket({ capacity: 0, refillPerSec: 1, clock }),
    ).toThrow();
    expect(
      () => new TokenBucket({ capacity: 1, refillPerSec: 0, clock }),
    ).toThrow();
  });
});

describe("parseUsageHeader", () => {
  it("อ่าน X-App-Usage ได้", () => {
    expect(
      parseUsageHeader('{"call_count":28,"total_time":25,"total_cputime":30}'),
    ).toEqual({ callCount: 28, totalTime: 25, totalCputime: 30 });
  });

  it("คืน null ถ้าไม่มี header หรือ JSON พัง", () => {
    expect(parseUsageHeader(null)).toBeNull();
    expect(parseUsageHeader("ไม่ใช่ json")).toBeNull();
    expect(parseUsageHeader("null")).toBeNull();
  });

  it("ค่าที่หายไปหรือผิดชนิดถือเป็น 0 ไม่ทำให้พัง", () => {
    expect(parseUsageHeader('{"call_count":"x"}')).toEqual({
      callCount: 0,
      totalTime: 0,
      totalCputime: 0,
    });
  });
});

describe("parseBusinessUsageHeader", () => {
  it("เลือกรายการที่ใช้โควตามากที่สุด", () => {
    const raw = JSON.stringify({
      "123": [
        { call_count: 10, total_time: 10, total_cputime: 10 },
        { call_count: 90, total_time: 20, total_cputime: 20 },
      ],
    });
    expect(parseBusinessUsageHeader(raw)?.callCount).toBe(90);
  });

  it("อ่าน estimated_time_to_regain_access", () => {
    const raw = JSON.stringify({
      "123": [
        {
          call_count: 100,
          total_time: 100,
          total_cputime: 100,
          estimated_time_to_regain_access: 300,
        },
      ],
    });
    expect(
      parseBusinessUsageHeader(raw)?.estimatedTimeToRegainAccessSec,
    ).toBe(300);
  });

  it("คืน null เมื่อ header พังหรือว่าง", () => {
    expect(parseBusinessUsageHeader(null)).toBeNull();
    expect(parseBusinessUsageHeader("{}")).toBeNull();
    expect(parseBusinessUsageHeader("[[[")).toBeNull();
  });
});

describe("delayForUsagePct", () => {
  it("ต่ำกว่าเส้น 80% ไม่หน่วง", () => {
    expect(delayForUsagePct(0)).toBe(0);
    expect(delayForUsagePct(79)).toBe(0);
  });

  it("ตั้งแต่ 80% ขึ้นไปเริ่มหน่วง และหน่วงมากขึ้นตามระดับ", () => {
    expect(delayForUsagePct(THROTTLE_THRESHOLD_PCT)).toBeGreaterThan(0);
    expect(delayForUsagePct(90)).toBeGreaterThan(delayForUsagePct(80));
    expect(delayForUsagePct(95)).toBeGreaterThan(delayForUsagePct(90));
    expect(delayForUsagePct(100)).toBeGreaterThan(delayForUsagePct(95));
  });
});

describe("UsageGovernor", () => {
  it("ไม่หน่วงเมื่อยังไม่เคยอ่านค่า", () => {
    const g = new UsageGovernor({ clock: new FakeClock() });
    expect(g.delayFor("app")).toBe(0);
  });

  it("หน่วงเมื่อโควตาเกิน 80% (สเปกข้อ 5.4)", () => {
    const g = new UsageGovernor({ clock: new FakeClock() });
    g.observe("app", { callCount: 85, totalTime: 10, totalCputime: 10 });
    expect(g.delayFor("app")).toBeGreaterThan(0);
    expect(g.isNearLimit("app")).toBe(true);
  });

  it("ใช้ค่าสูงสุดในสามตัวเป็นตัวตัดสิน", () => {
    const g = new UsageGovernor({ clock: new FakeClock() });
    g.observe("app", { callCount: 5, totalTime: 5, totalCputime: 96 });
    expect(g.delayFor("app")).toBe(delayForUsagePct(96));
  });

  it("ค่าที่อ่านมานานแล้วถือว่าหมดอายุ", async () => {
    const clock = new FakeClock();
    const g = new UsageGovernor({ clock, staleAfterMs: 1000 });
    g.observe("app", { callCount: 99, totalTime: 0, totalCputime: 0 });
    expect(g.delayFor("app")).toBeGreaterThan(0);
    await clock.advance(1001);
    expect(g.delayFor("app")).toBe(0);
    expect(g.isNearLimit("app")).toBe(false);
  });

  it("เคารพ estimated_time_to_regain_access เป็นเวลาบล็อก", async () => {
    const clock = new FakeClock();
    const g = new UsageGovernor({ clock });
    g.observe("page1", {
      callCount: 100,
      totalTime: 100,
      totalCputime: 100,
      estimatedTimeToRegainAccessSec: 120,
    });
    expect(g.delayFor("page1")).toBe(120_000);
    await clock.advance(60_000);
    expect(g.delayFor("page1")).toBe(60_000);
    await clock.advance(61_000);
    // ผ่านช่วงบล็อกแล้ว เหลือแค่หน่วงตาม % (ค่ายังไม่ stale)
    expect(g.delayFor("page1")).toBe(delayForUsagePct(100));
  });

  it("แยก scope ระหว่างแอปกับเพจ", () => {
    const g = new UsageGovernor({ clock: new FakeClock() });
    g.observe("app", { callCount: 10, totalTime: 10, totalCputime: 10 });
    g.observe("page1", { callCount: 95, totalTime: 0, totalCputime: 0 });
    expect(g.delayFor("app")).toBe(0);
    expect(g.delayFor("page1")).toBeGreaterThan(0);
  });

  it("delayForAll เอาค่าที่แย่ที่สุด", () => {
    const g = new UsageGovernor({ clock: new FakeClock() });
    g.observe("app", { callCount: 82, totalTime: 0, totalCputime: 0 });
    g.observe("page1", { callCount: 97, totalTime: 0, totalCputime: 0 });
    expect(g.delayForAll(["app", "page1"])).toBe(delayForUsagePct(97));
  });

  it("observe(null) ไม่ทำอะไร", () => {
    const g = new UsageGovernor({ clock: new FakeClock() });
    g.observe("app", null);
    expect(g.delayFor("app")).toBe(0);
  });

  it("snapshotAll คืนเฉพาะค่าที่ยังไม่หมดอายุ", async () => {
    const clock = new FakeClock();
    const g = new UsageGovernor({ clock, staleAfterMs: 1000 });
    g.observe("app", { callCount: 50, totalTime: 0, totalCputime: 0 });
    expect(Object.keys(g.snapshotAll())).toEqual(["app"]);
    await clock.advance(1001);
    expect(Object.keys(g.snapshotAll())).toEqual([]);
  });
});
