/**
 * Logger — JSON บรรทัดเดียวต่อ event, redact อัตโนมัติ
 * เวลาใน log เป็น UTC ISO เสมอ (กฎข้อ 4)
 */
import { redact } from "./redact.js";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  clock?: Clock;
  /** ปลายทางจริง — เปลี่ยนได้ตอนเทสต์ */
  sink?: (record: LogRecord) => void;
}

const defaultSink = (record: LogRecord): void => {
  const line = JSON.stringify(record);
  if (record.level === "error" || record.level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
};

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? (process.env.LOG_LEVEL as LogLevel) ?? "info";
  const min = LEVEL_ORDER[level] ?? LEVEL_ORDER.info;
  const clock = opts.clock ?? systemClock;
  const sink = opts.sink ?? defaultSink;
  const bindings = opts.bindings ?? {};

  const emit = (
    lvl: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ): void => {
    if (LEVEL_ORDER[lvl] < min) return;
    const merged = { ...bindings, ...(fields ?? {}) };
    const safe = redact(merged) as Record<string, unknown>;
    sink({
      ts: new Date(clock.now()).toISOString(),
      level: lvl,
      msg: typeof msg === "string" ? (redact(msg) as string) : String(msg),
      ...safe,
    });
  };

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) =>
      createLogger({
        ...opts,
        level,
        clock,
        sink,
        bindings: { ...bindings, ...extra },
      }),
  };
}

/** logger ที่ไม่ทำอะไร — ใช้ในเทสต์ */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => nullLogger,
};
