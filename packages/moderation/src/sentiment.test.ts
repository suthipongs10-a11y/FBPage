import { describe, expect, it } from "vitest";
import {
  ALERT_CONFIDENCE_THRESHOLD,
  analyzeSentiment,
  shouldAlert,
} from "./sentiment.js";

describe("analyzeSentiment — คอมเมนต์เชิงบวก", () => {
  it("คำชมตรงๆ", () => {
    for (const t of [
      "สินค้าดีมากค่ะ",
      "ประทับใจมาก ส่งไวด้วย",
      "อร่อยมากค่ะ แนะนำเลย",
      "สวยมากค่ะ ถูกใจสุดๆ",
    ]) {
      expect(analyzeSentiment(t).sentiment, t).toBe("positive");
    }
  });

  it("ไม่ยิง alert สำหรับคอมเมนต์ชม", () => {
    expect(shouldAlert(analyzeSentiment("ดีมากค่ะ ประทับใจ"))).toBe(false);
  });
});

describe("analyzeSentiment — คอมเมนต์เชิงลบ", () => {
  it("คำร้องเรียนตรงๆ", () => {
    for (const t of [
      "ยังไม่ได้ของเลยค่ะ รอนานมาก",
      "ของไม่ตรงปก ขอคืนเงิน",
      "บริการแย่มาก ไม่ประทับใจ",
      "โกงชัดๆ จะแจ้งความ",
    ]) {
      expect(analyzeSentiment(t).sentiment, t).toBe("negative");
    }
  });

  it("ยิง alert เมื่อชัดว่าลบ", () => {
    const r = analyzeSentiment("ของไม่ตรงปก บริการแย่มาก ขอคืนเงิน");
    expect(r.sentiment).toBe("negative");
    expect(shouldAlert(r)).toBe(true);
  });

  it("เก็บคำที่ทำให้ตัดสิน ไว้อธิบายให้ลูกค้าฟัง", () => {
    const r = analyzeSentiment("รอนานมาก ติดต่อไม่ได้");
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.th).toMatch(/[ก-๙]/);
  });
});

describe("analyzeSentiment — คำปฏิเสธ (จุดที่พลาดง่ายที่สุด)", () => {
  it('"ไม่ดี" ต้องไม่ถูกนับเป็นบวกเพราะมีคำว่า "ดี"', () => {
    expect(analyzeSentiment("สินค้าไม่ดีเลย").sentiment).toBe("negative");
  });

  it('"ไม่คุ้ม" เป็นลบ', () => {
    expect(analyzeSentiment("ราคานี้ไม่คุ้มเลย").sentiment).toBe("negative");
  });

  it('"ไม่ประทับใจ" เป็นลบ', () => {
    expect(analyzeSentiment("ไม่ประทับใจเลยค่ะ").sentiment).toBe("negative");
  });

  it('"ไม่แนะนำ" เป็นลบ', () => {
    expect(analyzeSentiment("ไม่แนะนำเลยค่ะ").sentiment).toBe("negative");
  });

  it('"ไม่แย่" ไม่ถูกนับเป็นคำชม', () => {
    // ปฏิเสธคำลบไม่ได้แปลว่าชม — ควรอยู่กลางๆ ไม่ใช่บวก
    expect(analyzeSentiment("ก็ไม่แย่นะ").sentiment).not.toBe("positive");
  });
});

describe("analyzeSentiment — กรณีที่ควรให้คนตัดสิน", () => {
  it("คอมเมนต์ว่าง", () => {
    const r = analyzeSentiment("   ");
    expect(r.sentiment).toBe("neutral");
    expect(shouldAlert(r)).toBe(false);
  });

  it("คอมเมนต์ที่ไม่มีคำบอกอารมณ์", () => {
    const r = analyzeSentiment("สอบถามราคาหน่อยค่ะ");
    expect(r.sentiment).toBe("neutral");
    expect(shouldAlert(r)).toBe(false);
  });

  it("คำถามที่มีคำชม ต้องมั่นใจน้อยลง (ไม่ใช่การชม)", () => {
    const statement = analyzeSentiment("ของดีมาก");
    const question = analyzeSentiment("ของดีมากไหมคะ");
    expect(question.confidence).toBeLessThan(statement.confidence);
  });

  it("มีทั้งคำบวกและคำลบ → กลางๆ ให้คนอ่านเอง", () => {
    const r = analyzeSentiment("ของสวยมากค่ะ แต่ส่งช้ามาก");
    expect(r.sentiment).toBe("neutral");
    expect(r.th).toContain("ให้คนอ่าน");
  });
});

describe("shouldAlert", () => {
  it("ไม่ยิง alert เมื่อมั่นใจต่ำ (กันแอดมินเลิกอ่าน)", () => {
    expect(
      shouldAlert({
        sentiment: "negative",
        score: -1,
        confidence: ALERT_CONFIDENCE_THRESHOLD - 0.01,
        signals: [],
        th: "",
      }),
    ).toBe(false);
  });

  it("ยิงเมื่อถึงเกณฑ์", () => {
    expect(
      shouldAlert({
        sentiment: "negative",
        score: -1,
        confidence: ALERT_CONFIDENCE_THRESHOLD,
        signals: [],
        th: "",
      }),
    ).toBe(true);
  });

  it("ไม่ยิงสำหรับ neutral/positive ไม่ว่าจะมั่นใจแค่ไหน", () => {
    for (const s of ["neutral", "positive"] as const) {
      expect(
        shouldAlert({
          sentiment: s,
          score: 1,
          confidence: 1,
          signals: [],
          th: "",
        }),
        s,
      ).toBe(false);
    }
  });
});
