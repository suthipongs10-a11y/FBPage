import { describe, expect, it } from "vitest";
import {
  QUESTION_MARKERS,
  TOPICS,
  TOPIC_EXCEPTIONS,
  analyzeComment,
  tallyTopics,
  type TopicKey,
} from "./topics.js";

const topicsOf = (text: string): TopicKey[] => analyzeComment(text).topics;
const isQuestion = (text: string): boolean => analyzeComment(text).isQuestion;

describe("จับหัวข้อที่คนพูดถึง", () => {
  it("พูดเรื่องรสชาติ → คุณภาพสินค้า", () => {
    expect(topicsOf("อร่อยมากค่ะ")).toContain("quality");
    expect(topicsOf("รสชาติใช้ได้เลย")).toContain("quality");
  });

  it("พูดเรื่องเงิน → ราคา", () => {
    expect(topicsOf("แพงจัง")).toContain("price");
    expect(topicsOf("กี่บาทคะ")).toContain("price");
    expect(topicsOf("ราคาเท่าไหร่")).toContain("price");
  });

  it("อยากได้ของ → อยากซื้อ/สั่งของ", () => {
    expect(topicsOf("สั่ง 2 กล่องค่ะ")).toContain("buyIntent");
    expect(topicsOf("สนใจค่ะ ทักไปแล้วนะ")).toContain("buyIntent");
    expect(topicsOf("cf 1")).toContain("buyIntent");
  });

  it("เรื่องแอดมิน/การตอบ → บริการ", () => {
    expect(topicsOf("ทักไปไม่ตอบเลย")).toContain("service");
    expect(topicsOf("แอดมินตอบเร็วมาก")).toContain("service");
  });

  it("เรื่องพัสดุ → การจัดส่ง", () => {
    expect(topicsOf("ค่าส่งเท่าไหร่")).toContain("shipping");
    expect(topicsOf("ยังไม่ได้ของเลยค่ะ")).toContain("shipping");
  });

  it("เรื่องร้องเรียน → ตำหนิ/ไม่พอใจ", () => {
    expect(topicsOf("ของไม่ตรงปก ขอคืนเงิน")).toContain("complaint");
  });

  it("คอมเมนต์เดียวอยู่ได้หลายหัวข้อ", () => {
    const t = topicsOf("ของอร่อยมาก แต่ค่าส่งแพงไปหน่อย");
    expect(t).toEqual(expect.arrayContaining(["quality", "price", "shipping"]));
  });

  it("คอมเมนต์ที่ไม่เข้าหัวข้อไหนเลย → ว่าง ไม่ใช่เดามั่ว", () => {
    expect(topicsOf("❤️❤️❤️")).toEqual([]);
    expect(topicsOf("ยินดีด้วยนะคะ")).toEqual([]);
  });

  it("ข้อความว่าง/ไม่มีข้อความ → ไม่พัง", () => {
    expect(analyzeComment(null)).toEqual({ topics: [], isQuestion: false });
    expect(analyzeComment("")).toEqual({ topics: [], isQuestion: false });
    expect(analyzeComment("   ")).toEqual({ topics: [], isQuestion: false });
  });
});

/**
 * หัวใจของโมดูลนี้ — ภาษาไทยไม่เว้นวรรค การแมตช์จึงเป็น substring ล้วน
 * ทุกเคสในบล็อกนี้คือกับดักจริงที่จะทำให้ตัวเลขบนหน้าจอผิดแบบมองไม่ออก
 */
describe("กับดักคำซ้อนของภาษาไทย", () => {
  it('"ขอบคุณ" ต้องไม่ถูกนับเป็นอยากสั่งของ', () => {
    expect(topicsOf("ขอบคุณมากค่ะ")).not.toContain("buyIntent");
    expect(topicsOf("ขอบพระคุณค่ะ")).not.toContain("buyIntent");
    expect(topicsOf("ขอโทษนะคะ")).not.toContain("buyIntent");
  });

  it('"ถูกใจ" / "ถูกต้อง" ต้องไม่ถูกนับเป็นเรื่องราคา', () => {
    expect(topicsOf("ถูกใจมาก")).not.toContain("price");
    expect(topicsOf("ข้อมูลถูกต้องแล้วค่ะ")).not.toContain("price");
    // แต่ "ราคาถูก" ต้องยังจับได้
    expect(topicsOf("ราคาถูกมาก")).toContain("price");
    expect(topicsOf("ของถูกและดี")).toContain("price");
  });

  it('"ช้าง" ต้องไม่ถูกนับเป็นส่งช้า', () => {
    expect(topicsOf("ช้างน่ารักมาก")).not.toContain("service");
    expect(topicsOf("ตอบช้ามาก")).toContain("service");
  });

  it('"เสียง" / "เสียดาย" ต้องไม่ถูกนับเป็นของเสีย', () => {
    expect(topicsOf("เสียงดีมาก")).not.toContain("complaint");
    expect(topicsOf("เสียดายจัง")).not.toContain("complaint");
  });

  it('"สั่งสอน" ต้องไม่ถูกนับเป็นสั่งของ', () => {
    expect(topicsOf("ต้องสั่งสอนกันหน่อย")).not.toContain("buyIntent");
    expect(topicsOf("สั่งของไปแล้วค่ะ")).toContain("buyIntent");
  });

  it('"ส่งเสริม" ต้องไม่ถูกนับเป็นการจัดส่ง', () => {
    expect(topicsOf("โครงการส่งเสริมการเกษตร")).not.toContain("shipping");
  });

  it("การตัดวลียกเว้นต้องไม่ทำให้คำสองข้างมาต่อกันเป็นคำใหม่", () => {
    // "รา" + "ถูกใจ" + "คา" ต้องไม่กลายเป็น "ราคา" หลังตัดวลียกเว้นออก
    expect(topicsOf("รา ถูกใจ คา")).not.toContain("price");
  });

  it('"จองไว้ในใจ" เป็นสำนวน ไม่ใช่การจองของ', () => {
    // เจอตอน audit ยิงคอมเมนต์ธรรมดา 37 อัน — อันนี้อันเดียวที่นับเกิน
    expect(topicsOf("จองไว้ในใจ")).not.toContain("buyIntent");
    expect(topicsOf("จองไว้ 2 ชิ้นค่ะ")).toContain("buyIntent");
  });
});

/**
 * กฎที่ audit เจอว่าเคยถูกละเมิดเงียบๆ — มีวลียกเว้นค้างอยู่ 15 อัน
 * ("ขอบคุณ" "ช้าง" "เสียง" …) ที่ไม่ได้กันอะไรเลย เพราะคำที่มันเคยกัน
 * ถูกตัดออกจากรายการคำสำคัญไปแล้ว
 *
 * ของค้างแบบนี้ไม่ทำให้ผลผิด แต่กิน CPU ทุกครั้งที่จัดหมวด และที่แย่กว่าคือ
 * หลอกคนอ่านโค้ดว่ามีการป้องกันอยู่ทั้งที่ไม่มี
 */
describe("ลิสต์วลียกเว้นต้องไม่มีของค้าง", () => {
  it("ทุกวลีต้องมีคำสำคัญหรือคำถามอยู่ข้างในจริง", () => {
    const guarded = [...TOPICS.flatMap((t) => t.words), ...QUESTION_MARKERS];
    const dead = TOPIC_EXCEPTIONS.filter(
      (ex) => !guarded.some((w) => ex.includes(w)),
    );
    expect(
      dead,
      "วลีพวกนี้ไม่ได้กันคำไหนเลย — เอาออกหรือไม่ก็เพิ่มคำที่มันควรกันเข้าไป",
    ).toEqual([]);
  });

  it("ทุกวลียกเว้นเอามาเป็นคอมเมนต์ตรงๆ แล้วต้องไม่เข้าหัวข้อไหน", () => {
    const leaking = TOPIC_EXCEPTIONS.filter(
      (ex) => analyzeComment(ex).topics.length > 0,
    );
    expect(leaking).toEqual([]);
  });
});

describe("จับว่าเป็นคำถามไหม", () => {
  it("เครื่องหมายคำถาม", () => {
    expect(isQuestion("มีของไหม?")).toBe(true);
    expect(isQuestion("ราคาเท่าไร？")).toBe(true);
  });

  it("คำลงท้ายแบบไทย", () => {
    for (const q of [
      "มีไหมคะ",
      "ส่งฟรีมั้ย",
      "จริงหรอ",
      "ยังมีอยู่เหรอ",
      "สั่งยังไงคะ",
      "ร้านอยู่ที่ไหน",
      "ของจะมาเมื่อไหร่",
      "ทำไมแพงจัง",
      "นี่คืออะไร",
      "ใครเคยลองบ้าง",
      "เหลือกี่ชิ้น",
    ]) {
      expect(isQuestion(q), q).toBe(true);
    }
  });

  it("ประโยคบอกเล่าไม่ใช่คำถาม", () => {
    for (const s of ["อร่อยมากค่ะ", "สั่งไปแล้ว 2 กล่อง", "ขอบคุณค่ะ", "❤️"]) {
      expect(isQuestion(s), s).toBe(false);
    }
  });

  it('"ผ้าไหม" ไม่ใช่คำถาม', () => {
    expect(isQuestion("ผ้าไหมสวยมาก")).toBe(false);
    expect(isQuestion("ไหมขัดฟันมีขายไหม")).toBe(true);
  });

  it("เป็นคำถามและมีหัวข้อพร้อมกันได้", () => {
    const a = analyzeComment("ค่าส่งกี่บาทคะ");
    expect(a.isQuestion).toBe(true);
    expect(a.topics).toEqual(expect.arrayContaining(["price", "shipping"]));
  });
});

describe("นับหัวข้อทั้งชุด", () => {
  const COMMENTS = [
    "อร่อยมากค่ะ",
    "อร่อยจริง",
    "แพงไปนะ",
    "ราคาเท่าไหร่คะ",
    "สั่ง 2 กล่องค่ะ",
    "ขอบคุณค่ะ",
    "❤️",
    null,
  ];

  it("นับถูกและเรียงจากมากไปน้อย", () => {
    const s = tallyTopics(COMMENTS);
    expect(s.total).toBe(8);
    expect(s.topics[0]).toMatchObject({ key: "quality", count: 2 });
    expect(s.topics.find((t) => t.key === "price")?.count).toBe(2);
    expect(s.topics.find((t) => t.key === "buyIntent")?.count).toBe(1);
  });

  it("ตัดหัวข้อที่ไม่มีใครพูดถึงทิ้ง ไม่แสดงเลข 0", () => {
    const s = tallyTopics(COMMENTS);
    expect(s.topics.every((t) => t.count > 0)).toBe(true);
    expect(s.topics.map((t) => t.key)).not.toContain("complaint");
  });

  it("นับคำถามพร้อมเปอร์เซ็นต์", () => {
    const s = tallyTopics(COMMENTS);
    expect(s.questions).toBe(1);
    expect(s.questionPct).toBeCloseTo(12.5, 5);
  });

  /**
   * ผลรวมของทุกหัวข้อไม่เท่ากับจำนวนคอมเมนต์ เพราะหนึ่งคอมเมนต์อยู่ได้หลายหัวข้อ
   * และส่วนใหญ่ไม่อยู่หัวข้อไหนเลย — ต้องมีตัวเลขนี้ให้เห็น ไม่ใช่ปล่อยให้คนงง
   */
  it("บอกจำนวนคอมเมนต์ที่ไม่เข้าหัวข้อไหนเลย", () => {
    // 8 คอมเมนต์ − 5 ที่เข้าหัวข้อ = 3 ("ขอบคุณค่ะ", "❤️", null)
    expect(tallyTopics(COMMENTS).uncategorized).toBe(3);
  });

  it("ไม่มีคอมเมนต์เลย → ไม่พัง และเปอร์เซ็นต์เป็น 0 ไม่ใช่ NaN", () => {
    const s = tallyTopics([]);
    expect(s).toMatchObject({ total: 0, topics: [], questions: 0, questionPct: 0 });
    expect(Number.isNaN(s.questionPct)).toBe(false);
  });
});
