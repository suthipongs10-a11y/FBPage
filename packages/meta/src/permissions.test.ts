import { describe, expect, it } from "vitest";
import {
  FEATURE_PERMISSIONS,
  PERMISSION_DEPENDENCIES,
  REQUIRED_PERMISSIONS,
  checkPermissions,
  describeMissingScopesTh,
  expandWithDependencies,
  oauthScopeString,
} from "./permissions.js";

describe("REQUIRED_PERMISSIONS", () => {
  it("ครบตามที่สเปกข้อ M0 ระบุไว้ 12 ตัว", () => {
    expect(REQUIRED_PERMISSIONS).toHaveLength(12);
    for (const p of [
      "pages_show_list",
      "pages_read_engagement",
      "pages_read_user_content",
      "pages_manage_posts",
      "pages_manage_engagement",
      "pages_manage_metadata",
      "pages_messaging",
      "read_insights",
      "business_management",
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_content_publish",
    ]) {
      expect(REQUIRED_PERMISSIONS).toContain(p);
    }
  });
});

describe("expandWithDependencies", () => {
  it("pages_manage_posts ลาก pages_read_engagement + pages_show_list มาด้วย (สเปกข้อ 0)", () => {
    const out = expandWithDependencies(["pages_manage_posts"]);
    expect(out).toContain("pages_manage_posts");
    expect(out).toContain("pages_read_engagement");
    expect(out).toContain("pages_show_list");
  });

  it("ตาม dependency ต่อกันเป็นทอดๆ", () => {
    const out = expandWithDependencies(["instagram_manage_messages"]);
    expect(out).toContain("instagram_basic");
    expect(out).toContain("pages_show_list");
  });

  it("ไม่มีตัวซ้ำ และเรียงคงที่", () => {
    const out = expandWithDependencies([
      "pages_manage_posts",
      "pages_manage_engagement",
    ]);
    expect(new Set(out).size).toBe(out.length);
    expect(out).toEqual([...out].sort());
  });

  it("รับ input ว่างได้", () => {
    expect(expandWithDependencies([])).toEqual([]);
  });

  it("ทุก dependency ที่อ้างถึงอยู่ในรายการที่ขอจริง", () => {
    const required = new Set<string>(REQUIRED_PERMISSIONS);
    for (const [perm, deps] of Object.entries(PERMISSION_DEPENDENCIES)) {
      expect(required.has(perm), `${perm} ไม่อยู่ใน REQUIRED_PERMISSIONS`).toBe(
        true,
      );
      for (const d of deps) {
        expect(required.has(d), `dependency ${d} ของ ${perm}`).toBe(true);
      }
    }
  });
});

describe("checkPermissions", () => {
  it("ครบทุกตัว → ok", () => {
    const r = checkPermissions([...REQUIRED_PERMISSIONS]);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.blockedFeatures).toEqual([]);
  });

  it("บอกว่าขาดตัวไหน และฟีเจอร์ไหนใช้ไม่ได้", () => {
    const granted = REQUIRED_PERMISSIONS.filter(
      (p) => p !== "pages_messaging",
    );
    const r = checkPermissions(granted);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["pages_messaging"]);
    expect(r.blockedFeatures).toContain("M1 Unified Inbox");
    expect(r.blockedFeatures).toContain("M2 Chatbot");
    expect(r.blockedFeatures).not.toContain("M4 Publishing");
  });

  it("ไม่มีสิทธิ์อะไรเลย → ทุกฟีเจอร์ถูกบล็อก", () => {
    const r = checkPermissions([]);
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(REQUIRED_PERMISSIONS.length);
    expect(r.blockedFeatures.length).toBeGreaterThan(0);
  });

  it("เทียบกับชุดที่กำหนดเองได้ (เช่นแพ็กเกจ STARTER ที่ไม่ต้องใช้ IG)", () => {
    const r = checkPermissions(["pages_show_list", "pages_manage_posts"], [
      "pages_show_list",
      "pages_manage_posts",
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("oauthScopeString", () => {
  it("คั่นด้วยคอมมา และรวม dependency แล้ว", () => {
    const s = oauthScopeString(["pages_manage_posts"]);
    expect(s.split(",")).toContain("pages_show_list");
    expect(s).not.toContain(" ");
  });

  it("ค่าเริ่มต้นครอบคลุมทุก permission ที่ต้องขอ", () => {
    const s = oauthScopeString().split(",");
    for (const p of REQUIRED_PERMISSIONS) expect(s).toContain(p);
  });
});

/**
 * สองตัวนี้ชื่อคล้ายกันจนเคยสลับกัน — และเป็นความผิดพลาดที่ตายเงียบ
 * (Meta คืน array ว่างแทนที่จะโยน error) กว่าจะรู้ก็ต้องยื่นรีวิวใหม่ทั้งชุด
 */
describe("สิทธิ์อ่านคอมเมนต์", () => {
  it("ขอ pages_read_user_content ไว้ด้วย ไม่ใช่แค่ pages_read_engagement", () => {
    expect(REQUIRED_PERMISSIONS).toContain("pages_read_user_content");
  });

  it.each([
    "M3 Comment Automation",
    "M-K ฟังเสียง / อ่านคอมเมนต์",
  ])("ฟีเจอร์ %s ผูกกับสิทธิ์อ่านเนื้อหาของคนอื่น", (feature) => {
    expect(FEATURE_PERMISSIONS[feature]).toContain("pages_read_user_content");
  });

  /** ซ่อน/ลบคอมเมนต์ได้ ต้องอ่านคอมเมนต์ออกก่อน */
  it("pages_manage_engagement ลากสิทธิ์อ่านคอมเมนต์มาด้วย", () => {
    expect(expandWithDependencies(["pages_manage_engagement"])).toContain(
      "pages_read_user_content",
    );
  });

  /**
   * ข้อที่สำคัญที่สุด: ถ้าขาดสิทธิ์นี้ หน้าจอต้อง**บอกออกมา**
   * ไม่ใช่ปล่อยให้คนเห็นคอมเมนต์ 0 อันแล้วนึกว่าไม่มีใครคอมเมนต์
   */
  it("ขาดสิทธิ์นี้ → บอกว่าฟีเจอร์อ่านคอมเมนต์ใช้ไม่ได้", () => {
    const granted = REQUIRED_PERMISSIONS.filter(
      (p) => p !== "pages_read_user_content",
    );
    const r = checkPermissions(granted);
    expect(r.missing).toEqual(["pages_read_user_content"]);
    expect(r.blockedFeatures).toContain("M-K ฟังเสียง / อ่านคอมเมนต์");
    expect(r.blockedFeatures).toContain("M3 Comment Automation");
    // ฟีเจอร์ที่ไม่เกี่ยวกับคอมเมนต์ต้องไม่ถูกลากไปด้วย
    expect(r.blockedFeatures).not.toContain("M4 Publishing");
    expect(r.blockedFeatures).not.toContain("M2 Chatbot");
  });

  it("scope ที่ส่งเข้า OAuth มีสิทธิ์นี้อยู่จริง", () => {
    expect(oauthScopeString()).toContain("pages_read_user_content");
  });
});

describe("describeMissingScopesTh", () => {
  it("สิทธิ์ครบ → ไม่มีคำเตือน", () => {
    expect(describeMissingScopesTh([...REQUIRED_PERMISSIONS])).toBeUndefined();
  });

  /**
   * ข้อความต้องบอกสามอย่าง: ขาดอะไร · พังตรงไหน · แก้ยังไง
   * ถ้าบอกแค่ชื่อ scope ที่ขาด คนที่เพิ่งติดตั้งจะไม่รู้ว่าต้องทำอะไรต่อ
   */
  it("ขาดสิทธิ์อ่านคอมเมนต์ → บอกทั้งชื่อสิทธิ์ ฟีเจอร์ที่พัง และวิธีแก้", () => {
    const th = describeMissingScopesTh(
      REQUIRED_PERMISSIONS.filter((p) => p !== "pages_read_user_content"),
    );
    expect(th).toContain("pages_read_user_content");
    expect(th).toContain("ฟังเสียง");
    expect(th).toContain("Graph API Explorer");
  });

  /**
   * หัวใจของคำเตือนนี้ — Meta ไม่โยน error มันคืน array ว่าง
   * ถ้าไม่เขียนไว้ คนจะนึกว่าเพจไม่มีคนคอมเมนต์
   */
  it("เตือนว่าอาการคือได้ข้อมูลว่าง ไม่ใช่ error", () => {
    const th = describeMissingScopesTh(["pages_show_list"]);
    expect(th).toContain("ไม่ขึ้น error");
    expect(th).toContain("ว่างเปล่า");
  });

  it("token ที่ไม่มีสิทธิ์อะไรเลย → ยังคืนข้อความที่อ่านรู้เรื่อง", () => {
    const th = describeMissingScopesTh([]);
    expect(th).toBeDefined();
    expect(th?.length).toBeGreaterThan(40);
  });
});
