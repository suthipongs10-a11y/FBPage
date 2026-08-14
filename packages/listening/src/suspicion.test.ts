import { describe, expect, it } from "vitest";
import {
  BURST_COUNT,
  COORDINATED_ACCOUNTS,
  MIN_DUPLICATE_LENGTH,
  SELF_REPEAT_TIMES,
  scanForSuspicion,
  type ScanComment,
} from "./suspicion.js";

const T0 = Date.UTC(2026, 7, 10, 12);

const c = (over: Partial<ScanComment> = {}): ScanComment => ({
  authorId: "u1",
  authorName: "คนหนึ่ง",
  message: "ข้อความนี้ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ นะครับ",
  createdAtMs: T0,
  trackedPageId: "page-a",
  ...over,
});

/** คอมเมนต์ n อันของคนเดิม ห่างกัน gap มิลลิวินาที */
const spread = (n: number, gapMs: number, over: Partial<ScanComment> = {}): ScanComment[] =>
  Array.from({ length: n }, (_, i) => c({ ...over, createdAtMs: T0 + i * gapMs }));

const flaggedNames = (comments: ScanComment[]): string[] =>
  scanForSuspicion(comments).flagged.map((f) => f.name);

describe("ข้อความเหมือนกันเป๊ะจากหลายบัญชี", () => {
  it("หลายบัญชีพิมพ์ข้อความเดียวกัน → ติดธงทุกบัญชี", () => {
    const text = "สินค้าดีมากเลยค่ะ แนะนำให้ทุกคนลองสั่งดูนะ";
    const comments = Array.from({ length: COORDINATED_ACCOUNTS }, (_, i) =>
      c({ authorId: `u${i}`, authorName: `คนที่ ${i}`, message: text }),
    );
    expect(flaggedNames(comments)).toHaveLength(COORDINATED_ACCOUNTS);
    expect(scanForSuspicion(comments).flagged[0]?.signals[0]?.key).toBe("coordinated");
  });

  it("ต่ำกว่าเกณฑ์จำนวนบัญชี → ไม่ติดธง", () => {
    const text = "สินค้าดีมากเลยค่ะ แนะนำให้ทุกคนลองสั่งดูนะ";
    const comments = Array.from({ length: COORDINATED_ACCOUNTS - 1 }, (_, i) =>
      c({ authorId: `u${i}`, authorName: `คนที่ ${i}`, message: text }),
    );
    expect(flaggedNames(comments)).toEqual([]);
  });

  it("ต่างกันแค่ช่องว่าง ถือว่าเหมือนกัน", () => {
    const text = "สินค้าดีมากเลยค่ะ แนะนำให้ทุกคนลองสั่งดูนะคะ";
    const comments = Array.from({ length: COORDINATED_ACCOUNTS }, (_, i) =>
      c({
        authorId: `u${i}`,
        authorName: `คนที่ ${i}`,
        // สลับใส่ช่องว่างเกินบ้าง — ต้องยังถูกจับว่าเป็นข้อความเดียวกัน
        message: i % 2 === 0 ? text : `  ${text.split(" ").join("   ")}  `,
        createdAtMs: T0 + i * 60_000,
      }),
    );
    expect(flaggedNames(comments)).toHaveLength(COORDINATED_ACCOUNTS);
  });

  it("บอกตัวอย่างข้อความที่ซ้ำมาด้วย ไม่ใช่แค่บอกว่าซ้ำ", () => {
    const text = "สินค้าดีมากเลยค่ะ แนะนำให้ทุกคนลองสั่งดูนะคะ";
    const n = COORDINATED_ACCOUNTS + 1;
    const comments = Array.from({ length: n }, (_, i) =>
      c({ authorId: `u${i}`, authorName: `คนที่ ${i}`, message: text, createdAtMs: T0 + i * 60_000 }),
    );
    const detail = scanForSuspicion(comments).flagged[0]?.signals[0]?.detailTh ?? "";
    expect(detail).toContain(`${n} บัญชี`);
    expect(detail).toContain("สินค้าดีมาก");
  });

  /**
   * เงื่อนไขที่ทำให้สัญญาณนี้เชื่อถือได้ — คนจริงที่บังเอิญพิมพ์ประโยคเหมือนกัน
   * จะกระจายกันเป็นวันเป็นสัปดาห์ ส่วนแคมเปญลงพร้อมกัน
   */
  it("ข้อความเดียวกันแต่กระจายกันเป็นวันๆ → ไม่ใช่การประสานกัน", () => {
    const text = "สินค้าดีมากเลยค่ะ แนะนำให้ทุกคนลองสั่งดูนะคะ";
    const comments = Array.from({ length: COORDINATED_ACCOUNTS + 3 }, (_, i) =>
      c({
        authorId: `u${i}`,
        authorName: `คนที่ ${i}`,
        message: text,
        // ห่างกันวันละคน
        createdAtMs: T0 + i * 86_400_000,
      }),
    );
    expect(flaggedNames(comments)).toEqual([]);
  });
});

/**
 * ด่านสำคัญที่สุดของทั้งไฟล์ — "❤️" "สนใจค่ะ" "cf 1" ถูกพิมพ์เป๊ะๆ โดยคนจริง
 * เป็นพันคนทุกวัน ถ้านับข้อความสั้นด้วย ทุกเพจจะขึ้นว่า "80% ของบัญชีน่าสงสัย"
 * ซึ่งไร้ประโยชน์และใส่ร้ายคนไปทั่ว
 */
describe("ข้อความสั้นต้องไม่ถูกนับว่าซ้ำ", () => {
  it.each([["❤️"], ["สนใจค่ะ"], ["cf 1"], ["ครับ"], ["สั่งค่ะ"], ["+1"], ["555"]])(
    'ข้อความ "%s" จากคนละคนหลายคน ต้องไม่ติดธง',
    (text) => {
      const comments = Array.from({ length: 20 }, (_, i) =>
        c({ authorId: `u${i}`, authorName: `คนที่ ${i}`, message: text }),
      );
      expect(flaggedNames(comments)).toEqual([]);
    },
  );

  it("อิโมจิยาวๆ ที่ไม่มีตัวอักษรเลย ก็ไม่นับ", () => {
    const text = "❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️";
    expect(text.length).toBeGreaterThanOrEqual(MIN_DUPLICATE_LENGTH);
    const comments = Array.from({ length: 10 }, (_, i) =>
      c({ authorId: `u${i}`, authorName: `คนที่ ${i}`, message: text }),
    );
    expect(flaggedNames(comments)).toEqual([]);
  });
});

describe("คนเดิมพิมพ์ข้อความเดิมซ้ำ", () => {
  it("ซ้ำถึงเกณฑ์ภายในหน้าต่างเวลา → ติดธง", () => {
    const r = scanForSuspicion(spread(SELF_REPEAT_TIMES, 60_000));
    expect(r.flagged[0]?.signals.map((s) => s.key)).toContain("selfRepeat");
  });

  it("ต่ำกว่าเกณฑ์ → ไม่ติดธง", () => {
    expect(flaggedNames(spread(SELF_REPEAT_TIMES - 1, 60_000))).toEqual([]);
  });

  /**
   * ลูกค้าจริงเอาคำถามเดิมไปถามใต้หลายโพสต์เป็นเรื่องปกติมาก
   * ("สั่ง 2 ชิ้นค่ะ รบกวนทักกลับด้วยนะคะ") — ถ้าไม่มีเงื่อนไขเวลาจะติดธงหมด
   */
  it("ถามคำถามเดิมใต้หลายโพสต์คนละวัน → ไม่ติดธง", () => {
    expect(flaggedNames(spread(SELF_REPEAT_TIMES + 3, 86_400_000))).toEqual([]);
  });

  it("คนละข้อความกันทุกครั้ง ถึงจะคอมเมนต์เยอะก็ไม่ติดธง", () => {
    const comments = Array.from({ length: 30 }, (_, i) =>
      c({ message: `คอมเมนต์ที่ ${i} ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ`, createdAtMs: T0 + i * 3_600_000 }),
    );
    expect(flaggedNames(comments)).toEqual([]);
  });
});

describe("คอมเมนต์รัวในเวลาสั้น", () => {
  it("รัวถึงเกณฑ์ในหน้าต่างเวลา → ติดธง", () => {
    // ข้อความไม่ซ้ำ เพื่อให้แน่ใจว่าติดธงเพราะความเร็วอย่างเดียว
    const comments = Array.from({ length: BURST_COUNT }, (_, i) =>
      c({ message: `ข้อความที่ ${i} ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ`, createdAtMs: T0 + i * 5_000 }),
    );
    const r = scanForSuspicion(comments);
    expect(r.flagged[0]?.signals.map((s) => s.key)).toEqual(["burst"]);
  });

  it("จำนวนเท่ากันแต่กระจายทั้งวัน → ไม่ติดธง", () => {
    const comments = Array.from({ length: BURST_COUNT }, (_, i) =>
      c({ message: `ข้อความที่ ${i} ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ`, createdAtMs: T0 + i * 3_600_000 }),
    );
    expect(flaggedNames(comments)).toEqual([]);
  });

  /** หน้าต่างเลื่อนได้ — ไม่ใช่แบ่งเป็นช่องตายตัว */
  it("รัวช่วงกลางของช่วงเวลายาว ก็ต้องจับได้", () => {
    const comments = [
      c({ message: "อันแรกยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ", createdAtMs: T0 }),
      ...Array.from({ length: BURST_COUNT }, (_, i) =>
        c({ message: `รัวที่ ${i} ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ`, createdAtMs: T0 + 86_400_000 + i * 1_000 }),
      ),
      c({ message: "อันท้ายยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ", createdAtMs: T0 + 200_000_000 }),
    ];
    const r = scanForSuspicion(comments);
    expect(r.flagged[0]?.signals.map((s) => s.key)).toContain("burst");
  });
});

describe("ระดับความน่าสงสัย", () => {
  it("สัญญาณเดียว = น่าดูต่อ", () => {
    const comments = Array.from({ length: BURST_COUNT }, (_, i) =>
      c({ message: `ข้อความที่ ${i} ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ`, createdAtMs: T0 + i * 5_000 }),
    );
    expect(scanForSuspicion(comments).flagged[0]?.level).toBe("watch");
  });

  it("สองสัญญาณขึ้นไป = เข้าข่ายชัด", () => {
    // พิมพ์ข้อความเดิมซ้ำ + รัวในเวลาสั้น พร้อมกัน
    const comments = spread(BURST_COUNT, 5_000);
    expect(scanForSuspicion(comments).flagged[0]?.level).toBe("high");
  });

  it("เรียงบัญชีที่มีสัญญาณมากที่สุดขึ้นก่อน", () => {
    const many = spread(BURST_COUNT, 5_000, { authorId: "หลายสัญญาณ", authorName: "หลายสัญญาณ" });
    const one = Array.from({ length: BURST_COUNT }, (_, i) =>
      c({
        authorId: "สัญญาณเดียว",
        authorName: "สัญญาณเดียว",
        message: `ข้อความที่ ${i} ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ`,
        createdAtMs: T0 + i * 5_000,
      }),
    );
    expect(flaggedNames([...one, ...many])[0]).toBe("หลายสัญญาณ");
  });
});

/**
 * สิ่งที่จงใจไม่นับเป็นสัญญาณ — ทุกข้อในบล็อกนี้คือการตัดสินใจเชิงจริยธรรม
 * ที่ต้องล็อกไว้ ไม่ใช่รายละเอียดทางเทคนิค
 */
describe("สิ่งที่ต้องไม่ถูกนับว่าน่าสงสัย", () => {
  it("ไม่มีชื่อ = การตั้งค่าความเป็นส่วนตัว ไม่ใช่พฤติกรรม → ไม่รายงานเลย", () => {
    const comments = spread(20, 1_000, { authorId: "x", authorName: null });
    const r = scanForSuspicion(comments);
    expect(r.flagged).toEqual([]);
    expect(r.accountsScanned).toBe(0);
  });

  it("ชื่อเป็นช่องว่างล้วน ก็ไม่รายงาน", () => {
    expect(flaggedNames(spread(20, 1_000, { authorName: "   " }))).toEqual([]);
  });

  it("คอมเมนต์เยอะแต่กระจายและไม่ซ้ำ = แฟนตัวยง ไม่ใช่บอท", () => {
    const comments = Array.from({ length: 100 }, (_, i) =>
      c({ message: `คอมเมนต์ที่ ${i} ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ`, createdAtMs: T0 + i * 3_600_000 }),
    );
    expect(flaggedNames(comments)).toEqual([]);
  });
});

describe("ผลรวมของการสแกน", () => {
  it("นับบัญชีที่สแกนและคิดเปอร์เซ็นต์ถูก", () => {
    const clean = Array.from({ length: 9 }, (_, i) =>
      c({ authorId: `ok${i}`, authorName: `ปกติ ${i}`, message: `ข้อความที่ ${i} ยาวพอที่จะถูกนับว่าเป็นข้อความซ้ำได้จริงๆ` }),
    );
    const bad = spread(BURST_COUNT, 5_000, { authorId: "bad", authorName: "รัว" });
    const r = scanForSuspicion([...clean, ...bad]);

    expect(r.accountsScanned).toBe(10);
    expect(r.flagged).toHaveLength(1);
    expect(r.flaggedPct).toBeCloseTo(10, 5);
  });

  it("ไม่มีคอมเมนต์เลย → ไม่พัง และเปอร์เซ็นต์เป็น 0 ไม่ใช่ NaN", () => {
    const r = scanForSuspicion([]);
    expect(r).toMatchObject({ accountsScanned: 0, flagged: [], flaggedPct: 0 });
    expect(Number.isNaN(r.flaggedPct)).toBe(false);
  });

  /**
   * ตัวเลขนี้ถูกอ่านผิดได้ง่ายมากว่าเป็นคำตัดสิน — คำเตือนจึงต้องติดไปกับ
   * ผลลัพธ์เสมอ ไม่ใช่ให้หน้าจอเลือกว่าจะแสดงหรือไม่
   */
  it("คำเตือนติดมากับผลลัพธ์เสมอ และบอกว่าไม่ใช่คำตัดสิน", () => {
    const r = scanForSuspicion([]);
    expect(r.caveatTh).toContain("ไม่ใช่คำตัดสิน");
    expect(r.caveatTh).toContain("คนจริงก็ติดธงได้");
  });
});
