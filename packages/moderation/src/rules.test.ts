import { describe, expect, it } from "vitest";
import {
  AUTO_DELETE_MIN_CONFIDENCE,
  AUTO_HIDE_MIN_CONFIDENCE,
  defaultRules,
  evaluateRules,
  renderTemplate,
} from "./rules.js";
import type { AutomationRule, IncomingComment } from "./types.js";

const PAGE = "p1";
const NOW = 1_700_000_000_000;

function comment(message: string, over: Partial<IncomingComment> = {}): IncomingComment {
  return {
    commentId: "c1",
    pageId: PAGE,
    authorId: "u1",
    message,
    createdAtMs: NOW,
    isFromPage: false,
    ...over,
  };
}

function rule(over: Partial<AutomationRule>): AutomationRule {
  return {
    id: "r1",
    pageId: PAGE,
    name: "กฎทดสอบ",
    trigger: { type: "profanity" },
    actions: [{ kind: "hide" }],
    priority: 10,
    isActive: true,
    ...over,
  };
}

describe("renderTemplate", () => {
  it("แทนตัวแปรภาษาไทย", () => {
    expect(
      renderTemplate("สวัสดีค่ะ {ชื่อลูกค้า} ยินดีต้อนรับสู่ {ชื่อร้าน}", {
        ชื่อลูกค้า: "คุณสมชาย",
        ชื่อร้าน: "ร้านกาแฟ",
      }),
    ).toBe("สวัสดีค่ะ คุณสมชาย ยินดีต้อนรับสู่ ร้านกาแฟ");
  });

  it("ตัวแปรที่ไม่มีค่าถูกตัดทิ้ง ไม่ทิ้งวงเล็บไว้ให้ลูกค้าเห็น", () => {
    expect(renderTemplate("สวัสดี{ชื่อลูกค้า}ค่ะ")).toBe("สวัสดีค่ะ");
  });

  it("ข้อความที่ไม่มีตัวแปรไม่เปลี่ยน", () => {
    expect(renderTemplate("สวัสดีค่ะ")).toBe("สวัสดีค่ะ");
  });
});

describe("evaluateRules — พื้นฐาน", () => {
  it("กฎที่ปิดอยู่ไม่ทำงาน", () => {
    const r = evaluateRules([rule({ isActive: false })], {
      comment: comment("เหี้ย"),
    });
    expect(r.actions).toEqual([]);
  });

  it("กฎของเพจอื่นไม่ทำงานกับเพจนี้", () => {
    const r = evaluateRules([rule({ pageId: "เพจอื่น" })], {
      comment: comment("เหี้ย"),
    });
    expect(r.actions).toEqual([]);
  });

  it("ไม่เข้าเงื่อนไข → ไม่มี action", () => {
    const r = evaluateRules([rule({})], { comment: comment("สวัสดีค่ะ") });
    expect(r.actions).toEqual([]);
  });

  it("เก็บ hit ไว้อธิบายให้ลูกค้าฟังได้ว่าทำไมถึงซ่อน", () => {
    const r = evaluateRules([rule({})], { comment: comment("เหี้ย") });
    expect(r.hits).toHaveLength(1);
    expect(r.actions[0]!.reason).toMatch(/[ก-๙]/);
    expect(r.actions[0]!.ruleId).toBe("r1");
  });
});

describe("evaluateRules — ลำดับความสำคัญ", () => {
  it("กฎ priority น้อยกว่าทำก่อน", () => {
    const rules = [
      rule({
        id: "late",
        priority: 90,
        trigger: { type: "buying_intent" },
        actions: [{ kind: "like" }],
      }),
      rule({
        id: "early",
        priority: 10,
        trigger: { type: "buying_intent" },
        actions: [{ kind: "flag" }],
      }),
    ];
    const r = evaluateRules(rules, { comment: comment("สนใจค่ะ") });
    expect(r.actions[0]!.ruleId).toBe("early");
  });

  it("ซ่อนแล้วห้ามตอบกลับหรือไลก์ (action ที่ขัดกัน)", () => {
    const rules = [
      rule({ id: "hide", priority: 10, actions: [{ kind: "hide" }] }),
      rule({
        id: "reply",
        priority: 20,
        trigger: { type: "profanity" },
        actions: [{ kind: "reply", message: "ขอบคุณค่ะ" }],
      }),
      rule({
        id: "like",
        priority: 30,
        trigger: { type: "profanity" },
        actions: [{ kind: "like" }],
      }),
    ];
    const r = evaluateRules(rules, { comment: comment("เหี้ย") });
    const kinds = r.actions.map((a) => a.kind);
    expect(kinds).toContain("hide");
    expect(kinds).not.toContain("reply");
    expect(kinds).not.toContain("like");
  });

  it("ไม่ทำ action ชนิดเดียวกันซ้ำ", () => {
    const rules = [
      rule({ id: "a", priority: 10 }),
      rule({ id: "b", priority: 20 }),
    ];
    const r = evaluateRules(rules, { comment: comment("เหี้ย") });
    expect(r.actions.filter((a) => a.kind === "hide")).toHaveLength(1);
  });
});

describe("evaluateRules — เกณฑ์ความมั่นใจ (กัน false positive)", () => {
  it("ความมั่นใจต่ำ → ปักธงแทนการซ่อน", () => {
    const r = evaluateRules(
      [rule({ trigger: { type: "phone" }, actions: [{ kind: "hide" }] })],
      // เลขยาวที่ไม่ตรงรูปแบบเบอร์ → confidence 0.6
      { comment: comment("เลขพัสดุ 123456789012") },
    );
    expect(r.actions.map((a) => a.kind)).toEqual(["flag"]);
    expect(r.actions[0]!.reason).toContain("ปักธง");
  });

  it("ลบต้องมั่นใจสูงกว่าซ่อน (ลบแล้วกู้ไม่ได้)", () => {
    expect(AUTO_DELETE_MIN_CONFIDENCE).toBeGreaterThan(
      AUTO_HIDE_MIN_CONFIDENCE,
    );
    // คำหยาบ confidence 0.9 → ซ่อนได้ แต่ลบไม่ได้
    const hide = evaluateRules(
      [rule({ actions: [{ kind: "hide" }] })],
      { comment: comment("เหี้ย") },
    );
    const del = evaluateRules([rule({ actions: [{ kind: "delete" }] })], {
      comment: comment("เหี้ย"),
    });
    expect(hide.actions[0]!.kind).toBe("hide");
    expect(del.actions[0]!.kind).toBe("flag");
  });

  it("action ที่ไม่ทำลายอะไร (alert/flag) ไม่ต้องผ่านเกณฑ์", () => {
    const r = evaluateRules(
      [rule({ trigger: { type: "phone" }, actions: [{ kind: "alert" }] })],
      { comment: comment("เลขพัสดุ 123456789012") },
    );
    expect(r.actions[0]!.kind).toBe("alert");
  });
});

describe("evaluateRules — trigger แต่ละแบบ", () => {
  it("keyword ที่ลูกค้าตั้งเอง", () => {
    const r = evaluateRules(
      [
        rule({
          trigger: { type: "keyword", words: ["ของแถม"] },
          actions: [{ kind: "reply", message: "ทักมาได้เลยค่ะ" }],
        }),
      ],
      { comment: comment("มีของแถมไหมคะ") },
    );
    expect(r.actions[0]!.kind).toBe("reply");
    expect(r.actions[0]!.message).toBe("ทักมาได้เลยค่ะ");
  });

  it("regex ที่ตั้งผิดต้องไม่ทำให้ทั้งระบบพัง", () => {
    const r = evaluateRules(
      [
        rule({
          trigger: { type: "regex", pattern: "([ไม่ปิดวงเล็บ" },
          actions: [{ kind: "hide" }],
        }),
      ],
      { comment: comment("อะไรก็ได้") },
    );
    expect(r.actions).toEqual([]);
  });

  it("regex ที่ถูกต้องทำงานได้", () => {
    const r = evaluateRules(
      [
        rule({
          trigger: { type: "regex", pattern: "ลด\\s*\\d+\\s*%" },
          actions: [{ kind: "hide" }],
        }),
      ],
      { comment: comment("ร้านนี้ลด 50% นะ") },
    );
    expect(r.actions[0]!.kind).toBe("hide");
  });

  it("sentiment trigger", () => {
    const neg = evaluateRules(
      [
        rule({
          trigger: { type: "negative_sentiment" },
          actions: [{ kind: "alert" }],
        }),
      ],
      { comment: comment("บริการแย่มาก ไม่ประทับใจ ขอคืนเงิน") },
    );
    expect(neg.actions[0]!.kind).toBe("alert");

    const pos = evaluateRules(
      [
        rule({
          trigger: { type: "positive_sentiment" },
          actions: [{ kind: "like" }],
        }),
      ],
      { comment: comment("ดีมากค่ะ ประทับใจ") },
    );
    expect(pos.actions[0]!.kind).toBe("like");
  });

  it("ข้อความตอบกลับรองรับตัวแปร", () => {
    const r = evaluateRules(
      [
        rule({
          trigger: { type: "buying_intent" },
          actions: [
            { kind: "private_reply", message: "สวัสดีค่ะ {ชื่อลูกค้า}" },
          ],
        }),
      ],
      { comment: comment("สนใจค่ะ"), vars: { ชื่อลูกค้า: "คุณเอ" } },
    );
    expect(r.actions[0]!.message).toBe("สวัสดีค่ะ คุณเอ");
  });
});

describe("defaultRules — ชุดที่เปิดให้ลูกค้าใหม่ทุกคน", () => {
  it("ครอบคลุมสิ่งที่สเปกข้อ M3 สั่งไว้", () => {
    const rules = defaultRules(PAGE);
    const triggers = rules.map((r) => r.trigger.type);
    expect(triggers).toContain("profanity");
    expect(triggers).toContain("phone");
    expect(triggers).toContain("external_link");
    expect(triggers).toContain("negative_sentiment");
    expect(triggers).toContain("buying_intent");
    expect(triggers).toContain("positive_sentiment");
  });

  it("ทุกกฎเปิดใช้งานและผูกกับเพจที่ระบุ", () => {
    for (const r of defaultRules("เพจ99")) {
      expect(r.isActive).toBe(true);
      expect(r.pageId).toBe("เพจ99");
      expect(r.name).toMatch(/[ก-๙]/);
    }
  });

  it("กฎซ่อนมาก่อนกฎทักเข้า inbox (ไม่งั้นสแปมจะได้รับข้อความต้อนรับ)", () => {
    const rules = defaultRules(PAGE);
    const hidePriority = Math.max(
      ...rules
        .filter((r) => r.actions.some((a) => a.kind === "hide"))
        .map((r) => r.priority),
    );
    const dmPriority = rules.find((r) =>
      r.actions.some((a) => a.kind === "private_reply"),
    )!.priority;
    expect(hidePriority).toBeLessThan(dmPriority);
  });

  it("ข้อความทักเข้า inbox มีตัวแปรให้ปรับต่อเพจ", () => {
    const dm = defaultRules(PAGE).find((r) =>
      r.actions.some((a) => a.kind === "private_reply"),
    )!;
    const msg = dm.actions[0]!.message!;
    expect(msg).toContain("{ชื่อร้าน}");
  });
});

describe("การซ่อนต้องชนะเสมอ ไม่ขึ้นกับลำดับที่ลูกค้าตั้ง", () => {
  it("ตั้ง priority ของไลก์ไว้ก่อนซ่อน คอมเมนต์หยาบก็ยังต้องถูกซ่อน", () => {
    // ลูกค้าตั้งค่าเองได้ ถ้าเรียงผิดแล้วคำหยาบไม่ถูกซ่อน = ระบบพังเงียบๆ
    const rules = [
      rule({
        id: "like-first",
        priority: 5,
        trigger: { type: "positive_sentiment" },
        actions: [{ kind: "like" }],
      }),
      rule({
        id: "hide-later",
        priority: 99,
        trigger: { type: "profanity" },
        actions: [{ kind: "hide" }],
      }),
    ];
    // ข้อความมีทั้งคำชมและคำหยาบ
    const r = evaluateRules(rules, {
      comment: comment("ของดีมากค่ะ ประทับใจ แต่ไอ้สัตว์คนนั้นนะ"),
    });
    const kinds = r.actions.map((a) => a.kind);
    expect(kinds).toContain("hide");
    expect(kinds).not.toContain("like");
  });

  it("ตั้ง reply ไว้ก่อน delete ก็ยังต้องลบ ไม่ตอบใต้คอมเมนต์ที่จะถูกลบ", () => {
    const rules = [
      rule({
        id: "reply-first",
        priority: 1,
        trigger: { type: "buying_intent" },
        actions: [{ kind: "reply", message: "ทักแชทได้เลยค่ะ" }],
      }),
      rule({
        id: "hide-later",
        priority: 100,
        trigger: { type: "phone" },
        actions: [{ kind: "hide" }],
      }),
    ];
    const r = evaluateRules(rules, {
      comment: comment("สนใจไหม โทร 0812345678"),
    });
    const kinds = r.actions.map((a) => a.kind);
    expect(kinds).toContain("hide");
    expect(kinds).not.toContain("reply");
  });
});
