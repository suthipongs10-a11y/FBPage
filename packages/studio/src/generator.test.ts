import { describe, expect, it } from "vitest";
import type { BrandBrief } from "./brand.js";
import {
  FEED_TRUNCATE_CHARS,
  MAX_CAPTION_CHARS,
  checkPost,
  feedPreview,
  generateBatch,
  type ContentLlm,
} from "./generator.js";
import { DEFAULT_PILLARS, buildPillarPlan } from "./pillars.js";

const BRIEF: BrandBrief = {
  pageId: "p1",
  brandName: "ครัวคุณยาย",
  business: "ร้านอาหารตามสั่งและข้าวกล่องส่งออฟฟิศ",
  audience: "พนักงานออฟฟิศวัย 25-40 ย่านรัชดา ที่ไม่มีเวลาทำกับข้าว",
  products: ["ข้าวกล่องรายวัน"],
  ctas: ["ทักแชทสั่งเลย"],
  bannedWords: ["รักษาโรค"],
  avoidTopics: ["การเมือง"],
};

/** LLM ปลอมที่คืนของตามที่สั่ง — ไม่ต้องต่อเน็ตและผลลัพธ์เดิมทุกครั้ง */
class FakeLlm implements ContentLlm {
  calls: Array<{ brief: string; topic: string; slots: unknown[] }> = [];
  constructor(
    private readonly reply: (
      slots: Array<{ pillar: string; guidance: string }>,
    ) => Array<{ idea: string; body: string; hashtags?: string[] }>,
  ) {}

  async generatePosts(args: {
    brief: string;
    topic: string;
    slots: Array<{ pillar: string; guidance: string }>;
  }): Promise<Array<{ idea: string; body: string; hashtags?: string[] }>> {
    this.calls.push(args);
    return this.reply(args.slots);
  }
}

const plan4 = buildPillarPlan(DEFAULT_PILLARS, 4);

describe("generateBatch", () => {
  it("ได้โพสต์ครบตามแผน พร้อมแคปชั่นที่ประกอบแล้ว", async () => {
    const llm = new FakeLlm((slots) =>
      slots.map((s, i) => ({
        idea: `แนวคิด ${i}`,
        body: `เนื้อโพสต์ ${s.pillar} ${i} ทักแชทสั่งเลย`,
        hashtags: ["ข้าวกล่อง"],
      })),
    );
    const r = await generateBatch({
      brief: BRIEF,
      topic: "ข้าวกล่องสัปดาห์นี้",
      plan: plan4,
      llm,
    });

    expect(r.posts).toHaveLength(4);
    expect(r.posts[0]!.caption).toContain("#ข้าวกล่อง");
    expect(r.posts[0]!.pillar).toBe(plan4[0]!.pillar);
    expect(r.th).toMatch(/ได้ 4 โพสต์/);
  });

  it("ส่ง brief และคำแนะนำของแต่ละเสาให้ LLM", async () => {
    const llm = new FakeLlm((slots) =>
      slots.map(() => ({ idea: "x", body: "เนื้อ ทักแชทสั่งเลย" })),
    );
    await generateBatch({
      brief: BRIEF,
      topic: "หัวข้อ",
      plan: plan4,
      llm,
    });

    const call = llm.calls[0]!;
    expect(call.brief).toContain("ครัวคุณยาย");
    expect(call.brief).toContain("ห้ามใช้คำเหล่านี้เด็ดขาด");
    expect(call.slots).toHaveLength(4);
  });

  it("แท็กที่ AI ใส่ปนในเนื้อโพสต์ ถูกแยกออกมาเก็บแยก", async () => {
    const llm = new FakeLlm(() => [
      { idea: "x", body: "ข้าวกล่องวันนี้ ทักแชทสั่งเลย #ข้าวกล่อง #ส่งฟรี" },
    ]);
    const r = await generateBatch({
      brief: BRIEF,
      topic: "t",
      plan: buildPillarPlan(DEFAULT_PILLARS, 1),
      llm,
    });

    expect(r.posts[0]!.body).not.toContain("#");
    expect(r.posts[0]!.hashtags).toEqual(["#ข้าวกล่อง", "#ส่งฟรี"]);
  });

  it("แท็กแบรนด์ถูกใส่ให้ทุกโพสต์และมาก่อน", async () => {
    const llm = new FakeLlm((slots) =>
      slots.map(() => ({ idea: "x", body: "เนื้อ ทักแชทสั่งเลย", hashtags: ["อร่อย"] })),
    );
    const r = await generateBatch({
      brief: BRIEF,
      topic: "t",
      plan: plan4,
      llm,
      brandTags: ["ครัวคุณยาย"],
    });

    for (const p of r.posts) expect(p.hashtags[0]).toBe("#ครัวคุณยาย");
  });

  it("ตัดโพสต์ที่ซ้ำกันเองในชุดเดียว — LLM ชอบเขียนซ้ำเมื่อขอเยอะ", async () => {
    const llm = new FakeLlm((slots) =>
      slots.map(() => ({ idea: "x", body: "ข้อความเดียวกันเป๊ะ ทักแชทสั่งเลย" })),
    );
    const r = await generateBatch({
      brief: BRIEF,
      topic: "t",
      plan: plan4,
      llm,
    });

    expect(r.posts).toHaveLength(1);
    expect(r.droppedDuplicates).toBe(3);
    expect(r.th).toMatch(/ตัดที่ซ้ำกันเองออก 3 โพสต์/);
  });

  it("LLM คืนมาไม่ครบ → ข้ามช่องนั้น ไม่ล้มทั้งชุด", async () => {
    const llm = new FakeLlm(() => [
      { idea: "x", body: "โพสต์แรก ทักแชทสั่งเลย" },
    ]);
    const r = await generateBatch({
      brief: BRIEF,
      topic: "t",
      plan: plan4,
      llm,
    });
    expect(r.posts).toHaveLength(1);
  });

  it("LLM คืนโพสต์ว่าง → ข้ามไป ไม่ปล่อยโพสต์เปล่าเข้าปฏิทิน", async () => {
    const llm = new FakeLlm((slots) =>
      slots.map((_, i) => ({ idea: "x", body: i === 0 ? "   " : `โพสต์ ${i} ทักแชทสั่งเลย` })),
    );
    const r = await generateBatch({
      brief: BRIEF,
      topic: "t",
      plan: plan4,
      llm,
    });
    expect(r.posts).toHaveLength(3);
    expect(r.posts.every((p) => p.body.trim() !== "")).toBe(true);
  });

  it("แผนว่าง → ไม่เรียก LLM เลย", async () => {
    const llm = new FakeLlm(() => []);
    const r = await generateBatch({ brief: BRIEF, topic: "t", plan: [], llm });
    expect(r.posts).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it("โพสต์ที่มีคำต้องห้ามยังส่งออกมา แต่ติดคำเตือนไว้ให้คนเห็นก่อนอนุมัติ", async () => {
    const llm = new FakeLlm(() => [
      { idea: "x", body: "กินแล้วรักษาโรคได้ ทักแชทสั่งเลย" },
    ]);
    const r = await generateBatch({
      brief: BRIEF,
      topic: "t",
      plan: buildPillarPlan(DEFAULT_PILLARS, 1),
      llm,
    });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.warnings.some((w) => /รักษาโรค/.test(w))).toBe(true);
  });

  it("ไม่มี idea → ใช้ต้นโพสต์แทน จะได้มีอะไรแสดงในปฏิทิน", async () => {
    const llm = new FakeLlm(() => [
      { idea: "  ", body: "ข้าวกล่องพรุ่งนี้เปิดจองแล้วนะคะ ทักแชทสั่งเลย" },
    ]);
    const r = await generateBatch({
      brief: BRIEF,
      topic: "t",
      plan: buildPillarPlan(DEFAULT_PILLARS, 1),
      llm,
    });
    expect(r.posts[0]!.idea).not.toBe("");
    expect(r.posts[0]!.idea.startsWith("ข้าวกล่อง")).toBe(true);
  });
});

describe("checkPost", () => {
  it("คำต้องห้ามของแบรนด์ → เตือนพร้อมบอกว่าต้องแก้", () => {
    const w = checkPost("สูตรนี้รักษาโรคได้ ทักแชทสั่งเลย", BRIEF);
    expect(w.some((x) => /ต้องแก้ก่อนโพสต์/.test(x))).toBe(true);
  });

  it("หัวข้อที่ขอให้เลี่ยง → เตือน", () => {
    const w = checkPost("วันนี้คุยเรื่องการเมืองกันหน่อย ทักแชทสั่งเลย", BRIEF);
    expect(w.some((x) => /เลี่ยง/.test(x))).toBe(true);
  });

  it("ยาวเกินที่ feed แสดง → เตือนให้ย้ายประเด็นสำคัญมาต้นโพสต์", () => {
    const w = checkPost(`${"ก".repeat(FEED_TRUNCATE_CHARS + 10)} ทักแชทสั่งเลย`, BRIEF);
    expect(w.some((x) => /ดูเพิ่มเติม/.test(x))).toBe(true);
  });

  it("ยาวเกินเพดานโพสต์ → เตือนแยกอีกข้อ", () => {
    const w = checkPost(`${"ก".repeat(MAX_CAPTION_CHARS + 10)} ทักแชทสั่งเลย`, BRIEF);
    expect(w.some((x) => /เกิน 2000/.test(x))).toBe(true);
  });

  it("ไม่มี CTA → เตือนว่าเสียโอกาส", () => {
    const w = checkPost("วันนี้อากาศดีนะคะ", BRIEF);
    expect(w.some((x) => /CTA/.test(x))).toBe(true);
  });

  it("โพสต์ที่ดี → ไม่มีคำเตือนเลย", () => {
    expect(checkPost("ข้าวกล่องพรุ่งนี้เปิดจองแล้ว ทักแชทสั่งเลย", BRIEF)).toEqual([]);
  });

  it("โพสต์ว่าง → เตือน", () => {
    expect(checkPost("   ", BRIEF).some((x) => /โพสต์ว่าง/.test(x))).toBe(true);
  });

  it("จับคำต้องห้ามแม้เว้นวรรคแปลกๆ (normalize ก่อนเทียบ)", () => {
    const w = checkPost("กิน   แล้ว รักษาโรค  ได้ ทักแชทสั่งเลย", BRIEF);
    expect(w.some((x) => /รักษาโรค/.test(x))).toBe(true);
  });
});

describe("feedPreview", () => {
  it("สั้นกว่าเกณฑ์ → แสดงเต็ม ไม่ตัด", () => {
    const r = feedPreview("สวัสดีค่ะ");
    expect(r.truncated).toBe(false);
    expect(r.visible).toBe("สวัสดีค่ะ");
  });

  it("ยาวเกิน → ตัดพร้อมจุดไข่ปลา และบอกว่าถูกตัด", () => {
    const r = feedPreview("ก".repeat(400));
    expect(r.truncated).toBe(true);
    expect(r.visible.endsWith("…")).toBe(true);
    expect(r.visible.length).toBe(FEED_TRUNCATE_CHARS + 1);
  });
});
