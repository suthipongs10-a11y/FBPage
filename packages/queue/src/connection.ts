/**
 * การต่อ Redis — ที่เดียวในระบบที่สร้าง connection
 *
 * BullMQ มีข้อบังคับที่ไม่ค่อยมีใครรู้จนกว่าจะโดน: connection ที่เอาไปให้ `Worker`
 * ใช้ **ต้องตั้ง `maxRetriesPerRequest: null`** ไม่งั้น ioredis จะยอมแพ้แล้วโยน
 * `MaxRetriesPerRequestError` ตอน Redis สะดุดแค่แป๊บเดียว แล้ว worker จะตายทั้งตัว
 * ทั้งที่รออีกสองวินาที Redis ก็กลับมาแล้ว
 *
 * ตัวหลอกอีกอย่าง: `Queue` กับ `Worker` ต้องใช้ connection คนละตัว เพราะ Worker
 * ใช้คำสั่งแบบ blocking (`BZPOPMIN`) ที่ยึด connection ไว้ทั้งเส้น ถ้าแชร์กัน
 * คำสั่งของ `Queue` จะค้างรอจนหมดเวลา
 */
// ต้อง import แบบมีชื่อ ไม่ใช่ default — ioredis เป็น CommonJS และภายใต้
// NodeNext การ import default จะได้ namespace ของโมดูลมาแทนที่จะได้ตัว class
import { Redis, type RedisOptions } from "ioredis";

export type RedisConnection = Redis;

export interface ConnectionOptions {
  url: string;
  /** true เมื่อจะเอาไปให้ Worker ใช้ */
  forBlockingUse: boolean;
  /** ตั้งชื่อไว้ให้เห็นใน `CLIENT LIST` ตอนไล่ว่าใครกิน connection */
  name?: string;
}

export function createRedisConnection(opts: ConnectionOptions): RedisConnection {
  const base: RedisOptions = {
    // ปิด lazy connect เพื่อให้รู้ตั้งแต่ตอนสตาร์ทว่าต่อไม่ได้
    lazyConnect: false,
    enableReadyCheck: true,
    ...(opts.name !== undefined ? { connectionName: opts.name } : {}),
  };
  if (opts.forBlockingUse) {
    // ดูเหตุผลในหัวไฟล์ — ค่านี้บังคับโดย BullMQ ไม่ใช่รสนิยม
    base.maxRetriesPerRequest = null;
  }
  return new Redis(opts.url, base);
}

/** ปิดหลายเส้นพร้อมกันตอน shutdown โดยไม่ให้เส้นที่ปิดพังทำให้เส้นอื่นค้าง */
export async function closeConnections(
  conns: readonly RedisConnection[],
): Promise<void> {
  await Promise.allSettled(conns.map((c) => c.quit()));
}
