import { describe, expect, it } from "vitest";
import { GracefulShutdown, type ShutdownStep } from "./shutdown.js";

const step = (name: string, run: () => Promise<void>): ShutdownStep => ({
  name,
  th: name,
  run,
});

/** ค้างตลอดกาล — ใช้จำลองขั้นตอนที่ไม่มีวันเสร็จ */
const hang = (): Promise<void> => new Promise<void>(() => {});

describe("GracefulShutdown", () => {
  it("ทำตามลำดับที่ให้มา", async () => {
    const order: string[] = [];
    const s = new GracefulShutdown({
      steps: [
        step("http", async () => {
          order.push("http");
        }),
        step("queue", async () => {
          order.push("queue");
        }),
        step("redis", async () => {
          order.push("redis");
        }),
      ],
    });
    const report = await s.run("SIGTERM");
    expect(order).toEqual(["http", "queue", "redis"]);
    expect(report.degraded).toBe(false);
    expect(report.steps.every((x) => x.outcome === "ok")).toBe(true);
  });

  /**
   * ปิด DB ไม่ได้ ก็ยังต้องพยายามปิด Redis — ไม่งั้น error เดียวจะทิ้ง
   * connection ค้างไว้ทั้งหมด
   */
  it("ขั้นที่ error ไม่หยุดขั้นที่เหลือ", async () => {
    const done: string[] = [];
    const s = new GracefulShutdown({
      steps: [
        step("พัง", async () => {
          throw new Error("ปิดไม่ได้");
        }),
        step("ต่อไป", async () => {
          done.push("ต่อไป");
        }),
      ],
    });
    const report = await s.run("SIGTERM");
    expect(done).toEqual(["ต่อไป"]);
    expect(report.degraded).toBe(true);
    expect(report.steps[0]?.outcome).toBe("error");
    expect(report.steps[0]?.errorTh).toContain("ปิดไม่ได้");
    expect(report.steps[1]?.outcome).toBe("ok");
  });

  /**
   * เหตุผลที่ให้เวลาเป็นรายขั้น ไม่ใช่ก้อนเดียว: ถ้าตัว drain งานค้าง
   * แล้วเราให้เวลารวม ขั้นปิด Redis จะไม่ได้ทำเลย
   */
  it("ขั้นที่ค้างเกินเพดาน → ข้ามไปทำขั้นถัดไป", async () => {
    const done: string[] = [];
    const s = new GracefulShutdown({
      stepTimeoutMs: 20,
      steps: [
        step("ค้าง", hang),
        step("ต่อไป", async () => {
          done.push("ต่อไป");
        }),
      ],
    });
    const report = await s.run("SIGTERM");
    expect(report.steps[0]?.outcome).toBe("timeout");
    expect(done).toEqual(["ต่อไป"]);
    expect(report.degraded).toBe(true);
  });

  it("ตั้งเพดานรายขั้นทับค่ากลางได้", async () => {
    const s = new GracefulShutdown({
      stepTimeoutMs: 5_000,
      steps: [{ name: "ค้าง", th: "ค้าง", run: hang, timeoutMs: 20 }],
    });
    const report = await s.run("SIGTERM");
    expect(report.steps[0]?.outcome).toBe("timeout");
  });

  /**
   * ตอน deploy จริงมักได้ทั้ง SIGTERM และ SIGINT ไล่กันมา ถ้ารันซ้ำจะปิด
   * ของที่ปิดไปแล้วอีกรอบ ซึ่ง client ส่วนใหญ่จะโยน error ออกมา
   */
  it("เรียกซ้ำไม่รันซ้ำ", async () => {
    let calls = 0;
    const s = new GracefulShutdown({
      steps: [
        step("นับ", async () => {
          calls++;
        }),
      ],
    });
    const [a, b] = await Promise.all([s.run("SIGTERM"), s.run("SIGINT")]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    // สัญญาณที่บันทึกไว้คือตัวแรกที่มาถึง
    expect(a.signal).toBe("SIGTERM");
  });

  it("บอกได้ว่ากำลังปิดอยู่ (ให้สัญญาณที่สองตัดสินใจว่าจะบังคับออกเลยไหม)", async () => {
    const s = new GracefulShutdown({
      stepTimeoutMs: 20,
      steps: [step("ค้าง", hang)],
    });
    expect(s.isShuttingDown).toBe(false);
    const p = s.run("SIGTERM");
    expect(s.isShuttingDown).toBe(true);
    await p;
  });

  it("ไม่มีขั้นตอนเลยก็ไม่พัง", async () => {
    const report = await new GracefulShutdown({ steps: [] }).run("SIGTERM");
    expect(report.steps).toEqual([]);
    expect(report.degraded).toBe(false);
  });
});
