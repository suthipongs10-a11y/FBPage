import { describe, expect, it } from "vitest";
import { REDACTED, isSecretKey, redact, redactString } from "./redact.js";
import { createLogger, type LogRecord } from "./logger.js";
import { FakeClock } from "./clock.js";

const FB_TOKEN =
  "EAAGm0PX4ZCpsBAO7ZBqZAZBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxZDZD";

describe("redactString", () => {
  it("ลบ Facebook token ที่ขึ้นต้นด้วย EAA", () => {
    const out = redactString(`ยิงไม่ผ่านด้วย token ${FB_TOKEN} ลองใหม่`);
    expect(out).not.toContain(FB_TOKEN);
    expect(out).toContain(REDACTED);
  });

  it("ลบ Bearer token", () => {
    expect(redactString("authorization: Bearer abcdef1234567890")).toBe(
      `authorization: Bearer ${REDACTED}`,
    );
  });

  it("ลบ appsecret_proof (hex 64 ตัว)", () => {
    const hex = "a".repeat(64);
    expect(redactString(`proof=${hex}`)).not.toContain(hex);
  });

  it("ลบ token ที่อยู่ใน query string", () => {
    const url =
      "https://graph.facebook.com/v25.0/me?access_token=SECRETVALUE123&fields=id";
    const out = redactString(url);
    expect(out).not.toContain("SECRETVALUE123");
    expect(out).toContain("fields=id");
  });

  it("ลบ client_secret และ fb_exchange_token ใน query", () => {
    const out = redactString(
      "oauth/access_token?client_secret=abc123xyz&fb_exchange_token=short999",
    );
    expect(out).not.toContain("abc123xyz");
    expect(out).not.toContain("short999");
  });

  it("จัดการหลาย token ในสตริงเดียวได้ (regex /g ไม่ค้าง lastIndex)", () => {
    const s = `${FB_TOKEN} และ ${FB_TOKEN}`;
    const out = redactString(s);
    expect(out).not.toContain("EAAGm0PX");
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it("เรียกซ้ำหลายรอบให้ผลเหมือนเดิม", () => {
    const s = `token ${FB_TOKEN}`;
    expect(redactString(s)).toBe(redactString(s));
    expect(redactString(s)).toBe(redactString(s));
  });

  it("ไม่แตะข้อความปกติ", () => {
    const s = "โพสต์ไปที่เพจ ร้านกาแฟดีดี เวลา 09:00";
    expect(redactString(s)).toBe(s);
  });
});

describe("isSecretKey", () => {
  it("จับ key ที่เป็นความลับ", () => {
    for (const k of [
      "access_token",
      "accessToken",
      "appSecret",
      "client_secret",
      "password",
      "authorization",
      "apiKey",
      "cookie",
      "signature",
    ]) {
      expect(isSecretKey(k), k).toBe(true);
    }
  });

  it("ไม่ redact id ธรรมดาจนอ่าน log ไม่รู้เรื่อง", () => {
    for (const k of ["page_id", "user_id", "app_id", "token_type"]) {
      expect(isSecretKey(k), k).toBe(false);
    }
  });
});

describe("redact (deep)", () => {
  it("redact ตามชื่อ key", () => {
    const out = redact({
      pageId: "123",
      access_token: FB_TOKEN,
      nested: { appSecret: "s3cr3t" },
    }) as Record<string, unknown>;
    expect(out["pageId"]).toBe("123");
    expect(out["access_token"]).toBe(REDACTED);
    expect((out["nested"] as Record<string, unknown>)["appSecret"]).toBe(
      REDACTED,
    );
  });

  it("redact ตามหน้าตาของค่า แม้ชื่อ key จะไม่บอก", () => {
    const out = redact({ note: `เก็บไว้: ${FB_TOKEN}` }) as Record<
      string,
      unknown
    >;
    expect(out["note"]).not.toContain("EAAGm0PX");
  });

  it("ไม่แก้ object ต้นฉบับ", () => {
    const input = { access_token: FB_TOKEN };
    redact(input);
    expect(input.access_token).toBe(FB_TOKEN);
  });

  it("รองรับ array / Map / Set", () => {
    expect(redact([FB_TOKEN, "ปกติ"])).toEqual([REDACTED, "ปกติ"]);
    expect(redact(new Map([["access_token", FB_TOKEN]]))).toEqual({
      access_token: REDACTED,
    });
    expect(redact(new Set([FB_TOKEN]))).toEqual([REDACTED]);
  });

  it("รองรับ circular reference โดยไม่ค้าง", () => {
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    expect(redact(a)).toEqual({ name: "a", self: "[Circular]" });
  });

  it("ตัดความลึกที่เกินกำหนด", () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain("[MaxDepth]");
  });

  it("redact stack ของ Error ด้วย (URL ใน stack อาจพก token)", () => {
    const err = new Error(`ยิง ${FB_TOKEN} ไม่ผ่าน`);
    const out = redact(err) as Record<string, unknown>;
    expect(out["message"]).not.toContain("EAAGm0PX");
    expect(String(out["stack"])).not.toContain("EAAGm0PX");
  });

  it("แปลง Buffer เป็นขนาด ไม่ dump เนื้อใน", () => {
    expect(redact(Buffer.from("secretbytes"))).toBe("[Buffer 11b]");
  });

  it("null / undefined ผ่านได้ไม่พัง", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe("logger", () => {
  function capture(): { records: LogRecord[]; log: ReturnType<typeof createLogger> } {
    const records: LogRecord[] = [];
    const log = createLogger({
      level: "debug",
      clock: new FakeClock(1_700_000_000_000),
      sink: (r) => records.push(r),
    });
    return { records, log };
  }

  it("ไม่ปล่อย token ออกไปแม้ผู้เรียกเผลอใส่มา", () => {
    const { records, log } = capture();
    log.info("เรียก Meta", { access_token: FB_TOKEN, url: `x?access_token=${FB_TOKEN}` });
    const line = JSON.stringify(records[0]);
    expect(line).not.toContain("EAAGm0PX");
  });

  it("ts เป็น UTC ISO ตามกฎข้อ 4", () => {
    const { records, log } = capture();
    log.info("hi");
    expect(records[0]!.ts).toBe("2023-11-14T22:13:20.000Z");
  });

  it("กรองตาม level", () => {
    const records: LogRecord[] = [];
    const log = createLogger({ level: "warn", sink: (r) => records.push(r) });
    log.debug("ไม่ควรออก");
    log.info("ไม่ควรออก");
    log.warn("ควรออก");
    log.error("ควรออก");
    expect(records.map((r) => r.level)).toEqual(["warn", "error"]);
  });

  it("child logger สืบทอด bindings และ redact ต่อ", () => {
    const { records, log } = capture();
    log.child({ pageId: "p1", access_token: FB_TOKEN }).info("ทำงาน");
    expect(records[0]!["pageId"]).toBe("p1");
    expect(records[0]!["access_token"]).toBe(REDACTED);
  });

  it("redact ข้อความหลักด้วย ไม่ใช่แค่ fields", () => {
    const { records, log } = capture();
    log.error(`ยิงไม่ผ่าน token=${FB_TOKEN}`);
    expect(records[0]!.msg).not.toContain("EAAGm0PX");
  });
});
