/**
 * Redaction — กฎข้อ 3 ของ PAGE OS: "ห้าม log token แม้บางส่วน"
 *
 * แนวคิด: อย่าไว้ใจว่าคนเรียกจะจำได้ว่าต้องลบ token เอง
 * ให้ logger scrub ให้อัตโนมัติทั้ง (ก) ตาม key ที่รู้จัก และ (ข) ตาม pattern ของค่า
 */

/**
 * key ที่ค่าข้างในถือว่าเป็นความลับเสมอ ไม่ว่าจะหน้าตายังไง
 *
 * ทุกคำในนี้ยาวพอที่จะไม่ไปโผล่กลางคำธรรมดาโดยบังเอิญ จึงเทียบแบบ substring ได้
 * คำสั้นกว่านี้อยู่ที่ `SHORT_SECRET_KEYS` ข้างล่าง
 */
const SECRET_KEY_RE =
  /(token|secret|password|passwd|credential|authorization|signature|api[-_]?key|client[-_]?secret|appsecret|cookie|session|private[-_]?key)/i;

/**
 * คำสั้นที่ต้องเทียบแบบ "เต็มท่อน" ไม่ใช่ substring
 *
 * เคยเทียบแบบ substring แล้วเจอปัญหาจริงตอนรัน worker: log ของการปิดระบบ
 * ขึ้นว่า `"signal": "[REDACTED]"` เพราะ **sig**nal มี "sig" อยู่ข้างใน
 * ไล่ต่อแล้วเจออีกหลายคำที่โดนกลืนไปเงียบๆ:
 *
 *   in**sig**hts  → ตัวเลขทั้งโดเมน analytics หายจาก log
 *   **auth**orName → ชื่อคนคอมเมนต์หาย ทำให้ไล่เคสคอมเมนต์ไม่ได้
 *   de**sig**nId, as**sig**nee
 *
 * การ redact เกินไม่ได้ทำให้ระบบไม่ปลอดภัย แต่ทำให้ log ใช้สอบสวนไม่ได้ —
 * ซึ่งพอถึงเวลาจริงก็แปลว่าเราไม่มี log
 *
 * ⚠️ ทั้ง `signature` และ `authorization` ยังอยู่ในรายการข้างบนแบบ substring
 * การเปลี่ยนตรงนี้จึงไม่ได้เปิดช่องให้ค่าที่เป็นความลับหลุดเพิ่ม
 */
const SHORT_SECRET_KEYS: ReadonlySet<string> = new Set(["sig", "auth"]);

/**
 * ตัดชื่อ key เป็นท่อนๆ ตาม `-` `_` `.` และจุดที่เปลี่ยนเป็นตัวพิมพ์ใหญ่
 * `"x-hub-sig"` → `["x","hub","sig"]`, `"sigValue"` → `["sig","value"]`
 */
function keySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+|\s+/)
    .filter((s) => s !== "")
    .map((s) => s.toLowerCase());
}

/** key ที่ "ลงท้ายด้วย _id" มักไม่ใช่ความลับ กันไม่ให้ redact เกินจนอ่าน log ไม่รู้เรื่อง */
const SAFE_KEY_RE = /^(page_id|user_id|app_id|token_type|token_id)$/i;

export const REDACTED = "[REDACTED]";

/**
 * Pattern ของค่าที่เป็น token ของ Meta / ทั่วไป
 * - Meta user & page token ขึ้นต้น EAA แล้วตามด้วยฐาน 64-ish ยาวๆ
 * - appsecret_proof / hex 64 ตัว
 * - Bearer <...>
 */
const VALUE_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /EAA[A-Za-z0-9_-]{20,}/g, replace: REDACTED },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace: `Bearer ${REDACTED}` },
  { re: /\b[a-f0-9]{64}\b/g, replace: REDACTED },
  // query string ที่พก secret มาด้วย เช่น ...&access_token=xxx
  {
    re: /([?&](?:access_token|client_secret|appsecret_proof|input_token|fb_exchange_token)=)[^&\s"']+/gi,
    replace: `$1${REDACTED}`,
  },
];

/** scrub ค่าที่เป็น string ตัวเดียว */
export function redactString(input: string): string {
  let out = input;
  for (const { re, replace } of VALUE_PATTERNS) {
    // regex มี /g → ต้อง reset lastIndex กันสถานะค้างข้ามการเรียก
    re.lastIndex = 0;
    out = out.replace(re, replace);
  }
  return out;
}

/** ค่านี้เป็นความลับเพราะ "ชื่อ key" บอกว่าเป็นความลับหรือเปล่า */
export function isSecretKey(key: string): boolean {
  if (SAFE_KEY_RE.test(key)) return false;
  if (SECRET_KEY_RE.test(key)) return true;
  return keySegments(key).some((s) => SHORT_SECRET_KEYS.has(s));
}

const MAX_DEPTH = 8;

/**
 * scrub object ทั้งก้อนแบบ deep — คืนของใหม่เสมอ ไม่แก้ input
 * รองรับ circular reference (แทนด้วย "[Circular]")
 */
export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[MaxDepth]";

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return value.toString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      // stack อาจมี URL ที่พก token มาด้วย
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`;

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((v) => walk(v, depth + 1, seen));
    }
    if (value instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of value) {
        const key = String(k);
        out[key] = isSecretKey(key) ? REDACTED : walk(v, depth + 1, seen);
      }
      return out;
    }
    if (value instanceof Set) {
      return [...value].map((v) => walk(v, depth + 1, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : walk(v, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}
