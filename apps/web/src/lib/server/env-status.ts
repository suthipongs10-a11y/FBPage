import "server-only";

/**
 * สถานะของค่าตั้งค่าใน `.env` สำหรับแสดงบนหน้า `/settings`
 *
 * ─── ทำไมหน้าเว็บถึงแก้ค่าพวกนี้ไม่ได้ (และไม่ควรได้) ───
 *
 * ค่าเหล่านี้ถูกอ่านตอน **โปรเซสสตาร์ท** ไม่ใช่ตอนมีคนเปิดหน้าเว็บ แก้จากหน้าเว็บ
 * แล้วก็ต้องรีสตาร์ทอยู่ดี — และตัวที่สำคัญที่สุดคือ `TOKEN_ENC_KEYS` ซึ่งเป็น
 * กุญแจถอดรหัส token ทุกเพจ ถ้าหน้าเว็บเขียนทับได้ แปลว่าใครที่เข้าหน้านี้ได้
 * ก็ทำให้ token ทุกเพจใช้ไม่ได้ถาวรได้ในคลิกเดียว
 *
 * หน้านี้จึงเป็น "กระจกส่อง" อย่างเดียว: บอกว่าตั้งครบหรือยัง ขาดตัวไหน
 * และไปเอาค่ามาจากไหน ส่วนการแก้ให้ไปทำที่ `pnpm configure`
 */
import spec from "../../../../../config/env-spec.json" with { type: "json" };

export interface EnvVarStatus {
  key: string;
  labelTh: string;
  whereTh: string;
  group: string;
  required: boolean;
  secret: boolean;
  isSet: boolean;
  /** ค่าที่แสดงได้ — ของลับจะถูกปิดบัง ของไม่ลับแสดงตรงๆ */
  display: string;
}

function mask(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}••••••••${value.slice(-2)}`;
}

export function readEnvStatus(): {
  vars: EnvVarStatus[];
  missingRequired: string[];
} {
  const vars: EnvVarStatus[] = spec.map((v) => {
    const raw = process.env[v.key];
    const isSet = raw !== undefined && raw.trim() !== "";
    const secret = v.secret === true;
    return {
      key: v.key,
      labelTh: v.labelTh,
      whereTh: v.whereTh,
      group: v.group,
      required: v.need === "required",
      secret,
      isSet,
      display: !isSet
        ? ""
        : secret
          ? mask(raw.trim())
          : raw.trim(),
    };
  });

  return {
    vars,
    missingRequired: vars.filter((v) => v.required && !v.isSet).map((v) => v.key),
  };
}
