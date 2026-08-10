/**
 * เงื่อนไขสองข้อที่ทำให้หน้าเว็บ "ทุกหน้าที่แตะฐานข้อมูล" ขึ้น 500
 *
 * ─── อาการที่เคยเกิดจริง ───
 *
 * เปิด `/settings` แล้วได้ HTTP 500 พร้อม error นี้ในเทอร์มินัล:
 *
 *   PrismaClientInitializationError:
 *   Prisma Client could not locate the Query Engine for runtime
 *   "debian-openssl-3.0.x"
 *   The following locations have been searched:
 *     …/apps/web/node_modules/.pnpm/@prisma+client@…/node_modules/.prisma/client
 *     …/apps/web/.next/server
 *
 * ต้นตอมีสองชั้นซ้อนกัน:
 *
 * 1. Prisma มี query engine เป็นไบนารีเนทีฟที่หาตัวเองจากตำแหน่งไฟล์ JS ของมัน
 *    ถ้า webpack ลาก JS ไปไว้ใน `.next/server/` ไบนารีไม่ได้ไปด้วย → พัง
 *    กันด้วย `serverExternalPackages`
 *
 * 2. Next จะ external ให้ **ก็ต่อเมื่อ resolve ชื่อนั้นจาก apps/web ได้**
 *    pnpm วาง node_modules แบบเข้มงวด — เราใช้ Prisma ผ่าน `@page-os/store`
 *    ไม่ได้ประกาศเอง จึงไม่มี `apps/web/node_modules/@prisma/client`
 *    Next resolve ไม่เจอ → เลิก external → หันไป bundle → กลับไปข้อ 1 พอดี
 *
 * แก้แค่ข้อใดข้อหนึ่งไม่พอ ต้องครบทั้งคู่ — และทั้งคู่มองไม่เห็นเลยตอน
 * typecheck หรือตอนรันเทสต์ (เห็นก็ต่อเมื่อเปิดหน้าเว็บจริงเท่านั้น)
 * ไฟล์นี้จึงล็อกไว้ทั้งสองข้อ
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Manifest {
  dependencies?: Record<string, string>;
}

describe("การตั้งค่าที่กันหน้าเว็บพังทั้งหน้า", () => {
  it("apps/web ประกาศ @prisma/client เป็น dependency ของตัวเอง", () => {
    const manifest = JSON.parse(
      readFileSync(join(WEB_ROOT, "package.json"), "utf8"),
    ) as Manifest;

    expect(
      Object.keys(manifest.dependencies ?? {}),
      "ถึงจะใช้ผ่าน @page-os/store ก็ต้องประกาศเอง — pnpm ไม่ยกของขึ้นมาให้ " +
        "ถ้าไม่มี Next จะ resolve ไม่เจอแล้วหันไป bundle Prisma ซึ่งทำให้ทุกหน้า 500",
    ).toContain("@prisma/client");
  });

  it("next.config บอก Next ว่าอย่า bundle @prisma/client", () => {
    const source = readFileSync(join(WEB_ROOT, "next.config.ts"), "utf8");

    // อ่านจากซอร์สตรงๆ แทนการ import — next.config.ts พึ่ง type ของ Next
    // ที่โหลดในบริบทของ vitest ไม่ได้ และสิ่งที่อยากล็อกคือ "ยังเขียนไว้อยู่ไหม"
    const declared = /serverExternalPackages\s*:\s*\[([^\]]*)\]/.exec(source);

    expect(declared, "ไม่พบ serverExternalPackages ใน next.config.ts").not.toBeNull();
    expect(
      declared?.[1],
      "ถ้าเอาออก Prisma จะถูกรวมเข้า bundle แล้วหา query engine ไม่เจอ",
    ).toContain("@prisma/client");
  });
});
