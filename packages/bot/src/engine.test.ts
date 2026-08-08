import { describe, expect, it } from "vitest";
import { nullLogger } from "@page-os/core";
import { BotEngine, isContained, type KeywordRule, type LlmClient } from "./engine.js";
import { defaultConfig } from "./tone.js";
import type { BotContext, KnowledgeChunk, PageBotConfig } from "./types.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const PAGE = "p1";

const CONFIG: PageBotConfig = defaultConfig(PAGE, "ร้านกาแฟดีดี");

const RULES: KeywordRule[] = [
  {
    id: "hours",
    pageId: PAGE,
    keywords: ["เปิดกี่โมง", "เวลาเปิด", "เปิดปิด"],
    reply: "{ชื่อร้าน}เปิดทุกวัน 08:00-20:00 {ค่ะ}",
    priority: 10,
    isActive: true,
  },
  {
    id: "delivery",
    pageId: PAGE,
    keywords: ["ค่าส่ง", "จัดส่ง"],
    reply: "ค่าส่ง 50 บาททั่วประเทศ{ค่ะ}",
    quickReplies: [{ title: "ดูสินค้า", payload: "SHOW_PRODUCTS" }],
    priority: 20,
    isActive: true,
  },
];

const CHUNKS: KnowledgeChunk[] = [
  {
    id: "k1",
    pageId: PAGE,
    title: "นโยบายคืนสินค้า",
    text: "รับคืนสินค้าภายใน 7 วันหลังได้รับของ สินค้าต้องอยู่ในสภาพเดิม ไม่ผ่านการใช้งาน",
  },
  {
    id: "k2",
    pageId: PAGE,
    title: "วิธีชำระเงิน",
    text: "รับชำระผ่านโอนธนาคาร พร้อมเพย์ และเก็บเงินปลายทาง",
  },
  {
    id: "k3",
    pageId: "เพจอื่น",
    title: "ข้อมูลเพจอื่น",
    text: "ข้อมูลนี้เป็นของเพจอื่น ไม่ควรถูกใช้ตอบลูกค้าเพจ p1",
  },
];

function ctx(message: string, over: Partial<BotContext> = {}): BotContext {
  return {
    pageId: PAGE,
    conversationId: "c1",
    message,
    disclosureSent: true,
    nowMs: NOW,
    ...over,
  };
}

function fakeLlm(
  text: string,
  confidence?: number,
): LlmClient & { calls: number; lastContext?: string } {
  const impl = {
    calls: 0,
    lastContext: undefined as string | undefined,
    async complete(a: { context: string }) {
      impl.calls++;
      impl.lastContext = a.context;
      return confidence === undefined ? { text } : { text, confidence };
    },
  };
  return impl;
}

function engine(over: Partial<Parameters<typeof makeEngine>[0]> = {}) {
  return makeEngine({ config: CONFIG, rules: RULES, chunks: CHUNKS, ...over });
}

function makeEngine(opts: {
  config: PageBotConfig;
  rules: readonly KeywordRule[];
  chunks: readonly KnowledgeChunk[];
  llm?: LlmClient;
}) {
  return new BotEngine({ ...opts, logger: nullLogger });
}

describe("ชั้นที่ 1 — keyword rules (เร็ว ฟรี แม่นยำ 100%)", () => {
  it("แมตช์คีย์เวิร์ดแล้วตอบทันที ไม่เรียก LLM", async () => {
    const llm = fakeLlm("ไม่ควรถูกเรียก");
    const r = await engine({ llm }).answer(ctx("ร้านเปิดกี่โมงคะ"), NOW);

    expect(r.reply!.layer).toBe("rule");
    expect(r.reply!.text).toContain("08:00-20:00");
    expect(r.reply!.confidence).toBe(1);
    expect(llm.calls).toBe(0);
  });

  it("ใส่โทนของเพจให้อัตโนมัติ", async () => {
    const r = await engine().answer(ctx("ค่าส่งเท่าไหร่"), NOW);
    expect(r.reply!.text).toContain("ค่ะ");
    expect(r.reply!.text).not.toContain("{");
  });

  it("แนบ quick replies ถ้ากฎกำหนดไว้", async () => {
    const r = await engine().answer(ctx("ค่าส่งเท่าไหร่"), NOW);
    expect(r.reply!.quickReplies).toEqual([
      { title: "ดูสินค้า", payload: "SHOW_PRODUCTS" },
    ]);
  });

  it("กฎ priority น้อยกว่าทำก่อน", async () => {
    const rules: KeywordRule[] = [
      { ...RULES[0]!, id: "late", priority: 99, reply: "ตอบทีหลัง" },
      { ...RULES[0]!, id: "early", priority: 1, reply: "ตอบก่อน" },
    ];
    const r = await engine({ rules }).answer(ctx("เปิดกี่โมง"), NOW);
    expect(r.reply!.sources).toEqual(["rule:early"]);
  });

  it("กฎที่ปิดอยู่หรือของเพจอื่นไม่ทำงาน", async () => {
    const llm = fakeLlm("จากเอกสาร");
    const rules: KeywordRule[] = [
      { ...RULES[0]!, id: "off", isActive: false },
      { ...RULES[0]!, id: "other", pageId: "เพจอื่น" },
    ];
    const r = await engine({ rules, llm }).answer(ctx("เปิดกี่โมง"), NOW);
    expect(r.reply!.layer).not.toBe("rule");
  });

  it("รองรับ regex และ regex ที่ผิดไม่ทำให้บอทพัง", async () => {
    const ok = await engine({
      rules: [
        {
          id: "re",
          pageId: PAGE,
          pattern: "ลด\\s*\\d+\\s*%",
          reply: "โปรลดราคายังมีอยู่{ค่ะ}",
          priority: 5,
          isActive: true,
        },
      ],
    }).answer(ctx("มีลด 50% ไหมคะ"), NOW);
    expect(ok.reply!.layer).toBe("rule");

    const bad = await engine({
      rules: [
        {
          id: "broken",
          pageId: PAGE,
          pattern: "([ไม่ปิด",
          reply: "x",
          priority: 5,
          isActive: true,
        },
      ],
    }).answer(ctx("อะไรก็ได้"), NOW);
    expect(bad.reply!.layer).toBe("escalated");
  });
});

describe("ชั้นที่ 2 — RAG + LLM", () => {
  it("ค้นข้อมูลของเพจแล้วให้ LLM เรียบเรียง", async () => {
    const llm = fakeLlm("รับคืนภายใน 7 วันค่ะ", 0.9);
    const r = await engine({ llm }).answer(ctx("คืนสินค้าได้ไหมคะ"), NOW);

    expect(r.reply!.layer).toBe("rag");
    expect(r.reply!.text).toContain("7 วัน");
    expect(llm.calls).toBe(1);
    expect(llm.lastContext).toContain("นโยบายคืนสินค้า");
  });

  it("ไม่ส่งข้อมูลของเพจอื่นให้ LLM เด็ดขาด", async () => {
    const llm = fakeLlm("ตอบ", 0.9);
    await engine({ llm }).answer(ctx("ขอข้อมูลหน่อย เรื่องคืนสินค้า"), NOW);
    expect(llm.lastContext ?? "").not.toContain("ข้อมูลนี้เป็นของเพจอื่น");
  });

  it("ไม่มีข้อมูลใน Knowledge Base → ไม่เรียก LLM (กันเปลืองและกันแต่งเรื่อง)", async () => {
    const llm = fakeLlm("ไม่ควรถูกเรียก");
    const r = await engine({ llm, chunks: [] }).answer(
      ctx("อยากรู้เรื่องที่ไม่มีในเอกสาร"),
      NOW,
    );
    expect(llm.calls).toBe(0);
    expect(r.reply!.layer).toBe("escalated");
  });

  it("LLM มั่นใจต่ำกว่าเกณฑ์ของเพจ → ส่งต่อให้คน", async () => {
    const llm = fakeLlm("น่าจะประมาณนี้", 0.2);
    const r = await engine({ llm }).answer(ctx("คืนสินค้าได้ไหม"), NOW);
    expect(r.reply!.layer).toBe("escalated");
    expect(r.reply!.escalate).toBe(true);
  });

  it("LLM พัง → ส่งต่อให้คน ไม่ทำให้ทั้งระบบล้ม", async () => {
    const llm: LlmClient = {
      async complete() {
        throw new Error("LLM timeout");
      },
    };
    const r = await engine({ llm }).answer(ctx("คืนสินค้าได้ไหม"), NOW);
    expect(r.reply!.layer).toBe("escalated");
  });

  it("ไม่มี LLM เลย → ตกไปชั้น 3 ทันที", async () => {
    const r = await engine().answer(ctx("คืนสินค้าได้ไหม"), NOW);
    expect(r.reply!.layer).toBe("escalated");
  });

  it("บันทึกแหล่งอ้างอิงไว้ให้แอดมินตรวจ", async () => {
    const llm = fakeLlm("ตอบ", 0.9);
    const r = await engine({ llm }).answer(ctx("คืนสินค้าได้ไหม"), NOW);
    expect(r.reply!.sources).toContain("k1");
  });
});

describe("ชั้นที่ 3 — ส่งต่อให้คน", () => {
  it("ลูกค้าขอคุยกับแอดมิน → ข้ามทุกชั้นทันที", async () => {
    const llm = fakeLlm("ไม่ควรถูกเรียก");
    for (const msg of [
      "ขอคุยกับแอดมินหน่อยค่ะ",
      "แอดมินอยู่ไหมคะ",
      "ไม่อยากคุยกับบอท",
    ]) {
      const r = await engine({ llm }).answer(ctx(msg), NOW);
      expect(r.reply!.layer, msg).toBe("escalated");
    }
    expect(llm.calls).toBe(0);
  });

  it("ตอบข้อความรอตามที่สเปกเขียนไว้", async () => {
    const r = await engine().answer(ctx("อะไรที่ไม่รู้"), NOW);
    expect(r.reply!.text).toContain("รอสักครู่");
  });

  it("บอกเหตุผลว่าทำไมถึงส่งต่อ", async () => {
    const r = await engine().answer(ctx("ขอคุยกับแอดมิน"), NOW);
    expect(r.reply!.th).toMatch(/[ก-๙]/);
  });
});

describe("กฎข้อ 7 — บอทห้ามส่งนอกหน้าต่าง 24 ชม.", () => {
  it("เกิน 24 ชม. → ไม่ตอบเลย และบอกว่าต้องให้คนตอบ", async () => {
    const r = await engine().answer(ctx("เปิดกี่โมง"), NOW - 25 * HOUR);
    expect(r.reply).toBeNull();
    expect(r.blocked).toContain("คนพิมพ์");
  });

  it("ลูกค้ายังไม่เคยทัก → บอททักไปก่อนไม่ได้", async () => {
    const r = await engine().answer(ctx("เปิดกี่โมง"), null);
    expect(r.reply).toBeNull();
  });

  it("ในหน้าต่าง 24 ชม. ตอบได้ปกติ", async () => {
    const r = await engine().answer(ctx("เปิดกี่โมง"), NOW - 2 * HOUR);
    expect(r.reply).not.toBeNull();
  });
});

describe("ประกาศว่าเป็นบอท (Meta policy)", () => {
  it("ข้อความแรกต้องมีการประกาศ", async () => {
    const r = await engine().answer(
      ctx("เปิดกี่โมง", { disclosureSent: false }),
      NOW,
    );
    expect(r.disclosure).toBeTruthy();
    expect(r.disclosure).toContain("อัตโนมัติ");
  });

  it("ประกาศไปแล้วไม่ประกาศซ้ำ", async () => {
    const r = await engine().answer(
      ctx("เปิดกี่โมง", { disclosureSent: true }),
      NOW,
    );
    expect(r.disclosure).toBeUndefined();
  });

  it("บอกวิธีขอคุยกับคนไว้ในข้อความประกาศ", async () => {
    const r = await engine().answer(
      ctx("เปิดกี่โมง", { disclosureSent: false }),
      NOW,
    );
    expect(r.disclosure).toContain("แอดมิน");
  });
});

describe("คำต้องห้ามของเพจ — ด่านสุดท้ายก่อนส่ง", () => {
  const strict = defaultConfig(PAGE, "คลินิกความงาม", {
    tone: { ...CONFIG.tone, bannedWords: ["รักษาหายขาด", "ปลอดภัย 100%"] },
  });

  it("คำตอบจาก LLM ที่มีคำต้องห้าม ไม่ถูกส่ง", async () => {
    const llm = fakeLlm("ทรีตเมนต์นี้รักษาหายขาดแน่นอนค่ะ", 0.95);
    const r = await makeEngine({
      config: strict,
      rules: [],
      chunks: CHUNKS.map((c) => ({ ...c, pageId: PAGE })),
      llm,
    }).answer(ctx("รักษาได้ไหมคะ"), NOW);

    expect(r.reply!.layer).toBe("escalated");
    expect(r.reply!.text).not.toContain("รักษาหายขาด");
  });

  it("ตรวจแม้คำตอบจะมาจากกฎที่คนเขียนเอง (คนก็เผลอได้)", async () => {
    const r = await makeEngine({
      config: strict,
      rules: [
        {
          id: "bad",
          pageId: PAGE,
          keywords: ["ทรีตเมนต์"],
          reply: "ทรีตเมนต์นี้ปลอดภัย 100% {ค่ะ}",
          priority: 1,
          isActive: true,
        },
      ],
      chunks: [],
    }).answer(ctx("อยากรู้เรื่องทรีตเมนต์"), NOW);

    expect(r.reply!.layer).toBe("escalated");
  });

  it("คำตอบปกติผ่านได้", async () => {
    const r = await makeEngine({
      config: strict,
      rules: [
        {
          id: "ok",
          pageId: PAGE,
          keywords: ["เปิดกี่โมง"],
          reply: "เปิด 10:00-19:00 {ค่ะ}",
          priority: 1,
          isActive: true,
        },
      ],
      chunks: [],
    }).answer(ctx("เปิดกี่โมง"), NOW);
    expect(r.reply!.layer).toBe("rule");
  });
});

describe("isContained — ใช้คำนวณ containment rate (M7)", () => {
  it("ชั้น 1 และ 2 ถือว่าบอทจบเอง ชั้น 3 ไม่ใช่", () => {
    expect(isContained("rule")).toBe(true);
    expect(isContained("rag")).toBe(true);
    expect(isContained("flow")).toBe(true);
    expect(isContained("escalated")).toBe(false);
  });
});
