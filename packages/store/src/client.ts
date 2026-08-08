/**
 * ตัวเชื่อมฐานข้อมูลจริง
 *
 * แพ็กเกจนี้คือที่เดียวในระบบที่รู้จัก Prisma — โดเมนอื่นประกาศแค่ interface
 * ของที่เก็บข้อมูล (`PageTokenRepository`, `AuditStore`, `AlertStore`, ...)
 * แล้วที่นี่เป็นคนทำให้เป็นจริง
 *
 * เหตุผลที่แยกออกมาเป็นแพ็กเกจต่างหาก แทนที่จะใส่ในแพ็กเกจโดเมนแต่ละตัว:
 *   - ไม่เกิดวงแหวนพึ่งพา (`ops` พึ่ง `db` อยู่แล้ว ถ้า `db` พึ่ง `ops` กลับก็วน)
 *   - โดเมนยังเทสต์ได้ด้วยที่เก็บในหน่วยความจำโดยไม่ต้องมี Postgres
 *   - มีที่เดียวให้เปิดดูว่า "ข้อมูลลงตารางไหน"
 */
import { PrismaClient } from "@prisma/client";

export type { PrismaClient };

let shared: PrismaClient | undefined;

/**
 * ตัวเชื่อมที่ใช้ร่วมกันทั้ง process
 *
 * Next.js ตอน dev โหลดโมดูลใหม่ทุกครั้งที่แก้ไฟล์ ถ้าสร้าง `new PrismaClient()`
 * ทุกครั้งจะเปิด connection pool ใหม่เรื่อยๆ จน Postgres ปฏิเสธการเชื่อมต่อ
 * — เก็บไว้ตัวเดียวแล้วใช้ซ้ำ
 */
export function getPrisma(): PrismaClient {
  shared ??= new PrismaClient();
  return shared;
}

/** ปิดการเชื่อมต่อ — ใช้ตอนจบเทสต์หรือปิด worker */
export async function closePrisma(): Promise<void> {
  if (shared) {
    await shared.$disconnect();
    shared = undefined;
  }
}

/** แปลง epoch ms (กฎข้อ 4: UTC เสมอ) เป็น Date ที่ Prisma รับ */
export function toDate(ms: number | null | undefined): Date | null {
  return ms === null || ms === undefined ? null : new Date(ms);
}

/** แปลงกลับเป็น epoch ms สำหรับโดเมนที่ทำงานด้วยตัวเลขล้วน */
export function toMs(d: Date | null | undefined): number | null {
  return d === null || d === undefined ? null : d.getTime();
}
