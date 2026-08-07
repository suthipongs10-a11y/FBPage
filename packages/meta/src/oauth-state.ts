/**
 * OAuth state — กัน CSRF ตอนลูกค้ากดเชื่อมเพจ
 *
 * ถ้าไม่ตรวจ state คนอื่นสามารถหลอกให้เบราว์เซอร์เราเรียก callback
 * ด้วย code ของบัญชีเขา → เพจของคนแปลกหน้าถูกผูกเข้า workspace ลูกค้าเรา
 *
 * ทำเป็น stateless (เซ็นด้วย HMAC) จะได้ไม่ต้องเก็บ session ฝั่งเซิร์ฟเวอร์
 *   state = <payload_b64url>.<hmac_b64url>
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface OAuthStatePayload {
  /** workspace ที่กำลังเชื่อมเพจให้ */
  workspaceId: string;
  /** ค่าสุ่มกัน replay */
  nonce: string;
  /** epoch ms ที่ออก state */
  issuedAtMs: number;
}

/** state มีอายุ 30 นาที — พอให้ลูกค้ากดเชื่อมเสร็จ แต่ไม่นานจนโดน replay */
export const OAUTH_STATE_TTL_MS = 30 * 60_000;

export class OAuthStateError extends Error {
  override readonly name = "OAuthStateError";
  /** ข้อความไทยสำหรับแสดงในหน้า callback */
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createOAuthState(
  args: { workspaceId: string; nowMs: number },
  secret: string,
): string {
  const payload: OAuthStatePayload = {
    workspaceId: args.workspaceId,
    nonce: randomBytes(16).toString("base64url"),
    issuedAtMs: args.nowMs,
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${b64}.${sign(b64, secret)}`;
}

/**
 * ตรวจ state ที่ Meta ส่งกลับมา
 * @throws OAuthStateError ถ้าลายเซ็นไม่ตรง รูปแบบผิด หรือหมดอายุ
 */
export function verifyOAuthState(
  state: string | undefined | null,
  secret: string,
  nowMs: number,
  ttlMs = OAUTH_STATE_TTL_MS,
): OAuthStatePayload {
  if (!state) {
    throw new OAuthStateError(
      "missing state",
      "ลิงก์เชื่อมเพจไม่ถูกต้อง — กรุณาเริ่มใหม่จากลิงก์ที่เราส่งให้",
    );
  }
  const dot = state.lastIndexOf(".");
  if (dot <= 0) {
    throw new OAuthStateError(
      "malformed state",
      "ลิงก์เชื่อมเพจไม่ถูกต้อง — กรุณาเริ่มใหม่จากลิงก์ที่เราส่งให้",
    );
  }
  const b64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  const expected = Buffer.from(sign(b64, secret), "utf8");
  const actual = Buffer.from(sig, "utf8");
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new OAuthStateError(
      "bad signature",
      "ลิงก์เชื่อมเพจถูกแก้ไข — เพื่อความปลอดภัยกรุณาเริ่มใหม่จากลิงก์ที่เราส่งให้",
    );
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(b64, "base64url").toString("utf8"),
    ) as OAuthStatePayload;
  } catch {
    throw new OAuthStateError(
      "unparseable payload",
      "ลิงก์เชื่อมเพจไม่ถูกต้อง — กรุณาเริ่มใหม่จากลิงก์ที่เราส่งให้",
    );
  }

  if (
    typeof payload?.workspaceId !== "string" ||
    typeof payload?.issuedAtMs !== "number"
  ) {
    throw new OAuthStateError(
      "invalid payload",
      "ลิงก์เชื่อมเพจไม่ถูกต้อง — กรุณาเริ่มใหม่จากลิงก์ที่เราส่งให้",
    );
  }

  const age = nowMs - payload.issuedAtMs;
  if (age > ttlMs) {
    throw new OAuthStateError(
      "state expired",
      "ลิงก์เชื่อมเพจหมดอายุแล้ว (เกิน 30 นาที) — กรุณาขอลิงก์ใหม่",
    );
  }
  // ออกจากอนาคต = นาฬิกาเพี้ยนหรือถูกปลอม
  if (age < -60_000) {
    throw new OAuthStateError(
      "state from future",
      "ลิงก์เชื่อมเพจไม่ถูกต้อง — กรุณาเริ่มใหม่จากลิงก์ที่เราส่งให้",
    );
  }

  return payload;
}
