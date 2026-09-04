/** ชื่อคิวตาม AGENTS.md §46 — นิยามที่ @fbpm/shared เพื่อให้ API (ผู้ส่ง) และ worker (ผู้รับ) ใช้ค่าเดียวกัน */
export { QUEUES, JOBS, publishJobId, type QueueName } from '@fbpm/shared';

/** แปลง REDIS_URL เป็น connection options ของ BullMQ */
export function redisConnectionFromUrl(url: string): { host: string; port: number; password?: string; db?: number; tls?: object } {
  const u = new URL(url);
  const db = u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined;
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password && { password: decodeURIComponent(u.password) }),
    ...(Number.isFinite(db) && { db }),
    ...(u.protocol === 'rediss:' && { tls: {} }),
  };
}
