import { describe, expect, it } from "vitest";
import { nounTh, sourceFor, validateExternalId } from "./tracked-page-rules.js";

describe("ตรวจรหัสเพจ Facebook", () => {
  it("ตัวเลขล้วนผ่าน", () => {
    expect(validateExternalId("FACEBOOK", "100064123456789")).toBeNull();
  });

  /** คนที่ก๊อป URL มาทั้งเส้นคือกรณีที่เจอบ่อยที่สุด */
  it("วาง URL มาทั้งเส้น → บอกให้เอาเฉพาะตัวเลข พร้อมบอกที่หา", () => {
    const th = validateExternalId("FACEBOOK", "https://facebook.com/ครัวคุณยาย");
    expect(th).toContain("ตัวเลขล้วน");
    expect(th).toContain("ความโปร่งใสของเพจ");
  });

  it("ว่างเปล่า → บอกว่ายังไม่ได้ใส่", () => {
    expect(validateExternalId("FACEBOOK", "")).toContain("ยังไม่ได้ใส่รหัสเพจ");
  });
});

describe("ตรวจรหัสช่อง YouTube", () => {
  const good = `UC${"a".repeat(22)}`;

  it("รูปแบบ UC + 22 ตัวผ่าน", () => {
    expect(validateExternalId("YOUTUBE", good)).toBeNull();
  });

  it("รับขีดกลางและขีดล่างที่ YouTube ใช้จริง", () => {
    expect(validateExternalId("YOUTUBE", `UC${"a".repeat(18)}_-Xy`)).toBeNull();
  });

  /**
   * `@handle` คือสิ่งที่คนเห็นบน URL สมัยใหม่ จึงเป็นค่าที่คนหยิบมาผิดบ่อยที่สุด
   * — ต้องแยกออกมาบอกวิธีหารหัสจริง ไม่ใช่บอกแค่ "รูปแบบผิด"
   */
  it("ใส่ @ชื่อช่อง มา → บอกว่านั่นคือ handle พร้อมบอกวิธีหารหัสจริง", () => {
    const th = validateExternalId("YOUTUBE", "@KruaKhunYai");
    expect(th).toContain("handle");
    expect(th).toContain("คัดลอกรหัสช่อง");
    expect(th).toContain("@KruaKhunYai");
  });

  it("ไม่ขึ้นต้นด้วย UC → ไม่ผ่าน", () => {
    expect(validateExternalId("YOUTUBE", `XY${"a".repeat(22)}`)).toContain("UC");
  });

  it("สั้นเกินไป → บอกความยาวที่ใส่มาให้เทียบได้", () => {
    expect(validateExternalId("YOUTUBE", "UCabc")).toContain("5 ตัว");
  });

  it("ยาวเกินไป → ไม่ผ่าน", () => {
    expect(validateExternalId("YOUTUBE", `UC${"a".repeat(30)}`)).not.toBeNull();
  });

  it("ว่างเปล่า → บอกว่ายังไม่ได้ใส่รหัสช่อง (ไม่ใช่ 'เพจ')", () => {
    expect(validateExternalId("YOUTUBE", "")).toContain("รหัสช่อง");
  });

  /** รหัสเพจ Facebook (ตัวเลขล้วน) ที่หลุดมาช่อง YouTube ต้องไม่ผ่าน */
  it("รหัสเพจ Facebook ที่เลือกแพลตฟอร์มผิด → ไม่ผ่าน", () => {
    expect(validateExternalId("YOUTUBE", "100064123456789")).not.toBeNull();
  });
});

/**
 * ─── กฎที่สำคัญที่สุดในไฟล์นี้ ───
 *
 * เพจ Facebook ของคนอื่นดึงไม่ได้จนกว่าจะได้สิทธิ์ PPCA แต่ช่อง YouTube ของ
 * คนอื่น **ดึงได้เลยด้วย API key** ถ้าตั้ง source ผิดฝั่งใดฝั่งหนึ่ง ผลคือ
 * ยิงแล้วโดนปฏิเสธทุกรอบ หรือไม่ก็ไม่ยิงเลยทั้งที่ยิงได้
 */
describe("เลือกแหล่งข้อมูลตามแพลตฟอร์ม", () => {
  it("เพจ Facebook ของเรา → META_API", () => {
    expect(sourceFor({ platform: "FACEBOOK", kind: "OWNED" })).toBe("META_API");
  });

  it("เพจ Facebook ของคนอื่น → EXTERNAL (ยังดึงไม่ได้จนกว่าจะได้ PPCA)", () => {
    expect(sourceFor({ platform: "FACEBOOK", kind: "COMPETITOR" })).toBe("EXTERNAL");
  });

  it("ช่อง YouTube ของเรา → YOUTUBE_API", () => {
    expect(sourceFor({ platform: "YOUTUBE", kind: "OWNED" })).toBe("YOUTUBE_API");
  });

  it("ช่อง YouTube ของคนอื่น → YOUTUBE_API ด้วย ไม่ใช่ EXTERNAL", () => {
    expect(sourceFor({ platform: "YOUTUBE", kind: "COMPETITOR" })).toBe("YOUTUBE_API");
  });
});

describe("คำเรียกในข้อความ", () => {
  it("แยกคำว่าเพจกับช่องตามแพลตฟอร์ม", () => {
    expect(nounTh("FACEBOOK")).toBe("เพจ");
    expect(nounTh("YOUTUBE")).toBe("ช่อง");
  });
});
