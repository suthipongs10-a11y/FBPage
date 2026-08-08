/**
 * ค่า config ของตัวรับ webhook — อ่านจาก env แล้ว **ล้มทันที** ถ้าไม่ครบ
 *
 * ทำไมต้องล้มทันทีแทนที่จะปล่อยผ่าน: ถ้า `META_APP_SECRET` ว่าง
 * `createHmac("sha256", "")` ยังทำงานได้ปกติ ได้ลายเซ็นออกมาหน้าตาถูกต้องทุกอย่าง
 * แค่ไม่มีวันตรงกับของ Meta — เราจะได้ service ที่ขึ้นเขียวสวยงามแล้วปฏิเสธ
 * ทุก event เงียบๆ กว่าจะรู้ตัวคือตอนลูกค้าถามว่าทำไมไม่มีใครตอบแชท
 */

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface MtlsConfig {
  /** CA ภายในของ Meta — ใช้ตรวจ client certificate ที่ Meta ส่งมา */
  caPath: string;
  /** cert/key ฝั่งเรา (ยังต้องมีเพราะ mTLS วิ่งบน TLS) */
  certPath: string;
  keyPath: string;
}

export interface WebhookConfig {
  appSecret: string;
  verifyToken: string;
  host: string;
  port: number;
  /**
   * Meta รวมหลาย entry มาใน request เดียว ก้อนใหญ่สุดที่เคยเจอยังห่างจาก 1 MB มาก
   * แต่ default ของ Fastify คือ 1 MB พอดี จึงตั้งให้กว้างกว่านั้นหน่อย
   * ไม่ตั้งเป็นอนันต์เพราะ endpoint นี้เปิดสู่อินเทอร์เน็ต
   */
  bodyLimitBytes: number;
  /**
   * mTLS — Meta บังคับตั้งแต่ 31 มี.ค. 2026 ว่า endpoint ต้องขอ client certificate
   * และ trust CA ภายในของ Meta
   *
   * `null` = ไม่ terminate TLS ที่ตัว service (ปกติคือให้ load balancer ทำ)
   * ซึ่งถูกต้องเหมือนกัน แต่ต้องไปตั้ง `requestCert` ที่ LB แทน
   */
  mtls: MtlsConfig | null;
}

function required(env: NodeJS.ProcessEnv, key: string, hintTh: string): string {
  const v = env[key];
  if (v === undefined || v.trim() === "") {
    throw new ConfigError(`${key} is not set`, `ยังไม่ได้ตั้งค่า ${key} — ${hintTh}`);
  }
  return v.trim();
}

function intOr(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(
      `${key} must be a positive integer`,
      `ค่า ${key} ต้องเป็นจำนวนเต็มบวก — ตอนนี้เป็น "${raw}"`,
    );
  }
  return n;
}

export function loadWebhookConfig(env: NodeJS.ProcessEnv): WebhookConfig {
  const appSecret = required(
    env,
    "META_APP_SECRET",
    "เอามาจาก Meta for Developers > App > Settings > Basic",
  );
  const verifyToken = required(
    env,
    "META_WEBHOOK_VERIFY_TOKEN",
    "ตั้งเองเป็นสตริงอะไรก็ได้ แล้วใส่ค่าเดียวกันตอน subscribe webhook ในหน้า Meta",
  );

  // ทั้งสามค่าต้องมาด้วยกัน — มีแค่บางตัวแปลว่าตั้งค่าค้างไว้ ไม่ใช่ตั้งใจปิด
  const caPath = env["WEBHOOK_MTLS_CA_PATH"]?.trim() ?? "";
  const certPath = env["WEBHOOK_TLS_CERT_PATH"]?.trim() ?? "";
  const keyPath = env["WEBHOOK_TLS_KEY_PATH"]?.trim() ?? "";
  const given = [caPath, certPath, keyPath].filter((s) => s !== "").length;
  if (given !== 0 && given !== 3) {
    throw new ConfigError(
      "mTLS config is partial",
      "ตั้งค่า mTLS ไม่ครบ — ต้องใส่ทั้ง WEBHOOK_MTLS_CA_PATH, WEBHOOK_TLS_CERT_PATH " +
        "และ WEBHOOK_TLS_KEY_PATH พร้อมกัน (หรือไม่ใส่เลยถ้าให้ load balancer จัดการ TLS)",
    );
  }

  return {
    appSecret,
    verifyToken,
    host: env["WEBHOOK_HOST"]?.trim() || "0.0.0.0",
    port: intOr(env, "WEBHOOK_PORT", 3001),
    bodyLimitBytes: intOr(env, "WEBHOOK_BODY_LIMIT_BYTES", 5 * 1024 * 1024),
    mtls: given === 3 ? { caPath, certPath, keyPath } : null,
  };
}
