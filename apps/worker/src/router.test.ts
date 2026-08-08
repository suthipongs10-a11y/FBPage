import { describe, expect, it } from "vitest";
import { nullLogger } from "@page-os/core";
import {
  JobRouter,
  NotWiredError,
  UnknownJobError,
  type JobContext,
  type JobHandler,
} from "./router.js";

const ctx: JobContext = {
  nowMs: 1_700_000_000_000,
  logger: nullLogger,
  jobId: "j1",
  attemptsMade: 0,
};

const handler = (name: string, th = "เสร็จ"): JobHandler => ({
  name,
  run: async () => ({ th }),
});

describe("JobRouter", () => {
  it("ส่งงานไปให้ตัวจัดการที่ชื่อตรงกัน", async () => {
    const router = new JobRouter([handler("a", "ทำ a แล้ว"), handler("b")]);
    expect((await router.dispatch("a", {}, ctx)).th).toBe("ทำ a แล้ว");
  });

  /**
   * ถ้าปล่อยผ่านเงียบๆ งานจะขึ้นว่า "สำเร็จ" ทุกรอบไปตลอดกาลโดยไม่มีอะไร
   * เกิดขึ้นจริง — เป็นความพังที่เงียบที่สุดแบบหนึ่งของระบบที่มี cron
   */
  it("งานที่ไม่มีคนรับ → โยน error พร้อมบอกว่ารู้จักงานอะไรบ้าง", async () => {
    const router = new JobRouter([handler("a"), handler("b")]);
    await expect(router.dispatch("ไม่มีใครรู้จัก", {}, ctx)).rejects.toThrow(
      UnknownJobError,
    );
    try {
      await router.dispatch("ไม่มีใครรู้จัก", {}, ctx);
    } catch (err) {
      expect((err as UnknownJobError).th).toContain("ไม่มีใครรู้จัก");
      expect((err as UnknownJobError).th).toContain("a, b");
    }
  });

  /**
   * ชื่อซ้ำแปลว่าตัวหลังทับตัวแรก ซึ่งเป็นบั๊กที่มองไม่เห็นเลยตอนรัน —
   * งานยังทำงานอยู่ แค่ทำผิดตัว
   */
  it("ลงทะเบียนชื่อซ้ำ → ล้มทันทีตอนสตาร์ท", () => {
    expect(() => new JobRouter([handler("a"), handler("a")])).toThrow(/ซ้ำ|แล้ว/);
  });

  it("รายชื่อที่รู้จักเรียงตามตัวอักษร", () => {
    const router = new JobRouter([handler("z"), handler("a")]);
    expect(router.names).toEqual(["a", "z"]);
    expect(router.has("a")).toBe(true);
    expect(router.has("q")).toBe(false);
  });

  it("error จากตัวจัดการทะลุออกมา ไม่ถูกกลืน", async () => {
    const router = new JobRouter([
      {
        name: "พัง",
        run: async () => {
          throw new Error("เขียน DB ไม่ได้");
        },
      },
    ]);
    await expect(router.dispatch("พัง", {}, ctx)).rejects.toThrow("เขียน DB ไม่ได้");
  });
});

describe("NotWiredError", () => {
  it("บอกว่าต้องเขียนอะไรเพิ่มถึงจะใช้ได้", () => {
    const err = new NotWiredError("cron:analytics-sync", "ที่เก็บ Insights บน Prisma");
    expect(err.th).toContain("cron:analytics-sync");
    expect(err.th).toContain("ที่เก็บ Insights บน Prisma");
  });
});
