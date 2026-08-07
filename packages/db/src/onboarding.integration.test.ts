/**
 * เทสต์ integration ของ M-A — ต่อชิ้นส่วนจริงทั้งหมดเข้าด้วยกัน
 * (unit test พิสูจน์ว่าแต่ละชิ้นถูก แต่ไม่พิสูจน์ว่าชิ้นส่วนต่อกันได้)
 *
 * เกณฑ์ผ่านของ M-A ตามสเปกข้อ 7: "เชื่อมเพจตัวเองได้ 3 เพจ token refresh อัตโนมัติ"
 */
import { describe, expect, it } from "vitest";
import {
  FakeClock,
  Keyring,
  createLogger,
  type LogRecord,
} from "@page-os/core";
import {
  MetaGateway,
  REQUIRED_PERMISSIONS,
  SubscriptionService,
  TokenService,
  createOAuthState,
  oauthScopeString,
  verifyOAuthState,
} from "@page-os/meta";
import { FakeFetch, type FakeCall } from "@page-os/meta/test-helpers";
import {
  EncryptedTokenStore,
  InMemoryPageTokenRepository,
} from "./token-store.js";
import { TokenHealthChecker, type AlertSink } from "./health-check.js";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const APP_SECRET = "APPSECRET";

const PAGES = [
  { id: "100000001", name: "ร้านกาแฟดีดี", token: "PT_COFFEE" },
  { id: "100000002", name: "คลินิกความงาม", token: "PT_CLINIC" },
  { id: "100000003", name: "ร้านขนมโฮมเมด", token: "PT_BAKERY" },
];

class Alerts implements AlertSink {
  readonly sent: Array<{ severity: string; body: string; pageId?: string }> = [];
  async send(a: {
    severity: "warn" | "critical";
    title: string;
    body: string;
    pageId?: string;
  }): Promise<void> {
    this.sent.push({ severity: a.severity, body: a.body, pageId: a.pageId });
  }
}

function buildStack() {
  const clock = new FakeClock(NOW);
  const keyring = new Keyring([{ keyId: "k1", key: Buffer.alloc(32, 42) }]);
  const repo = new InMemoryPageTokenRepository();
  const logRecords: LogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    clock,
    sink: (r) => logRecords.push(r),
  });
  const store = new EncryptedTokenStore({ repo, keyring, clock, logger });
  const fetchImpl = new FakeFetch();

  const gateway = new MetaGateway(
    {
      appId: "APP123",
      appSecret: APP_SECRET,
      graphVersion: "v25.0",
      rateLimit: { burst: 50, refillPerSec: 50 },
    },
    {
      tokenStore: store,
      clock,
      logger,
      fetchImpl: fetchImpl.fn,
      random: () => 0,
    },
  );

  const tokenSvc = new TokenService(
    gateway,
    { appId: "APP123", redirectUri: "https://pageos.app/api/oauth/callback" },
    logger,
    () => clock.now(),
  );
  const subSvc = new SubscriptionService(gateway);
  const alerts = new Alerts();
  const checker = new TokenHealthChecker({
    store,
    tokenService: tokenSvc,
    alerts,
    logger,
    clock,
  });

  return {
    clock,
    repo,
    store,
    gateway,
    tokenSvc,
    subSvc,
    checker,
    alerts,
    fetch: fetchImpl,
    logRecords,
  };
}

/** จำลอง Meta ตอบตาม endpoint ที่ถูกเรียก */
function metaRoutes(over: {
  debugToken?: (inputToken: string) => unknown;
  subscribedApps?: unknown;
} = {}) {
  return (call: FakeCall) => {
    const u = new URL(call.url);
    const path = u.pathname;

    if (path.includes("oauth/access_token")) {
      if (u.searchParams.get("grant_type") === "fb_exchange_token") {
        return {
          json: { access_token: "LONG_USER_TOKEN", expires_in: 60 * 86_400 },
        };
      }
      return { json: { access_token: "SHORT_USER_TOKEN", expires_in: 3600 } };
    }

    if (path.includes("me/accounts")) {
      return {
        json: {
          data: PAGES.map((p) => ({
            id: p.id,
            name: p.name,
            category: "Local Business",
            access_token: p.token,
            tasks: ["MANAGE", "CREATE_CONTENT", "MESSAGING"],
          })),
        },
      };
    }

    if (path.includes("debug_token")) {
      const input = u.searchParams.get("input_token") ?? "";
      if (over.debugToken) return { json: over.debugToken(input) };
      return {
        json: {
          data: {
            app_id: "APP123",
            type: "PAGE",
            application: "PAGE OS",
            expires_at: 0, // page token จาก long-lived user token ไม่หมดอายุ
            is_valid: true,
            scopes: [...REQUIRED_PERMISSIONS],
          },
        },
      };
    }

    if (path.includes("subscribed_apps")) {
      if (over.subscribedApps !== undefined) {
        return { json: over.subscribedApps };
      }
      if (call.method === "POST") return { json: { success: true } };
      return {
        json: {
          data: [
            {
              id: "APP123",
              subscribed_fields: [
                "messages",
                "messaging_postbacks",
                "message_reactions",
                "feed",
                "ratings",
              ],
            },
          ],
        },
      };
    }

    return undefined;
  };
}

describe("M-A integration — เชื่อมเพจ 3 เพจแบบครบวงจร", () => {
  it("onboarding: state → code → long-lived → page tokens → เก็บเข้ารหัส → subscribe webhook", async () => {
    const s = buildStack();
    s.fetch.setHandler(metaRoutes());

    // 1) สร้างลิงก์ให้ลูกค้ากด พร้อม state กัน CSRF
    const state = createOAuthState(
      { workspaceId: "ws-1", nowMs: s.clock.now() },
      APP_SECRET,
    );
    const loginUrl = s.tokenSvc.buildLoginUrl(oauthScopeString(), state);
    expect(loginUrl).toContain("client_id=APP123");
    expect(loginUrl).toContain("pages_show_list");

    // 2) ลูกค้ากดอนุญาต → Meta ส่ง code + state กลับมาที่ callback
    const verified = verifyOAuthState(state, APP_SECRET, s.clock.now());
    expect(verified.workspaceId).toBe("ws-1");

    // 3) แลก code เป็น token แล้วต่อยอดเป็น long-lived
    const short = await s.tokenSvc.exchangeCode("CODE_FROM_META");
    const long = await s.tokenSvc.exchangeForLongLived(short.accessToken);
    expect(long.accessToken).toBe("LONG_USER_TOKEN");

    // 4) ดึงเพจทั้งหมดที่ลูกค้าดูแล
    const pages = await s.tokenSvc.listManagedPages(long.accessToken);
    expect(pages).toHaveLength(3);

    // 5) เก็บ page token แบบเข้ารหัส
    for (const p of pages) {
      await s.store.save({
        pageId: p.pageId,
        accessToken: p.accessToken,
        tokenType: "page",
        scopes: [...REQUIRED_PERMISSIONS],
        expiresAtMs: null,
      });
    }

    // ตรวจว่าที่เก็บจริงเป็น ciphertext ไม่ใช่ plaintext
    for (const p of PAGES) {
      const row = s.repo.raw(p.id)!;
      expect(row.encryptedToken).not.toContain(p.token);
      expect(row.encryptedToken.startsWith("v1.k1.")).toBe(true);
    }

    // 6) subscribe webhook ให้ครบทุกเพจ
    for (const p of pages) await s.subSvc.subscribe(p.pageId);

    // 7) ตรวจสถานะ webhook — ต้องขึ้นว่าครบ
    for (const p of pages) {
      const st = await s.subSvc.check(p.pageId);
      expect(st.ok, p.pageId).toBe(true);
      expect(st.missingFields).toEqual([]);
    }
  });

  it("gateway ใช้ token ที่ถอดรหัสจาก store ได้จริง และไม่ปล่อยหลุดใน log", async () => {
    const s = buildStack();
    s.fetch.setHandler(metaRoutes());
    await s.store.save({
      pageId: PAGES[0]!.id,
      accessToken: PAGES[0]!.token,
      tokenType: "page",
      scopes: [...REQUIRED_PERMISSIONS],
      expiresAtMs: null,
    });

    s.fetch.push({ json: { id: PAGES[0]!.id, name: PAGES[0]!.name } });
    const res = await s.gateway.call<{ name: string }>({
      pageId: PAGES[0]!.id,
      path: PAGES[0]!.id,
      params: { fields: "id,name" },
    });
    expect(res.data.name).toBe("ร้านกาแฟดีดี");

    // token ต้องอยู่ใน header เท่านั้น ไม่โผล่ใน URL
    const call = s.fetch.lastCall!;
    expect(call.headers["authorization"]).toBe(`Bearer ${PAGES[0]!.token}`);
    expect(call.url).not.toContain(PAGES[0]!.token);

    // และต้องไม่มี token โผล่ใน log เลยสักบรรทัด
    const dump = JSON.stringify(s.logRecords);
    for (const p of PAGES) expect(dump).not.toContain(p.token);
  });

  it("health check ทั้ง 3 เพจผ่าน ไม่มี alert", async () => {
    const s = buildStack();
    s.fetch.setHandler(metaRoutes());
    for (const p of PAGES) {
      await s.store.save({
        pageId: p.id,
        accessToken: p.token,
        tokenType: "page",
        scopes: [...REQUIRED_PERMISSIONS],
        expiresAtMs: null,
      });
    }

    const res = await s.clock.runUntilSettled(s.checker.runAll());

    expect(res.checked).toBe(3);
    expect(res.alerts).toBe(0);
    expect(res.failed).toEqual([]);
    for (const p of PAGES) expect(s.repo.raw(p.id)!.status).toBe("active");
    expect(s.alerts.sent).toEqual([]);
  });
});

describe("M-A integration — เมื่อลูกค้าถอดสิทธิ์", () => {
  it("เพจที่ถูกเพิกถอนถูกจับได้ ส่ง alert และหยุดใช้ token นั้นทันที", async () => {
    const s = buildStack();
    // เพจที่ 2 ถูกเพิกถอน
    s.fetch.setHandler(
      metaRoutes({
        debugToken: (input) =>
          input === PAGES[1]!.token
            ? {
                data: {
                  app_id: "APP123",
                  is_valid: false,
                  scopes: [],
                  error: { code: 190, message: "Password changed" },
                },
              }
            : {
                data: {
                  app_id: "APP123",
                  type: "PAGE",
                  expires_at: 0,
                  is_valid: true,
                  scopes: [...REQUIRED_PERMISSIONS],
                },
              },
      }),
    );
    for (const p of PAGES) {
      await s.store.save({
        pageId: p.id,
        accessToken: p.token,
        tokenType: "page",
        scopes: [...REQUIRED_PERMISSIONS],
        expiresAtMs: null,
      });
    }

    const res = await s.clock.runUntilSettled(s.checker.runAll());

    expect(res.checked).toBe(3);
    expect(res.alerts).toBe(1);
    expect(s.alerts.sent[0]!.severity).toBe("critical");
    expect(s.alerts.sent[0]!.pageId).toBe(PAGES[1]!.id);

    // เพจที่ถูกเพิกถอนต้องหยุดใช้ทันที ส่วนเพจอื่นยังทำงานปกติ
    expect(await s.store.getPageToken(PAGES[1]!.id)).toBeNull();
    expect((await s.store.getPageToken(PAGES[0]!.id))?.accessToken).toBe(
      PAGES[0]!.token,
    );
  });

  it("เจอ error 190 ระหว่างใช้งานจริง → mark revoked เองโดยไม่ต้องรอ cron", async () => {
    const s = buildStack();
    await s.store.save({
      pageId: PAGES[0]!.id,
      accessToken: PAGES[0]!.token,
      tokenType: "page",
      scopes: [...REQUIRED_PERMISSIONS],
      expiresAtMs: null,
    });

    s.fetch.setFallback({
      status: 400,
      json: {
        error: {
          message: "Error validating access token",
          code: 190,
          error_subcode: 460,
          fbtrace_id: "T1",
        },
      },
    });

    await expect(
      s.gateway.call({ pageId: PAGES[0]!.id, path: PAGES[0]!.id }),
    ).rejects.toMatchObject({ code: 190, action: "reconnect" });

    expect(s.repo.raw(PAGES[0]!.id)!.status).toBe("revoked");
    expect(s.repo.raw(PAGES[0]!.id)!.statusReason).toContain("เปลี่ยนรหัสผ่าน");
    // call ถัดไปต้องไม่ยิงออกไปอีกเพราะรู้แล้วว่า token ตาย
    await expect(
      s.gateway.call({ pageId: PAGES[0]!.id, path: PAGES[0]!.id }),
    ).rejects.toMatchObject({ code: 190 });
  });
});

describe("M-A integration — webhook ยังไม่ได้ subscribe", () => {
  it("หน้า Connection Status ต้องบอกได้ว่ายังไม่ได้เชื่อม webhook", async () => {
    const s = buildStack();
    s.fetch.setHandler(metaRoutes({ subscribedApps: { data: [] } }));
    await s.store.save({
      pageId: PAGES[0]!.id,
      accessToken: PAGES[0]!.token,
      tokenType: "page",
      scopes: [...REQUIRED_PERMISSIONS],
      expiresAtMs: null,
    });

    const st = await s.subSvc.check(PAGES[0]!.id);
    expect(st.subscribed).toBe(false);
    expect(st.ok).toBe(false);
    expect(st.th).toContain("ยังไม่ได้ subscribe");
  });

  it("subscribe แล้วแต่ขาด field ต้องรายงานว่าขาดตัวไหน", async () => {
    const s = buildStack();
    s.fetch.setHandler(
      metaRoutes({
        subscribedApps: {
          data: [{ id: "APP123", subscribed_fields: ["messages", "feed"] }],
        },
      }),
    );
    await s.store.save({
      pageId: PAGES[0]!.id,
      accessToken: PAGES[0]!.token,
      tokenType: "page",
      scopes: [...REQUIRED_PERMISSIONS],
      expiresAtMs: null,
    });

    const st = await s.subSvc.check(PAGES[0]!.id);
    expect(st.subscribed).toBe(true);
    expect(st.ok).toBe(false);
    expect(st.missingFields).toEqual([
      "messaging_postbacks",
      "message_reactions",
      "ratings",
    ]);
  });
});

describe("M-A integration — token ใกล้หมดอายุ", () => {
  it("page token ที่มีวันหมดอายุ ถูกเตือนล่วงหน้าก่อนตาย", async () => {
    const s = buildStack();
    s.fetch.setHandler(
      metaRoutes({
        debugToken: () => ({
          data: {
            app_id: "APP123",
            type: "PAGE",
            expires_at: Math.floor((NOW + 3 * DAY) / 1000),
            is_valid: true,
            scopes: [...REQUIRED_PERMISSIONS],
          },
        }),
      }),
    );
    await s.store.save({
      pageId: PAGES[0]!.id,
      accessToken: PAGES[0]!.token,
      tokenType: "page",
      scopes: [...REQUIRED_PERMISSIONS],
      expiresAtMs: NOW + 3 * DAY,
    });

    const res = await s.clock.runUntilSettled(s.checker.runAll());

    expect(res.alerts).toBe(1);
    expect(s.alerts.sent[0]!.severity).toBe("warn");
    expect(s.alerts.sent[0]!.body).toContain("System User Token");
    // ยังใช้งานได้อยู่ ไม่ใช่ตัดทิ้งทันที
    expect(await s.store.getPageToken(PAGES[0]!.id)).not.toBeNull();
  });
});
