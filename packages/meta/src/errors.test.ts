import { describe, expect, it } from "vitest";
import { MetaApiError, MetaTransportError, classifyMetaError } from "./errors.js";

describe("classifyMetaError", () => {
  it("error โควตา 4 / 32 / 80001 → throttle และ retry ได้ (สเปกข้อ 5.5)", () => {
    for (const code of [4, 32, 80001]) {
      const info = classifyMetaError(code);
      expect(info.action, `code ${code}`).toBe("throttle");
      expect(info.retryable, `code ${code}`).toBe(true);
    }
  });

  it("error 190 → reconnect และห้าม retry", () => {
    const info = classifyMetaError(190);
    expect(info.action).toBe("reconnect");
    expect(info.retryable).toBe(false);
    expect(info.th).toContain("เชื่อมเพจใหม่");
  });

  it("แยก subcode ของ 190 ได้ละเอียด", () => {
    expect(classifyMetaError(190, 460).th).toContain("เปลี่ยนรหัสผ่าน");
    expect(classifyMetaError(190, 458).th).toContain("ถอนสิทธิ์");
    expect(classifyMetaError(190, 463).th).toContain("หมดอายุ");
    // subcode ที่ไม่รู้จักตกมาที่กฎของ code หลัก
    expect(classifyMetaError(190, 99999).action).toBe("reconnect");
  });

  it("error 200 / 10 → permission", () => {
    expect(classifyMetaError(200).action).toBe("permission");
    expect(classifyMetaError(10).action).toBe("permission");
  });

  it("error 100 → fix_request และเตือนเรื่อง message tag", () => {
    const info = classifyMetaError(100);
    expect(info.action).toBe("fix_request");
    expect(info.retryable).toBe(false);
  });

  it("จับ legacy message tag ที่ปลดระวาง 27 เม.ย. 2026", () => {
    for (const tag of [
      "CONFIRMED_EVENT_UPDATE",
      "POST_PURCHASE_UPDATE",
      "ACCOUNT_UPDATE",
    ]) {
      const info = classifyMetaError(100, undefined, `(#100) Invalid tag ${tag}`);
      expect(info.action, tag).toBe("deprecated");
      expect(info.th, tag).toContain("Utility Template");
    }
  });

  it("error 10900 (นอก 24h window) บอกทางออกที่ถูกต้อง", () => {
    const info = classifyMetaError(10900);
    expect(info.th).toContain("24 ชม.");
    expect(info.th).toContain("Utility Template");
    expect(info.retryable).toBe(false);
  });

  it("code ที่ไม่รู้จัก → manual ไม่ retry มั่ว", () => {
    const info = classifyMetaError(999999);
    expect(info.action).toBe("manual");
    expect(info.retryable).toBe(false);
  });

  it("ไม่มี code เลย → manual", () => {
    expect(classifyMetaError(undefined).action).toBe("manual");
  });

  it("ทุก rule มีข้อความไทย ไม่ใช่ภาษาอังกฤษดิบ", () => {
    for (const code of [4, 32, 80001, 190, 200, 100, 10900, 551, 2]) {
      expect(classifyMetaError(code).th, `code ${code}`).toMatch(/[ก-๙]/);
    }
  });
});

describe("MetaApiError", () => {
  it("แปลง code เป็น action + ข้อความไทยให้อัตโนมัติ", () => {
    const e = new MetaApiError({ message: "Invalid OAuth token", code: 190 });
    expect(e.action).toBe("reconnect");
    expect(e.retryable).toBe(false);
    expect(e.th).toContain("เชื่อมเพจใหม่");
  });

  it("HTTP 5xx ที่ไม่มี code ของ Meta ก็ retry ได้ (สเปกข้อ 5.5)", () => {
    const e = new MetaApiError({ message: "Bad Gateway", httpStatus: 502 });
    expect(e.retryable).toBe(true);
    expect(e.action).toBe("retry");
    expect(e.th).toContain("502");
  });

  it("HTTP 4xx ที่ไม่มี code ไม่ retry", () => {
    const e = new MetaApiError({ message: "Not Found", httpStatus: 404 });
    expect(e.retryable).toBe(false);
    expect(e.action).toBe("manual");
  });

  it("code ที่ห้าม retry ยังห้าม retry แม้ status จะเป็น 5xx", () => {
    // 190 มาพร้อม 500 ไม่ควรกลายเป็น retryable เพราะ retry ไปก็ 190 อยู่ดี
    const e = new MetaApiError({ message: "x", code: 190, httpStatus: 500 });
    expect(e.action).toBe("reconnect");
  });

  it("toJSON ไม่มี token หลุด และมีข้อมูลครบสำหรับ debug", () => {
    const e = new MetaApiError({
      message: "boom",
      code: 32,
      subcode: 1,
      httpStatus: 400,
      fbtraceId: "Abc123",
      path: "me/feed",
      pageId: "p1",
      attempts: 3,
    });
    const j = e.toJSON();
    expect(j["code"]).toBe(32);
    expect(j["fbtraceId"]).toBe("Abc123");
    expect(j["attempts"]).toBe(3);
    expect(j["action"]).toBe("throttle");
    expect(JSON.stringify(j)).not.toMatch(/EAA[A-Za-z0-9]/);
  });

  it("เป็น Error จริง จับด้วย instanceof ได้", () => {
    const e = new MetaApiError({ message: "x", code: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("MetaApiError");
  });
});

describe("MetaTransportError", () => {
  it("ต่อเน็ตไม่ติด → retry ได้", () => {
    const e = new MetaTransportError("ต่อ Facebook ไม่ได้");
    expect(e.retryable).toBe(true);
    expect(e).toBeInstanceOf(MetaApiError);
  });
});
