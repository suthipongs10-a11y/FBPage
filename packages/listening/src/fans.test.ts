import { describe, expect, it } from "vitest";
import {
  fanBoards,
  overlapAcrossPages,
  topFansOfPage,
  type CommentAuthor,
} from "./fans.js";

const c = (
  over: Partial<CommentAuthor> & { authorName?: string | null },
): CommentAuthor => ({
  authorId: null,
  authorName: null,
  trackedPageId: "page-a",
  ...over,
});

/** สร้างคอมเมนต์ n อันของคนเดียวกัน */
const many = (n: number, over: Partial<CommentAuthor>): CommentAuthor[] =>
  Array.from({ length: n }, () => c(over));

describe("แฟนตัวยงของเพจ", () => {
  it("เรียงจากคนที่คอมเมนต์เยอะสุด", () => {
    const fans = topFansOfPage([
      ...many(11, { authorId: "u1", authorName: "Kiky Temyum" }),
      ...many(8, { authorId: "u2", authorName: "Wilai Petersen" }),
      ...many(7, { authorId: "u3", authorName: "อโนทัย ศิลา" }),
    ]);
    expect(fans.map((f) => [f.name, f.comments])).toEqual([
      ["Kiky Temyum", 11],
      ["Wilai Petersen", 8],
      ["อโนทัย ศิลา", 7],
    ]);
  });

  /**
   * ในเพจเดียวกัน รหัสเชื่อถือได้ — คนสองคนที่บังเอิญชื่อเหมือนกัน
   * ต้องไม่ถูกยุบเป็นคนเดียว
   */
  it("คนละรหัสแต่ชื่อเหมือนกัน → นับเป็นคนละคน", () => {
    const fans = topFansOfPage([
      ...many(3, { authorId: "u1", authorName: "สมชาย ใจดี" }),
      ...many(2, { authorId: "u2", authorName: "สมชาย ใจดี" }),
    ]);
    expect(fans).toHaveLength(2);
    expect(fans.map((f) => f.comments)).toEqual([3, 2]);
  });

  /** คนที่ไม่ได้ให้สิทธิ์แอปเราจะไม่มีรหัสมาให้ — ยังนับได้ด้วยชื่อ */
  it("ไม่มีรหัส → ถอยไปนับด้วยชื่อ", () => {
    const fans = topFansOfPage(many(4, { authorId: null, authorName: "คนไม่มีรหัส" }));
    expect(fans).toEqual([{ name: "คนไม่มีรหัส", comments: 4 }]);
  });

  /**
   * ยุบคนที่ไม่รู้ชื่อรวมกันจะได้ "แฟนตัวยงอันดับ 1" ที่จริงๆ คือคนละสิบคน
   * — ไม่นับดีกว่านับผิด
   */
  it("ไม่รู้ทั้งรหัสและชื่อ → ไม่นับ ไม่ยุบรวมเป็นคนเดียว", () => {
    expect(topFansOfPage(many(50, { authorId: null, authorName: null }))).toEqual([]);
  });

  it("มีรหัสแต่ไม่มีชื่อ → ไม่แสดง เพราะเอาไปขึ้นจอไม่ได้", () => {
    expect(topFansOfPage(many(9, { authorId: "u9", authorName: null }))).toEqual([]);
  });

  it("ชื่อที่เป็นช่องว่างล้วนไม่นับ", () => {
    expect(topFansOfPage(many(3, { authorId: "u1", authorName: "   " }))).toEqual([]);
  });

  it("จำกัดจำนวนตามที่ขอ", () => {
    const comments = Array.from({ length: 30 }, (_, i) =>
      c({ authorId: `u${i}`, authorName: `คนที่ ${i}` }),
    );
    expect(topFansOfPage(comments, 5)).toHaveLength(5);
  });

  it("ไม่มีคอมเมนต์เลย → รายการว่าง ไม่พัง", () => {
    expect(topFansOfPage([])).toEqual([]);
  });

  /** จำนวนเท่ากันต้องเรียงคงที่ ไม่งั้นรีเฟรชแล้วลำดับสลับไปมา */
  it("จำนวนเท่ากัน → เรียงตามชื่อเพื่อให้ผลลัพธ์คงที่", () => {
    const fans = topFansOfPage([
      c({ authorId: "u2", authorName: "ขวัญ" }),
      c({ authorId: "u1", authorName: "กมล" }),
    ]);
    expect(fans.map((f) => f.name)).toEqual(["กมล", "ขวัญ"]);
  });
});

describe("คนที่คอมเมนต์ทับซ้อนข้ามเพจ", () => {
  it("นับจำนวนเพจที่คนคนนั้นไปคอมเมนต์", () => {
    const r = overlapAcrossPages([
      c({ authorName: "Korkamonwun", trackedPageId: "a" }),
      c({ authorName: "Korkamonwun", trackedPageId: "b" }),
      c({ authorName: "Korkamonwun", trackedPageId: "b" }),
      c({ authorName: "คนเพจเดียว", trackedPageId: "a" }),
    ]);
    expect(r.people).toEqual([{ name: "Korkamonwun", pages: 2, comments: 3 }]);
  });

  it("คนที่อยู่เพจเดียวไม่นับว่าทับซ้อน", () => {
    const r = overlapAcrossPages([
      ...many(99, { authorName: "ขาประจำเพจเดียว", trackedPageId: "a" }),
    ]);
    expect(r.people).toEqual([]);
  });

  /**
   * ข้อจำกัดที่ต้องยอมรับ: Meta ออกรหัสคนละตัวให้แต่ละเพจโดยตั้งใจ
   * จับข้ามเพจด้วยรหัสไม่ได้ เหลือแต่ชื่อ — จึงต้องมีคำเตือนติดไปกับผลลัพธ์เสมอ
   */
  it("มีคำเตือนติดมาด้วยเสมอว่าจับคู่ด้วยชื่อ", () => {
    const r = overlapAcrossPages([]);
    expect(r.caveatTh).toContain("ชื่อ");
    expect(r.caveatTh).toContain("ค่าประมาณ");
  });

  it("คนละคนที่ชื่อเหมือนกันจะถูกนับรวม — ยอมรับตามข้อจำกัด", () => {
    const r = overlapAcrossPages([
      c({ authorId: "หนึ่ง", authorName: "สมชาย ใจดี", trackedPageId: "a" }),
      c({ authorId: "สอง", authorName: "สมชาย ใจดี", trackedPageId: "b" }),
    ]);
    expect(r.people[0]).toMatchObject({ name: "สมชาย ใจดี", pages: 2 });
  });

  it("ตั้งขั้นต่ำจำนวนเพจได้", () => {
    const comments = [
      c({ authorName: "สองเพจ", trackedPageId: "a" }),
      c({ authorName: "สองเพจ", trackedPageId: "b" }),
      c({ authorName: "สามเพจ", trackedPageId: "a" }),
      c({ authorName: "สามเพจ", trackedPageId: "b" }),
      c({ authorName: "สามเพจ", trackedPageId: "cc" }),
    ];
    expect(overlapAcrossPages(comments, { minPages: 3 }).people.map((p) => p.name)).toEqual([
      "สามเพจ",
    ]);
  });

  it("เรียงจากคนที่อยู่หลายเพจที่สุดก่อน", () => {
    const r = overlapAcrossPages([
      c({ authorName: "สองเพจ", trackedPageId: "a" }),
      c({ authorName: "สองเพจ", trackedPageId: "b" }),
      c({ authorName: "สามเพจ", trackedPageId: "a" }),
      c({ authorName: "สามเพจ", trackedPageId: "b" }),
      c({ authorName: "สามเพจ", trackedPageId: "cc" }),
    ]);
    expect(r.people.map((p) => p.name)).toEqual(["สามเพจ", "สองเพจ"]);
  });

  it("ไม่รู้ชื่อ → ไม่นับ", () => {
    const r = overlapAcrossPages([
      c({ authorId: "x", authorName: null, trackedPageId: "a" }),
      c({ authorId: "y", authorName: null, trackedPageId: "b" }),
    ]);
    expect(r.people).toEqual([]);
  });
});

describe("แฟนตัวยงแยกตามเพจ", () => {
  const PAGES = [
    { id: "a", name: "Pimrypie" },
    { id: "b", name: "ซ้อก้าด" },
    { id: "c", name: "เพจเงียบ" },
  ];
  const COMMENTS = [
    ...many(11, { authorId: "u1", authorName: "Kiky", trackedPageId: "a" }),
    ...many(20, { authorId: "u9", authorName: "ไงล่ะ โอ๊พวกโง่", trackedPageId: "b" }),
  ];

  it("แยกคนของแต่ละเพจไม่ปนกัน", () => {
    const boards = fanBoards({ pages: PAGES, comments: COMMENTS });
    expect(boards.find((b) => b.pageName === "Pimrypie")?.fans[0]?.name).toBe("Kiky");
    expect(boards.find((b) => b.pageName === "ซ้อก้าด")?.fans[0]?.comments).toBe(20);
  });

  it("เพจที่ยังไม่มีคอมเมนต์ ไม่ขึ้นกล่องเปล่าให้รก", () => {
    const boards = fanBoards({ pages: PAGES, comments: COMMENTS });
    expect(boards.map((b) => b.pageName)).not.toContain("เพจเงียบ");
  });

  it("เรียงตามลำดับเพจที่ส่งเข้ามา ไม่สลับเอง", () => {
    const boards = fanBoards({ pages: PAGES, comments: COMMENTS });
    expect(boards.map((b) => b.trackedPageId)).toEqual(["a", "b"]);
  });
});
