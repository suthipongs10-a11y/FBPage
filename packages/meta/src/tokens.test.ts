import { describe, expect, it } from "vitest";
import { REQUIRED_PERMISSIONS, oauthScopeString } from "./permissions.js";
import { TokenService, needsAlert } from "./tokens.js";
import { graphError, makeGateway } from "./test-helpers.js";

const NOW = 1_700_000_000_000;
const SEC = 1000;
const DAY = 86_400 * SEC;

function setup() {
  const h = makeGateway();
  const svc = new TokenService(
    h.gateway,
    { appId: "APP123", redirectUri: "https://pageos.app/oauth/callback" },
    undefined,
    () => NOW,
  );
  return { ...h, svc };
}

/** body ที่ /debug_token ตอบกลับ */
function debugTokenBody(over: Record<string, unknown> = {}): unknown {
  return {
    data: {
      app_id: "APP123",
      type: "PAGE",
      application: "PAGE OS",
      expires_at: Math.floor((NOW + 60 * DAY) / 1000),
      is_valid: true,
      scopes: [...REQUIRED_PERMISSIONS],
      user_id: "u1",
      ...over,
    },
  };
}

describe("buildLoginUrl — Onboarding Wizard ขั้นที่ 1", () => {
  it("ประกอบ URL ครบทุกพารามิเตอร์ที่ Meta ต้องการ", () => {
    const { svc } = setup();
    const u = new URL(svc.buildLoginUrl(oauthScopeString(), "state-abc"));
    expect(u.hostname).toBe("www.facebook.com");
    expect(u.pathname).toContain("/v25.0/dialog/oauth");
    expect(u.searchParams.get("client_id")).toBe("APP123");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://pageos.app/oauth/callback",
    );
    expect(u.searchParams.get("state")).toBe("state-abc");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toContain("pages_show_list");
  });

  it("ใช้ GRAPH_VERSION เดียวกับ gateway (กฎข้อ 2)", () => {
    const { svc, gateway } = setup();
    expect(svc.buildLoginUrl("x", "y")).toContain(`/${gateway.graphVersion}/`);
  });
});

describe("exchangeCode", () => {
  it("แลก code เป็น short-lived token พร้อมเวลาหมดอายุ", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: { access_token: "SHORT_TOKEN", expires_in: 3600 } });

    const t = await svc.exchangeCode("CODE123");
    expect(t.accessToken).toBe("SHORT_TOKEN");
    expect(t.expiresAtMs).toBe(NOW + 3600 * SEC);

    const u = new URL(fetch.lastCall!.url);
    expect(u.pathname).toContain("oauth/access_token");
    expect(u.searchParams.get("code")).toBe("CODE123");
  });

  it("ห้าม retry — code ใช้ได้ครั้งเดียว ยิงซ้ำจะได้ error สับสน", async () => {
    const { svc, fetch, clock } = setup();
    fetch.setFallback({ status: 500, text: "" });
    const p = svc.exchangeCode("CODE123").catch((e: unknown) => e);
    await clock.advance(120_000);
    await p;
    expect(fetch.callCount).toBe(1);
  });

  it("ไม่มี access_token ใน response → error ที่บอกสาเหตุ", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: {} });
    await expect(svc.exchangeCode("CODE")).rejects.toThrow(/access_token/);
  });
});

describe("exchangeForLongLived", () => {
  it("แลกเป็น long-lived token (~60 วัน)", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: { access_token: "LONG_TOKEN", expires_in: 5_184_000 } });

    const t = await svc.exchangeForLongLived("SHORT_TOKEN");
    expect(t.accessToken).toBe("LONG_TOKEN");
    expect(t.expiresAtMs).toBe(NOW + 5_184_000 * SEC);
    expect(new URL(fetch.lastCall!.url).searchParams.get("grant_type")).toBe(
      "fb_exchange_token",
    );
  });

  it("ไม่มี expires_in → ถือว่าไม่หมดอายุ (System User Token)", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: { access_token: "SYSTEM_TOKEN" } });
    const t = await svc.exchangeForLongLived("x");
    expect(t.expiresAtMs).toBeUndefined();
  });

  it("expires_in = 0 ก็ถือว่าไม่หมดอายุ (Meta ส่ง 0 มาแบบนี้)", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: { access_token: "T", expires_in: 0 } });
    expect((await svc.exchangeForLongLived("x")).expiresAtMs).toBeUndefined();
  });
});

describe("listManagedPages", () => {
  it("ดึงเพจทั้งหมดที่ user ดูแล", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: {
        data: [
          {
            id: "100",
            name: "ร้านกาแฟดีดี",
            category: "Coffee Shop",
            access_token: "PT_100",
            tasks: ["MANAGE", "CREATE_CONTENT"],
          },
          { id: "200", name: "ร้านขนม", access_token: "PT_200", tasks: [] },
        ],
      },
    });

    const pages = await svc.listManagedPages("USER_TOKEN");
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      pageId: "100",
      name: "ร้านกาแฟดีดี",
      accessToken: "PT_100",
    });
    expect(fetch.lastCall!.headers["authorization"]).toBe("Bearer USER_TOKEN");
  });

  it("ตามหน้าถัดไปจนครบ (ลูกค้าที่มีเพจเยอะ)", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: {
        data: [{ id: "1", name: "a", access_token: "t1" }],
        paging: { cursors: { after: "CUR1" }, next: "https://next" },
      },
    });
    fetch.push({ json: { data: [{ id: "2", name: "b", access_token: "t2" }] } });

    const pages = await svc.listManagedPages("USER_TOKEN");
    expect(pages.map((p) => p.pageId)).toEqual(["1", "2"]);
    expect(new URL(fetch.calls[1]!.url).searchParams.get("after")).toBe("CUR1");
  });

  it("ข้ามรายการที่ข้อมูลไม่ครบแทนที่จะพัง", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: {
        data: [
          { id: "1", name: "ok", access_token: "t1" },
          { id: "2", name: "ไม่มี token" },
          { name: "ไม่มี id", access_token: "t3" },
        ],
      },
    });
    expect(await svc.listManagedPages("U")).toHaveLength(1);
  });

  it("ไม่มีเพจเลย → array ว่าง ไม่ throw", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: { data: [] } });
    expect(await svc.listManagedPages("U")).toEqual([]);
  });
});

describe("debugToken", () => {
  it("อ่านข้อมูล token ครบ", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: debugTokenBody() });

    const info = await svc.debugToken("SOME_TOKEN");
    expect(info.isValid).toBe(true);
    expect(info.appId).toBe("APP123");
    expect(info.expiresAtMs).toBe(NOW + 60 * DAY);
    expect(info.scopes).toContain("pages_messaging");
  });

  it("ใช้ app access token ตรวจ ไม่ใช่ token ที่กำลังตรวจ", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: debugTokenBody() });
    await svc.debugToken("TOKEN_TO_CHECK");
    expect(fetch.lastCall!.headers["authorization"]).toBe(
      "Bearer APP123|APPSECRET",
    );
    expect(new URL(fetch.lastCall!.url).searchParams.get("input_token")).toBe(
      "TOKEN_TO_CHECK",
    );
  });

  it("expires_at = 0 แปลว่าไม่หมดอายุ", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: debugTokenBody({ expires_at: 0 }) });
    expect((await svc.debugToken("t")).expiresAtMs).toBeUndefined();
  });

  it("token ที่ถูกเพิกถอน → is_valid false พร้อมเหตุผล", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: debugTokenBody({
        is_valid: false,
        error: { code: 190, message: "Session has been invalidated" },
      }),
    });
    const info = await svc.debugToken("t");
    expect(info.isValid).toBe(false);
    expect(info.invalidReason).toContain("invalidated");
  });
});

describe("checkPageHealth — health check ทุก 6 ชม.", () => {
  it("token ปกติ → ok", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: debugTokenBody() });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    expect(h.state).toBe("ok");
    expect(h.permissions.ok).toBe(true);
    expect(needsAlert(h.state)).toBe(false);
  });

  it("System User Token (ไม่หมดอายุ) → ok และบอกว่าไม่มีวันหมดอายุ", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: debugTokenBody({ expires_at: 0 }) });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "system_user",
    });
    expect(h.state).toBe("ok");
    expect(h.expiresAtMs).toBeUndefined();
    expect(h.th).toContain("ไม่มีวันหมดอายุ");
  });

  it("ใกล้หมดอายุ (< 7 วัน) → expiring_soon และต้องแจ้งเตือน", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: debugTokenBody({ expires_at: Math.floor((NOW + 3 * DAY) / 1000) }),
    });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    expect(h.state).toBe("expiring_soon");
    expect(h.hoursUntilExpiry).toBe(72);
    expect(needsAlert(h.state)).toBe(true);
    expect(h.th).toContain("System User Token");
  });

  it("หมดอายุแล้ว → expired", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: debugTokenBody({ expires_at: Math.floor((NOW - DAY) / 1000) }),
    });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    expect(h.state).toBe("expired");
    expect(h.hoursUntilExpiry).toBe(0);
    expect(needsAlert(h.state)).toBe(true);
  });

  it("ถูกเพิกถอน → revoked (ลูกค้าเปลี่ยนรหัส/ถอดสิทธิ์)", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: debugTokenBody({
        is_valid: false,
        error: { message: "Password changed" },
      }),
    });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    expect(h.state).toBe("revoked");
    expect(h.th).toContain("เชื่อมเพจใหม่");
    expect(needsAlert(h.state)).toBe(true);
  });

  it("ขาด permission → บอกว่าขาดตัวไหน และฟีเจอร์ไหนใช้ไม่ได้", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: debugTokenBody({
        scopes: REQUIRED_PERMISSIONS.filter((p) => p !== "pages_messaging"),
      }),
    });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    expect(h.state).toBe("missing_permissions");
    expect(h.permissions.missing).toEqual(["pages_messaging"]);
    expect(h.th).toContain("pages_messaging");
    expect(h.th).toContain("M1 Unified Inbox");
    expect(needsAlert(h.state)).toBe(true);
  });

  it("token หมดอายุสำคัญกว่า permission ขาด (รายงานตัวที่ต้องแก้ก่อน)", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: debugTokenBody({
        expires_at: Math.floor((NOW - DAY) / 1000),
        scopes: [],
      }),
    });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    expect(h.state).toBe("expired");
  });

  it("debug_token ยิงไม่ผ่านเพราะ token ตาย → revoked ไม่ใช่ unknown", async () => {
    const { svc, fetch } = setup();
    fetch.setFallback({ status: 400, json: graphError(190, "Invalid token") });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    expect(h.state).toBe("revoked");
  });

  it("ยิงไม่ผ่านด้วยเหตุอื่น → unknown ไม่เดาว่าลูกค้าถอดสิทธิ์", async () => {
    const { svc, fetch, clock } = setup();
    fetch.setFallback({ status: 400, json: graphError(100, "bad param") });
    const p = svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    await clock.advance(120_000);
    const h = await p;
    expect(h.state).toBe("unknown");
    expect(needsAlert(h.state)).toBe(false);
  });

  it("เทียบกับ permission ชุดที่กำหนดเองได้", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: debugTokenBody({ scopes: ["pages_show_list"] }) });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
      requiredPermissions: ["pages_show_list"],
    });
    expect(h.state).toBe("ok");
  });

  it("บันทึกเวลาที่ตรวจไว้ทุกครั้ง", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: debugTokenBody() });
    const h = await svc.checkPageHealth({
      pageId: "p1",
      token: "T",
      tokenType: "page",
    });
    expect(h.checkedAtMs).toBe(NOW);
  });
});

describe("needsAlert", () => {
  it("แจ้งเตือนเฉพาะสถานะที่ต้องลงมือทำ", () => {
    expect(needsAlert("ok")).toBe(false);
    expect(needsAlert("unknown")).toBe(false);
    expect(needsAlert("expired")).toBe(true);
    expect(needsAlert("revoked")).toBe(true);
    expect(needsAlert("expiring_soon")).toBe(true);
    expect(needsAlert("missing_permissions")).toBe(true);
  });
});
