import { describe, expect, it } from "vitest";
import {
  CryptoError,
  Keyring,
  decryptToken,
  encryptToken,
  safeEqual,
} from "./crypto.js";

const KEY_A = Buffer.alloc(32, 1);
const KEY_B = Buffer.alloc(32, 2);
const ring = new Keyring([{ keyId: "k1", key: KEY_A }]);

const SAMPLE_TOKEN =
  "EAAGm0PX4ZCpsBAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxZDZD";

describe("Keyring", () => {
  it("ปฏิเสธ key ที่ไม่ใช่ 32 ไบต์", () => {
    expect(() => new Keyring([{ keyId: "k", key: Buffer.alloc(16) }])).toThrow(
      CryptoError,
    );
  });

  it("ปฏิเสธ keyId ที่มีจุด (ชนกับตัวคั่นของ format)", () => {
    expect(() => new Keyring([{ keyId: "k.1", key: KEY_A }])).toThrow(
      /keyId/,
    );
  });

  it("ปฏิเสธ keyId ซ้ำ", () => {
    expect(
      () =>
        new Keyring([
          { keyId: "k1", key: KEY_A },
          { keyId: "k1", key: KEY_B },
        ]),
    ).toThrow(/ซ้ำ/);
  });

  it("ปฏิเสธ keyring ว่าง", () => {
    expect(() => new Keyring([])).toThrow(CryptoError);
  });

  it("อ่านจาก env ได้ และตัวแรกเป็น primary", () => {
    const r = Keyring.fromEnv(
      `k2:${KEY_B.toString("base64")},k1:${KEY_A.toString("base64")}`,
    );
    expect(r.primaryKeyId).toBe("k2");
    expect(r.keyIds).toEqual(["k2", "k1"]);
  });

  it("โยน error พร้อมชื่อ env เมื่อไม่ได้ตั้งค่า", () => {
    expect(() => Keyring.fromEnv(undefined)).toThrow(/TOKEN_ENC_KEYS/);
    expect(() => Keyring.fromEnv("   ")).toThrow(/TOKEN_ENC_KEYS/);
  });

  it("โยน error เมื่อรูปแบบ env ผิด", () => {
    expect(() => Keyring.fromEnv("ไม่มีโคลอน")).toThrow(/รูปแบบผิด/);
  });

  it("generateKeyB64 ได้ key ยาว 32 ไบต์ และไม่ซ้ำกัน", () => {
    const a = Keyring.generateKeyB64();
    const b = Keyring.generateKeyB64();
    expect(Buffer.from(a, "base64")).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});

describe("encryptToken / decryptToken", () => {
  it("เข้ารหัสแล้วถอดกลับได้ค่าเดิม", () => {
    const packed = encryptToken(SAMPLE_TOKEN, ring);
    expect(decryptToken(packed, ring)).toBe(SAMPLE_TOKEN);
  });

  it("ciphertext ต้องไม่มี plaintext ปนอยู่เลย", () => {
    const packed = encryptToken(SAMPLE_TOKEN, ring);
    expect(packed).not.toContain(SAMPLE_TOKEN);
    expect(packed).not.toContain(SAMPLE_TOKEN.slice(0, 12));
    expect(packed.startsWith("v1.k1.")).toBe(true);
  });

  it("เข้ารหัสค่าเดิมสองครั้งได้ ciphertext ต่างกัน (IV สุ่ม)", () => {
    expect(encryptToken(SAMPLE_TOKEN, ring)).not.toBe(
      encryptToken(SAMPLE_TOKEN, ring),
    );
  });

  it("รองรับข้อความไทยและอักขระพิเศษ", () => {
    const s = "โทเคน|ทดสอบ✓\n\t<>&";
    expect(decryptToken(encryptToken(s, ring), ring)).toBe(s);
  });

  it("ปฏิเสธ plaintext ว่าง", () => {
    expect(() => encryptToken("", ring)).toThrow(CryptoError);
  });

  it("ถอดรหัสไม่ผ่านถ้า ciphertext ถูกแก้", () => {
    const packed = encryptToken(SAMPLE_TOKEN, ring);
    const parts = packed.split(".");
    const ct = Buffer.from(parts[4]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString("base64url");
    expect(() => decryptToken(parts.join("."), ring)).toThrow(/ถอดรหัสไม่สำเร็จ/);
  });

  it("ถอดรหัสไม่ผ่านถ้า authTag ถูกแก้", () => {
    const parts = encryptToken(SAMPLE_TOKEN, ring).split(".");
    const tag = Buffer.from(parts[3]!, "base64url");
    tag[0] = tag[0]! ^ 0xff;
    parts[3] = tag.toString("base64url");
    expect(() => decryptToken(parts.join("."), ring)).toThrow(CryptoError);
  });

  it("ถอดรหัสไม่ผ่านถ้าใช้ key คนละตัว", () => {
    const other = new Keyring([{ keyId: "k1", key: KEY_B }]);
    const packed = encryptToken(SAMPLE_TOKEN, ring);
    expect(() => decryptToken(packed, other)).toThrow(CryptoError);
  });

  it("โยน error ที่บอกวิธีแก้ เมื่อหา keyId ไม่เจอ", () => {
    const packed = encryptToken(SAMPLE_TOKEN, ring);
    const other = new Keyring([{ keyId: "k9", key: KEY_B }]);
    expect(() => decryptToken(packed, other)).toThrow(/TOKEN_ENC_KEYS/);
  });

  it("ปฏิเสธ format ที่ไม่รู้จัก", () => {
    expect(() => decryptToken("v2.k1.a.b.c", ring)).toThrow(/format/);
    expect(() => decryptToken("มั่วๆ", ring)).toThrow(/รูปแบบ/);
  });

  describe("AAD ผูก ciphertext กับ pageId", () => {
    it("ถอดได้เมื่อ AAD ตรง", () => {
      const packed = encryptToken(SAMPLE_TOKEN, ring, "page:123");
      expect(decryptToken(packed, ring, "page:123")).toBe(SAMPLE_TOKEN);
    });

    it("ก๊อป ciphertext ของเพจ A ไปใช้เป็นของเพจ B ไม่ได้", () => {
      const packed = encryptToken(SAMPLE_TOKEN, ring, "page:123");
      expect(() => decryptToken(packed, ring, "page:456")).toThrow(
        /ถอดรหัสไม่สำเร็จ/,
      );
    });

    it("ถอดไม่ได้ถ้าลืมใส่ AAD", () => {
      const packed = encryptToken(SAMPLE_TOKEN, ring, "page:123");
      expect(() => decryptToken(packed, ring)).toThrow(CryptoError);
    });
  });

  describe("key rotation", () => {
    it("ของเก่าที่เข้ารหัสด้วย key เดิม ยังถอดได้หลังเพิ่ม key ใหม่", () => {
      const oldRing = new Keyring([{ keyId: "k1", key: KEY_A }]);
      const oldPacked = encryptToken(SAMPLE_TOKEN, oldRing);

      // rotate: k2 เป็น primary, เก็บ k1 ไว้ถอดของเก่า
      const rotated = new Keyring([
        { keyId: "k2", key: KEY_B },
        { keyId: "k1", key: KEY_A },
      ]);
      expect(decryptToken(oldPacked, rotated)).toBe(SAMPLE_TOKEN);

      // ของใหม่ใช้ k2
      const newPacked = encryptToken(SAMPLE_TOKEN, rotated);
      expect(newPacked.startsWith("v1.k2.")).toBe(true);
      expect(decryptToken(newPacked, rotated)).toBe(SAMPLE_TOKEN);
    });
  });
});

describe("safeEqual", () => {
  it("true เมื่อเหมือนกัน", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });
  it("false เมื่อต่างกัน หรือความยาวไม่เท่ากัน", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });
});
