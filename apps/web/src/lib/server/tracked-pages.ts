import "server-only";

/**
 * เพิ่ม/เอาออก เพจหรือช่องที่เฝ้าดู
 *
 * ─── ความต่างที่ใหญ่ที่สุดระหว่างสองแพลตฟอร์ม ───
 *
 * | | Facebook | YouTube |
 * |---|---|---|
 * | อ่านของ**ตัวเอง** | ต้องเชื่อม Page Access Token ก่อน | แค่มี API key |
 * | อ่านของ**คนอื่น** | ต้องมีสิทธิ์ Page Public Content Access | แค่มี API key |
 *
 * ดึงเพจ Facebook ที่เราไม่ได้เป็นแอดมิน ต้องมี **Page Public Content Access**
 * ซึ่งต้องผ่าน App Review + Business Verification ถ้าตั้งเป็น `META_API` ให้เลย
 * ระบบจะยิงไปทุกชั่วโมงแล้วโดนปฏิเสธทุกชั่วโมง เปลืองโควตาที่ใช้ร่วมกับงานที่
 * ลูกค้ารออยู่จริง โดยไม่ได้ข้อมูลอะไรกลับมาเลย — ตั้งเป็น `EXTERNAL` ไว้ก่อน
 * แล้วบอกไปตรงๆ ดีกว่า
 *
 * **ฝั่ง YouTube ไม่มีข้อจำกัดนี้เลย** ช่องคู่แข่งจึงตั้งเป็น `YOUTUBE_API`
 * ได้ทันทีเหมือนช่องของเราเอง — นี่คือเหตุผลที่ตารางในโค้ดนี้แยกสองฝั่ง
 * แทนที่จะใช้กฎเดียวกัน
 */
import type { TrackedKind, TrackedPlatform } from "@page-os/listening";
import { PrismaListeningQueries } from "@page-os/store";
import { prisma } from "@/lib/server/deps";
import { nounTh, sourceFor, validateExternalId } from "@/lib/tracked-page-rules";

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
  externalId: string;
  name: string;
  kind: TrackedKind;
  platform?: TrackedPlatform;
}): Promise<TrackResult> {
  const externalId = args.externalId.trim();
  const name = args.name.trim();
  const platform: TrackedPlatform = args.platform ?? "FACEBOOK";
  const whatTh = nounTh(platform);

  const badId = validateExternalId(platform, externalId);
  if (badId !== null) return { ok: false, th: badId };

  if (name === "") {
    return { ok: false, th: `ยังไม่ได้ตั้งชื่อ${whatTh} — ใส่ชื่อที่พอจะจำได้ก็พอ` };
  }

  const db = prisma();
  const queries = new PrismaListeningQueries(db);

  /**
   * เพจ Facebook ของเราเองต้องเชื่อม token ไว้แล้ว ไม่งั้นดึงข้อมูลไม่ได้อยู่ดี
   * บอกตั้งแต่ตอนเพิ่ม ดีกว่าปล่อยให้เพิ่มสำเร็จแล้วไปเงียบอยู่หนึ่งชั่วโมง
   *
   * ช่อง YouTube ไม่ต้อง — API key อ่านช่องไหนก็ได้ รวมทั้งช่องของเราเอง
   * (โทเคน OAuth จำเป็นตอน**ซ่อน/ลบคอมเมนต์**เท่านั้น ซึ่งยังไม่ได้ทำ)
   *
   * ตาราง `pages` (เพจที่เราดูแล) ยังใช้ชื่อ `fbPageId` เพราะเป็น Facebook แท้ๆ
   * ต่างจาก `tracked_pages` ที่ตอนนี้เก็บได้ทั้งเพจ FB และช่อง YouTube
   */
  const owned =
    platform === "FACEBOOK"
      ? await db.page.findUnique({ where: { fbPageId: externalId } })
      : null;

  if (platform === "FACEBOOK" && args.kind === "OWNED" && owned === null) {
    return {
      ok: false,
      th: `ยังไม่ได้เชื่อมเพจรหัส ${externalId} เข้าระบบ — ไปที่หน้าตั้งค่าแล้ววาง ` +
        "Page Access Token ของเพจนี้ก่อน แล้วค่อยกลับมาเพิ่ม",
    };
  }

  const workspaceId = owned?.workspaceId ?? (await defaultWorkspaceId());

  const already = await queries.findByFbPageId({ workspaceId, externalId });
  if (already !== null) {
    return { ok: false, th: `เฝ้าดู${whatTh} "${already.name}" อยู่แล้ว` };
  }

  const source = sourceFor({ platform, kind: args.kind });

  await queries.addPage({
    workspaceId,
    externalId,
    platform,
    name,
    kind: args.kind,
    source,
    ...(owned !== null ? { pageId: owned.id } : {}),
  });

  if (source === "EXTERNAL") {
    return {
      ok: true,
      th:
        `เพิ่มเพจ "${name}" แล้ว แต่**ยังดึงข้อมูลไม่ได้** เพราะเราไม่ได้เป็นแอดมินเพจนี้ ` +
        "ต้องมีสิทธิ์ Page Public Content Access จาก Meta หรือต่อแหล่งข้อมูลภายนอกก่อน",
    };
  }

  return {
    ok: true,
    th:
      platform === "YOUTUBE"
        ? `เพิ่มช่อง "${name}" แล้ว — รอบดึงข้อมูลถัดไป (ทุก 3 ชม.) จะเริ่มเก็บวิดีโอ` +
          "และคอมเมนต์ให้ ต้องมี YOUTUBE_API_KEY ในไฟล์ .env ด้วย"
        : `เพิ่มเพจ "${name}" แล้ว — รอบดึงข้อมูลรอบถัดไปจะเริ่มเก็บโพสต์ให้`,
  };
}

export async function removeTrackedPage(id: string): Promise<TrackResult> {
  const db = prisma();
  const page = await db.trackedPage.findUnique({ where: { id } });
  if (page === null) return { ok: false, th: "ไม่พบรายการนี้แล้ว" };

  const whatTh = page.platform === "YOUTUBE" ? "ช่อง" : "เพจ";
  await new PrismaListeningQueries(db).removePage(id);
  return {
    ok: true,
    th: `เอา${whatTh} "${page.name}" ออกจากรายการเฝ้าดูแล้ว (โพสต์และคอมเมนต์ที่เก็บไว้ถูกลบไปด้วย)`,
  };
}
