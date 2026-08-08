/**
 * config ของ worker — อ่านจาก env แล้วล้มทันทีถ้าไม่ครบ
 *
 * worker เป็นตัวเดียวในระบบที่ทำอะไรที่ **กู้คืนไม่ได้** (โพสต์ขึ้นเพจลูกค้าจริง)
 * การขึ้นมาแบบครึ่งๆ กลางๆ จึงอันตรายกว่าการไม่ขึ้นเลย
 */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface WorkerConfig {
  appId: string;
  appSecret: string;
  redisUrl: string;
  databaseUrl: string;
  /** คั่นคิวของแต่ละ environment ออกจากกัน */
  env: string;
  /** ค่าเวลาที่ใช้ตีความ cron และแสดงผล */
  timeZone: string;
  /** เพดานเวลารอให้งานที่ค้างจบตอนปิดระบบ */
  shutdownTimeoutMs: number;
}

function required(env: NodeJS.ProcessEnv, key: string, hintTh: string): string {
  const v = env[key];
  if (v === undefined || v.trim() === "") {
    throw new ConfigError(`${key} is not set`, `ยังไม่ได้ตั้งค่า ${key} — ${hintTh}`);
  }
  return v.trim();
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const raw = env["WORKER_SHUTDOWN_TIMEOUT_MS"];
  const shutdownTimeoutMs = raw === undefined || raw.trim() === "" ? 20_000 : Number(raw);
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new ConfigError(
      "WORKER_SHUTDOWN_TIMEOUT_MS must be a positive integer",
      `ค่า WORKER_SHUTDOWN_TIMEOUT_MS ต้องเป็นจำนวนเต็มบวก — ตอนนี้เป็น "${String(raw)}"`,
    );
  }

  return {
    appId: required(env, "META_APP_ID", "เอามาจาก Meta for Developers > App > Settings > Basic"),
    appSecret: required(env, "META_APP_SECRET", "เอามาจากหน้าเดียวกับ META_APP_ID"),
    redisUrl: required(env, "REDIS_URL", "worker ทั้งตัวทำงานผ่านคิว ไม่มี Redis ก็ทำอะไรไม่ได้"),
    databaseUrl: required(env, "DATABASE_URL", "ต้องมีฐานข้อมูลไว้อ่านโพสต์ที่ตั้งเวลาไว้"),
    env: env["APP_ENV"]?.trim() || "dev",
    timeZone: env["APP_TIMEZONE"]?.trim() || "Asia/Bangkok",
    shutdownTimeoutMs,
  };
}
