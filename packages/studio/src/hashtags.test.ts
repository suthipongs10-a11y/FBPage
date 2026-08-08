import { describe, expect, it } from "vitest";
import {
  MAX_HASHTAG_CHARS,
  MAX_HASHTAG_COUNT,
  checkHashtags,
  cleanHashtags,
  composeCaption,
  extractHashtags,
  toHashtag,
} from "./hashtags.js";

describe("toHashtag", () => {
  it("แท็กไทยต้องไม่มีช่องว่าง — Facebook ตัดที่ช่องว่าง", () => {
    // "#ร้าน กาแฟ" จะกลายเป็นแท็ก "#ร้าน" แล้ว "กาแฟ" ลอยออกมาเป็นข้อความเปล่า
    expect(toHashtag("ร้าน กาแฟ")).toBe("#ร้านกาแฟ");
  });

  it("ตัดอีโมจิและอักขระพิเศษออก", () => {
    expect(toHashtag("กาแฟ☕สด!")).toBe("#กาแฟสด");
  });

  it("ใส่ # มาอยู่แล้วก็ไม่ซ้อนกัน", () => {
    expect(toHashtag("#กาแฟ")).toBe("#กาแฟ");
    expect(toHashtag("##กาแฟ")).toBe("#กาแฟ");
  });

  it("เก็บตัวเลขที่ปนกับตัวอักษรไว้", () => {
    expect(toHashtag("โปร11.11")).toBe("#โปร1111");
  });

  it("ตัวเลขล้วน → ไม่เป็นแท็ก เพราะไม่มีใครค้นหา", () => {
    expect(toHashtag("2569")).toBeNull();
    expect(toHashtag("๒๕๖๙")).toBeNull();
  });

  it("สั้นเกิน 2 ตัว → ไม่เป็นแท็ก", () => {
    expect(toHashtag("ก")).toBeNull();
    expect(toHashtag("#")).toBeNull();
    expect(toHashtag("   ")).toBeNull();
  });

  it("ยาวเกินกำหนด → ตัดให้พอดี ไม่ทิ้ง", () => {
    const tag = toHashtag("ก".repeat(80))!;
    expect(tag.length).toBe(MAX_HASHTAG_CHARS + 1);
  });

  it("วรรณยุกต์และสระต้องไม่หาย — \\p{L} อย่างเดียวจะกิน ้ ของ 'ร้าน' ทิ้ง", () => {
    // เคสนี้เคยพังจริง: "#ร้านกาแฟ" กลายเป็น "#รานกาแฟ" ซึ่งสะกดผิดและเป็นคนละคำ
    // เพราะวรรณยุกต์ไทยเป็น Unicode Mark (\p{M}) ไม่ใช่ Letter (\p{L})
    expect(toHashtag("ร้านกาแฟ")).toBe("#ร้านกาแฟ");
    expect(toHashtag("ข้าวกล่องส่งฟรี")).toBe("#ข้าวกล่องส่งฟรี");
    expect(toHashtag("สู้ๆ นะคะ")).toBe("#สู้ๆนะคะ");
  });

  it("ตัดความยาวเป็นจำนวนตัวอักษรที่คนเห็น ไม่ใช่จำนวน code unit", () => {
    // "ก้" = 2 code unit แต่คนเห็นเป็นตัวเดียว
    // ถ้าตัดตาม code unit จะได้แค่ครึ่งเดียวของที่ควรได้
    const tag = toHashtag("ก้".repeat(60))!;
    expect(tag).toBe(`#${"ก้".repeat(MAX_HASHTAG_CHARS)}`);
  });

  it("วรรณยุกต์ลอยเดี่ยวโดยไม่มีพยัญชนะ → ไม่เป็นแท็ก", () => {
    expect(toHashtag("้")).toBeNull();
    expect(toHashtag("่้๊๋")).toBeNull();
  });

  it("ตัวอักษรอังกฤษใช้ได้ปกติ", () => {
    expect(toHashtag("Coffee Shop")).toBe("#CoffeeShop");
  });
});

describe("cleanHashtags", () => {
  it("ตัดแท็กซ้ำออก", () => {
    expect(cleanHashtags(["#กาแฟ", "กาแฟ", "#กาแฟ"])).toEqual(["#กาแฟ"]);
  });

  it("แท็กแบรนด์มาก่อนเสมอ แม้จะส่งมาทีหลัง", () => {
    const tags = cleanHashtags(["#โปรโมชั่น", "#ลดราคา"], {
      brandTags: ["ครัวคุณยาย"],
    });
    expect(tags[0]).toBe("#ครัวคุณยาย");
  });

  it("แท็กแบรนด์ไม่ถูกนับซ้ำถ้า AI ใส่มาด้วย", () => {
    const tags = cleanHashtags(["#ครัวคุณยาย", "#อร่อย"], {
      brandTags: ["ครัวคุณยาย"],
    });
    expect(tags.filter((t) => t === "#ครัวคุณยาย")).toHaveLength(1);
  });

  it("จำกัดจำนวนตามที่ขอ", () => {
    const many = Array.from({ length: 20 }, (_, i) => `แท็ก${i}`);
    expect(cleanHashtags(many, { limit: 3 })).toHaveLength(3);
  });

  it("ขอเกินเพดาน → ถูกกดลงมาที่เพดาน ไม่ปล่อยให้สแปม", () => {
    const many = Array.from({ length: 40 }, (_, i) => `แท็ก${i}`);
    expect(cleanHashtags(many, { limit: 99 })).toHaveLength(MAX_HASHTAG_COUNT);
  });

  it("แท็กที่แปลงแล้วไม่เหลืออะไร ถูกทิ้งไปเงียบๆ", () => {
    expect(cleanHashtags(["😀", "!", "ก"])).toEqual([]);
  });
});

describe("extractHashtags", () => {
  it("แยกแท็กที่ AI ใส่ปนมาในเนื้อโพสต์ออกมา", () => {
    const r = extractHashtags("วันนี้มีข้าวกล่องนะคะ #ข้าวกล่อง #ส่งฟรี");
    expect(r.body).toBe("วันนี้มีข้าวกล่องนะคะ");
    expect(r.hashtags).toEqual(["#ข้าวกล่อง", "#ส่งฟรี"]);
  });

  it("แท็กที่อยู่กลางประโยคก็ดึงออก และไม่ทิ้งช่องว่างซ้อน", () => {
    const r = extractHashtags("สั่ง #ข้าวกล่อง ได้เลยวันนี้");
    expect(r.body).toBe("สั่ง ได้เลยวันนี้");
  });

  it("ไม่มีแท็ก → คืนเนื้อเดิมและรายการว่าง", () => {
    const r = extractHashtags("วันนี้ฝนตก");
    expect(r.body).toBe("วันนี้ฝนตก");
    expect(r.hashtags).toEqual([]);
  });

  it("ยุบบรรทัดว่างที่เหลือจากการดึงแท็กออก", () => {
    const r = extractHashtags("เนื้อโพสต์\n\n\n#แท็ก1\n#แท็ก2");
    expect(r.body).toBe("เนื้อโพสต์");
  });
});

describe("composeCaption", () => {
  it("ต่อแท็กท้ายโพสต์โดยเว้นบรรทัด", () => {
    expect(composeCaption("สวัสดี", ["#กาแฟ", "#รัชดา"])).toBe(
      "สวัสดี\n\n#กาแฟ #รัชดา",
    );
  });

  it("ไม่มีแท็ก → ไม่ทิ้งบรรทัดว่างท้ายโพสต์", () => {
    expect(composeCaption("สวัสดี", [])).toBe("สวัสดี");
  });

  it("แท็กที่ใช้ไม่ได้ถูกกรองก่อนต่อ", () => {
    expect(composeCaption("สวัสดี", ["😀"])).toBe("สวัสดี");
  });
});

describe("checkHashtags", () => {
  it("แท็กที่มีช่องว่าง → เตือนพร้อมบอกผลที่จะเกิด", () => {
    const issues = checkHashtags(["#ร้าน กาแฟ"]);
    expect(issues[0]!.th).toMatch(/ตัดแท็กที่ช่องว่าง/);
  });

  it("ไม่ขึ้นต้นด้วย # → เตือน", () => {
    expect(checkHashtags(["กาแฟ"])[0]!.th).toMatch(/ไม่ได้ขึ้นต้นด้วย #/);
  });

  it("ยาวเกิน → เตือน", () => {
    const issues = checkHashtags([`#${"ก".repeat(60)}`]);
    expect(issues.some((i) => /ยาวเกิน/.test(i.th))).toBe(true);
  });

  it("แท็กซ้ำในโพสต์เดียว → เตือน", () => {
    const issues = checkHashtags(["#กาแฟ", "#กาแฟ"]);
    expect(issues.some((i) => /ซ้ำ/.test(i.th))).toBe(true);
  });

  it("แท็กเยอะเกินไป → เตือนว่าดูเหมือนสแปม", () => {
    const many = Array.from({ length: 15 }, (_, i) => `#แท็ก${i}`);
    expect(checkHashtags(many).some((i) => /สแปม/.test(i.th))).toBe(true);
  });

  it("แท็กที่ถูกต้องทั้งหมด → ไม่มีปัญหา", () => {
    expect(checkHashtags(["#ข้าวกล่อง", "#ส่งฟรี", "#รัชดา"])).toEqual([]);
  });
});
