import { describe, expect, it } from "vitest";
import {
  applyTone,
  botDisclosure,
  buildSystemPrompt,
  checkBannedWords,
  defaultConfig,
  stripEmoji,
} from "./tone.js";
import type { PageBotConfig } from "./types.js";

const SHOP = defaultConfig("p1", "ร้านกาแฟดีดี");

const CLINIC: PageBotConfig = defaultConfig("p2", "คลินิกความงาม", {
  tone: {
    particle: "ครับ",
    customerPronoun: "คุณ",
    selfPronoun: "ทางคลินิก",
    politeness: "formal",
    emoji: "none",
    bannedWords: ["รักษาหายขาด", "ปลอดภัย 100%"],
  },
});

describe("buildSystemPrompt", () => {
  it("ใส่ชื่อร้านและวิธีพูดของเพจนั้น", () => {
    const p = buildSystemPrompt(SHOP);
    expect(p).toContain("ร้านกาแฟดีดี");
    expect(p).toContain("ค่ะ");
    expect(p).toContain("คุณลูกค้า");
  });

  it("เพจต่างกันได้ prompt ต่างกัน", () => {
    expect(buildSystemPrompt(SHOP)).not.toBe(buildSystemPrompt(CLINIC));
    expect(buildSystemPrompt(CLINIC)).toContain("ครับ");
    expect(buildSystemPrompt(CLINIC)).toContain("ทางคลินิก");
  });

  it("สั่งห้ามแต่งข้อมูลขึ้นเอง (ลด hallucination ตามสเปก)", () => {
    const p = buildSystemPrompt(SHOP);
    expect(p).toContain("ห้ามแต่งข้อมูลขึ้นเอง");
    expect(p).toContain("อย่าเดา");
  });

  it("สั่งห้ามขอข้อมูลอ่อนไหว", () => {
    const p = buildSystemPrompt(SHOP);
    expect(p).toContain("บัตรเครดิต");
    expect(p).toContain("บัตรประชาชน");
  });

  it("ใส่คำต้องห้ามของเพจลงใน prompt ด้วย", () => {
    expect(buildSystemPrompt(CLINIC)).toContain("รักษาหายขาด");
  });

  it("สั่งให้ตอบสั้นเพราะลูกค้าอ่านบนมือถือ", () => {
    expect(buildSystemPrompt(SHOP)).toContain("มือถือ");
  });

  it("prompt เป็นภาษาไทย", () => {
    expect(buildSystemPrompt(SHOP)).toMatch(/[ก-๙]/);
  });
});

describe("applyTone — ปรับข้อความตายตัวให้เข้ากับเพจ", () => {
  it("แทนคำลงท้ายตามเพจ", () => {
    expect(applyTone("ยินดีให้บริการ{ค่ะ}", SHOP)).toBe("ยินดีให้บริการค่ะ");
    expect(applyTone("ยินดีให้บริการ{ค่ะ}", CLINIC)).toBe("ยินดีให้บริการครับ");
  });

  it("แทนสรรพนามและชื่อร้าน", () => {
    expect(applyTone("{ร้าน}ยินดีต้อนรับ{ลูกค้า}", SHOP)).toBe(
      "ทางร้านยินดีต้อนรับคุณลูกค้า",
    );
    expect(applyTone("ยินดีต้อนรับสู่{ชื่อร้าน}", CLINIC)).toBe(
      "ยินดีต้อนรับสู่คลินิกความงาม",
    );
  });

  it("ตัวแปรที่ไม่มีค่าถูกตัดทิ้ง ไม่ทิ้งวงเล็บ", () => {
    const out = applyTone("สวัสดี {ไม่มีตัวแปรนี้} ยินดี{ค่ะ}", SHOP);
    expect(out).not.toContain("{");
    expect(out).toBe("สวัสดี ยินดีค่ะ");
  });

  it("ส่งตัวแปรเพิ่มเองได้", () => {
    expect(
      applyTone("สวัสดี{ค่ะ} คุณ{ชื่อลูกค้า}", SHOP, { ชื่อลูกค้า: "สมชาย" }),
    ).toBe("สวัสดีค่ะ คุณสมชาย");
  });

  it("เพจที่ตั้งค่าไม่ใช้อีโมจิ ต้องไม่มีอีโมจิหลุดไป", () => {
    expect(applyTone("ยินดี{ค่ะ} 😊🎉", CLINIC)).toBe("ยินดีครับ");
  });

  it("เพจที่ใช้อีโมจิได้ยังคงอีโมจิไว้", () => {
    expect(applyTone("ยินดี{ค่ะ} 😊", SHOP)).toContain("😊");
  });
});

describe("stripEmoji", () => {
  it("ลบอีโมจิออก", () => {
    expect(stripEmoji("สวัสดีค่ะ 😊🎉✨")).toBe("สวัสดีค่ะ");
  });
  it("ข้อความไทยและตัวเลขไม่ถูกแตะ", () => {
    expect(stripEmoji("ราคา 250 บาทค่ะ")).toBe("ราคา 250 บาทค่ะ");
  });
});

describe("checkBannedWords — ด่านสุดท้ายหลัง LLM ตอบ", () => {
  it("จับคำต้องห้ามของเพจ", () => {
    const v = checkBannedWords("ทรีตเมนต์นี้รักษาหายขาดแน่นอน", CLINIC);
    expect(v).not.toBeNull();
    expect(v!.word).toBe("รักษาหายขาด");
    expect(v!.th).toMatch(/[ก-๙]/);
  });

  it("ไม่สนตัวพิมพ์", () => {
    const cfg = defaultConfig("p3", "ร้าน", {
      tone: { ...SHOP.tone, bannedWords: ["Guarantee"] },
    });
    expect(checkBannedWords("we guarantee results", cfg)).not.toBeNull();
  });

  it("ข้อความปกติผ่านได้", () => {
    expect(checkBannedWords("ยินดีให้คำปรึกษาครับ", CLINIC)).toBeNull();
  });

  it("เพจที่ไม่ได้ตั้งคำต้องห้ามไว้ ผ่านหมด", () => {
    expect(checkBannedWords("อะไรก็ได้", SHOP)).toBeNull();
  });
});

describe("botDisclosure — Meta policy บังคับ", () => {
  it("บอกว่าเป็นระบบอัตโนมัติและบอกวิธีขอคุยกับคน", () => {
    const d = botDisclosure(SHOP);
    expect(d).toContain("อัตโนมัติ");
    expect(d).toContain("แอดมิน");
  });

  it("ใช้โทนของเพจนั้น", () => {
    expect(botDisclosure(SHOP)).toContain("ค่ะ");
    expect(botDisclosure(CLINIC)).toContain("ครับ");
    expect(botDisclosure(CLINIC)).toContain("คลินิกความงาม");
  });

  it("เขียนข้อความเองได้", () => {
    const cfg = defaultConfig("p1", "ร้าน", {
      botDisclosure: "นี่คือบอทของ{ชื่อร้าน}นะ{ค่ะ}",
    });
    expect(botDisclosure(cfg)).toBe("นี่คือบอทของร้านนะค่ะ");
  });
});

describe("defaultConfig", () => {
  it("ค่าเริ่มต้นสมเหตุสมผล", () => {
    expect(SHOP.minConfidence).toBeGreaterThan(0);
    expect(SHOP.minConfidence).toBeLessThan(1);
    expect(SHOP.tone.bannedWords).toEqual([]);
  });

  it("ทับค่าเริ่มต้นได้", () => {
    const cfg = defaultConfig("p1", "ร้าน", { minConfidence: 0.9 });
    expect(cfg.minConfidence).toBe(0.9);
  });
});
