import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import { YouTubeApiError } from "./errors.js";
import { YouTubeGateway, resolveApiBase } from "./gateway.js";
import { DEFAULT_DAILY_QUOTA, RESERVED_FOR_INTERACTIVE } from "./quota.js";

const NOW = Date.UTC(2026, 7, 14, 12);

/** จำลอง fetch — เก็บ URL ที่ถูกเรียกไว้ตรวจทีหลัง */
function fakeFetch(
  replies: Array<{ status?: number; body: unknown }>,
): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const impl = (async (url: URL | string) => {
    calls.push(String(url));
    const r = replies[Math.min(i, replies.length - 1)];
    i++;
    return {
      ok: (r?.status ?? 200) < 400,
      status: r?.status ?? 200,
      json: async () => r?.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function build(
  replies: Array<{ status?: number; body: unknown }>,
  over: { dailyQuota?: number; maxAttempts?: number } = {},
) {
  const clock = new FakeClock(NOW);
  const { impl, calls } = fakeFetch(replies);
  const gw = new YouTubeGateway(
    {
      apiKey: "คีย์ลับมาก",
      apiBase: "https://example.test/youtube/v3",
      ...over,
    },
    { clock, fetchImpl: impl, random: () => 0.5 },
  );
  return { gw, calls, clock };
}

describe("ฐานของ API", () => {
  it("ไม่ได้ตั้งค่า → ใช้ของ Google", () => {
    expect(resolveApiBase(undefined)).toBe("https://www.googleapis.com/youtube/v3");
    expect(resolveApiBase("  ")).toBe("https://www.googleapis.com/youtube/v3");
  });

  it("ตัด / ท้ายทิ้ง ไม่งั้นจะได้ // ใน path", () => {
    expect(resolveApiBase("https://x.test/v3/")).toBe("https://x.test/v3");
  });
});

describe("ยิงสำเร็จ", () => {
  it("คืนข้อมูลพร้อมสถานะโควตา", async () => {
    const { gw } = build([{ body: { items: [{ id: "abc" }] } }]);
    const res = await gw.call<{ items: Array<{ id: string }> }>({
      endpoint: "channels.list",
      params: { part: "snippet", id: "UC123" },
    });

    expect(res.data.items[0]?.id).toBe("abc");
    expect(res.quota.used).toBe(1);
  });

  it("แปลงชื่อ endpoint เป็น path ถูก", async () => {
    const { gw, calls } = build([{ body: {} }]);
    await gw.call({ endpoint: "commentThreads.list", params: { part: "snippet" } });
    expect(calls[0]).toContain("/youtube/v3/commentThreads");
  });

  it("พารามิเตอร์ที่เป็น undefined ไม่ถูกส่งไป", async () => {
    const { gw, calls } = build([{ body: {} }]);
    await gw.call({
      endpoint: "channels.list",
      params: { part: "snippet", pageToken: undefined },
    });
    expect(calls[0]).not.toContain("pageToken");
  });
});

describe("การยืนยันตัวตน", () => {
  /**
   * อ่านของสาธารณะใช้ API key — นี่คือทางที่ทำให้ดูช่องคู่แข่งได้
   * โดยไม่ต้องผ่านการรีวิวแอปแบบฝั่ง Facebook
   */
  it("ไม่มีโทเคน → ใส่ API key ไปใน query", async () => {
    const { gw, calls } = build([{ body: {} }]);
    await gw.call({ endpoint: "channels.list", params: { id: "UC1" } });
    expect(calls[0]).toContain("key=");
  });

  /** มีโทเคนแล้วห้ามส่ง key ไปด้วย — Google จะปฏิเสธถ้าส่งทั้งคู่ */
  it("มีโทเคน → ใช้ header อย่างเดียว ไม่ใส่ key ใน URL", async () => {
    const { gw, calls } = build([{ body: {} }]);
    await gw.call({
      endpoint: "channels.list",
      params: { id: "UC1" },
      accessToken: "โทเคนของช่องเรา",
    });
    expect(calls[0]).not.toContain("key=");
  });

  it("โทเคนเป็นสตริงว่าง → ถอยไปใช้ API key", async () => {
    const { gw, calls } = build([{ body: {} }]);
    await gw.call({
      endpoint: "channels.list",
      params: { id: "UC1" },
      accessToken: "",
    });
    expect(calls[0]).toContain("key=");
  });
});

describe("กันความลับหลุด (กฎข้อ 3)", () => {
  /**
   * API key เดินทางมาใน query string ถ้า error เก็บ URL ดิบไว้
   * คีย์จะไปนอนอยู่ในไฟล์ log ให้ใครก็ได้อ่าน
   */
  it("error ที่โยนออกมาไม่มี API key ติดไปด้วย", async () => {
    const { gw } = build([
      { status: 403, body: { error: { message: "denied", errors: [{ reason: "forbidden" }] } } },
    ]);

    const err = await gw
      .call({ endpoint: "channels.list", params: { id: "UC1" } })
      .catch((e: unknown) => e as YouTubeApiError);

    expect(err).toBeInstanceOf(YouTubeApiError);
    const dumped = JSON.stringify((err as YouTubeApiError).toJSON());
    expect(dumped).not.toContain("คีย์ลับมาก");
    expect(dumped).toContain("***");
  });
});

describe("จัดการ error", () => {
  it("โควตาหมด → ไม่ลองใหม่ และบอกว่าต้องรออะไร", async () => {
    const { gw, calls } = build([
      {
        status: 403,
        body: { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
      },
    ]);

    const err = (await gw
      .call({ endpoint: "channels.list", params: {} })
      .catch((e: unknown) => e)) as YouTubeApiError;

    expect(err.action).toBe("wait_quota");
    expect(err.retryable).toBe(false);
    expect(err.th).toContain("แปซิฟิก");
    // ต้องยิงครั้งเดียว ไม่ retry — retry ตอนโควตาหมดคือเผาโควตาวันถัดไป
    expect(calls).toHaveLength(1);
  });

  it("ยิงถี่เกินไป → ลองใหม่จนสำเร็จ", async () => {
    const { gw, calls, clock } = build([
      {
        status: 403,
        body: { error: { message: "slow down", errors: [{ reason: "rateLimitExceeded" }] } },
      },
      { body: { items: [] } },
    ]);

    // FakeClock ไม่เดินเอง — ต้องดันเวลาให้ backoff ครบ ไม่งั้นเทสต์ค้าง
    const res = await clock.runUntilSettled(
      gw.call({ endpoint: "channels.list", params: {} }),
    );
    expect(res.data).toEqual({ items: [] });
    expect(calls).toHaveLength(2);
  });

  /**
   * ปิดคอมเมนต์ไม่ใช่ความผิดพลาดของเรา — เจ้าของช่องตั้งเอง
   * ต้องข้ามไปเงียบๆ ไม่ใช่ขึ้นเป็นปัญหาให้คนดูแลตกใจ
   */
  it("วิดีโอปิดคอมเมนต์ → บอกให้ข้าม ไม่ใช่ให้แก้", async () => {
    const { gw } = build([
      {
        status: 403,
        body: { error: { message: "off", errors: [{ reason: "commentsDisabled" }] } },
      },
    ]);

    const err = (await gw
      .call({ endpoint: "commentThreads.list", params: {} })
      .catch((e: unknown) => e)) as YouTubeApiError;

    expect(err.action).toBe("skip");
    expect(err.retryable).toBe(false);
  });

  it("โทเคนหมดอายุ → บอกให้ไปเชื่อมใหม่", async () => {
    const { gw } = build([{ status: 401, body: { error: { message: "expired" } } }]);
    const err = (await gw
      .call({ endpoint: "channels.list", params: {}, accessToken: "เก่า" })
      .catch((e: unknown) => e)) as YouTubeApiError;

    expect(err.action).toBe("reconnect");
  });

  /**
   * ⚠️ ต้องผูก `.catch()` ไว้**ก่อน**ดันเวลา
   *
   * `runUntilSettled` ปล่อยให้ promise ล้มเหลวระหว่างที่ยังวนดันเวลาอยู่
   * ถ้ายังไม่มีใครรับ rejection ตอนนั้น Node จะรายงานเป็น unhandled rejection
   * ซึ่ง vitest นับเป็น error แล้วคืน exit code 1 ทั้งที่ทุกข้อผ่าน
   * — เทสต์เขียว แต่ `pnpm check` แดง ซึ่งหาสาเหตุยากมาก
   */
  it("เลิกลองหลังครบจำนวนครั้งที่กำหนด", async () => {
    const { gw, calls, clock } = build(
      [{ status: 503, body: { error: { message: "down" } } }],
      { maxAttempts: 3 },
    );
    const pending = gw
      .call({ endpoint: "channels.list", params: {} })
      .catch((e: unknown) => e);

    await clock.runUntilSettled(pending);
    expect(await pending).toBeInstanceOf(YouTubeApiError);
    expect(calls).toHaveLength(3);
  });

  /** Google ตอบ 200 พร้อมก้อน error ได้ — ถ้าดูแต่ status จะนึกว่าสำเร็จ */
  it("HTTP 200 แต่มีก้อน error → ยังนับเป็นล้มเหลว", async () => {
    const { gw } = build([
      { status: 200, body: { error: { message: "พัง", errors: [{ reason: "forbidden" }] } } },
    ]);
    await expect(gw.call({ endpoint: "channels.list", params: {} })).rejects.toThrow(
      YouTubeApiError,
    );
  });
});

describe("การนับโควตา", () => {
  /**
   * Google หักโควตาตั้งแต่รับคำขอ ไม่ว่าจะตอบสำเร็จหรือ error
   * ถ้าเรานับเฉพาะตอนสำเร็จ ตัวเลขจะต่ำกว่าจริงแล้วเดินชนเพดานโดยไม่รู้ตัว
   */
  it("นับโควตาแม้ call จะล้มเหลว", async () => {
    const { gw } = build([
      { status: 403, body: { error: { message: "x", errors: [{ reason: "forbidden" }] } } },
    ]);
    await gw.call({ endpoint: "channels.list", params: {} }).catch(() => undefined);
    expect(gw.quotaSnapshot().used).toBe(1);
  });

  it("ลองใหม่แต่ละครั้งกินโควตาเพิ่ม", async () => {
    const { gw, clock } = build(
      [{ status: 503, body: { error: { message: "down" } } }],
      { maxAttempts: 3 },
    );
    const pending = gw
      .call({ endpoint: "channels.list", params: {} })
      .catch(() => undefined);

    await clock.runUntilSettled(pending);
    expect(gw.quotaSnapshot().used).toBe(3);
  });

  /**
   * เบรกตัวเอง**ก่อน**ยิง — call ที่โดนปฏิเสธเพราะโควตาหมดยังกินโควตา
   * การปล่อยให้ยิงไปโดนปฏิเสธคือการเผาโควตาทิ้งเปล่าๆ
   */
  it("โควตาหมดแล้ว → ไม่ยิงออกไปเลยสักครั้ง", async () => {
    // `background: false` ทั้งคู่ เพราะเพดานเล็กกว่าส่วนที่กันไว้ให้งานที่คนรอ
    const { gw, calls } = build([{ body: {} }], { dailyQuota: 1 });
    await gw.call({ endpoint: "channels.list", params: {}, background: false });
    expect(calls).toHaveLength(1);

    const err = (await gw
      .call({ endpoint: "channels.list", params: {}, background: false })
      .catch((e: unknown) => e)) as YouTubeApiError;

    expect(err.action).toBe("wait_quota");
    expect(calls).toHaveLength(1); // ไม่มีการยิงเพิ่ม
  });

  /**
   * ผลข้างเคียงของการกันโควตาไว้ให้งานที่คนรอ: ถ้าเพดานรวมเล็กกว่าส่วนที่กันไว้
   * งานเบื้องหลังจะไม่ได้รันเลยสักครั้ง
   *
   * ตั้งใจให้เป็นแบบนี้ — โควตาน้อยขนาดนั้นควรสงวนไว้ให้คนที่นั่งรอหน้าจอ
   * แต่ต้องมีเทสต์บอกไว้ ไม่งั้นวันหนึ่งจะมีคนงงว่าทำไม cron ไม่ทำงาน
   */
  it("เพดานเล็กกว่าส่วนที่กันไว้ → งานเบื้องหลังไม่รันเลย", async () => {
    const { gw, calls } = build([{ body: {} }], {
      dailyQuota: RESERVED_FOR_INTERACTIVE - 1,
    });
    const err = (await gw
      .call({ endpoint: "channels.list", params: {}, background: true })
      .catch((e: unknown) => e)) as YouTubeApiError;

    expect(err.action).toBe("wait_quota");
    expect(calls).toHaveLength(0);
  });

  /**
   * ตั้งเพดานให้เหลือช่องว่างน้อยกว่าที่กันไว้ให้งานที่คนรอ — งานเบื้องหลัง
   * จึงต้องโดนเบรกตั้งแต่ call แรก ส่วนงานที่คนกดเองยังผ่าน
   */
  it("โควตาใกล้หมด → งานเบื้องหลังหยุด แต่งานที่คนกดเองยังไปต่อได้", async () => {
    const { gw, calls } = build([{ body: {} }], {
      dailyQuota: RESERVED_FOR_INTERACTIVE,
    });

    const err = (await gw
      .call({ endpoint: "channels.list", params: {}, background: true })
      .catch((e: unknown) => e)) as YouTubeApiError;
    expect(err.action).toBe("wait_quota");
    expect(calls).toHaveLength(0);

    await gw.call({ endpoint: "channels.list", params: {}, background: false });
    expect(calls).toHaveLength(1);
  });
});
