/**
 * Result type — ทุกฟังก์ชันที่แตะข้อมูลภายนอก (network, DB, storage, หน้าเว็บ)
 * ต้อง return ตัวนี้ ห้าม throw ข้ามชั้น (CLAUDE.md ข้อ 10)
 */
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface AppError {
  /** รหัสสั้น ๆ ไว้ให้โค้ดเช็ค ไม่ใช่ข้อความให้คนอ่าน */
  code: string;
  /** ข้อความภาษาไทยที่แสดงให้ผู้ใช้ได้เลย — บอกว่าเกิดอะไรและทำยังไงต่อ */
  message: string;
  cause?: unknown;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function fail(
  code: string,
  message: string,
  cause?: unknown,
): Result<never, AppError> {
  return { ok: false, error: { code, message, cause } };
}

/** ห่อโค้ดที่ throw ได้ (เช่น Dexie, JSON.parse) ให้กลายเป็น Result */
export async function attempt<T>(
  code: string,
  message: string,
  fn: () => Promise<T> | T,
): Promise<Result<T, AppError>> {
  try {
    return ok(await fn());
  } catch (cause) {
    return fail(code, message, cause);
  }
}
