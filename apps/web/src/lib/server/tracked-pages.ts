import "server-only";

/**
 * เพิ่ม/เอาออก เพจที่เฝ้าดู
 *
 * ─── ทำไมคู่แข่งถึงตั้งเป็น "ยังไม่ต่อแหล่งข้อมูล" ให้เอง ───
 *
 * ดึงเพจที่เราไม่ได้เป็นแอดมินผ่าน Graph API ต้องมีสิทธิ์
 * **Page Public Content Access** ซึ่งต้องผ่าน App Review + Business Verification
 *
 * ถ้าตั้งเป็น `META_API` ให้เลย ระบบจะยิงไปทุกชั่วโมงแล้วโดนปฏิเสธทุกชั่วโมง
 * เปลืองโควตาที่ใช้ร่วมกับงานที่ลูกค้ารออยู่จริง โดยไม่ได้ข้อมูลอะไรกลับมาเลย
 * — ตั้งเป็น `EXTERNAL` ไว้ก่อนแล้วบอกไปตรงๆ ดีกว่า
 */
import type { TrackedKind } from "@page-os/listening";
import { PrismaListeningQueries } from "@page-os/store";
import { prisma } from "@/lib/server/deps";

export interface TrackResult {
  ok: boolean;
  th: string;
}

/**
 * workspace ที่จะเอาเพจไปใส่
 *
 * ระบบนี้ออกแบบมาให้คนเดียวดูแลหลายเพจ ตอนติดตั้งบนเครื่องตัวเองจึงมัก
 * มี workspace เดียว — ถ้ายังไม่มีเลยก็สร้างให้ แทนที่จะบังคับให้ไปตั้งค่าก่อน
 */
async function defaultWorkspaceId(): Promise<string> {
  const db = prisma();
  const existing = await db.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing !== null) return existing.id;
  const created = await db.workspace.create({
    data: { name: "ของฉัน", clientName: "ของฉัน" },
  });
  return created.id;
}

export async function addTrackedPage(args: {
  fbPageId: string;
  name: string;
  kind: TrackedKind;
}): Promise<TrackResult> {
  const fbPageId = args.fbPageId.trim();
  const name = args.name.trim();

  if (fbPageId === "") {
    return { ok: false, th: "ยังไม่ได้ใส่รหัสเพจ" };
  }
  // รหัสเพจของ Facebook เป็นตัวเลขล้วนเสมอ — ดักคนที่วาง URL มาทั้งเส้น
  if (!/^\d+$/.test(fbPageId)) {
    return {
      ok: false,
      th: "รหัสเพจต้องเป็นตัวเลขล้วน — ถ้าก๊อป URL มา ให้เอาเฉพาะตัวเลข " +
        "(หาได้จากหน้าเพจ → เกี่ยวกับ → ความโปร่งใสของเพจ → รหัสเพจ)",
    };
  }
  if (name === "") {
    return { ok: false, th: "ยังไม่ได้ตั้งชื่อเพจ — ใส่ชื่อที่พอจะจำได้ก็พอ" };
  }

  const db = prisma();
  const queries = new PrismaListeningQueries(db);

  /**
   * เพจของเราเองต้องเชื่อม token ไว้แล้ว ไม่งั้นดึงข้อมูลไม่ได้อยู่ดี
   * บอกตั้งแต่ตอนเพิ่ม ดีกว่าปล่อยให้เพิ่มสำเร็จแล้วไปเงียบอยู่หนึ่งชั่วโมง
   */
  const owned = await db.page.findUnique({ where: { fbPageId } });
  if (args.kind === "OWNED" && owned === null) {
    return {
      ok: false,
      th: `ยังไม่ได้เชื่อมเพจรหัส ${fbPageId} เข้าระบบ — ไปที่หน้าตั้งค่าแล้ววาง ` +
        "Page Access Token ของเพจนี้ก่อน แล้วค่อยกลับมาเพิ่ม",
    };
  }

  const workspaceId = owned?.workspaceId ?? (await defaultWorkspaceId());

  const already = await queries.findByFbPageId({ workspaceId, fbPageId });
  if (already !== null) {
    return { ok: false, th: `เฝ้าดูเพจ "${already.name}" อยู่แล้ว` };
  }

  // คู่แข่งยังดึงผ่าน Graph API ไม่ได้จนกว่าจะได้สิทธิ์ PPCA — ดูเหตุผลหัวไฟล์
  const source = args.kind === "OWNED" ? "META_API" : "EXTERNAL";

  await queries.addPage({
    workspaceId,
    fbPageId,
    name,
    kind: args.kind,
    source,
    ...(owned !== null ? { pageId: owned.id } : {}),
  });

  return {
    ok: true,
    th:
      source === "META_API"
        ? `เพิ่มเพจ "${name}" แล้ว — รอบดึงข้อมูลรอบถัดไปจะเริ่มเก็บโพสต์ให้`
        : `เพิ่มเพจ "${name}" แล้ว แต่**ยังดึงข้อมูลไม่ได้** เพราะเราไม่ได้เป็นแอดมินเพจนี้ ` +
          "ต้องมีสิทธิ์ Page Public Content Access จาก Meta หรือต่อแหล่งข้อมูลภายนอกก่อน",
  };
}

export async function removeTrackedPage(id: string): Promise<TrackResult> {
  const db = prisma();
  const page = await db.trackedPage.findUnique({ where: { id } });
  if (page === null) return { ok: false, th: "ไม่พบเพจนี้ในรายการแล้ว" };

  await new PrismaListeningQueries(db).removePage(id);
  return {
    ok: true,
    th: `เอาเพจ "${page.name}" ออกจากรายการเฝ้าดูแล้ว (โพสต์และคอมเมนต์ที่เก็บไว้ถูกลบไปด้วย)`,
  };
}
