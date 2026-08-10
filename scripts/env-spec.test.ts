/**
 * เทสต์ของสเปกค่าตั้งค่า
 *
 * ตัวนี้เป็นด่านแรกสุดที่คนเจอตอนติดตั้ง ถ้ามันบอกผิดว่า "ครบแล้ว"
 * คนจะไปเจอ error จริงตอน service สตาร์ทไม่ขึ้น ซึ่งไกลจากจุดที่แก้ได้มาก
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — สคริปต์ติดตั้งเป็น .mjs โดยตั้งใจ (ต้องรันได้ก่อน build)
import { BY_KEY, ENV_SPEC, REQUIRED_KEYS, checkEnv, maskSecret, parseEnvFile } from "./env-spec.mjs";

interface Spec {
  key: string;
  need: string;
  labelTh: string;
  whereTh: string;
  group: string;
  secret?: boolean;
  validate?: (v: string) => string | null;
}

const spec = (key: string): Spec => BY_KEY.get(key) as Spec;

/** ค่าที่ครบและถูกต้องทุกช่อง — ใช้เป็นฐานแล้วค่อยทำให้พังทีละอย่าง */
const GOOD: Record<string, string> = {
  META_APP_ID: "1234567890123",
  META_APP_SECRET: "0123456789abcdef0123456789abcdef",
  META_WEBHOOK_VERIFY_TOKEN: "verify-token-ที่ยาวพอ",
  TOKEN_ENC_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
  DATABASE_URL: "postgresql://pageos:pageos@localhost:5432/pageos",
  REDIS_URL: "redis://localhost:6379",
};

describe("สเปกค่าตั้งค่า", () => {
  it("ทุกค่ามีคำอธิบายและบอกว่าไปเอามาจากไหน", () => {
    for (const v of ENV_SPEC as Spec[]) {
      expect(v.labelTh.length, v.key).toBeGreaterThan(3);
      expect(v.whereTh.length, v.key).toBeGreaterThan(10);
      expect(v.group.length, v.key).toBeGreaterThan(0);
    }
  });

  it("ชื่อไม่ซ้ำกัน", () => {
    const keys = (ENV_SPEC as Spec[]).map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * ค่าที่ service อ่านตอนสตาร์ทต้องอยู่ในรายการนี้ครบ ไม่งั้น `doctor`
   * จะบอกว่าพร้อมแล้วทั้งที่ยังขาด แล้ว service จะสตาร์ทไม่ขึ้น
   */
  it("ค่าที่จำเป็นครอบคลุมทุกตัวที่ service อ่านตอนสตาร์ท", () => {
    for (const key of [
      "META_APP_ID",
      "META_APP_SECRET",
      "META_WEBHOOK_VERIFY_TOKEN",
      "TOKEN_ENC_KEYS",
      "DATABASE_URL",
      "REDIS_URL",
    ]) {
      expect(REQUIRED_KEYS, key).toContain(key);
    }
  });

  it("ค่าลับถูกทำเครื่องหมายไว้ครบ", () => {
    for (const key of ["META_APP_SECRET", "TOKEN_ENC_KEYS", "META_WEBHOOK_VERIFY_TOKEN"]) {
      expect(spec(key).secret, key).toBe(true);
    }
  });
});

describe("checkEnv", () => {
  it("ค่าครบและถูกต้อง → ไม่มีปัญหา", () => {
    expect(checkEnv(GOOD)).toEqual([]);
  });

  it("ขาดค่าจำเป็น → บอกชื่อค่าและบอกว่าไปเอามาจากไหน", () => {
    const { META_APP_SECRET, ...rest } = GOOD;
    void META_APP_SECRET;
    const problems = checkEnv(rest);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.key).toBe("META_APP_SECRET");
    expect(problems[0]?.th).toContain("META_APP_SECRET");
    expect(problems[0]?.th).toContain("App Secret");
  });

  it("ค่าว่างเปล่านับว่าไม่ได้ตั้ง", () => {
    expect(checkEnv({ ...GOOD, DATABASE_URL: "   " })).toHaveLength(1);
  });

  it("ค่าไม่จำเป็นที่ไม่ได้ตั้ง ไม่ถือว่าเป็นปัญหา", () => {
    expect(checkEnv(GOOD)).toEqual([]);
  });

  it("ค่าไม่จำเป็นที่ตั้งมาผิดรูปแบบ ยังถือว่าเป็นปัญหา", () => {
    // ตั้งมาแล้วผิด ต่างจากไม่ได้ตั้ง — ตั้งมาผิดแปลว่าตั้งใจใส่แต่ใส่พลาด
    expect(checkEnv({ ...GOOD, LOG_LEVEL: "โหด" })).toHaveLength(1);
  });
});

describe("ตัวตรวจรูปแบบของแต่ละค่า", () => {
  it("App ID ต้องเป็นตัวเลขล้วน", () => {
    expect(spec("META_APP_ID").validate?.("1234567890123")).toBeNull();
    for (const bad of ["abc", "12345", "123456789012345678901", "123 456"]) {
      expect(spec("META_APP_ID").validate?.(bad), bad).not.toBeNull();
    }
  });

  /** ความผิดพลาดที่พบบ่อยที่สุด: ก๊อป secret มาไม่ครบ หรือมีช่องว่างติดมา */
  it("App Secret ต้องเป็นฐาน 16 จำนวน 32 ตัว และบอกความยาวที่ใส่มา", () => {
    expect(spec("META_APP_SECRET").validate?.(GOOD.META_APP_SECRET!)).toBeNull();
    const msg = spec("META_APP_SECRET").validate?.("0123456789abcdef");
    expect(msg).toContain("16 ตัว");
  });

  it("App Secret ที่มีช่องว่างหน้า-หลัง ยังผ่าน (คนก๊อปมามักติดมาด้วย)", () => {
    expect(spec("META_APP_SECRET").validate?.(` ${GOOD.META_APP_SECRET} `)).toBeNull();
  });

  it("กุญแจเข้ารหัสต้องยาว 32 ไบต์หลังถอด base64", () => {
    expect(spec("TOKEN_ENC_KEYS").validate?.(GOOD.TOKEN_ENC_KEYS!)).toBeNull();
    // สั้นไป = AES-256 ใช้ไม่ได้
    expect(
      spec("TOKEN_ENC_KEYS").validate?.(`k1:${Buffer.alloc(16).toString("base64")}`),
    ).toContain("32 ไบต์");
    expect(spec("TOKEN_ENC_KEYS").validate?.("ไม่มีโคลอน")).toContain(":");
  });

  it("กุญแจหลายดอกคั่นด้วยจุลภาค (ตอน rotate key)", () => {
    const two = `k2:${Buffer.alloc(32, 1).toString("base64")},k1:${Buffer.alloc(32, 2).toString("base64")}`;
    expect(spec("TOKEN_ENC_KEYS").validate?.(two)).toBeNull();
  });

  it("DATABASE_URL ที่ชี้ผิดชนิดฐานข้อมูล → บอกว่าที่ใส่มาเป็นอะไร", () => {
    const msg = spec("DATABASE_URL").validate?.("mysql://localhost/x");
    expect(msg).toContain("mysql:");
  });

  it("URL ที่อ่านไม่ออกเลย → บอกรูปแบบที่ต้องการ", () => {
    expect(spec("REDIS_URL").validate?.("ที่อยู่ redis ของฉัน")).toContain(
      "redis://host:port",
    );
  });

  /**
   * `new URL("localhost:6379")` แปลงผ่าน โดยมองว่า "localhost:" คือ protocol
   * จึงตกไปทางข้อความ "ขึ้นต้นผิด" ไม่ใช่ "อ่านไม่ออก" — ซึ่งยังบอกปัญหาถูก
   * เขียนเทสต์ล็อกไว้เพราะเป็นค่าที่คนพิมพ์ผิดแบบนี้บ่อย
   */
  it('พิมพ์ "localhost:6379" โดยลืม redis:// → บอกว่าขึ้นต้นผิด', () => {
    expect(spec("REDIS_URL").validate?.("localhost:6379")).toContain("redis://");
  });

  /** ใส่ 6 ช่องแบบที่มีวินาที เป็นความผิดพลาดที่ทำให้เวลาเลื่อนทั้งกระดาน */
  it("GRAPH_VERSION ต้องเป็นรูป vXX.Y", () => {
    expect(spec("GRAPH_VERSION").validate?.("v25.0")).toBeNull();
    expect(spec("GRAPH_VERSION").validate?.("25.0")).not.toBeNull();
  });
});

describe("parseEnvFile", () => {
  it("อ่านค่าปกติได้", () => {
    expect(parseEnvFile("A=1\nB=สอง\n")).toEqual({ A: "1", B: "สอง" });
  });

  it("ข้ามคอมเมนต์และบรรทัดว่าง", () => {
    expect(parseEnvFile("# หมายเหตุ\n\nA=1\n")).toEqual({ A: "1" });
  });

  it("ค่าที่มีเครื่องหมาย = อยู่ข้างในไม่ถูกตัด", () => {
    // base64 ลงท้ายด้วย = เสมอ — ถ้าตัดผิดกุญแจจะใช้ไม่ได้ทั้งดอก
    expect(parseEnvFile("TOKEN_ENC_KEYS=k1:abc==\n")).toEqual({
      TOKEN_ENC_KEYS: "k1:abc==",
    });
  });

  it("ค่าที่ครอบด้วยเครื่องหมายคำพูดถูกถอดออกให้", () => {
    expect(parseEnvFile('A="ค่า"\nB=\'ค่า\'\n')).toEqual({ A: "ค่า", B: "ค่า" });
  });

  it("บรรทัดที่ไม่มี = ถูกข้ามไปเฉยๆ ไม่พัง", () => {
    expect(parseEnvFile("ขยะ\nA=1\n")).toEqual({ A: "1" });
  });
});

describe("maskSecret", () => {
  it("บอกได้ว่าตั้งแล้ว แต่ไม่พอให้เอาไปใช้", () => {
    const secret = "EAAGabcdefghijklmnop";
    const masked = maskSecret(secret);
    expect(masked).not.toContain("abcdefghijklm");
    expect(masked).toContain("EAA");
  });

  it("ค่าสั้นถูกปิดทั้งหมด", () => {
    expect(maskSecret("sh0rt")).toBe("••••••••");
  });
});
