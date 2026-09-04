/** ชื่อคิวตาม AGENTS.md §46 — ใช้ค่าคงที่นี้ทั้งฝั่งผู้ส่ง (API) และผู้รับ (worker) */
export const QUEUES = {
  facebookSync: 'facebook-sync',
  facebookPublish: 'facebook-publish',
  facebookWebhook: 'facebook-webhook',
  analytics: 'analytics',
  ai: 'ai',
  media: 'media',
  reports: 'reports',
  maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

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
