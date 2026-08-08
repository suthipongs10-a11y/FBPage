/**
 * ที่เก็บของ Client Portal ที่ต่อ Postgres จริง (M-H)
 */
import type { MagicLinkStore } from "@page-os/portal";
import type { PrismaClient } from "./client.js";

/** รหัสของ Prisma เมื่อชนคีย์ซ้ำ */
const UNIQUE_VIOLATION = "P2002";

export class PrismaMagicLinkStore implements MagicLinkStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * ทำเครื่องหมายว่าลิงก์ถูกใช้แล้ว — **ต้องเป็น atomic**
   *
   * ใช้การ insert แล้วจับ error คีย์ซ้ำ ไม่ใช่ "อ่านก่อนแล้วค่อยเขียน"
   * เพราะแบบหลังมีช่องว่างระหว่างอ่านกับเขียน: เปิดลิงก์เดียวกันสองแท็บพร้อมกัน
   * ทั้งคู่จะอ่านเจอว่า "ยังไม่ถูกใช้" แล้วผ่านทั้งคู่
   *
   * ฐานข้อมูลเป็นคนตัดสินว่าใครชนะ ผ่าน unique constraint ของ primary key
   */
  async consume(jti: string, expiresAtMs: number): Promise<boolean> {
    try {
      await this.prisma.usedMagicLink.create({
        data: { jti, expiresAt: new Date(expiresAtMs) },
      });
      return true;
    } catch (err) {
      if (
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: unknown }).code === UNIQUE_VIOLATION
      ) {
        return false;
      }
      throw err;
    }
  }

  /**
   * ล้างลิงก์ที่หมดอายุแล้ว
   *
   * ไม่ล้างก็ยังปลอดภัย (ลิงก์หมดอายุถูกปฏิเสธด้วยการตรวจเวลาอยู่แล้ว)
   * แต่ตารางจะโตไม่หยุด — ให้ cron เรียกวันละครั้ง
   */
  async purgeExpired(nowMs: number): Promise<number> {
    const r = await this.prisma.usedMagicLink.deleteMany({
      where: { expiresAt: { lt: new Date(nowMs) } },
    });
    return r.count;
  }
}
