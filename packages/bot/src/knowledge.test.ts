import { describe, expect, it } from "vitest";
import {
  TARGET_CHUNK_CHARS,
  buildContext,
  chunkText,
  cosineSimilarity,
  keywordScore,
  prepareChunks,
  retrieve,
} from "./knowledge.js";
import type { KnowledgeChunk } from "./types.js";

describe("chunkText", () => {
  it("ข้อความสั้นไม่ต้องตัด", () => {
    expect(chunkText("ค่าส่ง 50 บาทค่ะ")).toEqual(["ค่าส่ง 50 บาทค่ะ"]);
  });

  it("ข้อความว่างคืน array ว่าง", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("ตัดที่ย่อหน้าก่อน", () => {
    const doc = [
      "ก".repeat(300),
      "ข".repeat(300),
      "ค".repeat(300),
    ].join("\n\n");
    const chunks = chunkText(doc, { targetChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    // แต่ละ chunk ควรมีย่อหน้าเดียวหรือไม่กี่ย่อหน้า ไม่ใช่ตัดกลางย่อหน้า
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(450);
    }
  });

  it("ย่อหน้าที่ยาวเกินถูกตัดตามประโยค", () => {
    const long = Array.from(
      { length: 20 },
      (_, i) => `ประโยคที่ ${i} มีเนื้อหาพอสมควรให้ยาวขึ้นอีกหน่อย.`,
    ).join(" ");
    const chunks = chunkText(long, { targetChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(320);
  });

  it("ไม่ทำข้อมูลหาย", () => {
    const doc = "ราคาสินค้า 250 บาท\n\nค่าส่ง 50 บาท\n\nรับประกัน 1 ปี";
    const joined = chunkText(doc, { targetChars: 30 }).join(" ");
    expect(joined).toContain("250");
    expect(joined).toContain("50");
    expect(joined).toContain("1 ปี");
  });

  it("ใช้ค่าเริ่มต้นที่พอดีกับการตอบแชท", () => {
    expect(TARGET_CHUNK_CHARS).toBeLessThanOrEqual(800);
  });
});

describe("prepareChunks", () => {
  it("สร้าง chunk พร้อม id ที่ไม่ซ้ำและผูกกับเพจ", () => {
    const chunks = prepareChunks({
      pageId: "p1",
      title: "นโยบายคืนสินค้า",
      text: "ก".repeat(300) + "\n\n" + "ข".repeat(300),
      source: "policy.pdf",
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
    for (const c of chunks) {
      expect(c.pageId).toBe("p1");
      expect(c.title).toBe("นโยบายคืนสินค้า");
      expect(c.source).toBe("policy.pdf");
    }
  });
});

describe("cosineSimilarity", () => {
  it("เวกเตอร์เดียวกัน = 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
  it("ตั้งฉากกัน = 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it("ความยาวไม่เท่ากันหรือว่าง = 0 (ไม่พัง)", () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
  it("เวกเตอร์ศูนย์ = 0 ไม่หารด้วยศูนย์", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("keywordScore — ใช้ตอนยังไม่มี embedding", () => {
  it("ข้อความที่มีคำตรงได้คะแนนสูง", () => {
    const s = keywordScore("ค่าจัดส่งเท่าไหร่", "ค่าจัดส่ง 50 บาททั่วประเทศ");
    expect(s).toBeGreaterThan(0.3);
  });

  it("ข้อความที่ไม่เกี่ยวได้คะแนนต่ำ", () => {
    const s = keywordScore("ค่าจัดส่งเท่าไหร่", "เปิดทำการวันจันทร์ถึงศุกร์");
    expect(s).toBeLessThan(0.2);
  });

  it("จัดการภาษาไทยที่ไม่เว้นวรรคได้", () => {
    // คำที่ติดกันยังจับได้เพราะใช้ n-gram
    expect(
      keywordScore("คืนสินค้า", "รับคืนสินค้าภายใน7วัน"),
    ).toBeGreaterThan(0.3);
  });

  it("ข้อความว่างได้ 0", () => {
    expect(keywordScore("", "อะไรก็ได้")).toBe(0);
    expect(keywordScore("อะไรก็ได้", "")).toBe(0);
  });
});

describe("retrieve", () => {
  const chunks: KnowledgeChunk[] = [
    {
      id: "k1",
      pageId: "p1",
      title: "คืนสินค้า",
      text: "รับคืนสินค้าภายใน 7 วันหลังได้รับของ",
    },
    {
      id: "k2",
      pageId: "p1",
      title: "ชำระเงิน",
      text: "รับโอนธนาคาร พร้อมเพย์ และเก็บเงินปลายทาง",
    },
    {
      id: "k3",
      pageId: "p2",
      title: "ของเพจอื่น",
      text: "รับคืนสินค้าภายใน 7 วัน เหมือนกันแต่คนละเพจ",
    },
  ];

  it("ค้นเจอ chunk ที่เกี่ยวข้อง", () => {
    const r = retrieve({ query: "คืนสินค้าได้ไหม", chunks, pageId: "p1" });
    expect(r[0]!.id).toBe("k1");
  });

  it("ไม่ข้ามเพจเด็ดขาด (ข้อมูลลูกค้าคนละราย)", () => {
    const r = retrieve({ query: "คืนสินค้า", chunks, pageId: "p1" });
    expect(r.map((x) => x.id)).not.toContain("k3");
  });

  it("ไม่เกี่ยวเลย → ไม่คืนอะไร (ยอมบอกว่าไม่รู้ ดีกว่าเดา)", () => {
    const r = retrieve({
      query: "ขอสูตรทำอาหารญี่ปุ่น",
      chunks,
      pageId: "p1",
    });
    expect(r).toHaveLength(0);
  });

  it("จำกัดจำนวนผลลัพธ์ได้", () => {
    const many: KnowledgeChunk[] = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      pageId: "p1",
      title: "คืนสินค้า",
      text: "รับคืนสินค้าภายใน 7 วัน",
    }));
    expect(
      retrieve({ query: "คืนสินค้า", chunks: many, pageId: "p1", options: { topK: 3 } }),
    ).toHaveLength(3);
  });

  it("ใช้ embedding เมื่อมีทั้งสองฝั่ง", () => {
    const withVec: KnowledgeChunk[] = [
      { ...chunks[0]!, embedding: [1, 0, 0] },
      { ...chunks[1]!, embedding: [0, 1, 0] },
    ];
    const r = retrieve({
      query: "อะไรก็ได้",
      queryEmbedding: [0, 1, 0],
      chunks: withVec,
      pageId: "p1",
      options: { minScore: 0.1 },
    });
    // เวกเตอร์ชี้ไปทาง k2 จึงควรมาก่อน แม้คำจะไม่ตรง
    expect(r[0]!.id).toBe("k2");
  });

  it("chunk ที่ยังไม่ได้ embed ยังค้นเจอด้วยการจับคำ", () => {
    const mixed: KnowledgeChunk[] = [
      { ...chunks[0]!, embedding: undefined },
      { ...chunks[1]!, embedding: [0, 1, 0] },
    ];
    const r = retrieve({
      query: "คืนสินค้าได้ไหม",
      queryEmbedding: [1, 0, 0],
      chunks: mixed,
      pageId: "p1",
    });
    expect(r.map((x) => x.id)).toContain("k1");
  });

  it("เรียงจากคะแนนมากไปน้อย", () => {
    const r = retrieve({
      query: "คืนสินค้า",
      chunks,
      pageId: "p1",
      options: { minScore: 0 },
    });
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1]!.score).toBeGreaterThanOrEqual(r[i]!.score);
    }
  });
});

describe("buildContext", () => {
  it("ประกอบข้อมูลพร้อมหมายเลขอ้างอิง", () => {
    const out = buildContext([
      { id: "a", pageId: "p1", title: "หัวข้อ ก", text: "เนื้อหา ก", score: 0.9 },
      { id: "b", pageId: "p1", title: "หัวข้อ ข", text: "เนื้อหา ข", score: 0.8 },
    ]);
    expect(out).toContain("[1] หัวข้อ ก");
    expect(out).toContain("[2] หัวข้อ ข");
  });

  it("ไม่มีข้อมูลคืนสตริงว่าง", () => {
    expect(buildContext([])).toBe("");
  });
});
