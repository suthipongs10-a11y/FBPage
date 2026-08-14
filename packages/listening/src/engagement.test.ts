import { describe, expect, it } from "vitest";
import {
  engagementOf,
  isInWindow,
  shareOfVoice,
  summarizeWindow,
  type PostStat,
  type Window,
} from "./engagement.js";

const AUG_1 = Date.UTC(2026, 7, 1);
const SEP_1 = Date.UTC(2026, 8, 1);
const WINDOW: Window = { startMs: AUG_1, endMs: SEP_1 };

const post = (over: Partial<PostStat> = {}): PostStat => ({
  publishedAtMs: AUG_1 + 86_400_000,
  reactions: 10,
  shares: 2,
  comments: 3,
  ...over,
});

describe("engagement ของโพสต์ใบเดียว", () => {
  it("คือรีแอ็กชัน + แชร์ + คอมเมนต์", () => {
    expect(engagementOf(post({ reactions: 100, shares: 20, comments: 5 }))).toBe(125);
  });

  it("โพสต์ที่ไม่มีใครแตะเลยได้ 0 ไม่ใช่ NaN", () => {
    expect(engagementOf(post({ reactions: 0, shares: 0, comments: 0 }))).toBe(0);
  });
});

describe("ขอบเขตของช่วงเวลา", () => {
  /**
   * ครึ่งเปิด `[start, end)` — สำคัญตอนดูหลายเดือนต่อกัน ถ้าปิดสองข้าง
   * โพสต์ที่ลงเที่ยงคืนวันที่ 1 พอดีจะถูกนับทั้งในเดือนก่อนและเดือนถัดไป
   */
  it("โพสต์ที่ลงตรงต้นช่วงพอดี → นับ", () => {
    expect(isInWindow(post({ publishedAtMs: AUG_1 }), WINDOW)).toBe(true);
  });

  it("โพสต์ที่ลงตรงปลายช่วงพอดี → ไม่นับ (เป็นของช่วงถัดไป)", () => {
    expect(isInWindow(post({ publishedAtMs: SEP_1 }), WINDOW)).toBe(false);
  });

  it("โพสต์ที่ลงก่อนช่วง → ไม่นับ แม้จะยังมีคนมาคอมเมนต์อยู่", () => {
    expect(isInWindow(post({ publishedAtMs: AUG_1 - 1 }), WINDOW)).toBe(false);
  });
});

describe("สรุปยอดของเพจในช่วง", () => {
  it("นับเฉพาะโพสต์ที่เผยแพร่ในช่วง ไม่ใช่ทุกโพสต์ที่มี", () => {
    const stats = summarizeWindow(
      [
        post({ publishedAtMs: AUG_1 - 1, reactions: 999_999 }),
        post({ publishedAtMs: AUG_1, reactions: 10, shares: 1, comments: 1 }),
        post({ publishedAtMs: SEP_1 - 1, reactions: 20, shares: 2, comments: 2 }),
        post({ publishedAtMs: SEP_1, reactions: 999_999 }),
      ],
      WINDOW,
    );
    expect(stats.posts).toBe(2);
    expect(stats.engagement).toBe(36);
  });

  it("แยกยอดแต่ละชนิดไว้ให้ดูด้วย ไม่ใช่รวมแล้วทิ้ง", () => {
    const stats = summarizeWindow(
      [post({ reactions: 5, shares: 3, comments: 2 }), post({ reactions: 1, shares: 1, comments: 1 })],
      WINDOW,
    );
    expect(stats).toMatchObject({ reactions: 6, shares: 4, comments: 3, engagement: 13 });
  });

  it("ต่อโพสต์ = engagement ÷ จำนวนโพสต์", () => {
    const stats = summarizeWindow([post({ reactions: 10, shares: 0, comments: 0 }), post({ reactions: 30, shares: 0, comments: 0 })], WINDOW);
    expect(stats.perPost).toBe(20);
  });

  it("ไม่มีโพสต์ในช่วง → ต่อโพสต์เป็น 0 ไม่ใช่ NaN", () => {
    const stats = summarizeWindow([], WINDOW);
    expect(stats.posts).toBe(0);
    expect(stats.perPost).toBe(0);
    expect(Number.isNaN(stats.perPost)).toBe(false);
  });
});

describe("ส่วนแบ่งเสียง", () => {
  const pages = [
    { pageId: "a", pageName: "ซ้อก้าด", engagement: 4_288_923 },
    { pageId: "b", pageName: "Pimrypie", engagement: 2_552_588 },
    { pageId: "c", pageName: "ไบรท์ไร้ไขมัน", engagement: 285_921 },
    { pageId: "d", pageName: "LOVEPOTION", engagement: 215_702 },
  ];

  it("รวมกันได้ 100% เสมอ", () => {
    const sum = shareOfVoice(pages).shares.reduce((s, p) => s + p.sharePct, 0);
    expect(sum).toBeCloseTo(100, 10);
  });

  it("คิดสัดส่วนถูกตามตัวเลขจริง", () => {
    const sov = shareOfVoice(pages);
    expect(sov.totalEngagement).toBe(7_343_134);
    expect(sov.shares[0]?.sharePct).toBeCloseTo(58.4, 1);
  });

  it("เรียงจากมากไปน้อย และบอกว่าใครครองเสียง", () => {
    const sov = shareOfVoice(pages);
    expect(sov.shares.map((s) => s.pageId)).toEqual(["a", "b", "c", "d"]);
    expect(sov.leader?.pageName).toBe("ซ้อก้าด");
  });

  /** "เพจนี้เงียบสนิท" คือข้อมูล ไม่ใช่ความว่างเปล่า — ต้องยังอยู่ในตาราง */
  it("เพจที่ engagement เป็น 0 ยังอยู่ในผลลัพธ์", () => {
    const sov = shareOfVoice([...pages, { pageId: "e", pageName: "เพจเงียบ", engagement: 0 }]);
    expect(sov.shares).toHaveLength(5);
    expect(sov.shares.at(-1)).toMatchObject({ pageId: "e", sharePct: 0 });
  });

  it("ทั้งชุดยังไม่มี engagement เลย → ทุกเพจเป็น 0 และไม่มีผู้ครองเสียง", () => {
    const sov = shareOfVoice([
      { pageId: "a", pageName: "ก", engagement: 0 },
      { pageId: "b", pageName: "ข", engagement: 0 },
    ]);
    expect(sov.leader).toBeNull();
    for (const s of sov.shares) expect(s.sharePct).toBe(0);
  });

  it("ไม่มีเพจเลย → ไม่พัง", () => {
    expect(shareOfVoice([])).toMatchObject({ totalEngagement: 0, shares: [], leader: null });
  });
});
