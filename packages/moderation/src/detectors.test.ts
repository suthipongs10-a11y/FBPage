import { describe, expect, it } from "vitest";
import {
  detectBuyingIntent,
  detectComplaint,
  detectExternalLink,
  detectLineId,
  detectPhone,
  detectProfanity,
} from "./detectors.js";

describe("detectPhone — จับเบอร์คู่แข่ง", () => {
  it("เบอร์มือถือไทยมั่นใจสูง", () => {
    for (const t of [
      "โทร 0812345678",
      "081-234-5678",
      "๐๘๑๒๓๔๕๖๗๘",
      "0 8 1 2 3 4 5 6 7 8",
      "0912345678 นะครับ",
      "0651234567",
    ]) {
      const hit = detectPhone(t);
      expect(hit, t).not.toBeNull();
      expect(hit!.confidence, t).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("รูปแบบ +66", () => {
    expect(detectPhone("+66812345678")?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("เลขยาวที่ไม่ใช่รูปแบบเบอร์ → มั่นใจต่ำ ไม่ควรซ่อนเอง", () => {
    const hit = detectPhone("เลขพัสดุ 123456789012");
    expect(hit).not.toBeNull();
    expect(hit!.confidence).toBeLessThan(0.8);
  });

  it("ไม่จับราคาหรือเลขสั้น (false positive ที่แพงที่สุด)", () => {
    for (const t of [
      "ราคา 250 บาท",
      "ลด 50%",
      "ไซส์ 38",
      "สั่ง 2 ชิ้น",
      "ปี 2026",
      "รอบ 14.00 น.",
    ]) {
      expect(detectPhone(t), t).toBeNull();
    }
  });

  it("ข้อความไทยล้วนไม่มีเบอร์", () => {
    expect(detectPhone("สนใจค่ะ ราคาเท่าไหร่คะ")).toBeNull();
  });

  it("ข้อความไทยพร้อมเหตุผลว่าทำไมถึงจับ", () => {
    expect(detectPhone("0812345678")!.th).toMatch(/[ก-๙]/);
  });
});

describe("detectExternalLink", () => {
  it("จับลิงก์ออกนอก", () => {
    for (const t of [
      "ดูที่ https://shopee.co.th/xxx",
      "www.example.com/deal",
      "สั่งที่ lazada.co.th/abc",
    ]) {
      expect(detectExternalLink(t), t).not.toBeNull();
    }
  });

  it("ลิงก์ Facebook/IG ของเราเองไม่ถือว่าสแปม", () => {
    for (const t of [
      "ดูโพสต์เก่า https://facebook.com/mypage/posts/123",
      "https://m.me/mypage",
      "https://www.instagram.com/p/abc",
      "https://fb.watch/xyz",
    ]) {
      expect(detectExternalLink(t), t).toBeNull();
    }
  });

  it("ข้อความปกติที่มีจุดไม่ถูกมองว่าเป็นลิงก์", () => {
    for (const t of [
      "ราคา 1,250.50 บาท",
      "สนใจค่ะ...",
      "รอบ 14.00 น. ค่ะ",
    ]) {
      expect(detectExternalLink(t), t).toBeNull();
    }
  });
});

describe("detectLineId", () => {
  it("จับการทิ้ง LINE ID", () => {
    for (const t of ["ไลน์ไอดี abc123", "แอดไลน์ได้เลย", "line id: shop99"]) {
      expect(detectLineId(t), t).not.toBeNull();
    }
  });

  it("@xxx มั่นใจต่ำกว่า เพราะอาจเป็นการแท็กคน", () => {
    const hit = detectLineId("@somchai");
    expect(hit).not.toBeNull();
    expect(hit!.confidence).toBeLessThan(0.8);
  });

  it("ข้อความปกติไม่ถูกจับ", () => {
    expect(detectLineId("สนใจค่ะ")).toBeNull();
  });
});

describe("detectProfanity", () => {
  it("จับคำหยาบตรงๆ", () => {
    for (const t of ["เหี้ยอะไรวะ", "สัสจริง", "แม่งเอ๊ย"]) {
      expect(detectProfanity(t), t).not.toBeNull();
    }
  });

  it("จับที่ซ้ำตัวอักษร", () => {
    expect(detectProfanity("เหี้ยยยยยย")).not.toBeNull();
  });

  it("จับที่แทรกช่องว่างหลบ filter", () => {
    expect(detectProfanity("เ ห ี ้ ย")).not.toBeNull();
  });

  it("จับคำหยาบอังกฤษ", () => {
    expect(detectProfanity("what the fuck")).not.toBeNull();
  });

  it("ลูกค้าเพิ่มคำเองได้", () => {
    expect(detectProfanity("ห่วยแตกมาก", ["ห่วยแตก"])).not.toBeNull();
  });

  it("ไม่จับคำสุภาพ (false positive แพงกว่า false negative)", () => {
    for (const t of [
      "สนใจค่ะ",
      "ขอบคุณมากค่ะ",
      "สินค้าดีมาก",
      "ส่งไวมากเลยค่ะ",
      "สอบถามราคาหน่อยครับ",
    ]) {
      expect(detectProfanity(t), t).toBeNull();
    }
  });
});

describe("detectBuyingIntent — หัวใจของ Comment → Inbox", () => {
  it("จับคำที่สเปกยกตัวอย่างไว้", () => {
    for (const t of ["สนใจค่ะ", "ราคาเท่าไหร่", "CF", "cf 1"]) {
      expect(detectBuyingIntent(t), t).not.toBeNull();
    }
  });

  it("จับคำถามซื้อขายแบบไทยๆ", () => {
    for (const t of [
      "กี่บาทคะ",
      "ยังมีไหมคะ",
      "จองค่ะ",
      "สั่งซื้อยังไงคะ",
      "ส่งไหมคะ",
      "ทักแล้วนะคะ",
    ]) {
      expect(detectBuyingIntent(t), t).not.toBeNull();
    }
  });

  it("ลูกค้าเพิ่มคำเองได้", () => {
    expect(detectBuyingIntent("เอา 2 ตัว", ["เอา"])).not.toBeNull();
  });

  it("คอมเมนต์ชมเฉยๆ ไม่ถือว่าสนใจซื้อ", () => {
    for (const t of ["สวยมากค่ะ", "น่ารักจัง", "ขอบคุณค่ะ"]) {
      expect(detectBuyingIntent(t), t).toBeNull();
    }
  });
});

describe("detectComplaint", () => {
  it("จับคำร้องเรียนที่ต้องรีบแจ้งแอดมิน", () => {
    for (const t of [
      "ยังไม่ได้ของเลยค่ะ",
      "ของไม่ตรงปก",
      "จะแจ้งความแล้วนะ",
      "ขอคืนเงินค่ะ",
      "รอนานมาก",
      "ติดต่อไม่ได้เลย",
    ]) {
      expect(detectComplaint(t), t).not.toBeNull();
    }
  });

  it("คอมเมนต์ปกติไม่ถูกจับ", () => {
    for (const t of ["สนใจค่ะ", "สวยมาก", "ราคาเท่าไหร่"]) {
      expect(detectComplaint(t), t).toBeNull();
    }
  });
});

describe("ทุกตัวตรวจจับให้เหตุผลภาษาไทย", () => {
  it("อธิบายได้ว่าทำไมถึงจับ", () => {
    const hits = [
      detectPhone("0812345678"),
      detectExternalLink("https://shopee.co.th/x"),
      detectLineId("ไลน์ไอดี abc"),
      detectProfanity("เหี้ย"),
      detectBuyingIntent("สนใจค่ะ"),
      detectComplaint("ยังไม่ได้ของ"),
    ];
    for (const h of hits) {
      expect(h).not.toBeNull();
      expect(h!.th).toMatch(/[ก-๙]/);
      expect(h!.confidence).toBeGreaterThan(0);
      expect(h!.confidence).toBeLessThanOrEqual(1);
    }
  });
});
