import { describe, expect, it } from "vitest";
import { MetaApiError } from "@page-os/meta";
import {
  MAX_PUBLISH_ATTEMPTS,
  RETRY_SCHEDULE_MS,
  decideRetry,
  describeRetrySchedule,
} from "./retry-policy.js";

const err = (code: number): MetaApiError =>
  new MetaApiError({ message: "x", code });

describe("RETRY_SCHEDULE_MS", () => {
  it("ตรงตามสเปก: 1 นาที, 5 นาที, 30 นาที", () => {
    expect(RETRY_SCHEDULE_MS).toEqual([60_000, 300_000, 1_800_000]);
    expect(MAX_PUBLISH_ATTEMPTS).toBe(4);
  });

  it("อธิบายเป็นภาษาไทยให้ผู้ใช้อ่านได้", () => {
    const s = describeRetrySchedule();
    expect(s).toContain("1 นาที");
    expect(s).toContain("5 นาที");
    expect(s).toContain("30 นาที");
  });
});

describe("decideRetry — error ที่ลองใหม่แล้วมีโอกาสหาย", () => {
  it("โควตาเต็ม (error 32) → ลองใหม่ตามตาราง", () => {
    const d1 = decideRetry({ attempt: 1, error: err(32) });
    expect(d1).toMatchObject({ kind: "retry", delayMs: 60_000, attempt: 2 });

    const d2 = decideRetry({ attempt: 2, error: err(32) });
    expect(d2).toMatchObject({ kind: "retry", delayMs: 300_000, attempt: 3 });

    const d3 = decideRetry({ attempt: 3, error: err(32) });
    expect(d3).toMatchObject({ kind: "retry", delayMs: 1_800_000, attempt: 4 });
  });

  it("ครบ 3 ครั้งแล้วยังไม่ได้ → dead-letter พร้อมแจ้งเตือน", () => {
    const d = decideRetry({ attempt: 4, error: err(32) });
    expect(d.kind).toBe("dead");
    expect(d).toMatchObject({ needsAlert: true });
    expect(d.th).toContain("4 ครั้ง");
  });

  it("Facebook ล่มชั่วคราว (5xx) → ลองใหม่", () => {
    const e = new MetaApiError({ message: "Bad Gateway", httpStatus: 502 });
    expect(decideRetry({ attempt: 1, error: e }).kind).toBe("retry");
  });

  it("ข้อความไทยบอกว่าจะลองใหม่เมื่อไหร่", () => {
    const d = decideRetry({ attempt: 2, error: err(32) });
    expect(d.th).toContain("5 นาที");
    expect(d.th).toContain("ครั้งที่ 2");
  });
});

describe("decideRetry — error ที่ลองใหม่ไปก็เท่านั้น", () => {
  it("token ตาย (190) → เลิกลองทันที ไม่เสียเวลา 36 นาที", () => {
    const d = decideRetry({ attempt: 1, error: err(190) });
    expect(d.kind).toBe("give_up");
    expect(d).toMatchObject({ needsAlert: true });
    expect(d.th).toContain("เชื่อมเพจใหม่");
  });

  it("ขาดสิทธิ์ (200) → เลิกลองทันที", () => {
    expect(decideRetry({ attempt: 1, error: err(200) }).kind).toBe("give_up");
  });

  it("พารามิเตอร์ผิด (100) → เลิกลองทันที", () => {
    expect(decideRetry({ attempt: 1, error: err(100) }).kind).toBe("give_up");
  });

  it("ใช้ tag ที่ปลดระวางแล้ว → เลิกลองทันที", () => {
    const e = new MetaApiError({
      message: "Invalid tag CONFIRMED_EVENT_UPDATE",
      code: 100,
    });
    expect(e.action).toBe("deprecated");
    expect(decideRetry({ attempt: 1, error: e }).kind).toBe("give_up");
  });

  it("error ที่ไม่รู้จัก → ให้คนดู ไม่ retry มั่ว", () => {
    const d = decideRetry({ attempt: 1, error: err(999_999) });
    expect(d.kind).toBe("give_up");
    expect(d.th).toContain("ยังไม่รู้จัก");
  });
});

describe("decideRetry — ทุกผลลัพธ์อ่านรู้เรื่อง", () => {
  it("ทุกกรณีมีข้อความไทย", () => {
    for (const [attempt, code] of [
      [1, 32],
      [4, 32],
      [1, 190],
      [1, 999_999],
    ] as const) {
      const d = decideRetry({ attempt, error: err(code) });
      expect(d.th, `attempt=${attempt} code=${code}`).toMatch(/[ก-๙]/);
    }
  });

  it("กรณีที่ต้องให้คนมาดู ต้องมี needsAlert เสมอ", () => {
    for (const [attempt, code] of [
      [4, 32],
      [1, 190],
      [1, 200],
      [1, 999_999],
    ] as const) {
      const d = decideRetry({ attempt, error: err(code) });
      expect(d.kind).not.toBe("retry");
      expect("needsAlert" in d && d.needsAlert, `${attempt}/${code}`).toBe(true);
    }
  });
});
