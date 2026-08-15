/**
 * ที่เก็บข้อมูลของโมดูลฟังเสียง บน Prisma
 *
 * ตารางชุด `tracked_*` แยกจาก `pages` / `posts` / `comments` โดยตั้งใจ —
 * ดูเหตุผลเต็มที่หัวข้อ listening ใน `schema.prisma`
 */
import type {
  FetchedComment,
  FetchedPost,
  ListeningRepository,
  TrackedKind,
  TrackedPageRef,
  TrackedPlatform,
  TrackedSource,
} from "@page-os/listening";
import type { PrismaClient } from "./client.js";

export class PrismaListeningRepository implements ListeningRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * เพจที่ถึงเวลาดึงใหม่ — เอาตัวที่ค้างนานสุดขึ้นก่อน
   *
   * `lastFetchedAt = null` (ยังไม่เคยดึงเลย) ต้องมาก่อนตัวที่ดึงไปแล้วเสมอ
   * Postgres เรียง `NULL` ไว้ท้ายสุดเป็นค่าเริ่มต้นตอน `ASC` จึงต้องสั่ง
   * `nulls: "first"` ตรงๆ ไม่งั้นเพจที่เพิ่งเพิ่มเข้ามาจะไม่ถูกดึงเลยจนกว่า
   * เพจอื่นจะเก่าครบทุกตัว
   */
  async duePages(args: {
    nowMs: number;
    staleAfterMs: number;
    limit: number;
    platform: TrackedPlatform;
  }): Promise<TrackedPageRef[]> {
    const cutoff = new Date(args.nowMs - args.staleAfterMs);

    const rows = await this.prisma.trackedPage.findMany({
      where: {
        // กรองแพลตฟอร์มที่ชั้น DB ไม่ใช่มากรองทีหลัง — ไม่งั้น `take: 20`
        // อาจได้เพจ Facebook มาครบ 20 แล้วช่อง YouTube ไม่ถูกดึงเลยสักช่อง
        platform: args.platform,
        OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: cutoff } }],
      },
      orderBy: { lastFetchedAt: { sort: "asc", nulls: "first" } },
      take: args.limit,
    });

    return rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      platform: r.platform as TrackedPlatform,
      name: r.name,
      kind: r.kind as TrackedKind,
      source: r.source as TrackedSource,
      followers: r.followers,
      lastFetchedAtMs: r.lastFetchedAt?.getTime() ?? null,
    }));
  }

  /**
   * จดจำนวนผู้ติดตามของวันนี้ + อัปเดตค่าล่าสุดบนตัวเพจ
   *
   * ตรงนี้ใช้ `upsert` ได้โดยไม่ต้องกังวลเรื่อง race เหมือนที่อื่น เพราะมีคนเขียน
   * ได้ทีละคน (cron ตัวเดียวต่อเพจต่อวัน) และถ้าชนกันจริงผลลัพธ์ก็เหมือนกันทุกประการ
   */
  async saveFollowers(args: {
    trackedPageId: string;
    followers: number;
    dateKey: string;
  }): Promise<void> {
    const date = new Date(`${args.dateKey}T00:00:00.000Z`);

    await this.prisma.$transaction([
      this.prisma.trackedPageSnapshot.upsert({
        where: {
          trackedPageId_date: { trackedPageId: args.trackedPageId, date },
        },
        create: { trackedPageId: args.trackedPageId, date, followers: args.followers },
        update: { followers: args.followers },
      }),
      this.prisma.trackedPage.update({
        where: { id: args.trackedPageId },
        data: { followers: args.followers },
      }),
    ]);
  }

  /**
   * เขียนโพสต์ — ของเดิมต้อง**อัปเดตยอด** ไม่ใช่ข้าม
   *
   * ต่างจาก `saveComments` ตรงนี้เจตนาคนละอย่างกัน: คอมเมนต์เขียนครั้งเดียวจบ
   * ส่วนโพสต์ยอด engagement เปลี่ยนทุกชั่วโมง ถ้าใช้ `skipDuplicates`
   * ยอดจะค้างอยู่ที่ค่าตอนดึงครั้งแรกตลอดกาล แล้วแดชบอร์ดจะนิ่งสนิทโดยไม่มี error
   */
  async savePosts(args: {
    trackedPageId: string;
    posts: FetchedPost[];
    fetchedAtMs: number;
  }): Promise<number> {
    if (args.posts.length === 0) return 0;

    // เวลามาจาก Clock ที่ตัวเรียกฉีดเข้ามา ไม่ใช่นาฬิกาของเครื่อง (กฎข้อ 4)
    const now = new Date(args.fetchedAtMs);
    await this.prisma.$transaction(
      args.posts.map((p) =>
        this.prisma.trackedPost.upsert({
          where: {
            trackedPageId_externalId: {
              trackedPageId: args.trackedPageId,
              externalId: p.externalId,
            },
          },
          create: {
            trackedPageId: args.trackedPageId,
            externalId: p.externalId,
            publishedAt: new Date(p.publishedAtMs),
            message: p.message,
            permalink: p.permalink,
            reactions: p.reactions,
            shares: p.shares,
            commentCount: p.commentCount,
            fetchedAt: now,
          },
          update: {
            // ไม่แตะ publishedAt — โพสต์ไม่เปลี่ยนวันที่เผยแพร่ ถ้าเปลี่ยนแปลว่าอ่านผิด
            message: p.message,
            permalink: p.permalink,
            reactions: p.reactions,
            shares: p.shares,
            commentCount: p.commentCount,
            fetchedAt: now,
          },
        }),
      ),
    );
    return args.posts.length;
  }

  /**
   * เขียนคอมเมนต์ที่ยังไม่มี — คืนจำนวนที่**เพิ่มใหม่จริงๆ**
   *
   * ใช้ `createMany` + `skipDuplicates` ซึ่งแปลเป็น `INSERT ... ON CONFLICT DO NOTHING`
   * ให้ Postgres รับประกันในคำสั่งเดียว (`upsert` ของ Prisma เป็นอ่านแล้วค่อยเขียน
   * ซึ่งมีช่องตรงกลาง — บทเรียนจาก `inbox-repository.ts`)
   *
   * คอมเมนต์ที่ถูกแก้ไขทีหลังจะไม่ถูกอัปเดตตาม ซึ่งยอมรับได้: สิ่งที่เราสนใจคือ
   * "คนพูดอะไรตอนนั้น" ไม่ใช่ข้อความล่าสุดหลังเจ้าตัวมาแก้
   */
  async saveComments(args: {
    trackedPageId: string;
    externalId: string;
    comments: FetchedComment[];
  }): Promise<number> {
    if (args.comments.length === 0) return 0;

    const post = await this.prisma.trackedPost.findUnique({
      where: {
        trackedPageId_externalId: {
          trackedPageId: args.trackedPageId,
          externalId: args.externalId,
        },
      },
      select: { id: true },
    });
    // โพสต์หายไประหว่างทาง (ถูกลบ หรือรอบก่อนเขียนไม่สำเร็จ) — ทิ้งคอมเมนต์ชุดนี้
    // ดีกว่าสร้างโพสต์เปล่าขึ้นมาให้ตัวเลขในตารางเพี้ยน
    if (post === null) return 0;

    const written = await this.prisma.trackedComment.createMany({
      data: args.comments.map((c) => ({
        trackedPostId: post.id,
        externalId: c.externalId,
        authorId: c.authorId,
        authorName: c.authorName,
        message: c.message,
        createdAt: new Date(c.createdAtMs),
      })),
      skipDuplicates: true,
    });
    return written.count;
  }

  async markFetched(args: { trackedPageId: string; atMs: number }): Promise<void> {
    await this.prisma.trackedPage.update({
      where: { id: args.trackedPageId },
      data: { lastFetchedAt: new Date(args.atMs) },
    });
  }
}
