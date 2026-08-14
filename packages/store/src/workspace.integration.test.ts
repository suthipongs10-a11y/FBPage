/**
 * ตัวอ่านข้อมูลของหน้าจอฝั่งปฏิบัติการ — ทดสอบกับ Postgres จริง
 *
 * ข้ามทั้งไฟล์ถ้าไม่ได้ตั้ง `DATABASE_URL`
 *
 *   DATABASE_URL=postgresql://... pnpm test
 *
 * เรื่องที่เทสต์ในหน่วยความจำจับไม่ได้เลยและต้องมีของจริงเท่านั้น:
 *   - `meta_call_logs.page_id` เก็บรหัสเพจของ Facebook ไม่ใช่ UUID ของเรา
 *     (query ผิดจะได้ผลว่าง**โดยไม่มี error**)
 *   - `ORDER BY awaiting_since ASC NULLS LAST` ทำงานจริงไหม
 *   - ผู้ติดตามล่าสุดหยิบมาจากแถวที่ใหม่ที่สุดจริงหรือหยิบมั่ว
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaWorkspaceQueries } from "./workspace-queries.js";

const HAS_DB = Boolean(process.env["DATABASE_URL"]);
const prisma = new PrismaClient();

/** ชื่อเฉพาะของไฟล์นี้ — กันไฟล์เทสต์อื่นล้างข้อมูลกันเองตอนรันขนาน */
const WORKSPACE = "vitest-workspace-queries";
const NOW = Date.UTC(2026, 7, 14, 9);

/**
 * รหัสเพจของ Facebook ที่ไฟล์นี้ใช้ ต้องขึ้นต้นด้วยคำนี้เสมอ
 *
 * ⚠️ `meta_call_logs` **ไม่มี foreign key** ไปที่ `pages` (ตั้งใจ — gateway
 * เขียน log ได้ตั้งแต่ก่อนมีแถว Page) แถวของมันจึงไม่ถูกลบตามตอนลบ workspace
 * ถ้าไม่ล้างเองทุกรอบ log จากรอบก่อนจะค้างแล้วนับซ้ำเรื่อยๆ — เทสต์ที่ผ่าน
 * รอบแรกแล้วพังรอบสองคือเทสต์ที่เชื่อไม่ได้
 */
const FB_PREFIX = "vitest-ws-";

describe.skipIf(!HAS_DB)("ตัวอ่านข้อมูลหน้าจอปฏิบัติการ", () => {
  let queries: PrismaWorkspaceQueries;
  let workspaceId: string;
  /** id ของเพจที่เทสต์นี้สร้างเอง — ใช้แยกออกจากของค้างในฐานข้อมูล */
  let mine: Set<string>;

  /** ลบทั้ง workspace (cascade) และ log ที่ไม่มี FK ให้ cascade */
  const wipe = async () => {
    await prisma.workspace.deleteMany({ where: { name: WORKSPACE } });
    await prisma.metaCallLog.deleteMany({ where: { pageId: { startsWith: FB_PREFIX } } });
  };

  beforeEach(async () => {
    await wipe();
    const ws = await prisma.workspace.create({
      data: { name: WORKSPACE, clientName: "ครัวคุณยาย", plan: "FULL" },
    });
    workspaceId = ws.id;
    queries = new PrismaWorkspaceQueries(prisma);
    mine = new Set();
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  const addPage = async (over: { fbPageId?: string; name?: string } = {}) => {
    const fbPageId = `${FB_PREFIX}${over.fbPageId ?? "1013"}`;
    const p = await prisma.page.create({
      data: { workspaceId, fbPageId, name: over.name ?? fbPageId },
    });
    mine.add(p.id);
    return p;
  };

  /**
   * `snapshot()` อ่านทุกเพจในเครื่องโดยตั้งใจ (คนดูแลคนเดียวเห็นทุกลูกค้า)
   * เทสต์จึงต้องกรองเอาเฉพาะของตัวเอง ไม่งั้นข้อมูลค้างจากที่อื่นทำให้พัง
   * ทั้งที่โค้ดถูก — บทเรียนเดียวกับ `listening.integration.test.ts`
   */
  const snapshotHere = async () => {
    const s = await queries.snapshot(NOW);
    const pages = s.pages.filter((p) => mine.has(p.id));
    const ids = new Set(pages.map((p) => p.id));
    return {
      pages,
      conversations: s.conversations.filter((c) => ids.has(c.pageId)),
      scheduled: s.scheduled.filter((x) => ids.has(x.pageId)),
      incidents: s.incidents.filter((i) => ids.has(i.pageId)),
    };
  };

  describe("เพจ", () => {
    it("ดึงชื่อลูกค้าและแพ็กเกจมาจาก workspace ที่เพจสังกัด", async () => {
      await addPage();
      const s = await snapshotHere();
      expect(s.pages[0]).toMatchObject({ clientName: "ครัวคุณยาย", plan: "FULL" });
    });

    it("เพจที่ยังไม่มี token → token เป็น null", async () => {
      await addPage();
      const s = await snapshotHere();
      expect(s.pages[0]?.token).toBeNull();
    });

    /**
     * เพจมี token ได้หลายชนิด ถ้าหยิบตัวแรกที่ Postgres คืนมา สถานะที่โชว์
     * จะเปลี่ยนไปมาโดยไม่มีเหตุผล — และที่แย่กว่าคือมันจะ**ซ่อนตัวที่พังไว้**
     */
    it("มี token ทั้งดีและพัง → เอาตัวที่แย่ที่สุดมาโชว์", async () => {
      const page = await addPage();
      await prisma.pageToken.createMany({
        data: [
          {
            pageId: page.id,
            encryptedToken: "x",
            tokenType: "system_user",
            status: "active",
          },
          {
            pageId: page.id,
            encryptedToken: "y",
            tokenType: "page",
            status: "expired",
          },
        ],
      });

      const s = await snapshotHere();
      expect(s.pages[0]?.token?.status).toBe("expired");
    });

    it("ผู้ติดตามหยิบจากวันล่าสุด ไม่ใช่แถวไหนก็ได้", async () => {
      const page = await addPage();
      await prisma.insightsDaily.createMany({
        data: [
          { pageId: page.id, date: new Date("2026-08-01"), metricKey: "page_follows", value: 100 },
          { pageId: page.id, date: new Date("2026-08-13"), metricKey: "page_follows", value: 950 },
          { pageId: page.id, date: new Date("2026-08-07"), metricKey: "page_follows", value: 500 },
        ],
      });

      const s = await snapshotHere();
      expect(s.pages[0]?.followers).toBe(950);
    });

    /** ยังไม่เคย sync ต่างจากรู้แล้วว่าไม่มีคนตาม — ห้ามยุบเป็น 0 ที่ชั้นนี้ */
    it("ยังไม่เคย sync insights → followers เป็น null ไม่ใช่ 0", async () => {
      await addPage();
      const s = await snapshotHere();
      expect(s.pages[0]?.followers).toBeNull();
    });
  });

  describe("บทสนทนา", () => {
    const addConversation = async (
      pageId: string,
      over: { awaitingSince?: Date | null; name?: string; status?: string } = {},
    ) => {
      const contact = await prisma.contact.create({
        data: { pageId, psid: `psid-${Math.abs(hash(over.name ?? "x"))}`, name: over.name ?? "สุณี" },
      });
      return prisma.conversation.create({
        data: {
          pageId,
          contactId: contact.id,
          channel: "messenger",
          status: over.status ?? "open",
          awaitingSince: over.awaitingSince ?? null,
        },
      });
    };

    it("เอาเฉพาะบทสนทนาที่ยังเปิดอยู่", async () => {
      const page = await addPage();
      await addConversation(page.id, { name: "เปิดอยู่" });
      await addConversation(page.id, { name: "ปิดแล้ว", status: "closed" });

      const s = await snapshotHere();
      expect(s.conversations).toHaveLength(1);
    });

    /**
     * Postgres เรียง NULL ไว้**หน้าสุด**ตอน ASC ถ้าไม่สั่ง `nulls: "last"`
     * บทสนทนาที่ตอบครบแล้วจะมาแย่งที่คนที่ยังรออยู่ตอนโดนเพดานตัด
     */
    it("คนที่รอนานที่สุดมาก่อน คนที่ตอบครบแล้วไปท้ายแถว", async () => {
      const page = await addPage();
      await addConversation(page.id, { name: "ตอบครบแล้ว", awaitingSince: null });
      await addConversation(page.id, {
        name: "รอ 2 ชม.",
        awaitingSince: new Date(NOW - 2 * 3_600_000),
      });
      await addConversation(page.id, {
        name: "รอ 10 นาที",
        awaitingSince: new Date(NOW - 600_000),
      });

      const s = await snapshotHere();
      expect(s.conversations.map((c) => c.contactName)).toEqual([
        "รอ 2 ชม.",
        "รอ 10 นาที",
        "ตอบครบแล้ว",
      ]);
    });

    it("เอาข้อความล่าสุดมาเป็นตัวอย่าง ไม่ใช่ข้อความแรก", async () => {
      const page = await addPage();
      const conv = await addConversation(page.id);
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: "inbound",
          sentBy: "human",
          body: "ข้อความแรก",
          createdAt: new Date(NOW - 3_600_000),
        },
      });
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: "inbound",
          sentBy: "human",
          body: "ข้อความล่าสุด",
          createdAt: new Date(NOW - 60_000),
        },
      });

      const s = await snapshotHere();
      expect(s.conversations[0]?.preview).toBe("ข้อความล่าสุด");
    });
  });

  describe("โพสต์ที่ตั้งเวลาไว้", () => {
    const addPost = async (
      pageId: string,
      over: { scheduledAt: Date; status?: string; body?: string },
    ) =>
      prisma.post.create({
        data: {
          pageId,
          body: over.body ?? "เมนูใหม่",
          contentHash: `h-${Math.abs(hash(over.body ?? String(over.scheduledAt)))}`,
          scheduledAt: over.scheduledAt,
          status: (over.status ?? "scheduled") as "scheduled",
        },
      });

    it("โพสต์ที่ขึ้นไปแล้วไม่อยู่ในปฏิทิน แต่โพสต์ที่ล้มยังอยู่", async () => {
      const page = await addPage();
      await addPost(page.id, { scheduledAt: new Date(NOW + 3_600_000), body: "รอขึ้น" });
      await addPost(page.id, {
        scheduledAt: new Date(NOW - 3_600_000),
        status: "published",
        body: "ขึ้นแล้ว",
      });
      await addPost(page.id, {
        scheduledAt: new Date(NOW - 3_600_000),
        status: "failed",
        body: "ล้ม",
      });

      const s = await snapshotHere();
      expect(s.scheduled.map((p) => p.body).sort()).toEqual(["รอขึ้น", "ล้ม"]);
    });

    it("โพสต์ที่ไกลเกินกรอบเวลาไม่ถูกดึงมา", async () => {
      const page = await addPage();
      await addPost(page.id, { scheduledAt: new Date(NOW + 200 * 86_400_000), body: "ไกลมาก" });
      const s = await snapshotHere();
      expect(s.scheduled).toHaveLength(0);
    });

    it("เอาจำนวนครั้งที่ล้มของ target ที่แย่ที่สุดมา", async () => {
      const page = await addPage();
      const post = await addPost(page.id, { scheduledAt: new Date(NOW + 3_600_000) });
      await prisma.postTarget.create({
        data: { postId: post.id, pageId: page.id, attempts: 3, error: "โควตาเต็ม" },
      });

      const s = await snapshotHere();
      expect(s.scheduled[0]).toMatchObject({ attempts: 3, lastErrorTh: "โควตาเต็ม" });
    });
  });

  describe("ฟีดเหตุการณ์", () => {
    /**
     * ⚠️ ข้อที่สำคัญที่สุดของไฟล์นี้
     *
     * `meta_call_logs.page_id` เก็บ**รหัสเพจของ Facebook** ไม่ใช่ UUID ของเรา
     * (ตารางนั้นไม่มี foreign key ไปที่ `pages` เพราะ gateway เขียน log ได้
     * ตั้งแต่ก่อนมีแถว Page) ถ้า query ด้วย UUID จะได้ผลว่างโดยไม่มี error
     * แล้วหน้าจอจะบอกว่า "ไม่เคยชน rate limit" ตลอดกาล
     */
    it("จับ rate limit ได้ ทั้งที่ log เก็บด้วยรหัสเพจของ Facebook", async () => {
      const page = await addPage({ fbPageId: "9998877" });
      await prisma.metaCallLog.create({
        data: {
          pageId: `${FB_PREFIX}9998877`, // รหัสของ Facebook — ไม่ใช่ page.id
          method: "POST",
          path: "/feed",
          ok: false,
          durationMs: 120,
          errorCode: 32,
          createdAt: new Date(NOW - 600_000),
        },
      });

      const s = await snapshotHere();
      const rate = s.incidents.filter((i) => i.kind === "rate_limit");
      expect(rate).toHaveLength(1);
      // ต้องแปลงกลับเป็น UUID ให้ UI จับคู่กับเพจได้
      expect(rate[0]?.pageId).toBe(page.id);
    });

    it("log ที่เก่ากว่า 24 ชม. ไม่ขึ้นในฟีด", async () => {
      await addPage({ fbPageId: "9998877" });
      await prisma.metaCallLog.create({
        data: {
          pageId: `${FB_PREFIX}9998877`,
          method: "POST",
          path: "/x",
          ok: false,
          durationMs: 1,
          errorCode: 32,
          createdAt: new Date(NOW - 30 * 3_600_000),
        },
      });

      const s = await snapshotHere();
      expect(s.incidents.filter((i) => i.kind === "rate_limit")).toHaveLength(0);
    });

    it("คอมเมนต์ที่ถูกลบอัตโนมัติขึ้นในฟีด", async () => {
      const page = await addPage();
      await prisma.comment.create({
        data: {
          pageId: page.id,
          fbCommentId: `c-${Date.now()}`,
          actionTaken: "deleted",
          createdAt: new Date(NOW - 600_000),
        },
      });

      const s = await snapshotHere();
      expect(s.incidents.filter((i) => i.kind === "comment_deleted")).toHaveLength(1);
    });

    it("เรียงจากใหม่ไปเก่า", async () => {
      const page = await addPage({ fbPageId: "9998877" });
      await prisma.comment.create({
        data: {
          pageId: page.id,
          fbCommentId: `old-${Date.now()}`,
          actionTaken: "deleted",
          createdAt: new Date(NOW - 5 * 3_600_000),
        },
      });
      await prisma.metaCallLog.create({
        data: {
          pageId: `${FB_PREFIX}9998877`,
          method: "POST",
          path: "/x",
          ok: false,
          durationMs: 1,
          errorCode: 4,
          createdAt: new Date(NOW - 600_000),
        },
      });

      const s = await snapshotHere();
      expect(s.incidents[0]?.kind).toBe("rate_limit");
      expect(s.incidents[1]?.kind).toBe("comment_deleted");
    });
  });

  describe("ยังไม่มีเพจในระบบ", () => {
    it("ไม่มีเพจของตัวเอง → ชุดของตัวเองว่างทั้งหมด", async () => {
      const s = await snapshotHere();
      expect(s).toEqual({
        pages: [],
        conversations: [],
        scheduled: [],
        incidents: [],
      });
    });
  });
});

/** hash สั้นๆ ไว้สร้างคีย์ที่ไม่ชนกันในเทสต์ ไม่ต้องการคุณภาพเชิงการเข้ารหัส */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
