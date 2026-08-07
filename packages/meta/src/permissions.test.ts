import { describe, expect, it } from "vitest";
import {
  PERMISSION_DEPENDENCIES,
  REQUIRED_PERMISSIONS,
  checkPermissions,
  expandWithDependencies,
  oauthScopeString,
} from "./permissions.js";

describe("REQUIRED_PERMISSIONS", () => {
  it("ครบตามที่สเปกข้อ M0 ระบุไว้ 11 ตัว", () => {
    expect(REQUIRED_PERMISSIONS).toHaveLength(11);
    for (const p of [
      "pages_show_list",
      "pages_read_engagement",
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
