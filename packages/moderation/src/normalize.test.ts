import { describe, expect, it } from "vitest";
import {
  containsAny,
  extractDigitRuns,
  normalizeAggressive,
  normalizeText,
  thaiDigitsToArabic,
} from "./normalize.js";

describe("thaiDigitsToArabic", () => {
  it("แปลงเลขไทยเป็นอารบิก", () => {
    expect(thaiDigitsToArabic("๐๘๑๒๓๔๕๖๗๘")).toBe("0812345678");
  });
  it("ปนกันก็แปลงเฉพาะเลขไทย", () => {
    expect(thaiDigitsToArabic("โทร ๐๘๑-234-5678")).toBe("โทร 081-234-5678");
  });
  it("ข้อความที่ไม่มีเลขไทยไม่เปลี่ยน", () => {
    expect(thaiDigitsToArabic("สวัสดีครับ")).toBe("สวัสดีครับ");
  });
});

describe("normalizeText", () => {
  it("ยุบตัวอักษรที่ซ้ำเกิน 2 ตัว", () => {
    expect(normalizeText("เหี้ยยยยยยย")).toBe(normalizeText("เหี้ยย"));
    expect(normalizeText("ดีมากกกกก")).toBe(normalizeText("ดีมากก"));
  });

  it("ลบอักขระล่องหนที่ copy ติดมา", () => {
    expect(normalizeText("สวัสดี​ครับ")).toBe("สวัสดีครับ");
  });

  it("ยุบช่องว่างและตัดหัวท้าย", () => {
    expect(normalizeText("  สนใจ   ค่ะ  ")).toBe("สนใจ ค่ะ");
  });

  it("ไม่สนตัวพิมพ์ใหญ่เล็ก", () => {
    expect(normalizeText("CF")).toBe(normalizeText("cf"));
  });

  it("ข้อความไทยปกติยังอ่านออก", () => {
    expect(normalizeText("สนใจสินค้าค่ะ ราคาเท่าไหร่คะ")).toBe(
      "สนใจสินค้าค่ะ ราคาเท่าไหร่คะ",
    );
  });
});

describe("normalizeAggressive", () => {
  it("แทรกช่องว่างกลางคำแล้วยังจับได้", () => {
    expect(normalizeAggressive("เ ห ี ้ ย")).toBe(normalizeAggressive("เหี้ย"));
  });

  it("แทรกจุดหรือขีดก็ยังจับได้", () => {
    expect(normalizeAggressive("เ.ห.ี.้.ย")).toBe(normalizeAggressive("เหี้ย"));
  });

  it("ลบสระและวรรณยุกต์ออกหมด", () => {
    expect(normalizeAggressive("สวัสดี")).toBe("สวสด");
  });
});

describe("extractDigitRuns — หาเบอร์ที่ถูกพราง", () => {
  it("เบอร์ปกติ", () => {
    expect(extractDigitRuns("โทร 0812345678 นะ")).toContain("0812345678");
  });

  it("มีขีดคั่น", () => {
    expect(extractDigitRuns("081-234-5678")).toContain("0812345678");
  });

  it("มีช่องว่างคั่นทุกตัว", () => {
    expect(extractDigitRuns("0 8 1 2 3 4 5 6 7 8")).toContain("0812345678");
  });

  it("มีจุดคั่น", () => {
    expect(extractDigitRuns("081.234.5678")).toContain("0812345678");
  });

  it("เลขไทย", () => {
    expect(extractDigitRuns("๐๘๑๒๓๔๕๖๗๘")).toContain("0812345678");
  });

  it("ใช้ตัวอักษรแทนเลขที่อยู่ติดเลขจริง", () => {
    // "o" แทน 0 ตอนขึ้นต้น
    expect(extractDigitRuns("o812345678")).toContain("0812345678");
  });

  it("ไม่แปลงตัวอักษรในคำภาษาอังกฤษปกติ", () => {
    // "solo" ไม่ควรกลายเป็นตัวเลข
    const runs = extractDigitRuns("solo trip");
    expect(runs).toEqual([]);
  });

  it("ข้อความที่ไม่มีเลขคืน array ว่าง", () => {
    expect(extractDigitRuns("สนใจค่ะ")).toEqual([]);
  });

  it("แยกเลขคนละกลุ่มที่มีตัวอักษรคั่น", () => {
    const runs = extractDigitRuns("ราคา 250 บาท ส่ง 50");
    expect(runs).toContain("250");
    expect(runs).toContain("50");
  });
});

describe("containsAny", () => {
  it("เจอคำในข้อความ", () => {
    expect(containsAny("สนใจสินค้าค่ะ", ["สนใจ"])).toBe("สนใจ");
  });

  it("ไม่เจอคืน null", () => {
    expect(containsAny("สวัสดีค่ะ", ["สนใจ"])).toBeNull();
  });

  it("จับคำที่แทรกช่องว่างได้เมื่อเปิด aggressive", () => {
    expect(containsAny("เ ห ี ้ ย", ["เหี้ย"], { aggressive: true })).toBe(
      "เหี้ย",
    );
    expect(containsAny("เ ห ี ้ ย", ["เหี้ย"])).toBeNull();
  });

  it("คำสั้นเกินไปไม่แมตช์แบบ aggressive (กันชนมั่ว)", () => {
    // "กู" หลังลบสระเหลือสั้นมาก ไม่ควรไปชนกับคำอื่น
    expect(
      containsAny("ดูสิครับ", ["กู"], { aggressive: true }),
    ).toBeNull();
  });

  it("รายการว่างคืน null", () => {
    expect(containsAny("อะไรก็ได้", [])).toBeNull();
  });
});
