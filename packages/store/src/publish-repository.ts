/**
 * ที่เก็บของงานโพสต์ที่ต่อ Postgres จริง (M4)
 *
 * ⚠️ เรื่อง `pageId` สองความหมาย เหมือนใน `token-repository.ts` เป๊ะ
 *
 * โดเมนใช้ `pageId` = **รหัสเพจของ Facebook** เพราะค่านั้นคือสิ่งที่ต้องส่งไป
 * Graph API แต่ในฐานข้อมูล `posts.page_id` / `post_targets.page_id` ชี้ไปที่
 * `pages.id` ซึ่งเป็น UUID ภายใน
 *
 * ที่นี่จึงแปลงที่ขอบทุกครั้ง: รับเข้ามาเป็นรหัส Facebook → หา UUID → คืนออกไป
 * เป็นรหัส Facebook เสมอ ถ้าเผลอคืน UUID ออกไป ตัวยิงโพสต์จะเอา UUID ไปใส่ใน
 * path ของ Graph API แล้วได้ error "ไม่พบเพจ" ทั้งที่เพจมีอยู่
 */
import { systemClock, type Clock } from "@page-os/core";
import type {
  DuePostSource,
  DuplicateHit,
  PostContent,
  PostRepository,
  PostTarget,
  PublishedPostLookup,
  PublishStatus,
  ScheduledPost,
} from "@page-os/publish";
import type { PrismaClient } from "./client.js";

/** ค่าที่เก็บใน `posts.media` — JSON อิสระ จึงต้องแปลงกลับอย่างระวัง */
interface StoredMedia {
  url?: unknown;
  caption?: unknown;
}

function toContent(row: {
  type: string;
  body: string;
  media: unknown;
}): PostContent {
  const media = Array.isArray(row.media) ? (row.media as StoredMedia[]) : [];
  const items = media
    .filter((m): m is StoredMedia => typeof m === "object" && m !== null)
    .filter((m) => typeof m.url === "string")
    .map((m) => ({
      url: m.url as string,
      ...(typeof m.caption === "string" ? { caption: m.caption } : {}),
    }));

  return {
    type: row.type as PostContent["type"],
    body: row.body,
    ...(items.length > 0 ? { media: items } : {}),
  };
}

// ---------------------------------------------------------------------------

export class PrismaPostRepository implements PostRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPost(postId: string): Promise<ScheduledPost | null> {
    const row = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { page: { select: { fbPageId: true } } },
    });
    if (!row) return null;

    return {
      id: row.id,
      // รหัสของ Facebook ไม่ใช่ UUID — ดูเหตุผลในหัวไฟล์
      pageId: row.page.fbPageId,
      content: toContent(row),
      scheduledAtMs: row.scheduledAt === null ? null : row.scheduledAt.getTime(),
      status: row.status as PublishStatus,
      contentHash: row.contentHash,
      approvalStatus: row.approvalStatus as ScheduledPost["approvalStatus"],
    };
  }

  async findTarget(postId: string, fbPageId: string): Promise<PostTarget | null> {
    const row = await this.prisma.postTarget.findFirst({
      where: { postId, page: { fbPageId } },
    });
    if (!row) return null;

    return {
      postId: row.postId,
      pageId: fbPageId,
      overrideBody: row.overrideBody,
      fbPostId: row.fbPostId,
      status: row.status as PublishStatus,
      attempts: row.attempts,
      lastError: row.error,
    };
  }

  /**
   * จองเป้าหมายนี้ก่อนยิง — หัวใจของการกันโพสต์ซ้ำ
   *
   * ต้องเป็น **คำสั่งเดียวที่ทั้งอ่านและเขียนพร้อมกัน** ไม่ใช่ "อ่านมาดูก่อนแล้วค่อยเขียน"
   * เพราะระหว่างอ่านกับเขียนมีช่องให้ worker อีกตัวแทรกเข้ามาอ่านค่าเดิมได้
   * แล้วทั้งคู่จะเห็นว่า "ยังไม่มีใครจอง" แล้วยิงพร้อมกัน = โพสต์ซ้ำในเพจลูกค้า
   *
   * `updateMany` ของ Prisma กลายเป็น `UPDATE ... WHERE ...` คำสั่งเดียว และ
   * Postgres รับประกันว่าแถวหนึ่งจะถูก UPDATE โดยธุรกรรมเดียวในเวลาเดียว
   * ตัวที่มาทีหลังจะเห็น status = publishing แล้วเงื่อนไขไม่ผ่าน → count = 0
   */
  async claimTarget(args: {
    postId: string;
    pageId: string;
    attempt: number;
  }): Promise<boolean> {
    const internalPageId = await this.internalId(args.pageId);
    if (internalPageId === null) return false;

    const res = await this.prisma.postTarget.updateMany({
      where: {
        postId: args.postId,
        pageId: internalPageId,
        // ห้ามจองทับของที่กำลังทำอยู่หรือทำเสร็จแล้ว
        status: { notIn: ["published", "publishing"] },
        fbPostId: null,
      },
      data: { status: "publishing", attempts: args.attempt },
    });
    return res.count === 1;
  }

  async releaseTarget(args: { postId: string; pageId: string }): Promise<void> {
    const internalPageId = await this.internalId(args.pageId);
    if (internalPageId === null) return;

    await this.prisma.postTarget.updateMany({
      // คืนการจองเฉพาะของที่ยังจองค้างอยู่จริง — ถ้าระหว่างนั้นมันโพสต์สำเร็จไปแล้ว
      // การเขียนทับกลับเป็น scheduled จะทำให้รอบหน้าโพสต์ซ้ำ
      where: { postId: args.postId, pageId: internalPageId, status: "publishing" },
      data: { status: "scheduled" },
    });
  }

  async markTargetPublished(args: {
    postId: string;
    pageId: string;
    fbPostId: string;
    publishedAtMs: number;
  }): Promise<void> {
    const internalPageId = await this.internalId(args.pageId);
    if (internalPageId === null) return;

    await this.prisma.postTarget.updateMany({
      where: { postId: args.postId, pageId: internalPageId },
      data: {
        status: "published",
        fbPostId: args.fbPostId,
        publishedAt: new Date(args.publishedAtMs),
        error: null,
      },
    });
  }

  async markTargetFailed(args: {
    postId: string;
    pageId: string;
    error: string;
    attempts: number;
    terminal: boolean;
  }): Promise<void> {
    const internalPageId = await this.internalId(args.pageId);
    if (internalPageId === null) return;

    await this.prisma.postTarget.updateMany({
      where: { postId: args.postId, pageId: internalPageId },
      data: {
        // ยังไม่เลิกลอง = กลับไปเป็น scheduled เพื่อให้รอบหน้าจองได้
        status: args.terminal ? "failed" : "scheduled",
        error: args.error,
        attempts: args.attempts,
      },
    });
  }

  /**
   * สรุปสถานะของโพสต์แม่จากสถานะของทุกเป้าหมาย
   *
   * กติกา: ยังมีเป้าหมายที่ค้างอยู่ = ยังไม่จบ, จบหมดแล้วแต่มีที่พัง = failed,
   * สำเร็จอย่างน้อยหนึ่งและไม่มีที่ค้าง = published
   *
   * เหตุผลที่ "สำเร็จบางเพจ" ยังนับเป็น published: คนดูจะได้เห็นว่ามีอะไรขึ้นแล้วบ้าง
   * ส่วนเพจที่พังจะไปโผล่ในหน้าปัญหาของ Ops Center แยกต่างหากอยู่แล้ว
   */
  async refreshPostStatus(postId: string): Promise<void> {
    const targets = await this.prisma.postTarget.findMany({
      where: { postId },
      select: { status: true, publishedAt: true },
    });
    if (targets.length === 0) return;

    const has = (s: string): boolean => targets.some((t) => t.status === s);
    const pending = has("scheduled") || has("publishing");

    let status: PublishStatus;
    if (pending) status = "publishing";
    else if (has("published")) status = "published";
    else if (has("failed")) status = "failed";
    else status = "cancelled";

    const publishedTimes = targets
      .map((t) => t.publishedAt)
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());

    await this.prisma.post.update({
      where: { id: postId },
      data: {
        status,
        ...(publishedTimes.length > 0
          ? { publishedAt: new Date(Math.min(...publishedTimes)) }
          : {}),
      },
    });
  }

  private async internalId(fbPageId: string): Promise<string | null> {
    const page = await this.prisma.page.findUnique({
      where: { fbPageId },
      select: { id: true },
    });
    return page?.id ?? null;
  }
}

// ---------------------------------------------------------------------------

export interface PrismaDuePostSourceOptions {
  prisma: PrismaClient;
  /**
   * ผ่อนผันย้อนหลังกี่ ms — โพสต์ที่เลยเวลามาแล้วเท่าไหร่ยังถือว่า "ถึงเวลา"
   *
   * ไม่จำกัดโดยตั้งใจ (ค่า default = ไม่ตัดทิ้ง) เพราะถ้าระบบล่มไปสองชั่วโมง
   * เราต้องการให้โพสต์ที่พลาดไปได้ขึ้น ไม่ใช่หายไปเฉยๆ การขึ้นช้าลูกค้ารับได้
   * แต่ "ไม่ขึ้นเลยและไม่มีใครรู้" รับไม่ได้
   */
  graceMs?: number;
}

export class PrismaDuePostSource implements DuePostSource {
  private readonly prisma: PrismaClient;
  private readonly graceMs: number | undefined;

  constructor(opts: PrismaDuePostSourceOptions) {
    this.prisma = opts.prisma;
    this.graceMs = opts.graceMs;
  }

  async findDue(
    nowMs: number,
    limit: number,
  ): Promise<Array<{ post: ScheduledPost; targetPageIds: string[] }>> {
    const rows = await this.prisma.post.findMany({
      where: {
        status: "scheduled",
        scheduledAt: {
          lte: new Date(nowMs),
          ...(this.graceMs !== undefined
            ? { gte: new Date(nowMs - this.graceMs) }
            : {}),
        },
        // โพสต์ที่ลูกค้ายังไม่อนุมัติห้ามหลุดเข้าคิว — ถึงตัว worker จะเช็คซ้ำอีกที
        // แต่การปล่อยเข้าคิวไปก่อนแล้วค่อยข้าม ทำให้ log เต็มไปด้วยงานที่ไม่ได้ทำ
        approvalStatus: { notIn: ["pending", "changes_requested"] },
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
      include: {
        page: { select: { fbPageId: true } },
        targets: {
          // เอาเฉพาะเป้าหมายที่ยังไม่ได้โพสต์ — ถ้ารอบก่อนสำเร็จไปบางเพจแล้ว
          // ต้องไม่ยัดเพจนั้นเข้าคิวอีก
          where: { fbPostId: null, status: { notIn: ["published", "cancelled"] } },
          include: { page: { select: { fbPageId: true } } },
        },
      },
    });

    return rows.map((row) => ({
      post: {
        id: row.id,
        pageId: row.page.fbPageId,
        content: toContent(row),
        scheduledAtMs: row.scheduledAt === null ? null : row.scheduledAt.getTime(),
        status: row.status as PublishStatus,
        contentHash: row.contentHash,
        approvalStatus: row.approvalStatus as ScheduledPost["approvalStatus"],
      },
      targetPageIds: row.targets.map((t) => t.page.fbPageId),
    }));
  }

  /**
   * ทำเครื่องหมายว่ายัดเข้าคิวไปแล้ว
   *
   * เงื่อนไข `status: "scheduled"` สำคัญ: ถ้าไม่ใส่ แล้ว cron สองรอบเหลื่อมกัน
   * รอบที่สองจะเขียนทับสถานะของโพสต์ที่รอบแรกกำลังยิงอยู่ กลับไปเป็น publishing
   * ซ้ำอีกครั้ง ซึ่งไม่ได้ทำอะไรผิดโดยตรง แต่ทำให้ตัวสรุปสถานะเพี้ยน
   */
  async markQueued(postId: string): Promise<void> {
    await this.prisma.post.updateMany({
      where: { id: postId, status: "scheduled" },
      data: { status: "publishing" },
    });
  }
}

// ---------------------------------------------------------------------------

export interface PrismaPublishedPostLookupOptions {
  prisma: PrismaClient;
  /**
   * ต้องมี Clock เพราะ `daysAgo` ที่จะไปโผล่ในข้อความ "เคยโพสต์ไปแล้วเมื่อ N วันก่อน"
   * ต้องนับจากเวลาปัจจุบันจริงๆ
   *
   * เดาจาก `sinceMs` ไม่ได้ ถึงจะดูเหมือนเดาได้: `sinceMs` = now − หน้าต่างเวลา
   * แต่ผู้เรียกส่งขนาดหน้าต่างเองได้ เลข `daysAgo` จะเพี้ยนทันทีที่มีใครส่ง
   * หน้าต่างอื่นมา และเป็นความเพี้ยนที่ไม่มีอะไรจับได้เลยนอกจากคนอ่านแล้วเอะใจ
   */
  clock?: Clock;
}

export class PrismaPublishedPostLookup implements PublishedPostLookup {
  private readonly prisma: PrismaClient;
  private readonly clock: Clock;

  constructor(opts: PrismaPublishedPostLookupOptions) {
    this.prisma = opts.prisma;
    this.clock = opts.clock ?? systemClock;
  }

  async findByHash(args: {
    pageId: string;
    hash: string;
    sinceMs: number;
  }): Promise<DuplicateHit | null> {
    const row = await this.prisma.post.findFirst({
      where: {
        page: { fbPageId: args.pageId },
        contentHash: args.hash,
        publishedAt: { gte: new Date(args.sinceMs) },
        status: "published",
      },
      orderBy: { publishedAt: "desc" },
      select: { id: true, publishedAt: true },
    });
    if (!row || row.publishedAt === null) return null;

    const publishedAtMs = row.publishedAt.getTime();
    return {
      postId: row.id,
      publishedAtMs,
      daysAgo: Math.floor((this.clock.now() - publishedAtMs) / 86_400_000),
    };
  }
}
