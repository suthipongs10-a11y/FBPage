/**
 * ชื่อคิวและชื่องาน — สัญญาระหว่าง `apps/webhook` กับ `apps/worker`
 *
 * สองโปรเซสนี้คุยกันผ่าน Redis เท่านั้น ไม่มี compiler มาช่วยจับว่าฝั่งหนึ่ง
 * เปลี่ยนชื่อคิวแล้วอีกฝั่งลืมเปลี่ยนตาม อาการที่ได้คือ "งานเข้าคิวแล้วแต่ไม่มีใครทำ"
 * ซึ่งเงียบสนิท ไม่มี error ให้เห็น จึงบังคับให้ทั้งสองฝั่งอ่านชื่อจากที่นี่ที่เดียว
 */

export const QUEUE = {
  /** event ดิบจาก Meta ที่ webhook ส่งต่อมา */
  webhookEvents: "webhook-events",
  /** ยิงโพสต์ขึ้นเพจ */
  publish: "publish",
  /** จัดการคอมเมนต์ (ซ่อน/ลบ/ตอบ) */
  moderation: "moderation",
  /** ดึง Insights รายวัน */
  analytics: "analytics",
  /** เช็คสุขภาพ token ของทุกเพจ */
  tokenHealth: "token-health",
  /** ตรวจปัญหาแล้วส่งแจ้งเตือน */
  alerts: "alerts",
  /** งานตามเวลาที่ยิงตัวเองซ้ำ (cron) */
  cron: "cron",
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const ALL_QUEUES: readonly QueueName[] = Object.values(QUEUE);

/**
 * prefix ของคีย์ใน Redis
 *
 * แยก prefix ต่อ environment ไว้ตั้งแต่แรก เพราะถ้าเผลอชี้ dev ไป Redis ตัวเดียว
 * กับ production แล้ว worker ของ dev หยิบงานโพสต์ของจริงไปทำ = โพสต์ขึ้นเพจลูกค้า
 * จากเครื่องนักพัฒนา ซึ่งกู้คืนไม่ได้
 */
export function queuePrefix(env: string): string {
  return `pageos:${env}`;
}
