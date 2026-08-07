import { describe, expect, it } from "vitest";
import { MetaApiError } from "./errors.js";
import {
  DEFAULT_GRAPH_VERSION,
  MetaGateway,
  normalizePath,
  resolveGraphVersion,
} from "./gateway.js";
import {
  FakeTokenStore,
  catchMetaError,
  graphError,
  makeGateway,
} from "./test-helpers.js";

const PAGE_TOKEN = "PAGETOKEN_p1";

describe("resolveGraphVersion — กฎข้อ 2", () => {
  it("อ่านจาก env", () => {
    expect(resolveGraphVersion({ GRAPH_VERSION: "v26.0" })).toBe("v26.0");
  });

  it("ไม่ตั้งค่า → ใช้ค่าเริ่มต้นตามสเปก (v25.0)", () => {
    expect(resolveGraphVersion({})).toBe(DEFAULT_GRAPH_VERSION);
    expect(DEFAULT_GRAPH_VERSION).toBe("v25.0");
  });

  it("รูปแบบผิด → โยน error ทันทีตอนบูต ไม่ปล่อยให้พังตอน runtime", () => {
    expect(() => resolveGraphVersion({ GRAPH_VERSION: "25" })).toThrow(
      /GRAPH_VERSION/,
    );
    expect(() => resolveGraphVersion({ GRAPH_VERSION: "latest" })).toThrow();
    expect(() => resolveGraphVersion({ GRAPH_VERSION: "v25" })).toThrow();
  });

  it("ตัดช่องว่างหัวท้ายให้", () => {
    expect(resolveGraphVersion({ GRAPH_VERSION: " v24.0 " })).toBe("v24.0");
  });
});

describe("normalizePath", () => {
  it("ตัด / นำหน้าออก", () => {
    expect(normalizePath("/me/feed")).toBe("me/feed");
    expect(normalizePath("me/feed")).toBe("me/feed");
  });

  it("ห้ามใส่ host เต็ม (กันยิงไปเซิร์ฟเวอร์อื่น)", () => {
    expect(() => normalizePath("https://evil.example/x")).toThrow(/relative/);
    expect(() => normalizePath("//evil.example/x")).toThrow(/relative/);
  });

  it("ห้ามใส่เวอร์ชันใน path — gateway ใส่ให้เอง (กฎข้อ 2)", () => {
    expect(() => normalizePath("v25.0/me/feed")).toThrow(/GRAPH_VERSION/);
    expect(() => normalizePath("/v19.0/me")).toThrow(/GRAPH_VERSION/);
  });

  it("path ว่างไม่ได้", () => {
    expect(() => normalizePath("  ")).toThrow();
  });
});

describe("MetaGateway — พื้นฐาน", () => {
  it("ต้องมี appId และ appSecret", () => {
    const deps = { tokenStore: new FakeTokenStore() };
    expect(() => new MetaGateway({ appId: "", appSecret: "s" }, deps)).toThrow();
    expect(() => new MetaGateway({ appId: "a", appSecret: "" }, deps)).toThrow();
  });

  it("ใส่ GRAPH_VERSION ลงใน URL ให้อัตโนมัติ (สเปกข้อ 5.2)", async () => {
    const { gateway, fetch } = makeGateway();
    await gateway.call({ pageId: "p1", path: "me/feed" });
    expect(fetch.lastCall!.url).toContain("/v25.0/me/feed");
  });

  it("ดึง token จาก store แล้วส่งใน header ไม่ใช่ URL (กัน token โผล่ใน log/proxy)", async () => {
    const { gateway, fetch } = makeGateway();
    await gateway.call({ pageId: "p1", path: "me" });
    const call = fetch.lastCall!;
    expect(call.headers["authorization"]).toBe(`Bearer ${PAGE_TOKEN}`);
    expect(call.url).not.toContain(PAGE_TOKEN);
    expect(call.url).not.toContain("access_token");
  });

  it("ส่ง appsecret_proof ที่คำนวณจาก token", async () => {
    const { gateway, fetch } = makeGateway();
    await gateway.call({ pageId: "p1", path: "me" });
    const proof = new URL(fetch.lastCall!.url).searchParams.get(
      "appsecret_proof",
    );
    expect(proof).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ปิด appsecret_proof ได้", async () => {
    const { gateway, fetch } = makeGateway({
      config: { useAppSecretProof: false },
    });
    await gateway.call({ pageId: "p1", path: "me" });
    expect(fetch.lastCall!.url).not.toContain("appsecret_proof");
  });

  it("GET ใส่ params ใน query, POST ใส่ใน body", async () => {
    const { gateway, fetch } = makeGateway();

    await gateway.call({ pageId: "p1", path: "me", params: { fields: "id,name" } });
    expect(new URL(fetch.lastCall!.url).searchParams.get("fields")).toBe("id,name");

    await gateway.call({
      pageId: "p1",
      method: "POST",
      path: "p1/feed",
      params: { message: "สวัสดีครับ" },
    });
    const last = fetch.lastCall!;
    expect(last.method).toBe("POST");
    expect(new URLSearchParams(last.body!).get("message")).toBe("สวัสดีครับ");
    expect(last.url).not.toContain("message");
  });

  it("params ที่เป็น object ถูก JSON.stringify ให้", async () => {
    const { gateway, fetch } = makeGateway();
    await gateway.call({
      pageId: "p1",
      method: "POST",
      path: "p1/messages",
      params: { message: { text: "hi" } },
    });
    expect(new URLSearchParams(fetch.lastCall!.body!).get("message")).toBe(
      '{"text":"hi"}',
    );
  });

  it("ข้าม params ที่เป็น null / undefined", async () => {
    const { gateway, fetch } = makeGateway();
    await gateway.call({
      pageId: "p1",
      path: "me",
      params: { a: "1", b: null, c: undefined },
    });
    const q = new URL(fetch.lastCall!.url).searchParams;
    expect(q.get("a")).toBe("1");
    expect(q.has("b")).toBe(false);
    expect(q.has("c")).toBe(false);
  });

  it("คืนข้อมูลที่ Meta ตอบกลับมา", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.push({ json: { id: "123", name: "ร้านกาแฟ" } });
    const res = await gateway.call<{ id: string; name: string }>({
      pageId: "p1",
      path: "me",
    });
    expect(res.data.name).toBe("ร้านกาแฟ");
    expect(res.httpStatus).toBe(200);
    expect(res.attempts).toBe(1);
  });

  it("pageId=null ใช้ app access token", async () => {
    const { gateway, fetch } = makeGateway();
    await gateway.call({ pageId: null, path: "debug_token" });
    expect(fetch.lastCall!.headers["authorization"]).toBe(
      "Bearer APP123|APPSECRET",
    );
  });

  it("override accessToken ได้ (ใช้ตอน OAuth ที่ยังไม่มี token ใน store)", async () => {
    const { gateway, fetch } = makeGateway();
    await gateway.call({
      pageId: null,
      path: "me/accounts",
      accessToken: "USERTOKEN",
    });
    expect(fetch.lastCall!.headers["authorization"]).toBe("Bearer USERTOKEN");
  });

  it("ไม่มี token ในระบบ → error 190 พร้อมบอกให้เชื่อมเพจใหม่", async () => {
    const { gateway } = makeGateway();
    await expect(gateway.call({ pageId: "ไม่มีเพจนี้", path: "me" })).rejects.toMatchObject(
      { code: 190, action: "reconnect" },
    );
  });
});

describe("MetaGateway — กันโมดูลอื่นแอบจัดการ token เอง (สเปกข้อ 5.1)", () => {
  it("ห้ามส่ง access_token / appsecret_proof / client_secret มาใน params", async () => {
    const { gateway } = makeGateway();
    for (const key of ["access_token", "ACCESS_TOKEN", "appsecret_proof", "client_secret"]) {
      await expect(
        gateway.call({ pageId: "p1", path: "me", params: { [key]: "x" } }),
      ).rejects.toThrow(/gateway จัดการ token ให้เอง/);
    }
  });

  it("ห้ามยิงไป host อื่น", async () => {
    const { gateway } = makeGateway();
    await expect(
      gateway.call({ pageId: "p1", path: "https://evil.example/steal" }),
    ).rejects.toThrow(/relative/);
  });
});

describe("MetaGateway — error mapping (สเปกข้อ 5.6)", () => {
  it("error 190 → MetaApiError พร้อมข้อความไทย และ mark token ว่าใช้ไม่ได้", async () => {
    const { gateway, fetch, tokens } = makeGateway();
    fetch.push({ status: 400, json: graphError(190, "Invalid OAuth token") });

    const err = await catchMetaError(gateway.call({ pageId: "p1", path: "me" }));

    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.code).toBe(190);
    expect(err.action).toBe("reconnect");
    expect(err.th).toContain("เชื่อมเพจใหม่");
    expect(err.fbtraceId).toBe("TRACE123");
    expect(tokens.invalidated).toEqual([
      { pageId: "p1", reason: expect.stringContaining("เชื่อมเพจใหม่") },
    ]);
  });

  it("error 200 (ขาดสิทธิ์) ไม่ retry และไม่ mark token", async () => {
    const { gateway, fetch, tokens } = makeGateway();
    fetch.setFallback({ status: 403, json: graphError(200, "Permissions error") });

    const err = await catchMetaError(
      gateway.call({ pageId: "p1", path: "p1/feed", method: "POST" }),
    );

    expect(err.action).toBe("permission");
    expect(fetch.callCount).toBe(1);
    expect(tokens.invalidated).toEqual([]);
  });

  it("legacy message tag ที่ปลดระวาง → action=deprecated", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.push({
      status: 400,
      json: graphError(100, "(#100) Invalid tag: CONFIRMED_EVENT_UPDATE"),
    });
    const err = await catchMetaError(
      gateway.call({ pageId: "p1", path: "p1/messages", method: "POST" }),
    );
    expect(err.action).toBe("deprecated");
    expect(err.th).toContain("Utility Template");
  });

  it("HTTP 200 แต่ body มี error → ถือว่าล้มเหลว", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.push({ status: 200, json: graphError(100, "bad param") });
    await expect(gateway.call({ pageId: "p1", path: "me" })).rejects.toBeInstanceOf(
      MetaApiError,
    );
  });

  it("body ที่ไม่ใช่ JSON ไม่ทำให้ระบบพัง", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.push({ status: 200, text: "<html>ไม่ใช่ json</html>" });
    const res = await gateway.call<{ raw: string }>({ pageId: "p1", path: "me" });
    expect(res.data.raw).toContain("ไม่ใช่ json");
  });

  it("เน็ตหลุด → MetaTransportError ที่ retry ได้", async () => {
    const { gateway, fetch, clock } = makeGateway();
    fetch.setFallback({ throws: new TypeError("fetch failed") });
    const p = catchMetaError(gateway.call({ pageId: "p1", path: "me" }));
    await clock.advance(300_000);
    const err = await p;
    expect(err.th).toMatch(/ต่อ Facebook ไม่ได้|ไม่คาดคิด/);
    expect(fetch.callCount).toBe(4); // retry ครบตาม maxAttempts
  });

  it("error ที่โยนออกมาบอกจำนวนครั้งที่ลอง และ path", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.push({ status: 400, json: graphError(100) });
    const err = await catchMetaError(
      gateway.call({ pageId: "p1", path: "me/feed" }),
    );
    expect(err.attempts).toBe(1);
    expect(err.path).toBe("me/feed");
    expect(err.pageId).toBe("p1");
  });
});

describe("MetaGateway — retry + backoff (สเปกข้อ 5.5)", () => {
  it("retry เฉพาะ error 4 / 32 / 80001 / 5xx", async () => {
    for (const code of [4, 32, 80001]) {
      const { gateway, fetch, clock } = makeGateway();
      fetch.push({ status: 400, json: graphError(code) });
      fetch.push({ status: 200, json: { ok: true } });

      const p = gateway.call({ pageId: "p1", path: "me" });
      await clock.advance(120_000);
      const res = await p;

      expect(res.attempts, `code ${code}`).toBe(2);
      expect(fetch.callCount, `code ${code}`).toBe(2);
    }
  });

  it("retry เมื่อเจอ HTTP 500 / 503", async () => {
    for (const status of [500, 502, 503]) {
      const { gateway, fetch, clock } = makeGateway();
      fetch.push({ status, text: "" });
      fetch.push({ status: 200, json: { ok: true } });
      const p = gateway.call({ pageId: "p1", path: "me" });
      await clock.advance(120_000);
      expect((await p).attempts, `status ${status}`).toBe(2);
    }
  });

  it("ไม่ retry error ที่แก้ด้วยการยิงซ้ำไม่ได้ (100, 190, 200)", async () => {
    for (const code of [100, 190, 200]) {
      const { gateway, fetch } = makeGateway();
      fetch.setFallback({ status: 400, json: graphError(code) });
      await expect(
        gateway.call({ pageId: "p1", path: "me" }),
      ).rejects.toBeInstanceOf(MetaApiError);
      expect(fetch.callCount, `code ${code}`).toBe(1);
    }
  });

  it("หยุดที่ maxAttempts แล้วโยน error ที่มี attempts ถูกต้อง", async () => {
    const { gateway, fetch, clock } = makeGateway({
      config: { retry: { maxAttempts: 3 } },
    });
    fetch.setFallback({ status: 500, text: "" });

    const p = catchMetaError(gateway.call({ pageId: "p1", path: "me" }));
    await clock.advance(300_000);
    const err = await p;

    expect(fetch.callCount).toBe(3);
    expect(err.attempts).toBe(3);
  });

  it("backoff เพิ่มขึ้นแบบ exponential", async () => {
    const { gateway, fetch, clock } = makeGateway({
      config: {
        retry: { maxAttempts: 4, baseDelayMs: 1000, factor: 2, jitterMs: 0 },
      },
    });
    fetch.setFallback({ status: 500, text: "" });

    const stamps: number[] = [];
    const origFetch = fetch.fn;
    const p = gateway
      .call({ pageId: "p1", path: "me" })
      .catch(() => undefined);

    // เก็บเวลาที่ยิงแต่ละครั้งโดยดูจากจำนวน call ที่เพิ่มขึ้นระหว่าง advance
    let seen = 0;
    for (let t = 0; t <= 30_000; t += 250) {
      if (fetch.callCount > seen) {
        seen = fetch.callCount;
        stamps.push(clock.now());
      }
      await clock.advance(250);
    }
    await p;
    void origFetch;

    expect(stamps.length).toBeGreaterThanOrEqual(4);
    const gap1 = stamps[1]! - stamps[0]!;
    const gap2 = stamps[2]! - stamps[1]!;
    const gap3 = stamps[3]! - stamps[2]!;
    expect(gap2).toBeGreaterThan(gap1);
    expect(gap3).toBeGreaterThan(gap2);
  });

  it("noRetry ปิด retry ได้ (ใช้กับงานที่ห้ามทำซ้ำ)", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.setFallback({ status: 500, text: "" });
    await expect(
      gateway.call({ pageId: "p1", path: "me", noRetry: true }),
    ).rejects.toBeInstanceOf(MetaApiError);
    expect(fetch.callCount).toBe(1);
  });
});

describe("MetaGateway — โควตา (สเปกข้อ 5.3, 5.4)", () => {
  it("อ่าน X-App-Usage แล้วรายงานกลับมา", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.push({
      json: { ok: true },
      headers: {
        "x-app-usage": '{"call_count":85,"total_time":10,"total_cputime":10}',
      },
    });
    const res = await gateway.call({ pageId: "p1", path: "me" });
    expect(res.appUsagePct).toBe(85);
    expect(gateway.governor.isNearLimit("app")).toBe(true);
  });

  it("โควตาเกิน 80% → call ถัดไปถูกหน่วง", async () => {
    const { gateway, fetch, clock } = makeGateway();
    fetch.push({
      json: { ok: true },
      headers: {
        "x-app-usage": '{"call_count":92,"total_time":0,"total_cputime":0}',
      },
    });
    await gateway.call({ pageId: "p1", path: "me" });

    let done = false;
    const p = gateway.call({ pageId: "p1", path: "me" }).then(() => {
      done = true;
    });
    await clock.advance(100);
    expect(done).toBe(false); // ถูกหน่วงอยู่
    await clock.advance(30_000);
    await p;
    expect(done).toBe(true);
  });

  it("อ่าน X-Page-Usage แยกตามเพจ", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.push({
      json: { ok: true },
      headers: {
        "x-page-usage": '{"call_count":95,"total_time":0,"total_cputime":0}',
      },
    });
    const res = await gateway.call({ pageId: "p1", path: "me" });
    expect(res.pageUsagePct).toBe(95);
    expect(gateway.governor.isNearLimit("p1")).toBe(true);
    expect(gateway.governor.isNearLimit("app")).toBe(false);
  });

  it("token bucket จำกัดอัตราการยิงต่อเพจ", async () => {
    const { gateway, fetch, clock } = makeGateway({
      config: { rateLimit: { burst: 2, refillPerSec: 1 } },
    });

    const ps = [1, 2, 3, 4].map(() =>
      gateway.call({ pageId: "p1", path: "me" }),
    );
    await clock.advance(0);
    expect(fetch.callCount).toBe(2); // ยิงรัวได้แค่ขนาดถัง

    await clock.advance(1000);
    expect(fetch.callCount).toBe(3);

    await clock.advance(5000);
    await Promise.all(ps);
    expect(fetch.callCount).toBe(4);
  });

  it("แต่ละเพจมีถังของตัวเอง ไม่แย่งกัน", async () => {
    const tokens = new FakeTokenStore({ p1: "T1", p2: "T2" });
    const { gateway, fetch, clock } = makeGateway({
      tokens,
      config: { rateLimit: { burst: 1, refillPerSec: 1 } },
    });

    const ps = [
      gateway.call({ pageId: "p1", path: "me" }),
      gateway.call({ pageId: "p2", path: "me" }),
    ];
    await clock.advance(0);
    expect(fetch.callCount).toBe(2); // ทั้งสองเพจยิงได้พร้อมกัน
    await Promise.all(ps);
  });

  it("retry ต้องขอคิวใหม่ ไม่ข้าม rate limit", async () => {
    const { gateway, fetch, clock } = makeGateway({
      config: {
        rateLimit: { burst: 1, refillPerSec: 1 },
        retry: { maxAttempts: 2, baseDelayMs: 0, jitterMs: 0 },
      },
    });
    fetch.push({ status: 500, text: "" });
    fetch.push({ status: 200, json: { ok: true } });

    const p = gateway.call({ pageId: "p1", path: "me" });
    await clock.advance(0);
    expect(fetch.callCount).toBe(1);
    // ถังหมดแล้ว รอบสองต้องรอเติม token ก่อน
    await clock.advance(500);
    expect(fetch.callCount).toBe(1);
    await clock.advance(5000);
    await p;
    expect(fetch.callCount).toBe(2);
  });

  it("เคารพ estimated_time_to_regain_access", async () => {
    const { gateway, fetch, clock } = makeGateway();
    fetch.push({
      json: { ok: true },
      headers: {
        "x-business-use-case-usage": JSON.stringify({
          biz1: [
            {
              call_count: 100,
              total_time: 100,
              total_cputime: 100,
              estimated_time_to_regain_access: 60,
            },
          ],
        }),
      },
    });
    await gateway.call({ pageId: "p1", path: "me" });
    expect(gateway.governor.delayFor("p1")).toBe(60_000);
  });
});

describe("MetaGateway — priority", () => {
  it("งานตอบ inbox แซงงาน bulk ได้", async () => {
    const { gateway, fetch, clock } = makeGateway({
      config: { rateLimit: { burst: 1, refillPerSec: 1 } },
    });

    // ใช้ token ตัวสุดท้ายไปก่อน เพื่อบังคับให้ที่เหลือเข้าคิว
    await gateway.call({ pageId: "p1", path: "warmup" });

    const order: string[] = [];
    const ps = [
      gateway
        .call({ pageId: "p1", path: "bulk-a", priority: "bulk" })
        .then(() => order.push("bulk-a")),
      gateway
        .call({ pageId: "p1", path: "bulk-b", priority: "bulk" })
        .then(() => order.push("bulk-b")),
      gateway
        .call({ pageId: "p1", path: "inbox", priority: "realtime" })
        .then(() => order.push("inbox")),
    ];

    await clock.advance(20_000);
    await Promise.all(ps);
    expect(order[0]).toBe("inbox");
  });
});

describe("MetaGateway — call log (สเปกข้อ 5.7)", () => {
  it("บันทึกทุก call ที่สำเร็จ", async () => {
    const { gateway, fetch, callLog } = makeGateway();
    fetch.push({
      json: { ok: true },
      headers: { "x-app-usage": '{"call_count":10,"total_time":1,"total_cputime":1}' },
    });
    await gateway.call({ pageId: "p1", path: "me/feed", method: "POST", priority: "high" });

    expect(callLog.entries).toHaveLength(1);
    const e = callLog.entries[0]!;
    expect(e.ok).toBe(true);
    expect(e.pageId).toBe("p1");
    expect(e.path).toBe("me/feed");
    expect(e.method).toBe("POST");
    expect(e.priority).toBe("high");
    expect(e.appUsagePct).toBe(10);
    expect(e.attempts).toBe(1);
  });

  it("บันทึก call ที่ล้มเหลวพร้อมข้อความไทย", async () => {
    const { gateway, fetch, callLog } = makeGateway();
    fetch.push({ status: 400, json: graphError(190, "Invalid OAuth token") });
    await gateway.call({ pageId: "p1", path: "me" }).catch(() => undefined);

    const e = callLog.entries[0]!;
    expect(e.ok).toBe(false);
    expect(e.errorCode).toBe(190);
    expect(e.errorTh).toContain("เชื่อมเพจใหม่");
    expect(e.fbtraceId).toBe("TRACE123");
  });

  it("บันทึกครั้งเดียวต่อ call แม้จะ retry หลายรอบ และนับ attempts ถูก", async () => {
    const { gateway, fetch, clock, callLog } = makeGateway();
    fetch.push({ status: 500, text: "" });
    fetch.push({ status: 500, text: "" });
    fetch.push({ status: 200, json: { ok: true } });

    const p = gateway.call({ pageId: "p1", path: "me" });
    await clock.advance(300_000);
    await p;

    expect(callLog.entries).toHaveLength(1);
    expect(callLog.entries[0]!.attempts).toBe(3);
    expect(callLog.entries[0]!.ok).toBe(true);
  });

  it("log ไม่มี token ปนอยู่เลย", async () => {
    const { gateway, fetch, callLog } = makeGateway();
    fetch.push({ status: 400, json: graphError(190, `token ${PAGE_TOKEN} ใช้ไม่ได้`) });
    await gateway.call({ pageId: "p1", path: "me" }).catch(() => undefined);
    // path ที่บันทึกต้องเป็น path ล้วน ไม่ใช่ URL ที่มี query พก secret
    expect(callLog.entries[0]!.path).toBe("me");
    expect(JSON.stringify(callLog.entries[0]!)).not.toContain("appsecret_proof");
  });

  it("call log ที่พังต้องไม่ทำให้ call หลักพัง และห้ามทำให้ยิงซ้ำ", async () => {
    // ถ้า record() ที่ throw หลุดเข้า catch ของ retry loop ระบบจะยิงซ้ำทั้ง call
    // แปลว่า DB สะดุดหลังโพสต์สำเร็จ = โพสต์ขึ้นเพจซ้ำ ซึ่งรับไม่ได้
    let fetchCount = 0;
    const broken = new MetaGateway(
      { appId: "a", appSecret: "b", graphVersion: "v25.0" },
      {
        tokenStore: new FakeTokenStore(),
        callLog: {
          record: () => {
            throw new Error("DB ล่ม");
          },
        },
        fetchImpl: async () => {
          fetchCount++;
          return new Response(JSON.stringify({ id: "post_1" }), {
            headers: { "content-type": "application/json" },
          });
        },
      },
    );

    const res = await broken.call<{ id: string }>({
      pageId: "p1",
      method: "POST",
      path: "p1/feed",
    });
    expect(res.data.id).toBe("post_1");
    expect(fetchCount).toBe(1);
  });
});

describe("MetaGateway — ยกเลิกงาน", () => {
  it("AbortSignal ยกเลิกงานที่รออยู่ในคิวได้", async () => {
    const { gateway, clock } = makeGateway({
      config: { rateLimit: { burst: 1, refillPerSec: 0.001 } },
    });
    await gateway.call({ pageId: "p1", path: "warmup" });

    const ctl = new AbortController();
    const p = gateway.call({ pageId: "p1", path: "me", signal: ctl.signal });
    await clock.advance(0);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("MetaGateway — stats สำหรับหน้า Ops", () => {
  it("รายงานเวอร์ชัน คิว และโควตา", async () => {
    const { gateway, fetch } = makeGateway();
    fetch.push({
      json: { ok: true },
      headers: { "x-app-usage": '{"call_count":50,"total_time":0,"total_cputime":0}' },
    });
    await gateway.call({ pageId: "p1", path: "me" });

    const s = gateway.stats();
    expect(s.graphVersion).toBe("v25.0");
    expect(s.lanes.map((l) => l.scope)).toContain("p1");
    expect(s.usage["app"]!.peakPct).toBe(50);
  });
});
