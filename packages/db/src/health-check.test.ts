import { describe, expect, it } from "vitest";
import { FakeClock, Keyring, nullLogger } from "@page-os/core";
import { REQUIRED_PERMISSIONS, TokenService } from "@page-os/meta";
import {
  EncryptedTokenStore,
  InMemoryPageTokenRepository,
} from "./token-store.js";
import {
  STATE_LABEL_TH,
  STATE_TONE,
  TokenHealthChecker,
  type AlertSink,
} from "./health-check.js";
import {
  FakeFetch,
  FakeTokenStore,
  graphError,
} from "@page-os/meta/test-helpers";
import { MetaGateway } from "@page-os/meta";

const ring = new Keyring([{ keyId: "k1", key: Buffer.alloc(32, 3) }]);
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

class RecordingAlerts implements AlertSink {
  readonly sent: Array<{ severity: string; title: string; body: string }> = [];
  async send(a: {
    severity: "warn" | "critical";
    title: string;
    body: string;
  }): Promise<void> {
    this.sent.push(a);
  }
}

function setup() {
  const repo = new InMemoryPageTokenRepository();
  const clock = new FakeClock(NOW);
  const store = new EncryptedTokenStore({ repo, keyring: ring, clock });
  const fetchImpl = new FakeFetch();
  const gateway = new MetaGateway(
    {
      appId: "APP",
      appSecret: "SECRET",
      graphVersion: "v25.0",
      rateLimit: { burst: 1000, refillPerSec: 1000 },
    },
    {
      tokenStore: new FakeTokenStore({}),
      clock,
      fetchImpl: fetchImpl.fn,
      random: () => 0,
    },
  );
  const svc = new TokenService(
    gateway,
    { appId: "APP", redirectUri: "https://x/cb" },
    nullLogger,
    () => clock.now(),
  );
  const alerts = new RecordingAlerts();
  const checker = new TokenHealthChecker({
    store,
    tokenService: svc,
    alerts,
    clock,
  });
  return { repo, store, clock, fetch: fetchImpl, checker, alerts };
}

function debugBody(over: Record<string, unknown> = {}): unknown {
  return {
    data: {
      app_id: "APP",
      type: "PAGE",
      application: "PAGE OS",
      expires_at: Math.floor((NOW + 60 * DAY) / 1000),
      is_valid: true,
      scopes: [...REQUIRED_PERMISSIONS],
      ...over,
    },
  };
}

describe("TokenHealthChecker — cron ทุก 6 ชม.", () => {
  it("ตรวจทุกเพจ อัปเดตสถานะ และไม่แจ้งเตือนเมื่อทุกอย่างปกติ", async () => {
    const { store, repo, fetch, checker, alerts } = setup();
    await store.save({
      pageId: "p1",
      accessToken: "T1",
      tokenType: "page",
      scopes: [],
    });
    await store.save({
      pageId: "p2",
      accessToken: "T2",
      tokenType: "page",
      scopes: [],
    });
    fetch.setFallback({ json: debugBody() });

    const res = await checker.runAll();

    expect(res.checked).toBe(2);
    expect(res.alerts).toBe(0);
    expect(res.failed).toEqual([]);
    expect(repo.raw("p1")!.status).toBe("active");
    expect(repo.raw("p1")!.lastCheckedAtMs).toBe(NOW);
    expect(alerts.sent).toHaveLength(0);
  });

  it("token ถูกเพิกถอน → สถานะ revoked + alert ระดับ critical", async () => {
    const { store, repo, fetch, checker, alerts } = setup();
    await store.save({
      pageId: "p1",
      accessToken: "T1",
      tokenType: "page",
      scopes: [],
    });
    fetch.setFallback({
      json: debugBody({
        is_valid: false,
        error: { message: "Password changed" },
      }),
    });

    const res = await checker.runAll();

    expect(res.alerts).toBe(1);
    expect(repo.raw("p1")!.status).toBe("revoked");
    expect(alerts.sent[0]!.severity).toBe("critical");
    expect(alerts.sent[0]!.body).toContain("เชื่อมเพจใหม่");
  });

  it("ใกล้หมดอายุ → alert ระดับ warn (ยังใช้งานได้อยู่)", async () => {
    const { store, repo, fetch, checker, alerts } = setup();
    await store.save({
      pageId: "p1",
      accessToken: "T1",
      tokenType: "page",
      scopes: [],
    });
    fetch.setFallback({
      json: debugBody({ expires_at: Math.floor((NOW + 2 * DAY) / 1000) }),
    });

    await checker.runAll();

    expect(repo.raw("p1")!.status).toBe("expiring_soon");
    expect(alerts.sent[0]!.severity).toBe("warn");
  });

  it("สิทธิ์ไม่ครบ → สถานะ missing_permissions + alert", async () => {
    const { store, repo, fetch, checker, alerts } = setup();
    await store.save({
      pageId: "p1",
      accessToken: "T1",
      tokenType: "page",
      scopes: [],
    });
    fetch.setFallback({
      json: debugBody({
        scopes: REQUIRED_PERMISSIONS.filter((p) => p !== "pages_messaging"),
      }),
    });

    await checker.runAll();

    expect(repo.raw("p1")!.status).toBe("missing_permissions");
    expect(alerts.sent[0]!.body).toContain("pages_messaging");
  });

  it("เพจที่ยิงไม่ผ่านต้องไม่ทำให้เพจที่เหลือตรวจไม่ได้", async () => {
    const { store, repo, fetch, checker, clock } = setup();
    for (const id of ["p1", "p2", "p3"]) {
      await store.save({
        pageId: id,
        accessToken: `T_${id}`,
        tokenType: "page",
        scopes: [],
      });
    }
    // ผูก error ไว้กับ p2 โดยเฉพาะ — ตรวจแบบขนานจึงใช้คิวตามลำดับไม่ได้
    fetch.setHandler((call) =>
      new URL(call.url).searchParams.get("input_token") === "T_p2"
        ? { throws: new TypeError("เน็ตหลุด") }
        : undefined,
    );
    fetch.setFallback({ json: debugBody() });

    const res = await clock.runUntilSettled(checker.runAll());

    expect(res.checked).toBe(3);
    expect(repo.raw("p1")!.status).toBe("active");
    expect(repo.raw("p3")!.status).toBe("active");
    // เพจที่ยิงไม่ผ่านเป็น unknown ไม่ใช่ revoked — อย่าเดาว่าลูกค้าถอดสิทธิ์
    expect(repo.raw("p2")!.status).toBe("unknown");
  });

  it("ตรวจแบบขนาน ไม่ใช่ทีละเพจ — เพจที่ค้างต้องไม่ดองคิวทั้งหมด", async () => {
    const { store, fetch, checker, clock } = setup();
    for (let i = 0; i < 10; i++) {
      await store.save({
        pageId: `p${i}`,
        accessToken: `T${i}`,
        tokenType: "page",
        scopes: [],
      });
    }
    fetch.setFallback({ json: debugBody() });

    const started = clock.now();
    const res = await clock.runUntilSettled(checker.runAll());

    expect(res.checked).toBe(10);
    // ทำแบบขนานจึงไม่ควรกินเวลาเป็นสิบวินาที
    expect(clock.now() - started).toBeLessThan(10_000);
  });

  it("ส่ง alert ไม่ได้ ต้องไม่ทำให้ตรวจเพจที่เหลือหยุด", async () => {
    const repo = new InMemoryPageTokenRepository();
    const clock = new FakeClock(NOW);
    const store = new EncryptedTokenStore({ repo, keyring: ring, clock });
    const fetchImpl = new FakeFetch();
    const gateway = new MetaGateway(
      {
        appId: "APP",
        appSecret: "SECRET",
        graphVersion: "v25.0",
        rateLimit: { burst: 1000, refillPerSec: 1000 },
      },
      {
        tokenStore: new FakeTokenStore({}),
        clock,
        fetchImpl: fetchImpl.fn,
        random: () => 0,
      },
    );
    const checker = new TokenHealthChecker({
      store,
      tokenService: new TokenService(
        gateway,
        { appId: "APP", redirectUri: "https://x/cb" },
        nullLogger,
        () => clock.now(),
      ),
      alerts: {
        send: async () => {
          throw new Error("LINE ล่ม");
        },
      },
      clock,
    });

    for (const id of ["p1", "p2"]) {
      await store.save({
        pageId: id,
        accessToken: `T_${id}`,
        tokenType: "page",
        scopes: [],
      });
    }
    fetchImpl.setFallback({ json: debugBody({ is_valid: false }) });

    const res = await checker.runAll();
    expect(res.checked).toBe(2);
    expect(repo.raw("p2")!.status).toBe("revoked");
  });

  it("เพจที่ถอดรหัส token ไม่ได้ ถูกข้ามไปเงียบๆ ไม่ทำให้ cron ล้ม", async () => {
    const { repo, fetch, checker } = setup();
    await repo.upsert({
      pageId: "พัง",
      encryptedToken: "ขยะ",
      tokenType: "page",
      scopes: [],
      expiresAtMs: null,
      status: "active",
    });
    fetch.setFallback({ json: debugBody() });

    const res = await checker.runAll();
    expect(res.checked).toBe(0);
  });

  it("ไม่มีเพจเลย → ผ่านได้ไม่พัง", async () => {
    const { checker } = setup();
    const res = await checker.runAll();
    expect(res).toMatchObject({ checked: 0, alerts: 0, failed: [] });
  });

  it("debug_token ตอบ error 190 → บันทึกเป็น revoked", async () => {
    const { store, repo, fetch, checker } = setup();
    await store.save({
      pageId: "p1",
      accessToken: "T1",
      tokenType: "page",
      scopes: [],
    });
    fetch.setFallback({ status: 400, json: graphError(190, "Invalid token") });

    await checker.runAll();
    expect(repo.raw("p1")!.status).toBe("revoked");
  });
});

describe("ป้ายสถานะสำหรับหน้า Connection Status", () => {
  it("ทุกสถานะมีป้ายไทยและสี", () => {
    const states = [
      "ok",
      "expiring_soon",
      "expired",
      "revoked",
      "missing_permissions",
      "no_token",
      "unknown",
    ] as const;
    for (const s of states) {
      expect(STATE_LABEL_TH[s], s).toMatch(/[ก-๙]/);
      expect(STATE_TONE[s], s).toBeTruthy();
    }
  });

  it("สถานะที่ต้องรีบแก้เป็นสีแดง", () => {
    expect(STATE_TONE.expired).toBe("red");
    expect(STATE_TONE.revoked).toBe("red");
    expect(STATE_TONE.ok).toBe("green");
  });
});
