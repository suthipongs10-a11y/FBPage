/**
 * ตรวจลายเซ็น webhook ของ Meta (M1)
 *
 * ถ้าไม่ตรวจ ใครก็ยิง POST เข้ามาที่ endpoint เราแล้วสั่งให้ระบบทำอะไรก็ได้
 * — ปลอมข้อความลูกค้า สั่งบอทตอบ หรือทำให้ข้อมูลในรายงานเพี้ยน
 *
 * Meta เซ็น payload ด้วย app secret แล้วส่งมาใน header `X-Hub-Signature-256`
 * รูปแบบ: `sha256=<hex>`
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { safeEqual } from "@page-os/core";

export class WebhookSignatureError extends Error {
  override readonly name = "WebhookSignatureError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

/**
 * ตรวจว่า payload มาจาก Meta จริง
 *
 * **ต้องใช้ raw body เท่านั้น** ห้ามใช้ผลลัพธ์จาก JSON.parse แล้ว stringify ใหม่
 * เพราะการเรียงคีย์และช่องว่างจะเปลี่ยน ทำให้ลายเซ็นไม่ตรงทั้งที่ข้อมูลถูก
 */
export function verifyWebhookSignature(args: {
  /** body ดิบตามที่รับมา ไม่ผ่าน parse */
  rawBody: string | Buffer;
  /** ค่าจาก header X-Hub-Signature-256 */
  signatureHeader: string | undefined | null;
  appSecret: string;
}): void {
  if (!args.signatureHeader) {
    throw new WebhookSignatureError(
      "missing signature header",
      "ไม่มีลายเซ็นใน request — ปฏิเสธเพราะยืนยันไม่ได้ว่ามาจาก Facebook",
    );
  }

  const prefix = "sha256=";
  if (!args.signatureHeader.startsWith(prefix)) {
    throw new WebhookSignatureError(
      "unsupported signature format",
      "รูปแบบลายเซ็นไม่ถูกต้อง — รองรับเฉพาะ sha256",
    );
  }

  const provided = args.signatureHeader.slice(prefix.length);
  const expected = createHmac("sha256", args.appSecret)
    .update(args.rawBody)
    .digest("hex");

  // ความยาวต้องเท่ากันก่อน ไม่งั้น timingSafeEqual โยน error
  if (provided.length !== expected.length) {
    throw new WebhookSignatureError(
      "signature length mismatch",
      "ลายเซ็นไม่ถูกต้อง — ปฏิเสธ request นี้",
    );
  }
  if (
    !timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))
  ) {
    throw new WebhookSignatureError(
      "signature mismatch",
      "ลายเซ็นไม่ถูกต้อง — ปฏิเสธ request นี้",
    );
  }
}

/**
 * ตรวจ verify token ตอน Meta เรียก GET มา subscribe ครั้งแรก
 * คืนค่า challenge ที่ต้องตอบกลับ
 */
export function handleVerification(args: {
  mode: string | undefined | null;
  token: string | undefined | null;
  challenge: string | undefined | null;
  expectedToken: string;
}): string {
  if (args.mode !== "subscribe") {
    throw new WebhookSignatureError(
      "unexpected hub.mode",
      "โหมดการยืนยันไม่ถูกต้อง",
    );
  }
  if (!args.token || !safeEqual(args.token, args.expectedToken)) {
    throw new WebhookSignatureError(
      "verify token mismatch",
      "verify token ไม่ตรงกับที่ตั้งไว้ — เช็คค่า META_WEBHOOK_VERIFY_TOKEN",
    );
  }
  if (!args.challenge) {
    throw new WebhookSignatureError(
      "missing challenge",
      "ไม่มี hub.challenge ใน request",
    );
  }
  return args.challenge;
}
