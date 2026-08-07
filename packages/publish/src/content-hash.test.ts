import { describe, expect, it } from "vitest";
import {
  DUPLICATE_WINDOW_MS,
  checkDuplicate,
  contentHash,
  normalizeContent,
  type DuplicateHit,
  type PublishedPostLookup,
} from "./content-hash.js";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

class FakeLookup implements PublishedPostLookup {
  readonly queries: Array<{ pageId: string; hash: string; sinceMs: number }> =
    [];
  constructor(private readonly hits: Record<string, DuplicateHit> = {}) {}
  async findByHash(args: {
    pageId: string;
    hash: string;
    sinceMs: number;
  }): Promise<DuplicateHit | null> {
    this.queries.push(args);
    return this.hits[`${args.pageId}:${args.hash}`] ?? null;
  }
}

describe("normalizeContent", () => {
  it("ตัดช่องว่างหัวท้ายและยุบช่องว่างซ้ำ", () => {
    expect(normalizeContent("  สวัสดี   ครับ  ")).toBe("สวัสดี ครับ");
  });

  it("ขึ้นบรรทัดใหม่ถือเท่ากับช่องว่าง", () => {
    expect(normalizeContent("สวัสดี\n\nครับ")).toBe("สวัสดี ครับ");
  });

  it("ไม่สนตัวพิมพ์ใหญ่เล็ก", () => {
    expect(normalizeContent("Hello")).toBe(normalizeContent("HELLO"));
  });

  it("ตัด tracking parameter ออกจาก URL", () => {
    expect(normalizeContent("ดูที่ https://a.com/x?utm_source=fb")).toBe(
      normalizeContent("ดูที่ https://a.com/x?utm_source=ig"),
    );
  });

  it("ตัด zero-width character ที่ติดมาจากการ copy", () => {
    expect(normalizeContent("สวัสดี​ครับ")).toBe("สวัสดี ครับ");
  });
});

describe("contentHash", () => {
  it("เนื้อหาเหมือนกันได้ hash เดียวกัน", () => {
    expect(contentHash({ body: "โปรโมชั่นวันนี้" })).toBe(
      contentHash({ body: "โปรโมชั่นวันนี้" }),
    );
  });

  it("แก้แค่ช่องว่างยังถือว่าซ้ำ (ผู้อ่านก็เห็นว่าซ้ำอยู่ดี)", () => {
    expect(contentHash({ body: "โปรโมชั่น  วันนี้ " })).toBe(
      contentHash({ body: "โปรโมชั่น วันนี้" }),
    );
  });

  it("เนื้อหาต่างกันได้ hash ต่างกัน", () => {
    expect(contentHash({ body: "โปรวันนี้" })).not.toBe(
      contentHash({ body: "โปรพรุ่งนี้" }),
    );
  });

  it("ข้อความเดียวกันแต่คนละประเภทถือว่าคนละโพสต์", () => {
    expect(contentHash({ body: "x", type: "text" })).not.toBe(
      contentHash({ body: "x", type: "reel" }),
    );
  });

  it("ลำดับรูปในอัลบั้มไม่ทำให้เป็นคนละโพสต์", () => {
    expect(contentHash({ body: "x", media: ["a.jpg", "b.jpg"] })).toBe(
      contentHash({ body: "x", media: ["b.jpg", "a.jpg"] }),
    );
  });

  it("เปลี่ยนรูปถือว่าคนละโพสต์", () => {
    expect(contentHash({ body: "x", media: ["a.jpg"] })).not.toBe(
      contentHash({ body: "x", media: ["c.jpg"] }),
    );
  });

  it("ได้ sha256 hex", () => {
    expect(contentHash({ body: "x" })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("checkDuplicate", () => {
  it("ไม่เคยโพสต์ → ไม่ซ้ำ", async () => {
    const lookup = new FakeLookup();
    const r = await checkDuplicate({
      pageId: "p1",
      content: { body: "ใหม่" },
      nowMs: NOW,
      lookup,
    });
    expect(r.isDuplicate).toBe(false);
    expect(r.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("เคยโพสต์ในช่วง 90 วัน → ซ้ำ พร้อมบอกว่ากี่วันก่อน", async () => {
    const hash = contentHash({ body: "โปรเดิม" });
    const lookup = new FakeLookup({
      [`p1:${hash}`]: {
        postId: "old-1",
        publishedAtMs: NOW - 10 * DAY,
        daysAgo: 10,
      },
    });
    const r = await checkDuplicate({
      pageId: "p1",
      content: { body: "โปรเดิม" },
      nowMs: NOW,
      lookup,
    });
    expect(r.isDuplicate).toBe(true);
    expect(r.hit?.postId).toBe("old-1");
    expect(r.th).toContain("10 วันก่อน");
    expect(r.th).toContain("อนุญาตให้ซ้ำ");
  });

  it("ค้นย้อนหลัง 90 วันตามสเปก", async () => {
    const lookup = new FakeLookup();
    await checkDuplicate({
      pageId: "p1",
      content: { body: "x" },
      nowMs: NOW,
      lookup,
    });
    expect(lookup.queries[0]!.sinceMs).toBe(NOW - DUPLICATE_WINDOW_MS);
    expect(DUPLICATE_WINDOW_MS).toBe(90 * DAY);
  });

  it("เพจอื่นโพสต์เนื้อหาเดียวกันไม่ถือว่าซ้ำ (cross-post ต้องทำได้)", async () => {
    const hash = contentHash({ body: "โปรเดิม" });
    const lookup = new FakeLookup({
      [`p1:${hash}`]: { postId: "old", publishedAtMs: NOW, daysAgo: 0 },
    });
    const r = await checkDuplicate({
      pageId: "p2",
      content: { body: "โปรเดิม" },
      nowMs: NOW,
      lookup,
    });
    expect(r.isDuplicate).toBe(false);
  });

  it("กำหนดช่วงเวลาเองได้", async () => {
    const lookup = new FakeLookup();
    await checkDuplicate({
      pageId: "p1",
      content: { body: "x" },
      nowMs: NOW,
      lookup,
      windowMs: 7 * DAY,
    });
    expect(lookup.queries[0]!.sinceMs).toBe(NOW - 7 * DAY);
  });
});
