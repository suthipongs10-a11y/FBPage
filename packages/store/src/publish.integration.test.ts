/**
 * เทสต์ที่เก็บของงานโพสต์ กับ Postgres จริง
 *
 * ข้ามทั้งไฟล์ถ้าไม่ได้ตั้ง `DATABASE_URL` — ดูวิธีตั้งใน `store.integration.test.ts`
 *
 * ที่ต้องเทสต์กับของจริงไม่ใช่ของปลอม เพราะสิ่งที่กำลังพิสูจน์คือ **พฤติกรรม
 * ของฐานข้อมูล** ไม่ใช่ตรรกะของเรา: `claimTarget` จะกันโพสต์ซ้ำได้จริงหรือไม่
 * ขึ้นกับว่า Postgres ยอมให้สอง UPDATE เข้าถึงแถวเดียวกันพร้อมกันหรือเปล่า
 * ซึ่งของปลอมในหน่วยความจำตอบแทนไม่ได้
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { FakeClock } from "@page-os/core";
import { checkDuplicate, contentHash, PublishScheduler } from "@page-os/publish";
import type { PublishJob, PublishQueue } from "@page-os/publish";
import {
  PrismaDuePostSource,
  PrismaPostRepository,
  PrismaPublishedPostLookup,
} from "./publish-repository.js";

const HAS_DB = Boolean(process.env["DATABASE_URL"]);

/** ชื่อ workspace ประจำไฟล์นี้ — ดูเหตุผลใน `store.integration.test.ts` */
const WORKSPACE_NAME = "vitest-publish";
const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);
const MINUTE = 60_000;
const DAY = 86_400_000;

const prisma = HAS_DB ? new PrismaClient() : (null as unknown as PrismaClient);

interface Seeded {
  fbA: string;
  fbB: string;
  pageA: string;
  pageB: string;
}

async function seedPages(): Promise<Seeded> {
  const ws = await prisma.workspace.create({
    data: { name: WORKSPACE_NAME, clientName: "ครัวคุณยาย" },
  });
  const fbA = "fb-pub-a";
  const fbB = "fb-pub-b";
  const a = await prisma.page.create({
    data: { workspaceId: ws.id, fbPageId: fbA, name: "เพจ ก" },
  });
  const b = await prisma.page.create({
    data: { workspaceId: ws.id, fbPageId: fbB, name: "เพจ ข" },
  });
  return { fbA, fbB, pageA: a.id, pageB: b.id };
}

async function seedPost(args: {
  seeded: Seeded;
  body?: string;
  scheduledAtMs?: number | null;
  status?: "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  approvalStatus?: string;
  targets?: string[];
}): Promise<string> {
  const body = args.body ?? "เปิดร้านแล้วนะคะ วันนี้มีเมนูใหม่";
  const post = await prisma.post.create({
    data: {
      pageId: args.seeded.pageA,
      type: "text",
      body,
      contentHash: contentHash({ type: "text", body }),
      status: args.status ?? "scheduled",
      approvalStatus: args.approvalStatus ?? "approved",
      scheduledAt:
        args.scheduledAtMs === null
          ? null
          : new Date(args.scheduledAtMs ?? NOW - MINUTE),
    },
  });
  for (const pageId of args.targets ?? [args.seeded.pageA]) {
    await prisma.postTarget.create({ data: { postId: post.id, pageId } });
  }
  return post.id;
}

/**
 * ย้อน `updated_at` ของโพสต์ไปในอดีต
 *
 * ต้องใช้ SQL ตรง เพราะคอลัมน์นี้เป็น `@updatedAt` ซึ่ง Prisma เขียนทับเป็น
 * เวลาปัจจุบันเสมอไม่ว่าจะสั่งอะไรไป
 */
async function ageUpdatedAt(postId: string, atMs: number): Promise<void> {
  await prisma.$executeRaw`UPDATE posts SET updated_at = ${new Date(atMs)} WHERE id = ${postId}`;
}

describe.skipIf(!HAS_DB)("ที่เก็บของงานโพสต์", () => {
  beforeEach(async () => {
    // ลบเฉพาะของไฟล์นี้ — เพจ/โพสต์/เป้าหมาย ถูกลบต่อแบบ cascade
    await prisma.workspace.deleteMany({ where: { name: WORKSPACE_NAME } });
  });

  afterAll(async () => {
    if (HAS_DB) await prisma.$disconnect();
  });

  // ── PrismaPostRepository ────────────────────────────────────────────────

  describe("PrismaPostRepository", () => {
    /**
     * กับดักที่ทำให้ระบบพังทั้งระบบถ้าพลาด: โดเมนใช้ `pageId` = รหัสเพจของ Facebook
     * แต่ใน DB คอลัมน์ชื่อเดียวกันเก็บ UUID ภายใน ถ้าคืน UUID ออกไป
     * ตัวยิงโพสต์จะเอา UUID ไปใส่ใน path ของ Graph API แล้วได้ error "ไม่พบเพจ"
     */
    it("คืน pageId เป็นรหัสของ Facebook ไม่ใช่ UUID ภายใน", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);

      const post = await repo.findPost(postId);
      expect(post?.pageId).toBe(seeded.fbA);
      expect(post?.pageId).not.toBe(seeded.pageA);

      const target = await repo.findTarget(postId, seeded.fbA);
      expect(target?.pageId).toBe(seeded.fbA);
    });

    /**
     * เจอตอนตรวจงาน: `posts` ไม่มีคอลัมน์เก็บ URL เลย โพสต์ประเภท "ลิงก์"
     * จึงล้มทุกใบด้วยข้อความ 'โพสต์ประเภท "ลิงก์" ต้องระบุ URL' โดยไม่มีทาง
     * แก้ให้สำเร็จได้ — เพราะไม่มีที่ให้ใส่ URL ตั้งแต่แรก
     */
    it("โพสต์ประเภทลิงก์อ่าน URL กลับมาได้", async () => {
      const seeded = await seedPages();
      const post = await prisma.post.create({
        data: {
          pageId: seeded.pageA,
          type: "link",
          body: "อ่านรีวิวเต็มๆ ได้ที่นี่",
          link: "https://example.com/review",
          contentHash: "hash-link",
          status: "scheduled",
          approvalStatus: "approved",
          scheduledAt: new Date(NOW - MINUTE),
        },
      });
      await prisma.postTarget.create({
        data: { postId: post.id, pageId: seeded.pageA },
      });

      const content = (await new PrismaPostRepository(prisma).findPost(post.id))
        ?.content;
      expect(content?.type).toBe("link");
      expect(content?.link).toBe("https://example.com/review");
    });

    it("โพสต์ที่มีสื่ออ่าน url/caption กลับมาได้", async () => {
      const seeded = await seedPages();
      const post = await prisma.post.create({
        data: {
          pageId: seeded.pageA,
          type: "album",
          body: "เมนูใหม่",
          media: [
            { url: "https://cdn.example.com/1.jpg", caption: "กาแฟเย็น" },
            { url: "https://cdn.example.com/2.jpg" },
            // ของเสียที่หลุดเข้ามาต้องถูกกรองทิ้ง ไม่ใช่ทำให้ทั้งโพสต์พัง
            { caption: "ไม่มี url" },
            "ไม่ใช่อ็อบเจ็กต์",
          ],
          contentHash: "hash-album",
          status: "scheduled",
          approvalStatus: "approved",
          scheduledAt: new Date(NOW - MINUTE),
        },
      });
      await prisma.postTarget.create({
        data: { postId: post.id, pageId: seeded.pageA },
      });

      const content = (await new PrismaPostRepository(prisma).findPost(post.id))
        ?.content;
      expect(content?.media).toEqual([
        { url: "https://cdn.example.com/1.jpg", caption: "กาแฟเย็น" },
        { url: "https://cdn.example.com/2.jpg" },
      ]);
    });

    it("ไม่มีโพสต์นี้ → คืน null ไม่ใช่โยน error", async () => {
      await seedPages();
      const repo = new PrismaPostRepository(prisma);
      expect(await repo.findPost("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("ถามเป้าหมายของเพจที่ไม่ใช่ปลายทาง → คืน null (กันโพสต์ผิดเพจ)", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded, targets: [seeded.pageA] });
      const repo = new PrismaPostRepository(prisma);
      expect(await repo.findTarget(postId, seeded.fbB)).toBeNull();
    });

    /**
     * เทสต์ที่สำคัญที่สุดของไฟล์นี้
     *
     * ถ้า `claimTarget` ไม่ atomic จริง worker สองตัวจะจองผ่านทั้งคู่แล้วยิงพร้อมกัน
     * = โพสต์ซ้ำในเพจลูกค้า ซึ่งลบทีหลังก็สายไปแล้ว
     */
    it("จองพร้อมกัน 8 ตัว ผ่านได้แค่ตัวเดียว", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          repo.claimTarget({ postId, pageId: seeded.fbA, attempt: 1 }),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("จองแล้วบันทึกรอบที่ลองไว้ด้วย", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);

      await repo.claimTarget({ postId, pageId: seeded.fbA, attempt: 3 });
      expect((await repo.findTarget(postId, seeded.fbA))?.attempts).toBe(3);
    });

    it("เป้าหมายที่โพสต์สำเร็จไปแล้ว จองไม่ได้อีก", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);

      await repo.markTargetPublished({
        postId,
        pageId: seeded.fbA,
        fbPostId: "fb_1",
        publishedAtMs: NOW,
      });
      expect(await repo.claimTarget({ postId, pageId: seeded.fbA, attempt: 2 })).toBe(
        false,
      );
    });

    it("เพจที่ไม่มีในระบบ → จองไม่ผ่าน ไม่ใช่โยน error", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);
      expect(
        await repo.claimTarget({ postId, pageId: "ไม่มีเพจนี้", attempt: 1 }),
      ).toBe(false);
    });

    it("คืนการจองแล้วจองใหม่ได้", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);

      await repo.claimTarget({ postId, pageId: seeded.fbA, attempt: 1 });
      await repo.releaseTarget({ postId, pageId: seeded.fbA });
      expect(await repo.claimTarget({ postId, pageId: seeded.fbA, attempt: 2 })).toBe(
        true,
      );
    });

    /**
     * ถ้าคืนการจองแบบไม่ดูสถานะ แล้วบังเอิญมันโพสต์สำเร็จไประหว่างนั้น
     * สถานะจะถูกเขียนทับกลับเป็น scheduled แล้วรอบหน้าจะโพสต์ซ้ำ
     */
    it("คืนการจองของที่โพสต์สำเร็จไปแล้ว → ไม่แตะสถานะ", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);

      await repo.markTargetPublished({
        postId,
        pageId: seeded.fbA,
        fbPostId: "fb_1",
        publishedAtMs: NOW,
      });
      await repo.releaseTarget({ postId, pageId: seeded.fbA });
      expect((await repo.findTarget(postId, seeded.fbA))?.status).toBe("published");
    });

    it("ล้มเหลวแบบยังลองใหม่ได้ → กลับไปเป็น scheduled เพื่อให้รอบหน้าจองได้", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);

      await repo.claimTarget({ postId, pageId: seeded.fbA, attempt: 1 });
      await repo.markTargetFailed({
        postId,
        pageId: seeded.fbA,
        error: "Meta ล่ม",
        attempts: 1,
        terminal: false,
      });
      const t = await repo.findTarget(postId, seeded.fbA);
      expect(t?.status).toBe("scheduled");
      expect(t?.lastError).toBe("Meta ล่ม");
      expect(await repo.claimTarget({ postId, pageId: seeded.fbA, attempt: 2 })).toBe(
        true,
      );
    });

    it("ล้มเหลวแบบเลิกลองแล้ว → เป็น failed และจองไม่ได้อีก", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const repo = new PrismaPostRepository(prisma);

      await repo.markTargetFailed({
        postId,
        pageId: seeded.fbA,
        error: "token หมดอายุ",
        attempts: 4,
        terminal: true,
      });
      expect((await repo.findTarget(postId, seeded.fbA))?.status).toBe("failed");
    });

    describe("สรุปสถานะโพสต์แม่จากทุกเป้าหมาย", () => {
      it("ยังมีเป้าหมายค้าง → ยังไม่จบ", async () => {
        const seeded = await seedPages();
        const postId = await seedPost({
          seeded,
          targets: [seeded.pageA, seeded.pageB],
        });
        const repo = new PrismaPostRepository(prisma);

        await repo.markTargetPublished({
          postId,
          pageId: seeded.fbA,
          fbPostId: "fb_1",
          publishedAtMs: NOW,
        });
        await repo.refreshPostStatus(postId);
        expect((await repo.findPost(postId))?.status).toBe("publishing");
      });

      /**
       * สำเร็จบางเพจยังนับเป็น published เพราะคนดูอยากรู้ว่า "มีอะไรขึ้นแล้วบ้าง"
       * ส่วนเพจที่พังไปโผล่ในหน้าปัญหาแยกอยู่แล้ว
       */
      it("จบหมดแล้ว สำเร็จบ้างพังบ้าง → published", async () => {
        const seeded = await seedPages();
        const postId = await seedPost({
          seeded,
          targets: [seeded.pageA, seeded.pageB],
        });
        const repo = new PrismaPostRepository(prisma);

        await repo.markTargetPublished({
          postId,
          pageId: seeded.fbA,
          fbPostId: "fb_1",
          publishedAtMs: NOW,
        });
        await repo.markTargetFailed({
          postId,
          pageId: seeded.fbB,
          error: "พัง",
          attempts: 4,
          terminal: true,
        });
        await repo.refreshPostStatus(postId);
        expect((await repo.findPost(postId))?.status).toBe("published");
      });

      it("พังหมดทุกเพจ → failed", async () => {
        const seeded = await seedPages();
        const postId = await seedPost({ seeded, targets: [seeded.pageA] });
        const repo = new PrismaPostRepository(prisma);

        await repo.markTargetFailed({
          postId,
          pageId: seeded.fbA,
          error: "พัง",
          attempts: 4,
          terminal: true,
        });
        await repo.refreshPostStatus(postId);
        expect((await repo.findPost(postId))?.status).toBe("failed");
      });

      it("เวลาเผยแพร่ของโพสต์แม่ใช้เพจแรกที่ขึ้นสำเร็จ", async () => {
        const seeded = await seedPages();
        const postId = await seedPost({
          seeded,
          targets: [seeded.pageA, seeded.pageB],
        });
        const repo = new PrismaPostRepository(prisma);

        await repo.markTargetPublished({
          postId,
          pageId: seeded.fbB,
          fbPostId: "fb_2",
          publishedAtMs: NOW + 5 * MINUTE,
        });
        await repo.markTargetPublished({
          postId,
          pageId: seeded.fbA,
          fbPostId: "fb_1",
          publishedAtMs: NOW,
        });
        await repo.refreshPostStatus(postId);
        const row = await prisma.post.findUnique({ where: { id: postId } });
        expect(row?.publishedAt?.getTime()).toBe(NOW);
      });
    });
  });

  // ── PrismaDuePostSource ─────────────────────────────────────────────────

  describe("PrismaDuePostSource", () => {
    it("หยิบเฉพาะโพสต์ที่ถึงเวลาแล้ว", async () => {
      const seeded = await seedPages();
      const due = await seedPost({ seeded, scheduledAtMs: NOW - MINUTE });
      await seedPost({ seeded, scheduledAtMs: NOW + 10 * MINUTE });
      const source = new PrismaDuePostSource({ prisma });

      const rows = await source.findDue(NOW, 10);
      expect(rows.map((r) => r.post.id)).toEqual([due]);
    });

    it("คืนรหัสเพจปลายทางเป็นรหัสของ Facebook", async () => {
      const seeded = await seedPages();
      await seedPost({ seeded, targets: [seeded.pageA, seeded.pageB] });
      const source = new PrismaDuePostSource({ prisma });

      const rows = await source.findDue(NOW, 10);
      expect(rows[0]?.targetPageIds.sort()).toEqual([seeded.fbA, seeded.fbB].sort());
    });

    /**
     * ระบบล่มไปสองชั่วโมงแล้วกลับมา โพสต์ที่พลาดไปต้องได้ขึ้น
     * ขึ้นช้าลูกค้ารับได้ แต่ "ไม่ขึ้นเลยและไม่มีใครรู้" รับไม่ได้
     */
    it("โพสต์ที่เลยเวลามานานแล้วก็ยังหยิบมา", async () => {
      const seeded = await seedPages();
      const old = await seedPost({ seeded, scheduledAtMs: NOW - 3 * 3_600_000 });
      const source = new PrismaDuePostSource({ prisma });
      expect((await source.findDue(NOW, 10)).map((r) => r.post.id)).toEqual([old]);
    });

    it("โพสต์ที่ลูกค้ายังไม่อนุมัติไม่ถูกหยิบ", async () => {
      const seeded = await seedPages();
      await seedPost({ seeded, approvalStatus: "pending" });
      await seedPost({ seeded, approvalStatus: "changes_requested" });
      const source = new PrismaDuePostSource({ prisma });
      expect(await source.findDue(NOW, 10)).toEqual([]);
    });

    /**
     * ถ้ารอบก่อนสำเร็จไปบางเพจแล้ว ต้องไม่ยัดเพจนั้นเข้าคิวอีก
     */
    it("เป้าหมายที่โพสต์สำเร็จไปแล้วไม่ถูกยัดเข้าคิวซ้ำ", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({
        seeded,
        targets: [seeded.pageA, seeded.pageB],
      });
      await new PrismaPostRepository(prisma).markTargetPublished({
        postId,
        pageId: seeded.fbA,
        fbPostId: "fb_1",
        publishedAtMs: NOW,
      });
      // สถานะโพสต์แม่ยังเป็น scheduled อยู่ (ยังมีเพจที่ยังไม่ขึ้น)
      await prisma.post.update({ where: { id: postId }, data: { status: "scheduled" } });

      const rows = await new PrismaDuePostSource({ prisma }).findDue(NOW, 10);
      expect(rows[0]?.targetPageIds).toEqual([seeded.fbB]);
    });

    /**
     * เจอตอนตรวจงาน: ถ้าตัวจัดการงานใส่งาน retry กลับเข้าคิวไม่สำเร็จ
     * (Redis สะดุดพอดี) สิ่งที่เหลืออยู่คือเป้าหมาย = scheduled แต่โพสต์แม่ =
     * publishing แล้ว `findDue` เดิมมองหาแต่ status = scheduled → ไม่มีใคร
     * หยิบอีกเลย โพสต์หายเงียบๆ ไม่มี error ที่ไหน
     */
    it("โพสต์ที่ค้างในสถานะกำลังยิงเกินเวลา → หยิบกลับมาทำใหม่", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded, status: "publishing" });
      await ageUpdatedAt(postId, NOW - 2 * 3_600_000);

      const rows = await new PrismaDuePostSource({ prisma }).findDue(NOW, 10);
      expect(rows.map((r) => r.post.id)).toEqual([postId]);
    });

    it("โพสต์ที่กำลังยิงอยู่และเพิ่งแตะไป → ยังไม่ถือว่าค้าง", async () => {
      const seeded = await seedPages();
      await seedPost({ seeded, status: "publishing" });
      expect(await new PrismaDuePostSource({ prisma }).findDue(NOW, 10)).toEqual([]);
    });

    /**
     * ถ้าไม่ดัน updatedAt ตอนหยิบงานค้างกลับมา มันจะเข้าเงื่อนไข "ค้าง" อีก
     * ในนาทีถัดไป แล้วโดนยัดเข้าคิวซ้ำทุกนาทีไม่มีที่สิ้นสุด
     */
    it("หยิบงานค้างกลับมาแล้ว markQueued ต้องกันไม่ให้หยิบซ้ำรอบหน้า", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded, status: "publishing" });
      await ageUpdatedAt(postId, NOW - 2 * 3_600_000);

      const source = new PrismaDuePostSource({ prisma });
      expect(await source.findDue(NOW, 10)).toHaveLength(1);
      await source.markQueued(postId);
      expect(await source.findDue(NOW, 10)).toEqual([]);
    });

    /**
     * โพสต์ที่ขึ้นครบทุกเพจแล้วแต่สถานะแม่ยังไม่ได้อัปเดต ต้องไม่ถูกหยิบมา
     * ยัดคิวเปล่าๆ ทุกนาที
     */
    it("โพสต์ที่ไม่มีเป้าหมายเหลือแล้ว ไม่ถูกหยิบ", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      await new PrismaPostRepository(prisma).markTargetPublished({
        postId,
        pageId: seeded.fbA,
        fbPostId: "fb_1",
        publishedAtMs: NOW,
      });
      expect(await new PrismaDuePostSource({ prisma }).findDue(NOW, 10)).toEqual([]);
    });

    it("markQueued แล้วรอบถัดไปไม่หยิบซ้ำ", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({ seeded });
      const source = new PrismaDuePostSource({ prisma });

      await source.markQueued(postId);
      expect(await source.findDue(NOW, 10)).toEqual([]);
    });

    it("ต่อกับ PublishScheduler แล้วยัดงานเข้าคิวได้จริง", async () => {
      const seeded = await seedPages();
      const postId = await seedPost({
        seeded,
        targets: [seeded.pageA, seeded.pageB],
      });

      const enqueued: Array<{ job: PublishJob; jobKey: string }> = [];
      const queue: PublishQueue = {
        enqueue: async (a) => {
          enqueued.push({ job: a.job, jobKey: a.jobKey });
        },
        cancelForPost: async () => {},
      };

      const scheduler = new PublishScheduler({
        queue,
        source: new PrismaDuePostSource({ prisma }),
        clock: new FakeClock(NOW),
      });

      const r = await scheduler.tick();
      expect(r).toEqual({ enqueued: 2, posts: 1 });
      expect(enqueued.map((e) => e.job.pageId).sort()).toEqual(
        [seeded.fbA, seeded.fbB].sort(),
      );
      expect(enqueued.every((e) => e.job.postId === postId)).toBe(true);
      // รอบที่สองต้องไม่ได้อะไรอีก
      expect(await scheduler.tick()).toEqual({ enqueued: 0, posts: 0 });
    });
  });

  // ── PrismaPublishedPostLookup ───────────────────────────────────────────

  describe("PrismaPublishedPostLookup", () => {
    async function publishPost(seeded: Seeded, body: string, atMs: number) {
      const post = await prisma.post.create({
        data: {
          pageId: seeded.pageA,
          type: "text",
          body,
          contentHash: contentHash({ type: "text", body }),
          status: "published",
          publishedAt: new Date(atMs),
        },
      });
      return post.id;
    }

    it("เจอโพสต์เดิมที่เนื้อหาเหมือนกันในหน้าต่างเวลา", async () => {
      const seeded = await seedPages();
      const body = "เปิดร้านแล้วนะคะ";
      const id = await publishPost(seeded, body, NOW - 10 * DAY);
      const lookup = new PrismaPublishedPostLookup({
        prisma,
        clock: new FakeClock(NOW),
      });

      const r = await checkDuplicate({
        pageId: seeded.fbA,
        content: { type: "text", body },
        nowMs: NOW,
        lookup,
      });
      expect(r.isDuplicate).toBe(true);
      expect(r.hit?.postId).toBe(id);
      expect(r.hit?.daysAgo).toBe(10);
      expect(r.th).toContain("10 วัน");
    });

    it("โพสต์เดิมของเพจอื่นไม่นับว่าซ้ำ", async () => {
      const seeded = await seedPages();
      const body = "เปิดร้านแล้วนะคะ";
      await publishPost(seeded, body, NOW - DAY);
      const lookup = new PrismaPublishedPostLookup({
        prisma,
        clock: new FakeClock(NOW),
      });

      const r = await checkDuplicate({
        pageId: seeded.fbB,
        content: { type: "text", body },
        nowMs: NOW,
        lookup,
      });
      expect(r.isDuplicate).toBe(false);
    });

    it("โพสต์ที่เก่ากว่าหน้าต่าง 90 วันไม่นับว่าซ้ำ", async () => {
      const seeded = await seedPages();
      const body = "เปิดร้านแล้วนะคะ";
      await publishPost(seeded, body, NOW - 100 * DAY);
      const lookup = new PrismaPublishedPostLookup({
        prisma,
        clock: new FakeClock(NOW),
      });

      const r = await checkDuplicate({
        pageId: seeded.fbA,
        content: { type: "text", body },
        nowMs: NOW,
        lookup,
      });
      expect(r.isDuplicate).toBe(false);
    });

    /**
     * `daysAgo` ไปโผล่ในข้อความที่คนอ่าน ถ้ามันคำนวณจากขนาดหน้าต่างเวลา
     * แทนที่จะเป็นเวลาปัจจุบัน เลขจะเพี้ยนทันทีที่มีคนส่งหน้าต่างอื่นมา
     * โดยไม่มีอะไรจับได้เลยนอกจากคนอ่านแล้วเอะใจ
     */
    it("daysAgo ไม่เปลี่ยนตามขนาดหน้าต่างเวลาที่ส่งเข้ามา", async () => {
      const seeded = await seedPages();
      const body = "เปิดร้านแล้วนะคะ";
      await publishPost(seeded, body, NOW - 5 * DAY);
      const lookup = new PrismaPublishedPostLookup({
        prisma,
        clock: new FakeClock(NOW),
      });

      const wide = await checkDuplicate({
        pageId: seeded.fbA,
        content: { type: "text", body },
        nowMs: NOW,
        lookup,
      });
      const narrow = await checkDuplicate({
        pageId: seeded.fbA,
        content: { type: "text", body },
        nowMs: NOW,
        lookup,
        windowMs: 7 * DAY,
      });
      expect(wide.hit?.daysAgo).toBe(5);
      expect(narrow.hit?.daysAgo).toBe(5);
    });
  });
});
