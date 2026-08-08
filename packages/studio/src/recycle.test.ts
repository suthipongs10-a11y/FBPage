import { describe, expect, it } from "vitest";
import { contentHash, hashableFromPost } from "@page-os/publish";
import type { BrandBrief } from "./brand.js";
import {
  DUPLICATE_WINDOW_DAYS,
  MIN_DIFFERENCE_RATIO,
  RECYCLE_AFTER_DAYS,
  differenceRatio,
  findRecycleCandidates,
  rewriteForRecycle,
  safeRepostDate,
  type PastPost,
  type RewriteLlm,
} from "./recycle.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);

const BRIEF: BrandBrief = {
  pageId: "p1",
  brandName: "ครัวคุณยาย",
  business: "ร้านอาหารตามสั่ง",
  audience: "พนักงานออฟฟิศย่านรัชดา",
  products: ["ข้าวกล่อง"],
  ctas: ["ทักแชทสั่งเลย"],
  bannedWords: [],
};

function post(over: Partial<PastPost> = {}): PastPost {
  return {
    postId: "post1",
    pageId: "p1",
    body: "วันนี้มีข้าวกล่องแกงส้มชะอมกุ้งค่ะ สั่งก่อนสิบโมงรับได้เที่ยงเลย",
    publishedAtMs: NOW - 70 * DAY,
    engagement: 100,
    ...over,
  };
}

describe("findRecycleCandidates", () => {
  it("เอาเฉพาะโพสต์ที่เก่ากว่า 60 วัน", () => {
    const posts = [
      post({ postId: "old", publishedAtMs: NOW - 70 * DAY }),
      post({ postId: "new", publishedAtMs: NOW - 10 * DAY }),
    ];
    const r = findRecycleCandidates({ posts, nowMs: NOW });
    expect(r.map((x) => x.postId)).toEqual(["old"]);
  });

  it("จัดอันดับด้วย engagement ต่อ reach ไม่ใช่ engagement ดิบ", () => {
    // โพสต์ที่ยิงแอดได้ engagement เยอะแต่คุณภาพคอนเทนต์แย่กว่า
    const posts = [
      post({ postId: "ads", engagement: 1000, reach: 100_000 }),
      post({ postId: "organic", engagement: 200, reach: 2_000 }),
    ];
    const r = findRecycleCandidates({ posts, nowMs: NOW });
    expect(r[0]!.postId).toBe("organic");
  });

  it("ไม่มี reach → ใช้ engagement ดิบแทน", () => {
    const posts = [
      post({ postId: "a", engagement: 50 }),
      post({ postId: "b", engagement: 500 }),
    ];
    expect(findRecycleCandidates({ posts, nowMs: NOW })[0]!.postId).toBe("b");
  });

  it("โพสต์ที่ recycle ไปแล้วหลายรอบ ถูกตัดออก — คนตามเพจจะจำได้", () => {
    const posts = [
      post({ postId: "used", recycleCount: 2 }),
      post({ postId: "fresh", recycleCount: 0, engagement: 10 }),
    ];
    const r = findRecycleCandidates({ posts, nowMs: NOW });
    expect(r.map((x) => x.postId)).toEqual(["fresh"]);
  });

  it("ปรับเพดานจำนวนครั้งได้", () => {
    const posts = [post({ postId: "used", recycleCount: 2 })];
    expect(
      findRecycleCandidates({ posts, nowMs: NOW, maxRecycleCount: 3 }),
    ).toHaveLength(1);
  });

  it("โพสต์ที่ไม่มีคนสนใจเลย ไม่เอามาใช้ซ้ำ", () => {
    const posts = [post({ engagement: 0 })];
    expect(findRecycleCandidates({ posts, nowMs: NOW })).toEqual([]);
  });

  it("จำกัดจำนวนตามที่ขอ", () => {
    const posts = Array.from({ length: 10 }, (_, i) =>
      post({ postId: `p${i}`, engagement: i + 1 }),
    );
    expect(findRecycleCandidates({ posts, nowMs: NOW, limit: 3 })).toHaveLength(3);
  });

  it("คำอธิบายภาษาไทยบอกว่านานแค่ไหนแล้วและได้เท่าไหร่", () => {
    const r = findRecycleCandidates({
      posts: [post({ publishedAtMs: NOW - 65 * DAY, engagement: 1234 })],
      nowMs: NOW,
    });
    expect(r[0]!.th).toMatch(/65 วันก่อน/);
    expect(r[0]!.daysAgo).toBe(65);
  });
});

describe("differenceRatio", () => {
  it("ข้อความเดียวกัน = 0", () => {
    expect(differenceRatio("สวัสดีครับ", "สวัสดีครับ")).toBe(0);
  });

  it("ต่างกันสิ้นเชิง = ใกล้ 1", () => {
    expect(
      differenceRatio(
        "วันนี้มีข้าวกล่องแกงส้มนะคะ",
        "ทีมงานเราตื่นตีสี่ทุกวันเพื่อไปเลือกของสด",
      ),
    ).toBeGreaterThan(0.9);
  });

  it("สลับคำนิดหน่อยยังถือว่าเหมือนเดิม", () => {
    const a = "วันนี้มีข้าวกล่องแกงส้มชะอมกุ้งค่ะ สั่งก่อนสิบโมงรับได้เที่ยงเลย";
    const b = "วันนี้มีข้าวกล่องแกงส้มชะอมกุ้งนะคะ สั่งก่อนสิบโมงรับได้เที่ยงเลย";
    expect(differenceRatio(a, b)).toBeLessThan(MIN_DIFFERENCE_RATIO);
  });

  it("ข้อความว่างทั้งคู่ = 0, ว่างข้างเดียว = 1", () => {
    expect(differenceRatio("", "")).toBe(0);
    expect(differenceRatio("", "มีเนื้อหา")).toBe(1);
  });

  it("ต่างแค่ช่องว่างกับตัวพิมพ์ ไม่นับว่าต่าง", () => {
    expect(differenceRatio("Hello  World", "hello world")).toBe(0);
  });
});

/** LLM ปลอมที่คืนข้อความตามลำดับที่กำหนด */
class ScriptedLlm implements RewriteLlm {
  instructions: string[] = [];
  private i = 0;
  constructor(private readonly bodies: string[]) {}
  async rewrite(args: {
    brief: string;
    original: string;
    instruction: string;
  }): Promise<{ body: string; hashtags?: string[] }> {
    this.instructions.push(args.instruction);
    const body = this.bodies[Math.min(this.i, this.bodies.length - 1)] ?? "";
    this.i++;
    return { body };
  }
}

describe("rewriteForRecycle", () => {
  const DIFFERENT =
    "ทีมงานเราตื่นตีสี่ไปเลือกกุ้งสดที่ตลาดทุกเช้า กว่าจะได้แกงส้มหนึ่งหม้อผ่านมือคนห้าคน";

  it("เขียนใหม่ต่างพอ → ผ่าน พร้อม hash ใหม่ที่ไม่ชนของเดิม", async () => {
    const p = post();
    const r = await rewriteForRecycle({
      post: p,
      brief: BRIEF,
      llm: new ScriptedLlm([DIFFERENT]),
    });

    expect(r.ok).toBe(true);
    expect(r.body).toBe(DIFFERENT);
    expect(r.differenceRatio).toBeGreaterThanOrEqual(MIN_DIFFERENCE_RATIO);
    expect(r.contentHash).not.toBe(
      contentHash(hashableFromPost({ type: "text", body: p.body })),
    );
    expect(r.th).toMatch(/ผ่าน Duplicate Guard/);
  });

  it("เขียนกลับมาเหมือนเดิมเป๊ะ → ลองใหม่ แล้วผ่านในรอบถัดไป", async () => {
    const p = post();
    const llm = new ScriptedLlm([p.body, DIFFERENT]);
    const r = await rewriteForRecycle({ post: p, brief: BRIEF, llm });

    expect(r.ok).toBe(true);
    expect(llm.instructions).toHaveLength(2);
    // รอบสองต้องบอกโมเดลว่าครั้งก่อนเหมือนเกินไป ไม่ใช่สั่งเหมือนเดิม
    expect(llm.instructions[1]).toMatch(/ครั้งก่อนยังเหมือนของเดิม/);
  });

  it("ลองครบ 3 ครั้งแล้วยังเหมือนเดิม → ไม่ผ่าน และบอกว่าจะโดนบล็อก", async () => {
    const p = post();
    const llm = new ScriptedLlm([p.body]);
    const r = await rewriteForRecycle({ post: p, brief: BRIEF, llm });

    expect(r.ok).toBe(false);
    expect(llm.instructions).toHaveLength(3);
    expect(r.th).toMatch(/Duplicate Guard จะบล็อก/);
    expect(r.th).toMatch(/40%/);
  });

  it("hash ต่างแต่เนื้อหาเหมือนเดิม → ยังไม่ผ่าน (คนอ่านรู้ว่าซ้ำ)", async () => {
    // เปลี่ยนแค่คำท้ายประโยค hash ต่างแน่นอน แต่คนอ่านรู้ทันทีว่าเคยเห็นแล้ว
    const p = post();
    const barelyDifferent = `${p.body} นะคะ`;
    const r = await rewriteForRecycle({
      post: p,
      brief: BRIEF,
      llm: new ScriptedLlm([barelyDifferent]),
    });

    expect(r.ok).toBe(false);
    expect(r.differenceRatio).toBeLessThan(MIN_DIFFERENCE_RATIO);
  });

  it("คืนตัวที่ดีที่สุดมาให้แก้ต่อ แม้จะไม่ผ่านเกณฑ์", async () => {
    const p = post();
    const r = await rewriteForRecycle({
      post: p,
      brief: BRIEF,
      llm: new ScriptedLlm([`${p.body} นะคะ`]),
    });
    expect(r.ok).toBe(false);
    expect(r.body).toBeDefined();
  });

  it("LLM พัง → ไม่โยน error แต่คืนผลที่บอกให้ลองใหม่ภายหลัง", async () => {
    const llm: RewriteLlm = {
      async rewrite() {
        throw new Error("upstream 500");
      },
    };
    const r = await rewriteForRecycle({ post: post(), brief: BRIEF, llm });
    expect(r.ok).toBe(false);
    expect(r.th).toMatch(/ลองอีกครั้งภายหลัง/);
  });

  it("โพสต์ที่มีรูป → hash คิดรวมรูปด้วย เหมือนที่ Duplicate Guard ทำ", async () => {
    const p = post({ media: [{ url: "https://cdn.example/a.jpg" }], type: "photo" });
    const r = await rewriteForRecycle({
      post: p,
      brief: BRIEF,
      llm: new ScriptedLlm([DIFFERENT]),
    });
    expect(r.ok).toBe(true);
    expect(r.contentHash).toBe(
      contentHash(
        hashableFromPost({ type: "photo", body: DIFFERENT, media: p.media }),
      ),
    );
  });

  it("ส่ง brief ให้ LLM เพื่อให้เขียนใหม่ยังอยู่ในโทนแบรนด์", async () => {
    const llm = new ScriptedLlm([DIFFERENT]);
    await rewriteForRecycle({ post: post(), brief: BRIEF, llm });
    expect(llm.instructions[0]).toMatch(/ห้ามลอกประโยคเดิม/);
  });
});

describe("safeRepostDate", () => {
  const published = Date.UTC(2026, 0, 1);

  it("เขียนใหม่แล้ว → โพสต์ซ้ำได้หลัง 60 วัน", () => {
    const r = safeRepostDate(published, true);
    expect(r.atMs).toBe(published + RECYCLE_AFTER_DAYS * DAY);
    expect(r.th).toMatch(/60 วัน/);
  });

  it("ยังไม่ได้เขียนใหม่ → ต้องรอพ้น 90 วัน ไม่งั้นโดน Duplicate Guard", () => {
    const r = safeRepostDate(published, false);
    expect(r.atMs).toBe(published + DUPLICATE_WINDOW_DAYS * DAY);
    expect(r.th).toMatch(/กันโพสต์ซ้ำจะบล็อก/);
  });

  it("ช่วงรอของสองกรณีต่างกันจริง — นี่คือเหตุผลที่ต้องมีฟังก์ชันนี้", () => {
    expect(safeRepostDate(published, false).atMs).toBeGreaterThan(
      safeRepostDate(published, true).atMs,
    );
  });
});
