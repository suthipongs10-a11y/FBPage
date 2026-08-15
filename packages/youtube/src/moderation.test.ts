import { describe, expect, it } from "vitest";
import { YouTubeApiError } from "./errors.js";
import type { YouTubeGateway } from "./gateway.js";
import { MODERATION_BATCH, YouTubeCommentActions } from "./moderation.js";

interface Call {
  endpoint: string;
  method: string | undefined;
  params: Record<string, unknown>;
  accessToken: string | undefined;
  background: boolean | undefined;
}

function fake(throwOn?: (n: number) => unknown) {
  const calls: Call[] = [];
  let n = 0;
  const gateway = {
    async call(opts: {
      endpoint: string;
      method?: string;
      params?: Record<string, unknown>;
      accessToken?: string;
      background?: boolean;
    }) {
      n += 1;
      calls.push({
        endpoint: opts.endpoint,
        method: opts.method,
        params: opts.params ?? {},
        accessToken: opts.accessToken,
        background: opts.background,
      });
      const err = throwOn?.(n);
      if (err !== undefined) throw err;
      return { data: {}, quota: null };
    },
  } as unknown as YouTubeGateway;

  return {
    calls,
    actions: new YouTubeCommentActions({
      gateway,
      accessToken: async () => "tok-123",
    }),
  };
}

const ids = (count: number, prefix = "c"): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** ช่องของเราเอง — ค่าเริ่มต้นของเทสต์ส่วนใหญ่ */
const ours = { id: "UCours", owned: true };

const quotaError = () =>
  new YouTubeApiError({ message: "q", reason: "quotaExceeded", httpStatus: 403 });

/**
 * ─── เรื่องที่สำคัญที่สุดของไฟล์นี้ ───
 *
 * หนึ่ง call ราคา 50 หน่วย จากโควตาวันละ 10,000 แต่ `setModerationStatus`
 * รับ id หลายตัวใน call เดียวและคิดราคาเท่าเดิม — ยิงทีละอันจึงแพงกว่า 50 เท่า
 */
describe("ซ่อนคอมเมนต์เป็นก้อน", () => {
  it("ซ่อน 50 อัน = ยิงครั้งเดียว ไม่ใช่ 50 ครั้ง", async () => {
    const { actions, calls } = fake();
    const r = await actions.hide({ commentIds: ids(50), channel: ours });

    expect(calls).toHaveLength(1);
    expect(r.done).toBe(50);
    expect(r.quotaSpent).toBe(50);
    expect(String(calls[0]?.params.id).split(",")).toHaveLength(50);
  });

  it("เกินก้อนละ 50 → แบ่งเป็นก้อน ไม่ยัดใส่ call เดียว", async () => {
    const { actions, calls } = fake();
    const r = await actions.hide({ commentIds: ids(120), channel: ours });

    expect(calls).toHaveLength(3);
    expect(r.done).toBe(120);
    expect(r.quotaSpent).toBe(150);
    expect(String(calls[2]?.params.id).split(",")).toHaveLength(20);
  });

  it("บอกในข้อความสรุปว่าประหยัดไปเท่าไร", async () => {
    const { actions } = fake();
    const r = await actions.hide({ commentIds: ids(50), channel: ours });
    // 50 อันยิงทีละครั้ง = 2,500 หน่วย
    expect(r.th).toContain("2500");
    expect(r.th).toContain("50 หน่วย");
  });

  /** id ซ้ำทำให้ก้อนเต็มเร็วกว่าที่ควร = จ่ายโควตาเกินโดยไม่ได้อะไรเพิ่ม */
  it("id ซ้ำถูกตัดออกก่อนแบ่งก้อน", async () => {
    const { actions, calls } = fake();
    const r = await actions.hide({ commentIds: [...ids(50), ...ids(50)], channel: ours });

    expect(calls).toHaveLength(1);
    expect(r.done).toBe(50);
    expect(r.quotaSpent).toBe(50);
  });

  it("ไม่มีอะไรให้ทำ → ไม่ยิงเลยสักครั้ง", async () => {
    const { actions, calls } = fake();
    const r = await actions.hide({ commentIds: [], channel: ours });

    expect(calls).toEqual([]);
    expect(r.quotaSpent).toBe(0);
    expect(r.th).toContain("ไม่ได้ยิงอะไร");
  });

  it("สตริงว่างในรายการไม่ถูกนับเป็นคอมเมนต์", async () => {
    const { actions, calls } = fake();
    const r = await actions.hide({ commentIds: ["", "  ", "c1"], channel: ours });

    expect(r.done).toBe(1);
    expect(String(calls[0]?.params.id)).toBe("c1");
  });

  it("ใช้ MODERATION_BATCH เป็นขนาดก้อนจริง", async () => {
    const { actions, calls } = fake();
    await actions.hide({ commentIds: ids(MODERATION_BATCH + 1), channel: ours });
    expect(calls).toHaveLength(2);
  });
});

describe("สถานะที่ส่งไปต้องถูกต้อง", () => {
  it("ซ่อน = rejected", async () => {
    const { actions, calls } = fake();
    await actions.hide({ commentIds: ["c1"], channel: ours });
    expect(calls[0]?.params.moderationStatus).toBe("rejected");
    expect(calls[0]?.method).toBe("POST");
  });

  it("เอาการซ่อนออก = published", async () => {
    const { actions, calls } = fake();
    await actions.unhide({ commentIds: ["c1"], channel: ours });
    expect(calls[0]?.params.moderationStatus).toBe("published");
  });

  it("พักรอตรวจ = heldForReview", async () => {
    const { actions, calls } = fake();
    await actions.holdForReview({ commentIds: ["c1"], channel: ours });
    expect(calls[0]?.params.moderationStatus).toBe("heldForReview");
  });

  it("ไม่ขอปิดกั้นคนเขียน → ไม่ส่งพารามิเตอร์นั้นไปเลย", async () => {
    const { actions, calls } = fake();
    await actions.hide({ commentIds: ["c1"], channel: ours });
    expect(calls[0]?.params).not.toHaveProperty("banAuthor");
  });

  /**
   * Google ปฏิเสธทั้ง call ถ้า `banAuthor` มากับสถานะที่ไม่ใช่ `rejected`
   * — และการโดนปฏิเสธก็เสียโควตา 50 หน่วยไปแล้ว
   *
   * บังคับด้วยชนิดข้อมูล (มีแต่ `hide()` ที่รับพารามิเตอร์นี้) ข้อนี้จึงยืนยัน
   * ว่าเส้นทางอื่นไม่ได้แอบส่งค่านี้ออกไปเอง
   */
  it("เอาการซ่อนออก/พักรอตรวจ → ไม่มีทางส่ง banAuthor ออกไป", async () => {
    const { actions, calls } = fake();
    await actions.unhide({ commentIds: ["c1"], channel: ours });
    await actions.holdForReview({ commentIds: ["c2"], channel: ours });
    for (const c of calls) expect(c.params).not.toHaveProperty("banAuthor");
  });

  it("ปิดกั้นคนเขียนคู่กับการซ่อน → ส่งไปด้วย", async () => {
    const { actions, calls } = fake();
    await actions.hide({ commentIds: ["c1"], banAuthor: true, channel: ours });
    expect(calls[0]?.params.banAuthor).toBe("true");
  });
});

describe("โทเคนและลำดับความสำคัญ", () => {
  it("แนบโทเคน OAuth ไปทุกครั้ง (API key เขียนไม่ได้)", async () => {
    const { actions, calls } = fake();
    await actions.hide({ commentIds: ids(60), channel: ours });
    for (const c of calls) expect(c.accessToken).toBe("tok-123");
  });

  /** คนกดปุ่มนั่งรออยู่ — ห้ามโดนเบรกเพราะระบบกันโควตาไว้ให้งานเบื้องหลัง */
  it("ไม่ใช่งานเบื้องหลัง จึงไม่โดนเบรกด้วยโควตาสำรอง", async () => {
    const { actions, calls } = fake();
    await actions.hide({ commentIds: ["c1"], channel: ours });
    expect(calls[0]?.background).toBe(false);
  });

  it("ขอโทเคนครั้งเดียวต่องาน ไม่ใช่ทุกก้อน", async () => {
    let asked = 0;
    const gateway = {
      async call() {
        return { data: {}, quota: null };
      },
    } as unknown as YouTubeGateway;
    const actions = new YouTubeCommentActions({
      gateway,
      accessToken: async () => {
        asked += 1;
        return "tok";
      },
    });

    await actions.hide({ commentIds: ids(150), channel: ours });
    expect(asked).toBe(1);
  });
});

describe("เจอปัญหากลางทาง", () => {
  it("ก้อนหนึ่งพัง ก้อนอื่นยังทำต่อ", async () => {
    const { actions, calls } = fake((n) =>
      n === 2 ? new YouTubeApiError({ message: "boom", httpStatus: 500 }) : undefined,
    );
    const r = await actions.hide({ commentIds: ids(150), channel: ours });

    expect(calls).toHaveLength(3);
    expect(r.done).toBe(100);
    expect(r.errors).toHaveLength(1);
    expect(r.th).toContain("100/150");
  });

  /** ยิงต่อตอนโควตาหมดคือการเผาโควตาพรุ่งนี้ทิ้ง 50 หน่วยต่อครั้ง */
  it("โควตาหมด → หยุดทันที ไม่ยิงก้อนที่เหลือ", async () => {
    const { actions, calls } = fake((n) => (n === 2 ? quotaError() : undefined));
    const r = await actions.hide({ commentIds: ids(150), channel: ours });

    expect(calls).toHaveLength(2);
    expect(r.done).toBe(50);
    expect(r.th).toContain("โควตาหมด");
    expect(r.th).toContain("แปซิฟิก");
  });

});

describe("ลบถาวร", () => {
  it("ลบทีละ id — API ไม่รับเป็นก้อน", async () => {
    const { actions, calls } = fake();
    const r = await actions.remove({ commentIds: ids(3), channel: ours });

    expect(calls).toHaveLength(3);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls.map((c) => c.params.id)).toEqual(["c0", "c1", "c2"]);
    expect(r.quotaSpent).toBe(150);
  });

  /**
   * ลบ 100 อัน = 5,000 หน่วย = ครึ่งหนึ่งของทั้งวัน และกู้คืนไม่ได้
   * — เพดานนี้กันมือลั่น และบอกทางเลือกที่ถูกกว่าให้ด้วย
   */
  it("เกินเพดาน → ไม่ยิงเลย พร้อมบอกราคาที่จะเสียและทางเลือก", async () => {
    const { actions, calls } = fake();
    const r = await actions.remove({ commentIds: ids(100), channel: ours });

    expect(calls).toEqual([]);
    expect(r.done).toBe(0);
    expect(r.th).toContain("5000");
    expect(r.th).toContain("ซ่อน");
  });

  it("ปรับเพดานได้เมื่อรู้ว่ากำลังทำอะไรอยู่", async () => {
    const { actions, calls } = fake();
    const r = await actions.remove({ commentIds: ids(30), max: 50, channel: ours });

    expect(calls).toHaveLength(30);
    expect(r.done).toBe(30);
  });

  it("โควตาหมดกลางทาง → หยุด ไม่ไล่ลบต่อ", async () => {
    const { actions, calls } = fake((n) => (n === 3 ? quotaError() : undefined));
    const r = await actions.remove({ commentIds: ids(10), channel: ours });

    expect(calls).toHaveLength(3);
    expect(r.done).toBe(2);
    expect(r.th).toContain("โควตาหมด");
  });

  it("ไม่มีอะไรให้ลบ → ไม่ยิงเลย", async () => {
    const { actions, calls } = fake();
    const r = await actions.remove({ commentIds: [], channel: ours });
    expect(calls).toEqual([]);
    expect(r.quotaSpent).toBe(0);
  });
});

/**
 * YouTube ให้จัดการคอมเมนต์ได้เฉพาะช่องที่เราเป็นเจ้าของ — ยิงไปที่ช่องอื่น
 * ได้ 403 กลับมา แต่ **เสียโควตา 50 หน่วยไปแล้ว**
 *
 * กด "ซ่อนทั้งหมด" ผิดช่องสัก 20 ครั้ง = 1,000 หน่วยหายไปโดยไม่มีอะไรเกิดขึ้น
 */
describe("ช่องที่ไม่ใช่ของเรา", () => {
  const theirs = { id: "UCtheirs", owned: false };

  it("ซ่อน → ไม่ยิงเลย ไม่เสียโควตา", async () => {
    const { actions, calls } = fake();
    const r = await actions.hide({ commentIds: ids(50), channel: theirs });

    expect(calls).toEqual([]);
    expect(r.quotaSpent).toBe(0);
    expect(r.done).toBe(0);
    expect(r.th).toContain("UCtheirs");
    expect(r.th).toContain("ไม่เสียโควตา");
  });

  it("เอาการซ่อนออก / พักรอตรวจ / ลบ → ไม่ยิงเหมือนกัน", async () => {
    const { actions, calls } = fake();
    await actions.unhide({ commentIds: ["c1"], channel: theirs });
    await actions.holdForReview({ commentIds: ["c1"], channel: theirs });
    await actions.remove({ commentIds: ["c1"], channel: theirs });

    expect(calls).toEqual([]);
  });

  /** บอกด้วยว่าทำไม ไม่ใช่แค่บอกว่าทำไม่ได้ */
  it("บอกเหตุผลที่เข้าใจได้ ไม่ใช่แค่ปฏิเสธเฉยๆ", async () => {
    const { actions } = fake();
    const r = await actions.hide({ commentIds: ["c1"], channel: theirs });
    expect(r.th).toContain("เจ้าของ");
    expect(r.errors).toHaveLength(1);
  });

  it("ไม่มีคอมเมนต์ให้ทำอยู่แล้ว → ตอบเรื่องนั้นก่อน ไม่ต้องพูดเรื่องสิทธิ์", async () => {
    const { actions } = fake();
    const r = await actions.hide({ commentIds: [], channel: theirs });
    expect(r.th).toContain("ไม่มีคอมเมนต์");
  });
});
