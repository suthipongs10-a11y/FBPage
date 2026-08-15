import { describe, expect, it } from "vitest";
import {
  blockReasonTh,
  missingConfigTh,
  parseAction,
  STATUS_OF,
  type ModerationGroup,
} from "./moderation-guard.js";

const yt = (over: Partial<ModerationGroup> = {}): ModerationGroup => ({
  channelName: "ครัวคุณยาย",
  platform: "YOUTUBE",
  owned: true,
  ...over,
});

/**
 * ─── ด่านที่ผิดแล้วเจ็บที่สุด ───
 *
 * YouTube ให้จัดการคอมเมนต์ได้เฉพาะช่องที่เราเป็นเจ้าของ ปล่อยผ่านผิด =
 * ยิงคำสั่งไปที่ช่องที่ไม่มีสิทธิ์ ได้ 403 กลับมาแต่เสียโควตา 50 หน่วยไปแล้ว
 */
describe("ตรวจก่อนสั่ง", () => {
  it("ช่อง YouTube ของเราเอง → ผ่าน", () => {
    expect(blockReasonTh({ groups: [yt()], action: "hide" })).toBeNull();
  });

  it("ช่องที่ไม่ใช่ของเรา → ปฏิเสธ พร้อมบอกชื่อช่องที่เป็นปัญหา", () => {
    const th = blockReasonTh({
      groups: [yt(), yt({ channelName: "ช่องคนอื่น", owned: false })],
      action: "hide",
    });
    expect(th).toContain("ช่องคนอื่น");
    expect(th).toContain("เจ้าของ");
  });

  /**
   * ฝั่ง Facebook มีตัวจัดการอยู่คนละที่และยังไม่ได้ต่อเข้าหน้านี้
   * — บอกตรงๆ ดีกว่าปล่อยให้กดแล้วเงียบ
   */
  it("มีคอมเมนต์ฝั่ง Facebook ปนมา → ปฏิเสธทั้งชุด", () => {
    const th = blockReasonTh({
      groups: [yt(), yt({ channelName: "เพจเฟซ", platform: "FACEBOOK" })],
      action: "hide",
    });
    expect(th).toContain("เพจเฟซ");
    expect(th).toContain("YouTube");
  });

  /** ถ้าตรวจ owned ก่อน จะขึ้นข้อความเรื่องสิทธิ์ทั้งที่ปัญหาจริงคือแพลตฟอร์ม */
  it("เพจ Facebook ที่ไม่ใช่ของเรา → บอกเรื่องแพลตฟอร์มก่อน ไม่ใช่เรื่องสิทธิ์", () => {
    const th = blockReasonTh({
      groups: [yt({ channelName: "เพจเฟซ", platform: "FACEBOOK", owned: false })],
      action: "hide",
    });
    expect(th).toContain("เฉพาะฝั่ง YouTube");
  });

  it("ไม่พบคอมเมนต์เลย → บอกให้รีเฟรช ไม่ใช่เงียบ", () => {
    expect(blockReasonTh({ groups: [], action: "hide" })).toContain("รีเฟรช");
  });

  it("ข้อความใช้คำกริยาตรงกับสิ่งที่กำลังจะทำ", () => {
    const g = [yt({ owned: false })];
    expect(blockReasonTh({ groups: g, action: "hide" })).toContain("ซ่อนคอมเมนต์");
    expect(blockReasonTh({ groups: g, action: "delete" })).toContain("ลบคอมเมนต์");
  });
});

describe("ตรวจว่าตั้งค่าครบไหม", () => {
  it("ครบทั้งสองอย่าง → ผ่าน", () => {
    expect(missingConfigTh({ hasApiKey: true, hasOAuth: true })).toBeNull();
  });

  it("ไม่มี API key → บอกให้รัน pnpm configure", () => {
    const th = missingConfigTh({ hasApiKey: false, hasOAuth: true });
    expect(th).toContain("YOUTUBE_API_KEY");
    expect(th).toContain("pnpm configure");
  });

  /** คนที่มีแต่ API key จะงงว่าทำไมอ่านได้แต่ซ่อนไม่ได้ — ต้องอธิบายตรงนั้น */
  it("มี API key แต่ไม่มี OAuth → บอกว่า API key อ่านได้อย่างเดียว", () => {
    const th = missingConfigTh({ hasApiKey: true, hasOAuth: false });
    expect(th).toContain("อ่านได้อย่างเดียว");
    expect(th).toContain("youtube.force-ssl");
  });
});

describe("แปลงค่าที่มาจากฟอร์ม", () => {
  it("ค่าที่รู้จักผ่านตรงๆ", () => {
    expect(parseAction("hide")).toBe("hide");
    expect(parseAction("unhide")).toBe("unhide");
    expect(parseAction("delete")).toBe("delete");
  });

  /**
   * ข้อนี้สำคัญกว่าที่ดู — ถ้าค่าแปลกๆ ตกไปที่ `delete` การส่งค่าเพี้ยนมา
   * จะกลายเป็นลบถาวรโดยไม่ได้ตั้งใจ ซึ่งกู้คืนไม่ได้
   */
  it("ค่าแปลกๆ ตกไปที่ตัวที่ย้อนกลับได้ ไม่ใช่ตัวที่ลบถาวร", () => {
    for (const bad of ["", "DELETE", "ลบ", "drop", undefined, null, 42, {}]) {
      expect(parseAction(bad)).toBe("hide");
    }
  });
});

describe("สถานะที่จดลงฐานข้อมูล", () => {
  /** ต้องตรงกับที่ YouTube ใช้ ไม่งั้นเทียบกับของจริงทีหลังไม่ได้ */
  it("ใช้ชื่อสถานะเดียวกับ YouTube", () => {
    expect(STATUS_OF.hide).toBe("rejected");
    expect(STATUS_OF.unhide).toBe("published");
  });

  it("การลบใช้ชื่อของเราเอง เพราะ YouTube ไม่มีสถานะนี้", () => {
    expect(STATUS_OF.delete).toBe("deleted");
  });
});
