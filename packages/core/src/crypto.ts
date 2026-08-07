/**
 * Token encryption — AES-256-GCM.
 *
 * กฎข้อ 3 ของ PAGE OS: token ต้องเข้ารหัสเสมอ ห้ามเก็บ plaintext
 *
 * รูปแบบ ciphertext ที่เก็บลง DB (string เดียว ไม่ต้องมีคอลัมน์เพิ่ม):
 *   v1.<keyId>.<iv_b64url>.<authTag_b64url>.<ciphertext_b64url>
 *
 * keyId ทำให้ rotate key ได้โดยไม่ต้อง re-encrypt ทั้งตารางในทีเดียว —
 * decrypt เลือก key ตาม keyId ที่ฝังมากับ ciphertext
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256
const FORMAT_VERSION = "v1";

export class CryptoError extends Error {
  override readonly name = "CryptoError";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function unb64url(s: string, what: string): Buffer {
  const buf = Buffer.from(s, "base64url");
  if (buf.length === 0 && s.length > 0) {
    throw new CryptoError(`ถอดรหัสไม่ได้: ${what} ไม่ใช่ base64url ที่ถูกต้อง`);
  }
  return buf;
}

/** keyId ต้องเป็น token สั้นๆ ที่ไม่มีจุด เพราะจุดเป็นตัวคั่นของ format */
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface KeyringEntry {
  keyId: string;
  key: Buffer;
}

/**
 * Keyring รองรับหลาย key พร้อมกัน: primary ใช้เข้ารหัสของใหม่,
 * ที่เหลือเก็บไว้ decrypt ของเก่าระหว่างช่วง rotate
 */
export class Keyring {
  private readonly keys = new Map<string, Buffer>();
  readonly primaryKeyId: string;

  constructor(entries: KeyringEntry[]) {
    if (entries.length === 0) {
      throw new CryptoError("Keyring ต้องมีอย่างน้อย 1 key");
    }
    for (const e of entries) {
      if (!KEY_ID_RE.test(e.keyId)) {
        throw new CryptoError(
          `keyId "${e.keyId}" ไม่ถูกต้อง — ใช้ได้แค่ A-Z a-z 0-9 _ - ยาวไม่เกิน 32`,
        );
      }
      if (e.key.length !== KEY_BYTES) {
        throw new CryptoError(
          `key "${e.keyId}" ยาว ${e.key.length} ไบต์ ต้องเป็น ${KEY_BYTES} ไบต์ (AES-256)`,
        );
      }
      if (this.keys.has(e.keyId)) {
        throw new CryptoError(`keyId "${e.keyId}" ซ้ำใน keyring`);
      }
      this.keys.set(e.keyId, e.key);
    }
    this.primaryKeyId = entries[0]!.keyId;
  }

  get(keyId: string): Buffer | undefined {
    return this.keys.get(keyId);
  }

  get keyIds(): string[] {
    return [...this.keys.keys()];
  }

  /**
   * อ่าน keyring จาก env.
   *
   * รูปแบบ: `TOKEN_ENC_KEYS="k1:<base64 32 ไบต์>,k0:<base64 32 ไบต์>"`
   * ตัวแรกคือ primary (ใช้เข้ารหัสของใหม่)
   */
  static fromEnv(raw: string | undefined, varName = "TOKEN_ENC_KEYS"): Keyring {
    if (!raw || raw.trim() === "") {
      throw new CryptoError(
        `ไม่พบ env ${varName} — ต้องตั้งค่าก่อนใช้งาน (รูปแบบ "keyId:base64key,...")`,
      );
    }
    const entries: KeyringEntry[] = [];
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (trimmed === "") continue;
      const idx = trimmed.indexOf(":");
      if (idx <= 0) {
        throw new CryptoError(
          `env ${varName} รูปแบบผิด — แต่ละรายการต้องเป็น "keyId:base64key"`,
        );
      }
      const keyId = trimmed.slice(0, idx);
      const keyB64 = trimmed.slice(idx + 1);
      let key: Buffer;
      try {
        key = Buffer.from(keyB64, "base64");
      } catch {
        throw new CryptoError(`key ของ "${keyId}" ไม่ใช่ base64`);
      }
      entries.push({ keyId, key });
    }
    return new Keyring(entries);
  }

  /** สร้าง key ใหม่แบบสุ่มสำหรับใส่ env (ใช้ตอน setup / rotate) */
  static generateKeyB64(): string {
    return randomBytes(KEY_BYTES).toString("base64");
  }
}

/**
 * เข้ารหัส plaintext token
 *
 * @param aad Additional Authenticated Data — ผูก ciphertext กับ context เช่น pageId
 *            ทำให้ก๊อป ciphertext ของเพจ A ไปแปะเป็นของเพจ B แล้ว decrypt ไม่ผ่าน
 */
export function encryptToken(
  plaintext: string,
  keyring: Keyring,
  aad?: string,
): string {
  if (typeof plaintext !== "string" || plaintext === "") {
    throw new CryptoError("encryptToken: plaintext ต้องเป็น string ที่ไม่ว่าง");
  }
  const keyId = keyring.primaryKeyId;
  const key = keyring.get(keyId)!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, keyId, b64url(iv), b64url(tag), b64url(ct)].join(".");
}

/** ถอดรหัส — โยน CryptoError ถ้า tag ไม่ตรง (ข้อมูลถูกแก้) หรือหา key ไม่เจอ */
export function decryptToken(
  packed: string,
  keyring: Keyring,
  aad?: string,
): string {
  if (typeof packed !== "string") {
    throw new CryptoError("decryptToken: ต้องเป็น string");
  }
  const parts = packed.split(".");
  if (parts.length !== 5) {
    throw new CryptoError("decryptToken: รูปแบบ ciphertext ไม่ถูกต้อง");
  }
  const [version, keyId, ivB64, tagB64, ctB64] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== FORMAT_VERSION) {
    throw new CryptoError(`decryptToken: ไม่รองรับ format "${version}"`);
  }
  const key = keyring.get(keyId);
  if (!key) {
    throw new CryptoError(
      `decryptToken: ไม่พบ key "${keyId}" ใน keyring — ถ้าเพิ่ง rotate ให้เก็บ key เก่าไว้ใน TOKEN_ENC_KEYS ด้วย`,
    );
  }
  const iv = unb64url(ivB64, "iv");
  const tag = unb64url(tagB64, "authTag");
  const ct = unb64url(ctB64, "ciphertext");
  if (iv.length !== IV_BYTES) {
    throw new CryptoError("decryptToken: ความยาว iv ไม่ถูกต้อง");
  }
  if (tag.length !== TAG_BYTES) {
    throw new CryptoError("decryptToken: ความยาว authTag ไม่ถูกต้อง");
  }
  const decipher = createDecipheriv(ALGO, key, iv, {
    authTagLength: TAG_BYTES,
  });
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    // ไม่ส่ง error ดิบออกไป กัน oracle attack
    throw new CryptoError(
      "decryptToken: ถอดรหัสไม่สำเร็จ — ข้อมูลถูกแก้ไข, key ไม่ตรง, หรือ AAD ไม่ตรง",
    );
  }
}

/** เทียบ string แบบ constant-time (ใช้กับ webhook verify token / signature) */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
