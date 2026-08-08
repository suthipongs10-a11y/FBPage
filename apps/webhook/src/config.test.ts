import { describe, expect, it } from "vitest";
import { ConfigError, loadWebhookConfig } from "./config.js";

const OK = {
  META_APP_SECRET: "secret",
  META_WEBHOOK_VERIFY_TOKEN: "token",
};

function th(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err.th;
    throw err;
  }
  throw new Error("ไม่ได้โยน ConfigError อย่างที่คาด");
}

describe("loadWebhookConfig", () => {
  it("ค่าครบ → ได้ config พร้อมค่าเริ่มต้น", () => {
    const c = loadWebhookConfig(OK);
    expect(c.appSecret).toBe("secret");
    expect(c.port).toBe(3001);
    expect(c.host).toBe("0.0.0.0");
    expect(c.mtls).toBeNull();
  });

  /**
   * `createHmac("sha256", "")` ทำงานได้ปกติ ได้ลายเซ็นหน้าตาถูกต้องทุกอย่าง
   * แค่ไม่มีวันตรงกับของ Meta — ถ้าไม่ล้มตรงนี้ เราจะได้ service ที่ขึ้นเขียว
   * แล้วปฏิเสธทุก event เงียบๆ
   */
  it("ไม่มี app secret → ล้มพร้อมบอกว่าไปเอาค่ามาจากไหน", () => {
    const msg = th(() => loadWebhookConfig({ ...OK, META_APP_SECRET: "" }));
    expect(msg).toContain("META_APP_SECRET");
    expect(msg).toContain("Meta for Developers");
  });

  it("app secret เป็นช่องว่างล้วนก็ถือว่าไม่มี", () => {
    expect(() => loadWebhookConfig({ ...OK, META_APP_SECRET: "   " })).toThrow(
      ConfigError,
    );
  });

  it("ไม่มี verify token → ล้ม", () => {
    const msg = th(() =>
      loadWebhookConfig({ ...OK, META_WEBHOOK_VERIFY_TOKEN: "" }),
    );
    expect(msg).toContain("META_WEBHOOK_VERIFY_TOKEN");
  });

  it("พอร์ตที่ไม่ใช่ตัวเลข → ล้มพร้อมบอกค่าที่ใส่มา", () => {
    const msg = th(() => loadWebhookConfig({ ...OK, WEBHOOK_PORT: "abc" }));
    expect(msg).toContain("abc");
  });

  it("พอร์ตติดลบ → ล้ม", () => {
    expect(() => loadWebhookConfig({ ...OK, WEBHOOK_PORT: "-1" })).toThrow(
      ConfigError,
    );
  });

  it("ตั้ง mTLS ครบสามค่า → ได้ config", () => {
    const c = loadWebhookConfig({
      ...OK,
      WEBHOOK_MTLS_CA_PATH: "/etc/meta-ca.pem",
      WEBHOOK_TLS_CERT_PATH: "/etc/cert.pem",
      WEBHOOK_TLS_KEY_PATH: "/etc/key.pem",
    });
    expect(c.mtls).toEqual({
      caPath: "/etc/meta-ca.pem",
      certPath: "/etc/cert.pem",
      keyPath: "/etc/key.pem",
    });
  });

  /**
   * ตั้งมาบางส่วนคือ "ตั้งค้างไว้" ไม่ใช่ "ตั้งใจปิด" — ถ้าปล่อยผ่านโดยถือว่า
   * ไม่ได้เปิด mTLS เราจะขึ้น service ที่คนตั้งค่าเชื่อว่ามี mTLS แล้วทั้งที่ไม่มี
   */
  it("ตั้ง mTLS มาไม่ครบ → ล้มพร้อมบอกว่าต้องใส่อะไรอีก", () => {
    const msg = th(() =>
      loadWebhookConfig({ ...OK, WEBHOOK_MTLS_CA_PATH: "/etc/meta-ca.pem" }),
    );
    expect(msg).toContain("WEBHOOK_TLS_CERT_PATH");
    expect(msg).toContain("WEBHOOK_TLS_KEY_PATH");
  });
});
