/** ชนิดข้อมูลกลางของ Meta layer */

export type HttpMethod = "GET" | "POST" | "DELETE";

/**
 * ลำดับความสำคัญของงาน — ใช้จัดคิวเวลาโควตาใกล้เต็ม
 * งานตอบลูกค้าต้องแซงงาน sync analytics เสมอ
 */
export type CallPriority = "realtime" | "high" | "normal" | "low" | "bulk";

export const PRIORITY_WEIGHT: Record<CallPriority, number> = {
  realtime: 100, // ตอบ inbox ภายใน 24h window
  high: 80, // โพสต์ตามเวลาที่ตั้งไว้, ซ่อนคอมเมนต์
  normal: 50, // งานทั่วไป
  low: 20, // sync insights
  bulk: 10, // backfill ย้อนหลัง
};

export type TokenType = "user" | "page" | "system_user" | "app";

export interface PageToken {
  pageId: string;
  /** token ที่ decrypt แล้ว — ห้ามหลุดออกนอก gateway */
  accessToken: string;
  tokenType: TokenType;
  scopes: string[];
  /** epoch ms; undefined = ไม่หมดอายุ (System User Token) */
  expiresAtMs?: number;
}

/** ที่เก็บ token — gateway ไม่รู้ว่าอยู่ Postgres หรือที่ไหน */
export interface TokenStore {
  /** คืน token ที่ decrypt แล้ว หรือ null ถ้าไม่มี/ใช้ไม่ได้ */
  getPageToken(pageId: string): Promise<PageToken | null>;
  /** ทำเครื่องหมายว่า token ใช้ไม่ได้แล้ว (เจอ error 190) */
  markInvalid(pageId: string, reason: string): Promise<void>;
}

/** บันทึกทุก call ลง DB (สเปกข้อ 5 หน้าที่ 7) */
export interface CallLogEntry {
  pageId: string | null;
  method: HttpMethod;
  /** path ที่เรียก — ไม่มี token ปนแล้ว */
  path: string;
  httpStatus: number | null;
  ok: boolean;
  durationMs: number;
  attempts: number;
  errorCode?: number;
  errorSubcode?: number;
  errorMessage?: string;
  errorTh?: string;
  fbtraceId?: string;
  appUsagePct?: number;
  pageUsagePct?: number;
  priority: CallPriority;
  startedAtMs: number;
}

export interface CallLogSink {
  /** ต้องไม่โยน error และไม่บล็อก call หลัก */
  record(entry: CallLogEntry): void;
}

export const noopCallLog: CallLogSink = { record: () => {} };
