import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // แพ็กเกจในโมโนรีโปคอมไพล์เป็น ESM อยู่แล้ว ไม่ต้องให้ Next แปลงซ้ำ
  typedRoutes: true,

  /**
   * ห้าม Next เอา Prisma ไปรวมร่างใน bundle ฝั่งเซิร์ฟเวอร์
   *
   * Prisma ไม่ได้เป็น JS ล้วน — มันมี query engine เป็นไฟล์ไบนารีเนทีฟ
   * (`libquery_engine-<platform>.so.node` / `.dll.node` บน Windows) วางอยู่
   * ข้างๆ client ที่ generate ไว้ แล้วหาตัวเองจากตำแหน่งของไฟล์ JS ตัวเอง
   *
   * ถ้าโดนลากเข้า bundle `__dirname` จะกลายเป็น `.next/server` ไบนารีไม่ได้ไป
   * ด้วย แล้ว **ทุกหน้าที่แตะฐานข้อมูลจะพังด้วย HTTP 500**:
   *
   *   PrismaClientInitializationError:
   *   Prisma Client could not locate the Query Engine for runtime …
   *
   * ชื่อนี้อยู่ในรายการ external ของ Next โดยปริยายอยู่แล้ว แต่เขียนไว้ให้เห็น
   * เพราะมันเป็นเงื่อนไขที่ระบบพังทั้งหน้าเว็บถ้าหายไป
   *
   * ⚠️ ที่สำคัญกว่าคือ `apps/web/package.json` ต้องประกาศ `@prisma/client`
   *    เป็น dependency ตรงๆ ด้วย — pnpm วาง node_modules แบบเข้มงวด ของที่ใช้
   *    ผ่านแพ็กเกจอื่น (เราใช้ผ่าน `@page-os/store`) จะ resolve จาก apps/web
   *    ไม่ได้ พอ Next resolve ไม่เจอมันก็ **เลิก external แล้วหันไป bundle แทน**
   *    ซึ่งพาเรากลับไปสู่อาการข้างบนพอดี
   *
   * อาการนี้ไม่โผล่ตอน typecheck หรือตอนเทสต์เลย — เห็นก็ต่อเมื่อเปิดหน้าเว็บจริง
   * `apps/web/src/next-config.test.ts` จึงล็อกทั้งสองเงื่อนไขไว้
   */
  serverExternalPackages: ["@prisma/client"],
};

export default config;
