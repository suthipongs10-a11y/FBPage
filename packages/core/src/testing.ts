/**
 * ตัวช่วยเขียนเทสต์ที่ใช้ร่วมกันทุก package (ไม่ถูก build เข้า dist)
 *
 * ที่มา: error ทุกตัวในโปรเจ็คนี้มีสองข้อความ — `message` เป็นอังกฤษไว้ debug
 * และ `th` เป็นข้อความที่ผู้ใช้เห็นจริง ส่วน `expect(...).toThrow(/…/)` ของ vitest
 * เทียบกับ `message` เท่านั้น จึงพลาดง่ายมากถ้าเขียนเอง
 */

/** error ของโปรเจ็คนี้ทุกตัวมีฟิลด์ th */
export interface ThaiError extends Error {
  th: string;
}

export function isThaiError(err: unknown): err is ThaiError {
  return (
    err instanceof Error &&
    typeof (err as { th?: unknown }).th === "string" &&
    (err as ThaiError).th.length > 0
  );
}

interface Expecter {
  (actual: unknown): {
    toMatch(pattern: RegExp): void;
    toBe(v: unknown): void;
  };
}

/**
 * รอให้ promise ล้มเหลว แล้วคืน error ที่มีข้อความไทย
 *
 * ใช้แทน `await expect(p).rejects.toThrow(/ภาษาไทย/)` ซึ่งจะไม่เจอ
 * เพราะไปเทียบกับ `message` ที่เป็นอังกฤษ
 *
 * @example
 *   const err = await expectThaiRejection(svc.doThing());
 *   expect(err.th).toMatch(/ไม่พบโพสต์/);
 */
export async function expectThaiRejection(
  promise: Promise<unknown>,
): Promise<ThaiError> {
  try {
    await promise;
  } catch (err) {
    if (isThaiError(err)) return err;
    throw new Error(
      `คาดว่าจะได้ error ที่มีข้อความไทย (ฟิลด์ th) แต่ได้: ${String(err)}`,
    );
  }
  throw new Error("คาดว่าจะโยน error แต่ทำงานผ่านไปได้");
}

/** เวอร์ชัน sync */
export function expectThaiThrow(fn: () => unknown): ThaiError {
  try {
    fn();
  } catch (err) {
    if (isThaiError(err)) return err;
    throw new Error(
      `คาดว่าจะได้ error ที่มีข้อความไทย (ฟิลด์ th) แต่ได้: ${String(err)}`,
    );
  }
  throw new Error("คาดว่าจะโยน error แต่ทำงานผ่านไปได้");
}

/**
 * assert ว่า promise ล้มเหลวพร้อมข้อความไทยที่ตรง pattern
 * ส่ง `expect` ของ vitest เข้ามาเพื่อไม่ให้ core ต้องพึ่ง vitest
 */
export async function assertThaiRejection(
  expect: Expecter,
  promise: Promise<unknown>,
  pattern: RegExp,
): Promise<ThaiError> {
  const err = await expectThaiRejection(promise);
  expect(err.th).toMatch(pattern);
  return err;
}
