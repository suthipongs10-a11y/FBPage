import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expectThaiThrow } from "@page-os/core/testing";
import {
  WebhookSignatureError,
  handleVerification,
  verifyWebhookSignature,
} from "./signature.js";

const SECRET = "APPSECRET";
const BODY = JSON.stringify({ object: "page", entry: [{ id: "p1" }] });

function sign(body: string | Buffer, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  it("ลายเซ็นถูกต้องผ่านได้", () => {
    expect(() =>
      verifyWebhookSignature({
        rawBody: BODY,
        signatureHeader: sign(BODY),
        appSecret: SECRET,
      }),
    ).not.toThrow();
  });

  it("รองรับ Buffer (raw body ที่ Fastify ส่งมา)", () => {
    const buf = Buffer.from(BODY, "utf8");
    expect(() =>
      verifyWebhookSignature({
        rawBody: buf,
        signatureHeader: sign(buf),
        appSecret: SECRET,
      }),
    ).not.toThrow();
  });

  it("ไม่มีลายเซ็น → ปฏิเสธ (ใครก็ยิงเข้ามาได้ถ้าไม่ตรวจ)", () => {
    for (const h of [undefined, null, ""]) {
      const err = expectThaiThrow(() =>
        verifyWebhookSignature({
          rawBody: BODY,
          signatureHeader: h,
          appSecret: SECRET,
        }),
      );
      expect(err.th).toMatch(/[ก-๙]/);
    }
  });

  it("ลายเซ็นจาก secret อื่น → ปฏิเสธ", () => {
    expect(() =>
      verifyWebhookSignature({
        rawBody: BODY,
        signatureHeader: sign(BODY, "SECRET_ปลอม"),
        appSecret: SECRET,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it("body ถูกแก้แม้ตัวเดียว → ปฏิเสธ", () => {
    const tampered = BODY.replace('"p1"', '"p2"');
    expect(() =>
      verifyWebhookSignature({
        rawBody: tampered,
        signatureHeader: sign(BODY),
        appSecret: SECRET,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it("รูปแบบที่ไม่ใช่ sha256 → ปฏิเสธ", () => {
    for (const h of ["sha1=abc", "abc", "md5=abc"]) {
      expect(() =>
        verifyWebhookSignature({
          rawBody: BODY,
          signatureHeader: h,
          appSecret: SECRET,
        }),
        h,
      ).toThrow(WebhookSignatureError);
    }
  });

  it("ลายเซ็นสั้น/ยาวผิดปกติไม่ทำให้พัง (timingSafeEqual ต้องการความยาวเท่ากัน)", () => {
    for (const h of ["sha256=", "sha256=aa", "sha256=" + "a".repeat(200)]) {
      expect(() =>
        verifyWebhookSignature({
          rawBody: BODY,
          signatureHeader: h,
          appSecret: SECRET,
        }),
        h,
      ).toThrow(WebhookSignatureError);
    }
  });

  it("body ที่เรียงคีย์ต่างกันแต่ข้อมูลเหมือนกัน ต้องไม่ผ่าน", () => {
    // ยืนยันว่าเราตรวจจาก raw body จริงๆ ไม่ได้ parse แล้ว stringify ใหม่
    const reordered = JSON.stringify({ entry: [{ id: "p1" }], object: "page" });
    expect(() =>
      verifyWebhookSignature({
        rawBody: reordered,
        signatureHeader: sign(BODY),
        appSecret: SECRET,
      }),
    ).toThrow(WebhookSignatureError);
  });
});

describe("handleVerification — ตอน Meta มา subscribe ครั้งแรก", () => {
  it("token ถูกต้อง → คืน challenge", () => {
    expect(
      handleVerification({
        mode: "subscribe",
        token: "MY_TOKEN",
        challenge: "12345",
        expectedToken: "MY_TOKEN",
      }),
    ).toBe("12345");
  });

  it("token ผิด → ปฏิเสธพร้อมบอกให้เช็ค env", () => {
    const err = expectThaiThrow(() =>
      handleVerification({
        mode: "subscribe",
        token: "ผิด",
        challenge: "12345",
        expectedToken: "MY_TOKEN",
      }),
    );
    expect(err.th).toContain("META_WEBHOOK_VERIFY_TOKEN");
  });

  it("mode ไม่ใช่ subscribe → ปฏิเสธ", () => {
    expect(() =>
      handleVerification({
        mode: "unsubscribe",
        token: "MY_TOKEN",
        challenge: "1",
        expectedToken: "MY_TOKEN",
      }),
    ).toThrow(WebhookSignatureError);
  });

  it("ไม่มี challenge → ปฏิเสธ", () => {
    expect(() =>
      handleVerification({
        mode: "subscribe",
        token: "MY_TOKEN",
        challenge: null,
        expectedToken: "MY_TOKEN",
      }),
    ).toThrow(WebhookSignatureError);
  });

  it("token ว่าง → ปฏิเสธ", () => {
    expect(() =>
      handleVerification({
        mode: "subscribe",
        token: "",
        challenge: "1",
        expectedToken: "MY_TOKEN",
      }),
    ).toThrow(WebhookSignatureError);
  });
});
