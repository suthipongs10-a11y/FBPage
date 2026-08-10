/**
 * รายการค่าตั้งค่าทั้งหมดของระบบ
 *
 * **ข้อมูลบรรยาย** (ชื่อ, คำอธิบาย, จำเป็นไหม) อยู่ใน `config/env-spec.json`
 * ที่เดียว — ไฟล์นี้อ่านมาแล้วเติม "ตัวตรวจรูปแบบ" ให้เท่านั้น
 *
 * ที่ต้องแยกเป็น JSON เพราะมีผู้ใช้สองฝั่งที่รันคนละที่:
 *   - สคริปต์ CLI (`setup`, `doctor`) — ต้องทำงานได้แม้ยังไม่ได้ build
 *   - หน้า `/settings` บนเว็บ — อยู่คนละแพ็กเกจ import ไฟล์ .mjs ข้ามมาไม่สะดวก
 *
 * ถ้าแยกกันประกาศ วันหนึ่งจะเกิดสถานการณ์ที่ `doctor` บอกว่า "พร้อมแล้ว"
 * แต่ service สตาร์ทไม่ขึ้นเพราะขาดค่าที่ doctor ไม่รู้จัก
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SPEC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "env-spec.json",
);

const isBlank = (v) => v.trim() === "";

/**
 * ตัวตรวจรูปแบบของแต่ละค่า — คืนข้อความไทยถ้าผิด คืน null ถ้าผ่าน
 *
 * อยู่ในไฟล์ .mjs ไม่ใช่ JSON เพราะเป็นฟังก์ชัน และเป็นของที่มีแต่ CLI ใช้
 * (หน้าเว็บบอกแค่ว่า "ตั้งแล้ว/ยังไม่ตั้ง" แล้วชี้ให้ไปรัน `pnpm preflight`)
 */
const VALIDATORS = {
  META_APP_ID: (v) =>
    /^\d{10,20}$/.test(v.trim())
      ? null
      : "App ID ของ Meta เป็นตัวเลขล้วน 10–20 หลัก — ที่ใส่มาไม่ใช่รูปแบบนั้น",

  META_APP_SECRET: (v) =>
    /^[a-f0-9]{32}$/i.test(v.trim())
      ? null
      : "App Secret ของ Meta เป็นเลขฐาน 16 จำนวน 32 ตัว — ที่ใส่มายาว " +
        `${v.trim().length} ตัว เช็คว่าก๊อปมาครบหรือมีช่องว่างติดมาไหม`,

  META_WEBHOOK_VERIFY_TOKEN: (v) =>
    v.trim().length >= 12
      ? null
      : "ควรยาวอย่างน้อย 12 ตัวอักษร — ค่านี้คือสิ่งเดียวที่กันคนอื่นมาสวมรอย " +
        "เป็น Meta ตอนตั้ง webhook",

  GRAPH_VERSION: (v) =>
    /^v\d+\.\d+$/.test(v.trim())
      ? null
      : 'รูปแบบต้องเป็น "v" ตามด้วยเลขเวอร์ชัน เช่น v25.0',

  TOKEN_ENC_KEYS: (v) => {
    for (const p of v.trim().split(",")) {
      const i = p.indexOf(":");
      if (i < 0) return `รูปแบบต้องเป็น "keyId:base64key" — ท่อน "${p}" ไม่มี :`;
      if (Buffer.from(p.slice(i + 1), "base64").length !== 32) {
        return `กุญแจ "${p.slice(0, i)}" ต้องยาว 32 ไบต์หลังถอด base64 (AES-256)`;
      }
    }
    return null;
  },

  DATABASE_URL: (v) => urlOf(v, ["postgresql:", "postgres:"], "postgresql://user:pass@host:port/dbname"),
  REDIS_URL: (v) => urlOf(v, ["redis:", "rediss:"], "redis://host:port"),

  WEBHOOK_PORT: (v) =>
    /^\d+$/.test(v.trim()) && Number(v) > 0 && Number(v) < 65536
      ? null
      : "ต้องเป็นเลขพอร์ตระหว่าง 1–65535",

  LOG_LEVEL: (v) =>
    ["debug", "info", "warn", "error"].includes(v.trim())
      ? null
      : "ต้องเป็น debug / info / warn / error อย่างใดอย่างหนึ่ง",
};

function urlOf(v, protocols, exampleTh) {
  try {
    const u = new URL(v.trim());
    return protocols.includes(u.protocol)
      ? null
      : `ต้องขึ้นต้นด้วย ${protocols[0]}// — ที่ใส่มาขึ้นต้นด้วย ${u.protocol}//`;
  } catch {
    return `ไม่ใช่ URL ที่อ่านได้ — รูปแบบคือ ${exampleTh}`;
  }
}

/** @type {Array<Record<string, unknown> & {key: string, validate?: (v: string) => string | null}>} */
export const ENV_SPEC = JSON.parse(readFileSync(SPEC_PATH, "utf8")).map((v) => ({
  ...v,
  ...(VALIDATORS[v.key] !== undefined ? { validate: VALIDATORS[v.key] } : {}),
}));

/** ค่าที่ขาดแล้ว service สตาร์ทไม่ขึ้น */
export const REQUIRED_KEYS = ENV_SPEC.filter((v) => v.need === "required").map(
  (v) => v.key,
);

export const BY_KEY = new Map(ENV_SPEC.map((v) => [v.key, v]));

/**
 * แปลงเนื้อไฟล์ .env เป็นออบเจ็กต์
 *
 * เขียนเองแทนที่จะลงไลบรารี เพราะไฟล์นี้ถูกอ่านโดยสคริปต์ที่ต้องทำงานได้
 * ตั้งแต่ก่อน `pnpm install` — ตอนนั้นยังไม่มี node_modules ให้ใช้
 */
export function parseEnvFile(text) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    // รองรับค่าที่ใส่เครื่องหมายคำพูดครอบไว้
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * ตรวจค่าทั้งชุด คืนรายการปัญหาเป็นภาษาไทย
 * @param {Record<string,string|undefined>} env
 */
export function checkEnv(env) {
  /** @type {Array<{key:string, level:"error"|"warn", th:string}>} */
  const problems = [];

  for (const spec of ENV_SPEC) {
    const raw = env[spec.key];
    const missing = raw === undefined || isBlank(raw);

    if (missing) {
      if (spec.need === "required") {
        problems.push({
          key: spec.key,
          level: "error",
          th: `ยังไม่ได้ตั้ง ${spec.key} (${spec.labelTh}) — ${spec.whereTh}`,
        });
      }
      continue;
    }

    const err = spec.validate?.(raw);
    if (err !== null && err !== undefined) {
      problems.push({ key: spec.key, level: "error", th: `${spec.key}: ${err}` });
    }
  }

  return problems;
}

/** ปิดบังค่าลับตอนแสดงผล — พอให้รู้ว่าตั้งแล้ว แต่ไม่พอให้เอาไปใช้ */
export function maskSecret(value) {
  if (value === undefined || value === "") return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}••••••••${value.slice(-2)} (${value.length} ตัวอักษร)`;
}
