/**
 * แปลง error ของ YouTube Data API เป็นภาษาไทยที่บอกว่าต้องทำอะไรต่อ
 *
 * โครงเดียวกับ `packages/meta/src/errors.ts` โดยตั้งใจ — ทุก error มี
 * `action` ให้โค้ดตัดสินใจ และ `th` ให้คนอ่าน
 *
 * ─── สิ่งที่ต่างจากฝั่ง Meta และต้องระวัง ───
 *
 * Google ใช้ HTTP 403 กับเรื่องที่**คนละเรื่องกันสิ้นเชิง** แล้วแยกด้วย
 * `reason` ในตัว body เท่านั้น:
 *
 * | reason | แปลว่า | ต้องทำอะไร |
 * |---|---|---|
 * | `quotaExceeded` | โควตาวันนี้หมด | รอรีเซ็ต — retry ตอนนี้ไม่มีประโยชน์ |
 * | `rateLimitExceeded` | ยิงเร็วเกินไปชั่วขณะ | ถอยแล้วลองใหม่ได้ |
 * | `forbidden` | ไม่มีสิทธิ์กับของชิ้นนั้น | ต้องแก้สิทธิ์ ไม่ใช่รอ |
 * | `commentsDisabled` | เจ้าของปิดคอมเมนต์ | ข้ามวิดีโอนั้นไป ไม่ใช่ error ของเรา |
 *
 * ถ้าเหมารวมว่า 403 = retry ได้ทั้งหมด ระบบจะยิงซ้ำตอนโควตาหมด
 * ซึ่ง**เผาโควตาของวันถัดไป**ไปด้วยเมื่อข้ามเที่ยงคืนพอดี
 */

export type YouTubeErrorAction =
  /** ลองใหม่อัตโนมัติได้ */
  | "retry"
  /** โควตาหมด — หยุดยิงจนกว่าจะรีเซ็ต */
  | "wait_quota"
  /** ต้องให้คนไปเชื่อมบัญชีใหม่ */
  | "reconnect"
  /** ของชิ้นนั้นไม่มี/ถูกลบ — ข้ามไป ไม่ใช่ความผิดพลาด */
  | "skip"
  /** ต้องมีคนไปแก้ */
  | "manual";

export interface YouTubeErrorInfo {
  action: YouTubeErrorAction;
  th: string;
  retryable: boolean;
}

/**
 * `reason` ที่ Google ส่งมาใน `error.errors[0].reason`
 *
 * ตารางนี้ครอบเฉพาะตัวที่เจอจริงในงานอ่านคอมเมนต์/ช่อง
 * ตัวที่ไม่รู้จักตกไปที่ `manual` พร้อมข้อความที่บอกให้ไปดู log
 */
const AUTH_ERROR: YouTubeErrorInfo = {
  action: "reconnect",
  th: "โทเคนของ YouTube ใช้ไม่ได้แล้ว — ต้องเชื่อมบัญชีใหม่ที่หน้าตั้งค่า",
  retryable: false,
};

const RATE_LIMITED: YouTubeErrorInfo = {
  action: "retry",
  th: "ยิงถี่เกินไปชั่วขณะ — ระบบจะถอยแล้วลองใหม่ให้เอง",
  retryable: true,
};

const BY_REASON: Record<string, YouTubeErrorInfo> = {
  quotaExceeded: {
    action: "wait_quota",
    th:
      "โควตา YouTube วันนี้หมดแล้ว — รอรีเซ็ตเที่ยงคืนเวลาแปซิฟิก " +
      "(ราวบ่าย 2–3 โมงบ้านเรา) หรือขอเพิ่มโควตาที่ Google Cloud Console",
    retryable: false,
  },
  dailyLimitExceeded: {
    action: "wait_quota",
    th: "ใช้โควตา YouTube ครบเพดานรายวันแล้ว — รอรีเซ็ตเที่ยงคืนเวลาแปซิฟิก",
    retryable: false,
  },
  rateLimitExceeded: RATE_LIMITED,
  userRateLimitExceeded: RATE_LIMITED,
  /**
   * ไม่ใช่ความผิดพลาด — เจ้าของช่องปิดคอมเมนต์ของวิดีโอนั้นเอง
   * ต้องข้ามไปเงียบๆ ไม่ใช่ขึ้นเป็นปัญหาให้คนดูแลตกใจ
   */
  commentsDisabled: {
    action: "skip",
    th: "วิดีโอนี้ปิดคอมเมนต์ไว้ — ข้ามไป",
    retryable: false,
  },
  videoNotFound: {
    action: "skip",
    th: "ไม่พบวิดีโอนี้แล้ว (อาจถูกลบหรือเปลี่ยนเป็นส่วนตัว) — ข้ามไป",
    retryable: false,
  },
  channelNotFound: {
    action: "skip",
    th: "ไม่พบช่องนี้ (อาจถูกลบหรือเปลี่ยนรหัส) — ข้ามไป",
    retryable: false,
  },
  playlistNotFound: {
    action: "skip",
    th: "ไม่พบเพลย์ลิสต์อัปโหลดของช่องนี้ — ข้ามไป",
    retryable: false,
  },
  authError: AUTH_ERROR,
  forbidden: {
    action: "manual",
    th:
      "ไม่มีสิทธิ์เข้าถึงข้อมูลชิ้นนี้ — ถ้าเป็นช่องของเราเอง ให้เชื่อมบัญชีใหม่ " +
      "โดยติ๊กสิทธิ์ให้ครบ ถ้าเป็นช่องคนอื่น แปลว่าเจ้าของตั้งเป็นส่วนตัวไว้",
    retryable: false,
  },
  keyInvalid: {
    action: "manual",
    th: "API key ของ YouTube ไม่ถูกต้อง — ตรวจค่า YOUTUBE_API_KEY ในไฟล์ .env",
    retryable: false,
  },
  accessNotConfigured: {
    action: "manual",
    th:
      "ยังไม่ได้เปิดใช้ YouTube Data API v3 ในโปรเจ็ค Google Cloud นี้ — " +
      "เข้า Google Cloud Console แล้วกดเปิดใช้งาน API ก่อน",
    retryable: false,
  },
};

/**
 * ตัดสินจาก `reason` ก่อน แล้วค่อยถอยไปดู HTTP status
 *
 * เรียงแบบนี้เพราะ `reason` แม่นกว่ามาก — HTTP 403 อย่างเดียวบอกไม่ได้เลย
 * ว่าโควตาหมด หรือไม่มีสิทธิ์ ซึ่งสองอย่างนี้ต้องทำคนละอย่างสิ้นเชิง
 */
export function classifyYouTubeError(
  reason: string | undefined,
  httpStatus: number | undefined,
  message?: string,
): YouTubeErrorInfo {
  const byReason = reason === undefined ? undefined : BY_REASON[reason];
  if (byReason !== undefined) return byReason;

  if (httpStatus !== undefined) {
    if (httpStatus === 401) return AUTH_ERROR;
    if (httpStatus === 404) {
      return {
        action: "skip",
        th: "ไม่พบข้อมูลที่ขอ (อาจถูกลบไปแล้ว) — ข้ามไป",
        retryable: false,
      };
    }
    if (httpStatus === 429) return RATE_LIMITED;
    if (httpStatus >= 500) {
      return {
        action: "retry",
        th: `YouTube ตอบ HTTP ${httpStatus} — ลองใหม่อัตโนมัติ`,
        retryable: true,
      };
    }
  }

  return {
    action: "manual",
    th:
      `YouTube ตอบ error ที่ระบบยังไม่รู้จัก` +
      `${reason !== undefined ? ` (reason: ${reason})` : ""}` +
      `${message !== undefined && message !== "" ? ` — ${message}` : ""} — ` +
      `ดูรายละเอียดใน log แล้วเพิ่ม rule`,
    retryable: false,
  };
}

export interface YouTubeApiErrorInit {
  message: string;
  reason?: string | undefined;
  httpStatus?: number | undefined;
  path?: string | undefined;
  channelId?: string | undefined;
  attempts?: number | undefined;
  cause?: unknown;
}

export class YouTubeApiError extends Error {
  override readonly name = "YouTubeApiError";
  readonly reason: string | undefined;
  readonly httpStatus: number | undefined;
  readonly path: string | undefined;
  readonly channelId: string | undefined;
  readonly attempts: number;
  readonly action: YouTubeErrorAction;
  /** ข้อความไทยพร้อมบอกวิธีแก้ */
  readonly th: string;
  readonly retryable: boolean;

  constructor(init: YouTubeApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.reason = init.reason;
    this.httpStatus = init.httpStatus;
    this.path = init.path;
    this.channelId = init.channelId;
    this.attempts = init.attempts ?? 1;

    const info = classifyYouTubeError(init.reason, init.httpStatus, init.message);
    this.action = info.action;
    this.retryable = info.retryable;
    this.th = info.th;
  }

  /**
   * สรุปแบบปลอดภัยสำหรับ log
   *
   * ⚠️ ห้ามใส่ `accessToken` หรือ `key` ลงไปเด็ดขาด (กฎข้อ 3) —
   * `path` ที่เก็บไว้ถูกตัดพารามิเตอร์ลับออกแล้วตั้งแต่ใน gateway
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      reason: this.reason,
      httpStatus: this.httpStatus,
      path: this.path,
      channelId: this.channelId,
      attempts: this.attempts,
      action: this.action,
      retryable: this.retryable,
      th: this.th,
    };
  }
}
