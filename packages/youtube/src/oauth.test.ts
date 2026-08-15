import { FakeClock } from "@page-os/core";
import { describe, expect, it } from "vitest";
import { YouTubeApiError } from "./errors.js";
import { GoogleOAuth, googleOAuthFromEnv, REFRESH_MARGIN_MS } from "./oauth.js";

interface Hit {
  url: string;
  body: string;
}

function fake(
  reply: (n: number) => { status?: number; body: unknown },
  startMs = 1_000_000,
) {
  const hits: Hit[] = [];
  let n = 0;
  const clock = new FakeClock(startMs);
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    n += 1;
    hits.push({ url: String(url), body: String(init?.body ?? "") });
    const r = reply(n);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    } as Response;
  }) as unknown as typeof fetch;

  const oauth = new GoogleOAuth(
    { clientId: "cid", clientSecret: "csecret", refreshToken: "rtok" },
    { clock, fetchImpl },
  );
  return { oauth, hits, clock };
}

const ok = (token: string, expiresIn = 3600) => ({
  body: { access_token: token, expires_in: expiresIn },
});

describe("แลก refresh token เป็น access token", () => {
  it("ส่ง grant_type=refresh_token พร้อมข้อมูลครบ", async () => {
    const { oauth, hits } = fake(() => ok("at-1"));
    expect(await oauth.token()).toBe("at-1");

    const sent = new URLSearchParams(hits[0]?.body ?? "");
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("rtok");
    expect(sent.get("client_id")).toBe("cid");
    expect(sent.get("client_secret")).toBe("csecret");
  });

  /**
   * ถ้าขอใหม่ทุกครั้ง ทุกการกดปุ่มจะช้าขึ้นหนึ่งรอบเน็ตเวิร์กโดยไม่ได้อะไรกลับมา
   */
  it("จำไว้ใช้ซ้ำ ไม่ยิงใหม่ทุกครั้ง", async () => {
    const { oauth, hits } = fake(() => ok("at-1"));
    await oauth.token();
    await oauth.token();
    await oauth.token();
    expect(hits).toHaveLength(1);
  });

  /**
   * เผื่อเวลาไว้ก่อนหมดจริง เพราะนาฬิกาสองฝั่งไม่ตรงกันเป๊ะ และคำขอใช้เวลาเดินทาง
   */
  it("ต่ออายุก่อนหมดจริงตามระยะเผื่อที่ตั้งไว้", async () => {
    const { oauth, hits, clock } = fake((n) => ok(`at-${n}`));
    expect(await oauth.token()).toBe("at-1");

    // ยังไม่ถึงเวลาต่ออายุ (เหลืออีก 1 มิลลิวินาที)
    await clock.advance(3_600_000 - REFRESH_MARGIN_MS - 1);
    expect(await oauth.token()).toBe("at-1");
    expect(hits).toHaveLength(1);

    // ถึงเวลาแล้ว
    await clock.advance(1);
    expect(await oauth.token()).toBe("at-2");
    expect(hits).toHaveLength(2);
  });

  /** ไม่บอกอายุมา = เดาว่ายาวไม่ได้ ต้องถือว่าสั้นไว้ก่อน */
  it("ไม่มี expires_in → ถือว่าอายุสั้น ไม่ใช่ไม่มีวันหมด", async () => {
    const { oauth, hits, clock } = fake(() => ({
      body: { access_token: "at-1" },
    }));
    await oauth.token();

    await clock.advance(600_000);
    await oauth.token();
    expect(hits).toHaveLength(2);
  });

  /**
   * ขอพร้อมกันหลายงานตอนโทเคนหมดพอดี ต้องแลกครั้งเดียว —
   * Google มีเพดานการแลกต่อช่วงเวลาด้วย
   */
  it("ขอพร้อมกันหลายงาน → ยิงแลกครั้งเดียว", async () => {
    const { oauth, hits } = fake(() => ok("at-1"));
    const [a, b, c] = await Promise.all([oauth.token(), oauth.token(), oauth.token()]);

    expect(hits).toHaveLength(1);
    expect([a, b, c]).toEqual(["at-1", "at-1", "at-1"]);
  });

  it("ลืมของที่จำไว้ได้ เมื่อรู้ว่าโทเคนใช้ไม่ได้แล้ว", async () => {
    const { oauth, hits } = fake((n) => ok(`at-${n}`));
    await oauth.token();
    oauth.forget();
    expect(await oauth.token()).toBe("at-2");
    expect(hits).toHaveLength(2);
  });
});

describe("เมื่อแลกไม่สำเร็จ", () => {
  /**
   * `invalid_grant` = refresh token ถูกเพิกถอน — ลองใหม่กี่ครั้งก็ไม่หาย
   * ต้องให้คนไปกดอนุญาตใหม่ จึงต้องแยกออกจาก error ที่ลองใหม่แล้วได้
   */
  it("refresh token ถูกเพิกถอน → บอกให้เชื่อมบัญชีใหม่ ไม่ใช่ให้รอ", async () => {
    const { oauth } = fake(() => ({ status: 400, body: { error: "invalid_grant" } }));

    await expect(oauth.token()).rejects.toThrow(YouTubeApiError);
    try {
      await oauth.token();
    } catch (err) {
      const e = err as YouTubeApiError;
      expect(e.action).toBe("reconnect");
      expect(e.th).toContain("เชื่อมบัญชีใหม่");
      expect(e.retryable).toBe(false);
    }
  });

  it("ต่อเน็ตไม่ได้ → ลองใหม่ได้", async () => {
    const clock = new FakeClock(0);
    const oauth = new GoogleOAuth(
      { clientId: "c", clientSecret: "s", refreshToken: "r" },
      {
        clock,
        fetchImpl: (async () => {
          throw new Error("ECONNREFUSED");
        }) as unknown as typeof fetch,
      },
    );

    try {
      await oauth.token();
      expect.unreachable("ควรโยน error");
    } catch (err) {
      expect((err as YouTubeApiError).retryable).toBe(true);
    }
  });

  it("ตอบ 200 แต่ไม่มีโทเคนมาด้วย → ถือว่าล้มเหลว ไม่ใช่คืนค่าว่าง", async () => {
    const { oauth } = fake(() => ({ body: { expires_in: 3600 } }));
    await expect(oauth.token()).rejects.toThrow(YouTubeApiError);
  });

  /**
   * ⚠️ ข้อนี้สำคัญที่สุดในไฟล์ — client secret กับ refresh token เดินทางอยู่ใน
   * body ของคำขอ ถ้าหลุดเข้าไปในข้อความ error มันจะไปนอนอยู่ใน log
   */
  it("ข้อความ error ต้องไม่มีความลับติดไปด้วย", async () => {
    const { oauth } = fake(() => ({
      status: 400,
      body: { error: "invalid_client", error_description: "bad csecret rtok" },
    }));

    try {
      await oauth.token();
      expect.unreachable("ควรโยน error");
    } catch (err) {
      const e = err as YouTubeApiError;
      const dump = `${e.message} ${e.th} ${JSON.stringify(e.toJSON())}`;
      expect(dump).not.toContain("csecret");
      expect(dump).not.toContain("rtok");
    }
  });
});

describe("สร้างจาก env", () => {
  const full = {
    YOUTUBE_OAUTH_CLIENT_ID: "cid",
    YOUTUBE_OAUTH_CLIENT_SECRET: "csecret",
    YOUTUBE_OAUTH_REFRESH_TOKEN: "rtok",
  };

  it("ครบทั้งสามค่า → ได้ตัวจริง", () => {
    expect(googleOAuthFromEnv(full)).not.toBeNull();
  });

  /** คนที่ยังไม่ต้องซ่อน/ลบคอมเมนต์ ต้องใช้ส่วนที่เหลือได้ตามปกติ */
  it("ขาดค่าใดค่าหนึ่ง → คืน null ไม่ใช่ล้มทั้งระบบ", () => {
    for (const key of Object.keys(full)) {
      expect(googleOAuthFromEnv({ ...full, [key]: "" })).toBeNull();
      expect(googleOAuthFromEnv({ ...full, [key]: undefined })).toBeNull();
    }
  });

  it("ไม่ได้ตั้งอะไรเลย → คืน null", () => {
    expect(googleOAuthFromEnv({})).toBeNull();
  });
});
