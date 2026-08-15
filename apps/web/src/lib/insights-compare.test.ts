import { describe, expect, it } from "vitest";
import { gapAgainstStrongest, gapBetween, hasMixedPlatforms } from "./insights-compare.js";
import type { PageInsight } from "@/lib/server/insights";

const page = (over: Partial<PageInsight> & { id: string }): PageInsight => ({
  externalId: over.id,
  platform: "FACEBOOK",
  name: over.id,
  kind: "COMPETITOR",
  followers: 10_000,
  lastFetchedAtMs: null,
  posts: 10,
  reactions: 0,
  shares: 0,
  comments: 0,
  engagement: 1_000,
  perPost: 100,
  uniqueCommenters: 50,
  colorIndex: 0,
  ...over,
});

/**
 * ─── กฎที่สำคัญที่สุดของไฟล์นี้ ───
 *
 * `engagement` = รีแอ็กชัน + **แชร์** + คอมเมนต์ แต่ YouTube ไม่มีตัวเลขการแชร์
 * ให้เลย (เก็บเป็น 0 เสมอ) ช่อง YouTube จึงขาดองค์ประกอบทั้งก้อนที่เพจ Facebook มี
 *
 * ถ้าเทียบข้ามฝั่ง ช่อง YouTube จะดูแย่กว่าความจริงเสมอ โดยที่ตัวเลขบนหน้าจอ
 * ไม่มีอะไรบอกว่าเทียบกันไม่ได้ — คนจะเอาไปตัดสินใจผิด
 */
describe("เทียบกับคู่แข่งที่แรงที่สุด", () => {
  it("ไม่เอาช่อง YouTube มาเป็นคู่เทียบของเพจ Facebook", () => {
    const pages = [
      page({ id: "เราเอง", kind: "OWNED", engagement: 1_000 }),
      page({ id: "คู่แข่งเฟซ", engagement: 2_000 }),
      // ช่อง YouTube ที่แรงที่สุดในชุด — ต้องไม่ถูกหยิบมาเทียบ
      page({ id: "ช่องยูทูป", platform: "YOUTUBE", engagement: 99_000 }),
    ];

    const { result } = gapAgainstStrongest({ pages });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theirs.pageName).toBe("คู่แข่งเฟซ");
  });

  it("ช่อง YouTube ของเรา เทียบกับช่อง YouTube ด้วยกันเอง", () => {
    const pages = [
      page({ id: "ช่องเรา", platform: "YOUTUBE", kind: "OWNED", engagement: 1_000 }),
      page({ id: "เพจเฟซแรงมาก", engagement: 99_000 }),
      page({ id: "ช่องคู่แข่ง", platform: "YOUTUBE", engagement: 3_000 }),
    ];

    const { result } = gapAgainstStrongest({ pages });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theirs.pageName).toBe("ช่องคู่แข่ง");
  });

  it("ยังไม่ได้บอกว่าอันไหนเป็นของเรา → บอกให้ไปเพิ่มก่อน", () => {
    const { result } = gapAgainstStrongest({ pages: [page({ id: "คนอื่น" })] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonTh).toContain("เพจของเรา");
  });
});

describe("เทียบสองอันที่เลือกเอง", () => {
  const pages = [
    page({ id: "เพจ", platform: "FACEBOOK", engagement: 5_000 }),
    page({ id: "ช่อง", platform: "YOUTUBE", engagement: 5_000 }),
    page({ id: "เพจ2", platform: "FACEBOOK", engagement: 8_000 }),
  ];

  it("แพลตฟอร์มเดียวกัน → เทียบได้", () => {
    expect(gapBetween({ pages, ourId: "เพจ", theirId: "เพจ2" }).ok).toBe(true);
  });

  /**
   * ปฏิเสธ ไม่ใช่คำนวณให้แล้วเติมคำเตือนตัวเล็กๆ — ตัวเลขที่เทียบกันไม่ได้
   * ตั้งแต่ต้นไม่ควรถูกแสดงเลย เพราะคนอ่านจะจำตัวเลขไปมากกว่าจำคำเตือน
   */
  it("ข้ามแพลตฟอร์ม → ปฏิเสธพร้อมบอกเหตุผลที่เข้าใจได้", () => {
    const r = gapBetween({ pages, ourId: "เพจ", theirId: "ช่อง" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasonTh).toContain("การแชร์");
      expect(r.reasonTh).toContain("ยอดวิว");
    }
  });

  it("เลือกอันที่ถูกเอาออกไปแล้ว → บอกให้ชัด ไม่ใช่พังทั้งหน้า", () => {
    const r = gapBetween({ pages, ourId: "เพจ", theirId: "ไม่มีอยู่" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonTh).toContain("ไม่พบ");
  });
});

describe("รู้ว่ามีของสองแพลตฟอร์มปนกันไหม", () => {
  it("มีทั้งสองฝั่ง → true", () => {
    expect(
      hasMixedPlatforms([page({ id: "a" }), page({ id: "b", platform: "YOUTUBE" })]),
    ).toBe(true);
  });

  it("ฝั่งเดียว → false", () => {
    expect(hasMixedPlatforms([page({ id: "a" }), page({ id: "b" })])).toBe(false);
    expect(hasMixedPlatforms([page({ id: "a", platform: "YOUTUBE" })])).toBe(false);
  });

  it("ยังไม่มีอะไรเลย → false", () => {
    expect(hasMixedPlatforms([])).toBe(false);
  });
});
