/**
 * ที่เก็บข้อมูลของโมดูลฟังเสียง — ทดสอบกับ Postgres จริง
 *
 * ข้ามทั้งไฟล์ถ้าไม่ได้ตั้ง `DATABASE_URL`
 *
 *   DATABASE_URL=postgresql://... pnpm test
 *
 * เรื่องที่เทสต์ในหน่วยความจำจับไม่ได้เลยและต้องมีของจริงเท่านั้น:
 *   - `ORDER BY ... NULLS FIRST` ทำงานจริงไหม (Prisma แปลถูกหรือเปล่า)
 *   - `ON CONFLICT DO NOTHING` นับจำนวนที่เพิ่มจริงถูกไหมตอนของซ้ำปนมา
 *   - upsert โพสต์แล้วยอด engagement อัปเดตตามจริงหรือค้างของเดิม
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaListeningRepository } from "./listening-repository.js";

const HAS_DB = Boolean(process.env["DATABASE_URL"]);
const prisma = new PrismaClient();

/** ชื่อเฉพาะของไฟล์นี้ — กันไฟล์เทสต์อื่นล้างข้อมูลกันเองตอนรันขนาน */
const WORKSPACE = "vitest-listening";

async function freshWorkspace(): Promise<string> {
  await prisma.workspace.deleteMany({ where: { name: WORKSPACE } });
  const ws = await prisma.workspace.create({
    data: { name: WORKSPACE, clientName: WORKSPACE },
  });
  return ws.id;
}

describe.skipIf(!HAS_DB)("ที่เก็บข้อมูลฟังเสียง", () => {
  let repo: PrismaListeningRepository;
  let workspaceId: string;
  /** id ของเพจที่เทสต์นี้สร้างเอง — ใช้แยกออกจากของค้างในฐานข้อมูล */
  let mine: Set<string>;

  beforeEach(async () => {
    workspaceId = await freshWorkspace();
    repo = new PrismaListeningRepository(prisma);
    mine = new Set();
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: WORKSPACE } });
    await prisma.$disconnect();
  });

  const addPage = async (over: {
    externalId: string;
    name?: string;
    lastFetchedAt?: Date | null;
    source?: "META_API" | "EXTERNAL" | "MANUAL" | "YOUTUBE_API";
    platform?: "FACEBOOK" | "YOUTUBE";
  }) => {
    const page = await prisma.trackedPage.create({
      data: {
        workspaceId,
        externalId: over.externalId,
        platform: over.platform ?? "FACEBOOK",
        name: over.name ?? over.externalId,
        kind: "COMPETITOR",
        source: over.source ?? "META_API",
        lastFetchedAt: over.lastFetchedAt ?? null,
      },
    });
    mine.add(page.id);
    return page;
  };

  /**
   * คิวที่ถึงเวลาดึง เอาเฉพาะเพจที่เทสต์นี้สร้างเอง
   *
   * `duePages` เป็นคิว**ระดับเครื่อง** — มันมองข้าม workspace โดยตั้งใจ เพราะ
   * cron ตัวเดียวดูแลทุกเพจที่เฝ้าอยู่ ไม่ว่าจะของลูกค้าคนไหน จะใส่ตัวกรอง
   * workspace ลงไปในโค้ดจริงเพื่อให้เทสต์ผ่านไม่ได้
   *
   * แต่แปลว่าถ้าในฐานข้อมูลมีเพจค้างอยู่จากที่อื่น (seed, เทสต์ไฟล์อื่น, ของที่คน
   * เปิดเครื่องทิ้งไว้) มันจะปนกลับมาด้วย จึงต้องกรองที่ฝั่งเทสต์ — และต้องขอ
   * limit เผื่อไว้เยอะ เพราะถ้าขอไปน้อย เพจของคนอื่นจะกินโควตาจนเพจของเรา
   * ไม่โผล่มาเลย แล้วเทสต์จะพังทั้งที่โค้ดถูก
   *
   * (ตัวกรองไม่ทำให้เทสต์อ่อนลง เพราะสิ่งที่ตรวจคือ "ลำดับ" ซึ่งการกรอง
   * รักษาลำดับสัมพัทธ์ไว้ครบ)
   */
  const dueHere = async (args: {
    nowMs: number;
    staleAfterMs: number;
    platform?: "FACEBOOK" | "YOUTUBE";
  }) => {
    const rows = await repo.duePages({
      nowMs: args.nowMs,
      staleAfterMs: args.staleAfterMs,
      limit: 10_000,
      platform: args.platform ?? "FACEBOOK",
    });
    return rows.filter((p) => mine.has(p.id));
  };

  /**
   * นับ/หาคอมเมนต์เฉพาะของ workspace ตัวเอง
   *
   * เคยเขียนเป็น `prisma.trackedComment.count()` เฉยๆ แล้วพังทันทีที่มีข้อมูล
   * ค้างอยู่ในฐานข้อมูลจากที่อื่น (seed, เทสต์ไฟล์อื่นที่รันขนาน, ของที่คนเปิดเครื่อง
   * ทิ้งไว้) — เทสต์ที่พังเพราะข้อมูลของคนอื่นคือเทสต์ที่เชื่อไม่ได้
   * เป็นบทเรียนเดียวกับ call-log flush test ใน M-J
   */
  const ownComments = () => ({
    trackedPost: { trackedPage: { workspaceId } },
  });
  const countComments = () => prisma.trackedComment.count({ where: ownComments() });
  const firstComment = () => prisma.trackedComment.findFirst({ where: ownComments() });

  describe("เลือกเพจที่ถึงเวลาดึง", () => {
    /**
     * Postgres เรียง NULL ไว้ท้ายสุดตอน ASC เป็นค่าเริ่มต้น — ถ้าไม่สั่ง nulls:"first"
     * เพจที่เพิ่งเพิ่มเข้ามาจะไม่ถูกดึงเลยจนกว่าเพจอื่นจะเก่าครบทุกตัว
     */
    it("เพจที่ยังไม่เคยดึงเลย มาก่อนเพจที่ดึงไปแล้ว", async () => {
      const now = Date.now();
      await addPage({ externalId: "เก่ามาก", lastFetchedAt: new Date(now - 10 * 86_400_000) });
      await addPage({ externalId: "ยังไม่เคยดึง", lastFetchedAt: null });

      const due = await dueHere({ nowMs: now, staleAfterMs: 3_600_000 });
      expect(due.map((p) => p.externalId)).toEqual(["ยังไม่เคยดึง", "เก่ามาก"]);
    });

    it("เพจที่เพิ่งดึงไปยังไม่ถึงเวลา ไม่ถูกหยิบมา", async () => {
      const now = Date.now();
      await addPage({ externalId: "เพิ่งดึง", lastFetchedAt: new Date(now - 60_000) });
      await addPage({ externalId: "ถึงเวลาแล้ว", lastFetchedAt: new Date(now - 7_200_000) });

      const due = await dueHere({ nowMs: now, staleAfterMs: 3_600_000 });
      expect(due.map((p) => p.externalId)).toEqual(["ถึงเวลาแล้ว"]);
    });

    /**
     * ข้อนี้เรียก `duePages` ตรงๆ ไม่ผ่าน `dueHere` เพราะสิ่งที่ตรวจคือ
     * "ขอ 2 ต้องได้ 2 ไม่ใช่ 3" ซึ่งเป็นสัญญาของ `take` ล้วนๆ ไม่เกี่ยวว่า
     * แถวที่ได้มาเป็นของ workspace ไหน
     */
    it("จำกัดจำนวนตามที่ขอ", async () => {
      for (const id of ["a", "b", "c"]) await addPage({ externalId: id });
      const due = await repo.duePages({
        nowMs: Date.now(),
        staleAfterMs: 1,
        limit: 2,
        platform: "FACEBOOK",
      });
      expect(due).toHaveLength(2);
    });

    it("ส่ง kind/source กลับมาให้ตัวดึงตัดสินใจได้", async () => {
      await addPage({ externalId: "ภายนอก", source: "EXTERNAL" });
      const due = await dueHere({ nowMs: Date.now(), staleAfterMs: 1 });
      expect(due[0]).toMatchObject({ kind: "COMPETITOR", source: "EXTERNAL" });
    });

    /**
     * ─── ข้อที่ผิดแล้วเจ็บที่สุดในไฟล์นี้ ───
     *
     * ตัวดึงของแต่ละแพลตฟอร์มคุยกับ API คนละเจ้า ถ้าคิวคืนของปนกันมา:
     *   - เพจ Facebook หลุดเข้าตัวดึง YouTube → เผาโควตา 10,000/วัน ทิ้ง
     *   - ช่อง YouTube หลุดเข้าตัวดึง Facebook → ยิง `/{channelId}/posts`
     *     เข้า Graph API แล้วโดนปฏิเสธทุกชั่วโมงตลอดไป
     *
     * ทั้งสองแบบไม่มี error ให้เห็นในหน้าจอเลย มีแต่ "ทำไมไม่มีข้อมูล"
     */
    it("ขอเพจ Facebook ไม่ได้ช่อง YouTube ปนมา", async () => {
      await addPage({ externalId: "เพจเฟซ" });
      await addPage({
        externalId: "UCช่องยูทูป",
        platform: "YOUTUBE",
        source: "YOUTUBE_API",
      });

      const due = await dueHere({ nowMs: Date.now(), staleAfterMs: 1 });
      expect(due.map((p) => p.externalId)).toEqual(["เพจเฟซ"]);
    });

    it("ขอช่อง YouTube ไม่ได้เพจ Facebook ปนมา", async () => {
      await addPage({ externalId: "เพจเฟซ" });
      await addPage({
        externalId: "UCช่องยูทูป",
        platform: "YOUTUBE",
        source: "YOUTUBE_API",
      });

      const due = await dueHere({
        nowMs: Date.now(),
        staleAfterMs: 1,
        platform: "YOUTUBE",
      });
      expect(due.map((p) => p.externalId)).toEqual(["UCช่องยูทูป"]);
      expect(due[0]).toMatchObject({ platform: "YOUTUBE", source: "YOUTUBE_API" });
    });

    /**
     * กรองต้องเกิดที่ชั้น DB ไม่ใช่มากรองทีหลังในโค้ด — ไม่งั้น `take: 5`
     * อาจได้เพจ Facebook มาครบ 5 แล้วช่อง YouTube ไม่ถูกดึงเลยสักช่อง
     * ทั้งที่ค้างคิวมานานกว่า
     */
    it("เพดานจำนวนนับเฉพาะแพลตฟอร์มที่ขอ ไม่ถูกเพจอีกฝั่งกินโควตา", async () => {
      const old = new Date(Date.now() - 10 * 86_400_000);
      for (let i = 0; i < 5; i++) {
        await addPage({ externalId: `เฟซ${i}`, lastFetchedAt: old });
      }
      await addPage({
        externalId: "UCช่องเดียว",
        platform: "YOUTUBE",
        source: "YOUTUBE_API",
        lastFetchedAt: null,
      });

      const due = await repo.duePages({
        nowMs: Date.now(),
        staleAfterMs: 1,
        limit: 5,
        platform: "YOUTUBE",
      });
      expect(due.filter((p) => mine.has(p.id)).map((p) => p.externalId)).toEqual([
        "UCช่องเดียว",
      ]);
    });
  });

  describe("จำนวนผู้ติดตาม", () => {
    it("จดของวันนี้ และอัปเดตค่าล่าสุดบนตัวเพจด้วย", async () => {
      const page = await addPage({ externalId: "p" });
      await repo.saveFollowers({
        trackedPageId: page.id,
        followers: 18_420,
        dateKey: "2026-08-10",
      });

      const snap = await prisma.trackedPageSnapshot.findMany({
        where: { trackedPageId: page.id },
      });
      expect(snap).toHaveLength(1);
      expect(snap[0]?.followers).toBe(18_420);

      const after = await prisma.trackedPage.findUnique({ where: { id: page.id } });
      expect(after?.followers).toBe(18_420);
    });

    it("รันซ้ำวันเดิม → ทับของเดิม ไม่เพิ่มแถว", async () => {
      const page = await addPage({ externalId: "p" });
      await repo.saveFollowers({ trackedPageId: page.id, followers: 100, dateKey: "2026-08-10" });
      await repo.saveFollowers({ trackedPageId: page.id, followers: 250, dateKey: "2026-08-10" });

      const snaps = await prisma.trackedPageSnapshot.findMany({
        where: { trackedPageId: page.id },
      });
      expect(snaps).toHaveLength(1);
      expect(snaps[0]?.followers).toBe(250);
    });
  });

  describe("โพสต์", () => {
    const post = (over: Partial<{ externalId: string; reactions: number }> = {}) => ({
      externalId: over.externalId ?? "p1",
      publishedAtMs: Date.UTC(2026, 7, 7, 8, 57),
      message: "ข้าวกล่อง",
      permalink: "https://facebook.com/p1",
      reactions: over.reactions ?? 120,
      shares: 4,
      commentCount: 2,
    });

    /**
     * ยอด engagement เปลี่ยนทุกชั่วโมง ถ้าเขียนแบบ "ข้ามของซ้ำ" ยอดจะค้างอยู่ที่
     * ค่าตอนดึงครั้งแรกตลอดกาล แล้วแดชบอร์ดจะนิ่งสนิทโดยไม่มี error ให้เห็นเลย
     */
    it("ดึงซ้ำแล้วยอดอัปเดตตาม ไม่ค้างของเดิม", async () => {
      const page = await addPage({ externalId: "p" });
      const at = Date.now();
      await repo.savePosts({ trackedPageId: page.id, posts: [post({ reactions: 120 })], fetchedAtMs: at });
      await repo.savePosts({ trackedPageId: page.id, posts: [post({ reactions: 999 })], fetchedAtMs: at });

      const rows = await prisma.trackedPost.findMany({ where: { trackedPageId: page.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reactions).toBe(999);
    });

    it("ไม่แตะวันที่เผยแพร่ตอนอัปเดต", async () => {
      const page = await addPage({ externalId: "p" });
      await repo.savePosts({ trackedPageId: page.id, posts: [post()], fetchedAtMs: Date.now() });
      const before = await prisma.trackedPost.findFirst({ where: { trackedPageId: page.id } });

      await repo.savePosts({
        trackedPageId: page.id,
        posts: [{ ...post(), publishedAtMs: Date.UTC(2020, 0, 1) }],
        fetchedAtMs: Date.now(),
      });
      const after = await prisma.trackedPost.findFirst({ where: { trackedPageId: page.id } });

      expect(after?.publishedAt.getTime()).toBe(before?.publishedAt.getTime());
    });

    it("เพจคนละเพจใช้รหัสโพสต์ซ้ำกันได้", async () => {
      const a = await addPage({ externalId: "a" });
      const b = await addPage({ externalId: "b" });
      await repo.savePosts({ trackedPageId: a.id, posts: [post({ externalId: "ซ้ำ" })], fetchedAtMs: Date.now() });
      await repo.savePosts({ trackedPageId: b.id, posts: [post({ externalId: "ซ้ำ" })], fetchedAtMs: Date.now() });

      expect(await prisma.trackedPost.count({ where: { externalId: "ซ้ำ" } })).toBe(2);
    });

    it("ไม่มีโพสต์ให้เขียน → ไม่ยิงคำสั่งไปฐานข้อมูล", async () => {
      const page = await addPage({ externalId: "p" });
      expect(await repo.savePosts({ trackedPageId: page.id, posts: [], fetchedAtMs: Date.now() })).toBe(0);
    });
  });

  describe("คอมเมนต์", () => {
    const seedPost = async (trackedPageId: string) => {
      await repo.savePosts({
        fetchedAtMs: Date.now(),
        trackedPageId,
        posts: [
          {
            externalId: "p1",
            publishedAtMs: Date.UTC(2026, 7, 7),
            message: null,
            permalink: null,
            reactions: 0,
            shares: 0,
            commentCount: 3,
          },
        ],
      });
    };

    const comment = (id: string) => ({
      externalId: id,
      authorId: `u-${id}`,
      authorName: `คน ${id}`,
      message: "อร่อยมาก",
      createdAtMs: Date.UTC(2026, 7, 7, 9),
    });

    it("นับเฉพาะที่เพิ่มใหม่จริง ไม่นับของซ้ำ", async () => {
      const page = await addPage({ externalId: "p" });
      await seedPost(page.id);

      const first = await repo.saveComments({
        trackedPageId: page.id,
        externalId: "p1",
        comments: [comment("c1"), comment("c2")],
      });
      expect(first).toBe(2);

      // รอบสองมีของเก่าปนของใหม่ — ต้องนับแค่ตัวใหม่
      const second = await repo.saveComments({
        trackedPageId: page.id,
        externalId: "p1",
        comments: [comment("c1"), comment("c2"), comment("c3")],
      });
      expect(second).toBe(1);
      expect(await countComments()).toBe(3);
    });

    /**
     * โพสต์อาจหายไประหว่างทาง (ถูกลบ หรือรอบก่อนเขียนไม่สำเร็จ)
     * สร้างโพสต์เปล่าขึ้นมารองรับจะทำให้จำนวนโพสต์ในตารางเพี้ยน
     */
    it("โพสต์ไม่มีในระบบ → ทิ้งคอมเมนต์ชุดนั้น ไม่สร้างโพสต์เปล่า", async () => {
      const page = await addPage({ externalId: "p" });
      const written = await repo.saveComments({
        trackedPageId: page.id,
        externalId: "ไม่มีอยู่จริง",
        comments: [comment("c1")],
      });

      expect(written).toBe(0);
      expect(await prisma.trackedPost.count({ where: { trackedPageId: page.id } })).toBe(0);
    });

    it("คอมเมนต์ที่ไม่รู้ว่าใครพูด เก็บได้", async () => {
      const page = await addPage({ externalId: "p" });
      await seedPost(page.id);
      await repo.saveComments({
        trackedPageId: page.id,
        externalId: "p1",
        comments: [{ ...comment("c1"), authorId: null, authorName: null }],
      });

      const row = await firstComment();
      expect(row).toMatchObject({ authorId: null, authorName: null });
    });

    /** เขียนพร้อมกันหลายตัวต้องไม่มีใครล้มด้วย unique violation */
    it("เขียนชุดเดียวกันพร้อมกัน 8 ครั้ง → รวมกันได้ของครบชุดเดียว", async () => {
      const page = await addPage({ externalId: "p" });
      await seedPost(page.id);

      const batch = [comment("c1"), comment("c2"), comment("c3")];
      const counts = await Promise.all(
        Array.from({ length: 8 }, () =>
          repo.saveComments({ trackedPageId: page.id, externalId: "p1", comments: batch }),
        ),
      );

      expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
      expect(await countComments()).toBe(3);
    });
  });

  describe("จดเวลาที่ดึงล่าสุด", () => {
    it("จดแล้วเพจนั้นหลุดออกจากคิวรอบถัดไป", async () => {
      const now = Date.now();
      const page = await addPage({ externalId: "p", lastFetchedAt: null });
      expect(await dueHere({ nowMs: now, staleAfterMs: 3_600_000 })).toHaveLength(1);

      await repo.markFetched({ trackedPageId: page.id, atMs: now });
      expect(await dueHere({ nowMs: now, staleAfterMs: 3_600_000 })).toHaveLength(0);
    });
  });
});
