/**
 * Meta error taxonomy → ข้อความไทย + วิธีจัดการ
 * (สเปกข้อ 5 หน้าที่ 6: "Map error → ข้อความไทยที่คุณเข้าใจ")
 *
 * ทุก error ที่ออกจาก gateway ต้องเป็น MetaApiError เสมอ
 * โมดูลอื่นตัดสินใจจาก `action` ไม่ต้องจำเลข error เอง
 */

/** สิ่งที่ระบบควรทำต่อเมื่อเจอ error นี้ */
export type MetaErrorAction =
  /** ลองใหม่ได้ — gateway จะ backoff ให้เอง */
  | "retry"
  /** โดน rate limit — เข้าคิว ชะลอ แล้วค่อยลองใหม่ */
  | "throttle"
  /** token ใช้ไม่ได้แล้ว — ต้องให้ลูกค้าเชื่อมเพจใหม่ */
  | "reconnect"
  /** ขาด permission — ต้องยื่น App Review หรือขอสิทธิ์เพิ่ม */
  | "permission"
  /** ข้อมูลที่ส่งไปผิด — แก้โค้ด/ข้อมูลก่อน ลองใหม่ไปก็เท่านั้น */
  | "fix_request"
  /** Meta ปลดระวางฟีเจอร์นี้แล้ว — ต้องเปลี่ยนวิธีทำ */
  | "deprecated"
  /** ไม่รู้จัก — ให้คนดู */
  | "manual";

export interface MetaErrorInfo {
  action: MetaErrorAction;
  /** ข้อความไทยที่อ่านแล้วรู้ว่าต้องทำอะไรต่อ */
  th: string;
  retryable: boolean;
}

/** error ที่ต้อง backoff แล้วลองใหม่ ตามสเปกข้อ 5.5 (4 / 32 / 80001 / 5xx) */
export const RETRYABLE_CODES = new Set([4, 32, 80001, 613, 80002, 80003, 80004]);

interface Rule {
  code: number;
  subcode?: number;
  info: MetaErrorInfo;
}

const RULES: Rule[] = [
  // ---- Rate limit ----
  {
    code: 4,
    info: {
      action: "throttle",
      th: "แอปยิง API เกินโควตารวม (error 4) — ชะลออัตโนมัติแล้วลองใหม่",
      retryable: true,
    },
  },
  {
    code: 32,
    info: {
      action: "throttle",
      th: "เพจนี้ยิง API เกินโควตา (error 32) — เข้าคิวรอแล้วลองใหม่",
      retryable: true,
    },
  },
  {
    code: 613,
    info: {
      action: "throttle",
      th: "เรียก endpoint นี้ถี่เกินกำหนด (error 613) — ชะลอแล้วลองใหม่",
      retryable: true,
    },
  },
  {
    code: 80001,
    info: {
      action: "throttle",
      th: "เกินโควตาข้อความ/เพจ (error 80001) — เข้าคิวรอแล้วลองใหม่",
      retryable: true,
    },
  },
  {
    code: 80002,
    info: {
      action: "throttle",
      th: "เกินโควตา Instagram (error 80002) — เข้าคิวรอแล้วลองใหม่",
      retryable: true,
    },
  },
  {
    code: 80003,
    info: {
      action: "throttle",
      th: "เกินโควตาโพสต์ (error 80003) — เข้าคิวรอแล้วลองใหม่",
      retryable: true,
    },
  },
  {
    code: 80004,
    info: {
      action: "throttle",
      th: "เกินโควตา (error 80004) — เข้าคิวรอแล้วลองใหม่",
      retryable: true,
    },
  },
  {
    code: 341,
    info: {
      action: "throttle",
      th: "แอปชนเพดานการใช้งานรายวัน (error 341) — รอรีเซ็ตแล้วลองใหม่",
      retryable: true,
    },
  },

  // ---- Token ----
  {
    code: 190,
    subcode: 458,
    info: {
      action: "reconnect",
      th: "ลูกค้าถอนสิทธิ์แอปออกแล้ว (190/458) — ต้องส่งลิงก์ให้เชื่อมเพจใหม่",
      retryable: false,
    },
  },
  {
    code: 190,
    subcode: 459,
    info: {
      action: "reconnect",
      th: "บัญชีลูกค้าถูก Facebook ล็อก (190/459) — ลูกค้าต้องเข้าไปปลดล็อกเองก่อน",
      retryable: false,
    },
  },
  {
    code: 190,
    subcode: 460,
    info: {
      action: "reconnect",
      th: "ลูกค้าเปลี่ยนรหัสผ่าน token เลยใช้ไม่ได้ (190/460) — ต้องเชื่อมเพจใหม่",
      retryable: false,
    },
  },
  {
    code: 190,
    subcode: 463,
    info: {
      action: "reconnect",
      th: "token หมดอายุ (190/463) — ต้องเชื่อมเพจใหม่ หรือย้ายไปใช้ System User Token",
      retryable: false,
    },
  },
  {
    code: 190,
    subcode: 467,
    info: {
      action: "reconnect",
      th: "token ใช้ไม่ได้แล้ว (190/467) — ต้องเชื่อมเพจใหม่",
      retryable: false,
    },
  },
  {
    code: 190,
    info: {
      action: "reconnect",
      th: "token หมดอายุหรือถูกเพิกถอน (error 190) — ต้องเชื่อมเพจใหม่",
      retryable: false,
    },
  },
  {
    code: 102,
    info: {
      action: "reconnect",
      th: "session หมดอายุ (error 102) — ต้องเชื่อมเพจใหม่",
      retryable: false,
    },
  },

  // ---- Permission ----
  {
    code: 10,
    info: {
      action: "permission",
      th: "แอปไม่มีสิทธิ์ทำสิ่งนี้ (error 10) — ต้องผ่าน App Review permission ที่เกี่ยวข้องก่อน",
      retryable: false,
    },
  },
  {
    code: 200,
    info: {
      action: "permission",
      th: "ขาดสิทธิ์บนเพจนี้ (error 200) — เช็คว่าได้ permission ครบและเป็นแอดมินเพจหรือยัง",
      retryable: false,
    },
  },
  {
    code: 3,
    info: {
      action: "permission",
      th: "เมธอดนี้ยังไม่เปิดให้แอป (error 3) — ต้องขอสิทธิ์/ผ่านรีวิวก่อน",
      retryable: false,
    },
  },
  {
    code: 803,
    info: {
      action: "permission",
      th: "ไม่พบ object ที่ขอ หรือแอปไม่มีสิทธิ์เห็น (error 803)",
      retryable: false,
    },
  },

  // ---- ข้อมูลผิด ----
  {
    code: 100,
    subcode: 33,
    info: {
      action: "fix_request",
      th: "ไม่พบ object นี้ หรือ token ไม่มีสิทธิ์เข้าถึง (100/33) — เช็ค id และสิทธิ์",
      retryable: false,
    },
  },
  {
    code: 100,
    subcode: 2018001,
    info: {
      action: "fix_request",
      th: "อ่านไฟล์แนบไม่ได้ (100/2018001) — เช็ค URL รูป/วิดีโอว่าเปิดสาธารณะจริง",
      retryable: false,
    },
  },
  {
    code: 100,
    info: {
      action: "fix_request",
      th: "พารามิเตอร์ผิด (error 100) — เช็คชื่อฟิลด์/ค่าที่ส่งไป และเช็คว่าใช้ message tag ที่ปลดระวางแล้วหรือเปล่า",
      retryable: false,
    },
  },
  {
    code: 2,
    info: {
      action: "retry",
      th: "ฝั่ง Facebook ขัดข้องชั่วคราว (error 2) — ลองใหม่อัตโนมัติ",
      retryable: true,
    },
  },
  {
    code: 1,
    info: {
      action: "retry",
      th: "Facebook ตอบ error ไม่ระบุสาเหตุ (error 1) — ลองใหม่อัตโนมัติ",
      retryable: true,
    },
  },

  // ---- Messaging ----
  {
    code: 10900,
    info: {
      action: "fix_request",
      th: "ส่งข้อความไม่ได้เพราะเกิน 24 ชม. แล้ว — ต้องใช้ Utility Template หรือรอลูกค้าทักมาใหม่",
      retryable: false,
    },
  },
  {
    code: 551,
    info: {
      action: "fix_request",
      th: "ผู้ใช้บล็อกเพจ หรือไม่รับข้อความจากเพจนี้ (error 551)",
      retryable: false,
    },
  },
  {
    code: 10303,
    info: {
      action: "fix_request",
      th: "ส่งข้อความซ้ำเร็วเกินไป (error 10303)",
      retryable: false,
    },
  },
];

/** error 100 ที่มาจาก message tag ที่ปลดระวาง 27 เม.ย. 2026 — จับด้วยข้อความ */
const DEPRECATED_TAG_RE =
  /(CONFIRMED_EVENT_UPDATE|POST_PURCHASE_UPDATE|ACCOUNT_UPDATE)/i;

const UNKNOWN: MetaErrorInfo = {
  action: "manual",
  th: "Facebook ตอบ error ที่ระบบยังไม่รู้จัก — ดูรายละเอียดใน log แล้วเพิ่ม rule",
  retryable: false,
};

export function classifyMetaError(
  code: number | undefined,
  subcode?: number,
  message?: string,
): MetaErrorInfo {
  if (message && DEPRECATED_TAG_RE.test(message)) {
    return {
      action: "deprecated",
      th: "ใช้ message tag ที่ Meta ปลดระวางไปแล้ว (27 เม.ย. 2026) — ต้องย้ายไปใช้ Utility Template",
      retryable: false,
    };
  }
  if (code === undefined) return UNKNOWN;

  const exact = RULES.find((r) => r.code === code && r.subcode === subcode);
  if (exact) return exact.info;

  const byCode = RULES.find((r) => r.code === code && r.subcode === undefined);
  if (byCode) return byCode.info;

  return UNKNOWN;
}

export interface MetaApiErrorInit {
  message: string;
  code?: number;
  subcode?: number;
  type?: string;
  httpStatus?: number;
  fbtraceId?: string;
  /** path ที่เรียก (ไม่มี token — gateway strip ให้แล้ว) */
  path?: string;
  pageId?: string;
  attempts?: number;
  cause?: unknown;
  /** เขียนข้อความไทยเองแทนที่จะให้ classify เดาให้ (ใช้กับ error ที่ไม่ได้มาจาก Meta) */
  th?: string;
}

/** error เดียวที่ gateway โยนออกมา */
export class MetaApiError extends Error {
  override readonly name = "MetaApiError";
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly type: string | undefined;
  readonly httpStatus: number | undefined;
  readonly fbtraceId: string | undefined;
  readonly path: string | undefined;
  readonly pageId: string | undefined;
  readonly attempts: number;
  readonly action: MetaErrorAction;
  /** ข้อความไทยพร้อมบอกวิธีแก้ */
  readonly th: string;
  readonly retryable: boolean;

  constructor(init: MetaApiErrorInit) {
    super(init.message, init.cause ? { cause: init.cause } : undefined);
    this.code = init.code;
    this.subcode = init.subcode;
    this.type = init.type;
    this.httpStatus = init.httpStatus;
    this.fbtraceId = init.fbtraceId;
    this.path = init.path;
    this.pageId = init.pageId;
    this.attempts = init.attempts ?? 1;

    const info = classifyMetaError(init.code, init.subcode, init.message);
    // 5xx ที่ไม่มี error code ของ Meta ก็ retry ได้ (สเปกข้อ 5.5)
    const is5xx = (init.httpStatus ?? 0) >= 500;
    this.action = info.action === "manual" && is5xx ? "retry" : info.action;
    this.retryable = info.retryable || is5xx;
    this.th =
      init.th ??
      (info.action === "manual" && is5xx
        ? `Facebook ตอบ HTTP ${init.httpStatus} — ลองใหม่อัตโนมัติ`
        : info.th);
  }

  /** สรุปแบบปลอดภัยสำหรับ log / เก็บลง DB (ไม่มี token) */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      subcode: this.subcode,
      type: this.type,
      httpStatus: this.httpStatus,
      fbtraceId: this.fbtraceId,
      path: this.path,
      pageId: this.pageId,
      attempts: this.attempts,
      action: this.action,
      th: this.th,
      retryable: this.retryable,
    };
  }
}

/**
 * error ตอนต่อเน็ตไม่ติด/timeout — ไม่ใช่ error จาก Meta แต่ retry ได้
 * ใช้ message ที่ผู้เรียกเขียนมาเป็นข้อความไทยเลย เพราะเจาะจงกว่า "HTTP 599"
 */
export class MetaTransportError extends MetaApiError {
  constructor(message: string, init: Omit<MetaApiErrorInit, "message"> = {}) {
    super({
      ...init,
      message,
      httpStatus: init.httpStatus ?? 599,
      th: init.th ?? message,
    });
  }
}
