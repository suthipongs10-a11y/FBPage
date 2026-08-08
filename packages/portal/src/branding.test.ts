import { describe, expect, it } from "vitest";
import { expectThaiThrow } from "@page-os/core/testing";
import {
  MIN_CONTRAST_AA,
  MIN_CONTRAST_UI,
  checkBrandColor,
  contrastRatio,
  normalizeHexColor,
  prepareBranding,
  readableTextOn,
  relativeLuminance,
  suggestSubdomain,
  validateLogoUrl,
  validateSubdomain,
  type BrandConfig,
} from "./branding.js";

describe("validateSubdomain", () => {
  it("ชื่อปกติผ่านและถูกทำเป็นตัวพิมพ์เล็ก", () => {
    expect(validateSubdomain("  KruaKhunYai ")).toBe("kruakhunyai");
    expect(validateSubdomain("pladang-bakery")).toBe("pladang-bakery");
  });

  it("ชื่อที่ระบบใช้อยู่ → ปฏิเสธ", () => {
    // ปล่อยให้ลูกค้ายึด www หรือ api ได้เมื่อไหร่ คือยกเส้นทางของระบบไปเลย
    for (const bad of ["www", "api", "admin", "portal", "login", "billing"]) {
      const err = expectThaiThrow(() => validateSubdomain(bad));
      expect(err.th, bad).toMatch(/ระบบใช้อยู่/);
    }
  });

  it("ภาษาไทยและช่องว่างใช้ไม่ได้ พร้อมบอกว่าใช้อะไรได้", () => {
    const err = expectThaiThrow(() => validateSubdomain("ครัวคุณยาย"));
    expect(err.th).toMatch(/a-z/);
  });

  it("สั้นหรือยาวเกินไป → ปฏิเสธ", () => {
    expect(() => validateSubdomain("ab")).toThrow();
    expect(() => validateSubdomain("a".repeat(31))).toThrow();
  });

  it("ขีดกลางหน้าหรือหลัง → ปฏิเสธ", () => {
    expect(() => validateSubdomain("-abc")).toThrow();
    expect(() => validateSubdomain("abc-")).toThrow();
  });

  it('ขึ้นต้นด้วย "xn--" → ปฏิเสธ (กันชื่อที่แสดงผลเหมือนแบรนด์อื่น)', () => {
    const err = expectThaiThrow(() => validateSubdomain("xn--80ak6aa92e"));
    expect(err.th).toMatch(/xn--/);
  });
});

describe("suggestSubdomain", () => {
  it("แปลงชื่ออังกฤษเป็นชื่อลิงก์", () => {
    expect(suggestSubdomain("Pla Dang Bakery")).toBe("pla-dang-bakery");
  });

  it("ชื่อไทยล้วน → เดาให้ไม่ได้ ต้องให้กรอกเอง", () => {
    expect(suggestSubdomain("ครัวคุณยาย")).toBeNull();
  });

  it("ชื่อที่ย่อแล้วไปชนชื่อระบบ → ไม่เสนอ", () => {
    expect(suggestSubdomain("API")).toBeNull();
  });

  it("ไม่ทิ้งขีดกลางท้ายชื่อหลังตัดความยาว", () => {
    const s = suggestSubdomain(`${"a".repeat(29)} bakery`);
    expect(s).not.toMatch(/-$/);
  });
});

describe("validateLogoUrl", () => {
  it("https กับนามสกุลภาพที่รองรับ → ผ่าน", () => {
    expect(validateLogoUrl("https://cdn.example/logo.png")).toBe(
      "https://cdn.example/logo.png",
    );
  });

  it("http ธรรมดา → ปฏิเสธ", () => {
    expect(() => validateLogoUrl("http://cdn.example/logo.png")).toThrow();
  });

  it("SVG → ปฏิเสธ พร้อมบอกเหตุผลและทางออก", () => {
    // SVG เป็น XML ที่ฝัง <script> ได้ พอวางในหน้าเราก็รันในโดเมนเรา
    const err = expectThaiThrow(() =>
      validateLogoUrl("https://cdn.example/logo.svg"),
    );
    expect(err.th).toMatch(/ฝังสคริปต์ได้/);
    expect(err.th).toMatch(/PNG/);
  });

  it("javascript: และ data: → ปฏิเสธ", () => {
    expect(() => validateLogoUrl("javascript:alert(1)")).toThrow();
    expect(() =>
      validateLogoUrl("data:image/png;base64,iVBORw0KGgo="),
    ).toThrow();
  });

  it("URL ที่มีรหัสผ่านฝังอยู่ → ปฏิเสธ", () => {
    const err = expectThaiThrow(() =>
      validateLogoUrl("https://user:pass@cdn.example/logo.png"),
    );
    expect(err.th).toMatch(/รหัสผ่าน/);
  });

  it("นามสกุลที่ไม่ใช่ภาพ → ปฏิเสธ", () => {
    expect(() => validateLogoUrl("https://cdn.example/logo.html")).toThrow();
    expect(() => validateLogoUrl("https://cdn.example/logo")).toThrow();
  });

  it("ข้อความที่ไม่ใช่ URL → error ไทยที่บอกรูปแบบที่ต้องการ", () => {
    const err = expectThaiThrow(() => validateLogoUrl("โลโก้ร้าน"));
    expect(err.th).toMatch(/https:\/\//);
  });
});

describe("สี", () => {
  it("normalizeHexColor รับทั้งแบบสามและหกหลัก", () => {
    expect(normalizeHexColor("#FFF")).toBe("#ffffff");
    expect(normalizeHexColor("1a73e8")).toBe("#1a73e8");
  });

  it("รูปแบบสีที่ผิด → error ไทยพร้อมตัวอย่าง", () => {
    const err = expectThaiThrow(() => normalizeHexColor("สีแดง"));
    expect(err.th).toMatch(/#rrggbb/);
  });

  it("ความสว่างสัมพัทธ์ตรงตามค่าอ้างอิง", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("ดำกับขาวได้อัตราส่วน 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("สลับลำดับสีแล้วได้ค่าเดิม", () => {
    expect(contrastRatio("#1a73e8", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#1a73e8"),
      6,
    );
  });

  it("เลือกสีตัวอักษรบนพื้นให้อ่านออก", () => {
    expect(readableTextOn("#1a73e8")).toBe("#ffffff");
    expect(readableTextOn("#ffe066")).toBe("#111111");
  });

  it("สีช่วงที่ทั้งขาวและ #111111 ไม่ถึงเกณฑ์ → ต้องถอยไปใช้ดำสนิท", () => {
    // สองเคสนี้เจอตอนกวาดสีทั้งช่วง ไม่ได้เดาเอา
    for (const hex of ["#6666ff", "#0077dd"]) {
      expect(readableTextOn(hex), hex).toBe("#000000");
      expect(contrastRatio(hex, "#ffffff"), hex).toBeLessThan(MIN_CONTRAST_AA);
      expect(contrastRatio(hex, "#111111"), hex).toBeLessThan(MIN_CONTRAST_AA);
      expect(contrastRatio(hex, "#000000"), hex).toBeGreaterThan(
        MIN_CONTRAST_AA,
      );
    }
  });

  it("ตัวหนังสือบนปุ่มอ่านออกเสมอ ไม่ว่าลูกค้าเลือกสีอะไร", () => {
    // กวาดทั้งช่วงสีเพื่อยืนยันว่าไม่มีสีไหนที่ปุ่มอ่านไม่ออก
    // เทสต์นี้คือตัวที่จับได้ว่า #111111 เอาไม่อยู่ในบางช่วง
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = `#${[r, g, b]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("")}`;
          expect(contrastRatio(hex, readableTextOn(hex)), hex).toBeGreaterThan(
            MIN_CONTRAST_AA,
          );
        }
      }
    }
  });

  it("สีอ่อนของแบรนด์ → เตือนว่าเอาไปทำตัวหนังสือบนพื้นขาวไม่ได้", () => {
    // เจ้าของร้านเบเกอรี่เลือกเหลืองพาสเทลตามป้ายร้าน แล้วลิงก์หายไปกับพื้น
    const w = checkBrandColor("#fff8b0");
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]!.th).toMatch(/กลืนกับพื้นขาว/);
    expect(w[0]!.th).toMatch(/สีพื้นปุ่มเท่านั้น/);
  });

  it("สีกลางๆ → เตือนว่าใช้กับหัวข้อใหญ่ได้ แต่ตัวหนังสือเล็กไม่ได้", () => {
    const w = checkBrandColor("#2f80ed");
    expect(w).toHaveLength(1);
    expect(w[0]!.th).toMatch(/ตัวหนังสือเล็กจะอ่านยาก/);
  });

  it("สีเข้มพอ → ไม่เตือน", () => {
    expect(checkBrandColor("#1a73e8")).toEqual([]);
    expect(checkBrandColor("#b3261e")).toEqual([]);
  });

  it("เกณฑ์ที่เตือนสอดคล้องกับค่าที่วัดได้จริง", () => {
    expect(contrastRatio("#fff8b0", "#ffffff")).toBeLessThan(MIN_CONTRAST_UI);
    expect(contrastRatio("#1a73e8", "#ffffff")).toBeGreaterThanOrEqual(
      MIN_CONTRAST_AA,
    );
  });
});

describe("prepareBranding", () => {
  const base: BrandConfig = {
    workspaceId: "ws-a",
    displayName: "ครัวคุณยาย",
    primaryColor: "#1a73e8",
    subdomain: "KruaKhunYai",
    logoUrl: "https://cdn.example/logo.png",
  };

  it("ทำให้เป็นมาตรฐานทั้งชุด", () => {
    const r = prepareBranding(base);
    expect(r.config.subdomain).toBe("kruakhunyai");
    expect(r.config.primaryColor).toBe("#1a73e8");
    expect(r.onPrimary).toBe("#ffffff");
    expect(r.warnings).toEqual([]);
    expect(r.th).toMatch(/เรียบร้อย/);
  });

  it("ไม่มีโลโก้ → ยังใช้ได้ แต่เตือนว่าจะแสดงเป็นตัวหนังสือ", () => {
    const noLogo = { ...base };
    delete noLogo.logoUrl;
    const r = prepareBranding(noLogo);
    expect(r.config.logoUrl).toBeUndefined();
    expect(r.warnings.some((w) => w.field === "logoUrl")).toBe(true);
  });

  it("โลโก้เป็นสตริงว่าง → ถือว่าไม่ได้ใส่ ไม่ใช่ error", () => {
    const r = prepareBranding({ ...base, logoUrl: "   " });
    expect(r.config.logoUrl).toBeUndefined();
  });

  it("ชื่อที่แสดงว่างเปล่า → ปฏิเสธ", () => {
    expect(() => prepareBranding({ ...base, displayName: "  " })).toThrow();
  });

  it("subdomain ที่ใช้ไม่ได้ → ปฏิเสธทั้งชุด ไม่บันทึกครึ่งๆ", () => {
    expect(() => prepareBranding({ ...base, subdomain: "www" })).toThrow();
  });

  it("สีที่อ่านยาก → บันทึกได้แต่มีคำเตือนติดมา", () => {
    const r = prepareBranding({ ...base, primaryColor: "#fff8b0" });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.onPrimary).toBe("#111111");
    expect(r.th).toMatch(/ที่ควรดู/);
  });
});
