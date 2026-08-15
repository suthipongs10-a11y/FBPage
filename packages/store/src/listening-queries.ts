/**
 * ฝั่งอ่านของโมดูลฟังเสียง — ป้อนข้อมูลให้หน้าจอ
 *
 * ─── ทำไมโหลดโพสต์มาทั้งชุดแล้วค่อยคำนวณใน JS แทนที่จะ GROUP BY ใน SQL ───
 *
 * เพราะสูตรนับ engagement กับส่วนแบ่งเสียงอยู่ใน `packages/listening` ซึ่งมีเทสต์
 * ครอบไว้แล้ว ถ้าเขียน SQL รวมยอดซ้ำอีกชุด เท่ากับมีสูตรสองที่ที่ต้องตรงกันเอง —
 * วันหนึ่งจะเพี้ยนกันแล้วไม่มีใครรู้ว่าอันไหนถูก
 *
 * ขนาดข้อมูลรองรับได้สบาย: เพดานคือ 100 โพสต์ต่อเพจต่อรอบดึง คนดูแล 10–20 เพจ
 * ก็ราวสองพันแถว ซึ่งเล็กกว่าที่ Postgres จะสนใจ ถ้าวันหนึ่งโตกว่านี้มากค่อยย้าย
 * ไปทำใน SQL พร้อมย้ายเทสต์ตามไปด้วย
 */
import type {
  PostStat,
  TrackedKind,
  TrackedPlatform,
  TrackedSource,
} from "@page-os/listening";
import type { PrismaClient } from "./client.js";

export interface TrackedPageRow {
  id: string;
  externalId: string;
  platform: TrackedPlatform;
  name: string;
  kind: TrackedKind;
  source: TrackedSource;
  followers: number | null;
  lastFetchedAtMs: number | null;
}

export interface TrackedPageWithPosts extends TrackedPageRow {
  /** โพสต์ในช่วงที่ขอ พร้อมยอด ณ ตอนดึงล่าสุด */
  posts: PostStat[];
  /** จำนวน "คน" ที่คอมเมนต์ ไม่ใช่จำนวนคอมเมนต์ */
  uniqueCommenters: number;
}

export interface CommentRow {
  id: string;
  authorId: string | null;
  authorName: string | null;
  message: string | null;
  createdAtMs: number;
  trackedPageId: string;
  pageName: string;
  /** หน้าจอต้องรู้ เพราะข้อความอย่าง "เปิดโพสต์บน Facebook" จะโกหกทันทีถ้าเป็น YouTube */
  platform: TrackedPlatform;
  /** ช่องนี้เป็นของเราไหม — ตัดสินว่าปุ่มซ่อน/ลบใช้ได้หรือเปล่า */
  kind: TrackedKind;
  /** รหัสคอมเมนต์บนแพลตฟอร์มนั้น — ต้องใช้ตอนสั่งซ่อน/ลบ */
  commentExternalId: string;
  /**
   * สถานะที่ **เราสั่งไป** ไม่ใช่สถานะจริงบนแพลตฟอร์ม ณ ตอนนี้
   * (เจ้าของช่องเปลี่ยนเองได้ตลอด และการไปถามกินโควตาทุกครั้ง)
   */
  moderatedStatus: string | null;
  moderatedAtMs: number | null;
  postPermalink: string | null;
  externalId: string;
}

/**
 * คอมเมนต์หนึ่งอันในรูปย่อ
 *
 * มีฟิลด์ครบพอสำหรับทั้งสามงานที่ใช้ชุดนี้ — นับหัวข้อ (`message`),
 * หาแฟนตัวยง (`authorId`/`authorName`/`trackedPageId`) และสแกนสัญญาณผิดปกติ
 * (ต้องใช้ `createdAtMs` ด้วย) — ดึงรอบเดียวแล้วแจกให้ทุกตัวใช้
 */
export interface DigestRow {
  message: string | null;
  authorId: string | null;
  authorName: string | null;
  trackedPageId: string;
  createdAtMs: number;
}

export interface CommentDigest {
  /** จำนวนคอมเมนต์ทั้งหมดที่เข้าเงื่อนไข (ไม่ถูกตัดด้วยเพดาน) */
  total: number;
  /** `true` เมื่อโดนเพดานตัด — ตัวเลขที่คิดจากชุดนี้เป็นของตัวอย่าง ไม่ใช่ทั้งหมด */
  truncated: boolean;
  rows: DigestRow[];
}

/**
 * เพดานคอมเมนต์ที่เอามาคิดหัวข้อ/แฟนตัวยงต่อครั้ง
 *
 * 20,000 แถว × ~3 คอลัมน์สั้นๆ ราวไม่กี่ MB — เปิดหน้าเว็บแล้วยังไว
 * เกินกว่านี้หน้าจะหน่วงจนคนคิดว่าค้าง ซึ่งแย่กว่าการบอกว่า "คิดจากตัวอย่าง"
 */
export const DIGEST_CAP = 20_000;

export class PrismaListeningQueries {
  constructor(private readonly prisma: PrismaClient) {}

  /** รายการเพจที่เฝ้าดูทั้งหมด — ใช้ในหน้าจัดการ */
  async listPages(workspaceId?: string): Promise<TrackedPageRow[]> {
    const rows = await this.prisma.trackedPage.findMany({
      ...(workspaceId !== undefined ? { where: { workspaceId } } : {}),
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
    return rows.map(toRow);
  }

  /**
   * เพจทั้งหมดพร้อมโพสต์ในช่วงที่เลือก
   *
   * `uniqueCommenters` นับจาก `authorId` ก่อน แล้วค่อยถอยไปใช้ชื่อเมื่อไม่มีรหัส
   * — คนที่ไม่ได้ให้สิทธิ์แอปเราจะไม่มีรหัสมาให้ ถ้านับแต่รหัสตัวเลขจะต่ำกว่าจริงมาก
   * ส่วนคนที่ไม่มีทั้งรหัสและชื่อ นับไม่ได้เลย จึงไม่นับ (ดีกว่านับรวมเป็นคนเดียว)
   */
  async pagesWithPosts(args: {
    workspaceId?: string;
    fromMs: number;
    toMs: number;
  }): Promise<TrackedPageWithPosts[]> {
    const pages = await this.prisma.trackedPage.findMany({
      ...(args.workspaceId !== undefined ? { where: { workspaceId: args.workspaceId } } : {}),
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      include: {
        posts: {
          where: {
            publishedAt: { gte: new Date(args.fromMs), lt: new Date(args.toMs) },
          },
          select: {
            id: true,
            publishedAt: true,
            reactions: true,
            shares: true,
            commentCount: true,
          },
        },
      },
    });

    const commenters = await this.uniqueCommentersByPage(
      pages.flatMap((p) => p.posts.map((post) => post.id)),
    );

    return pages.map((p) => ({
      ...toRow(p),
      posts: p.posts.map((post) => ({
        publishedAtMs: post.publishedAt.getTime(),
        reactions: post.reactions,
        shares: post.shares,
        comments: post.commentCount,
      })),
      uniqueCommenters: countDistinct(
        p.posts.flatMap((post) => commenters.get(post.id) ?? []),
      ),
    }));
  }

  /**
   * คนที่คอมเมนต์ในแต่ละโพสต์ (คีย์ = trackedPostId)
   *
   * ดึงมาเป็นก้อนเดียวแล้วแจกทีหลัง แทนที่จะถามทีละโพสต์ — ไม่งั้นเพจละ 100 โพสต์
   * คูณ 10 เพจ = พันคำสั่งต่อการเปิดหน้าเว็บหนึ่งครั้ง
   */
  private async uniqueCommentersByPage(
    postIds: string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (postIds.length === 0) return out;

    const rows = await this.prisma.trackedComment.findMany({
      where: { trackedPostId: { in: postIds } },
      select: { trackedPostId: true, authorId: true, authorName: true },
    });

    for (const r of rows) {
      const who = r.authorId ?? r.authorName;
      if (who === null) continue;
      const list = out.get(r.trackedPostId);
      if (list === undefined) out.set(r.trackedPostId, [who]);
      else list.push(who);
    }
    return out;
  }

  /**
   * ค้นคอมเมนต์ — ตัวที่ทำให้ "อ่านคอมเมนต์จริง" เป็นไปได้
   *
   * ค้นด้วย `contains` ธรรมดาบนคอลัมน์ `message` ซึ่งกลายเป็น `ILIKE '%คำ%'`
   * ใน Postgres — ใช้กับภาษาไทยได้ตรงๆ เพราะเป็นการหา substring ล้วน
   * (full-text search ของ Postgres แยกคำไทยไม่ได้ ใส่ไปก็ไม่ได้ผลดีกว่า)
   */
  async searchComments(args: {
    workspaceId?: string;
    trackedPageId?: string;
    keyword?: string;
    fromMs: number;
    toMs: number;
    limit: number;
    offset?: number;
  }): Promise<{ rows: CommentRow[]; total: number }> {
    const where = this.commentWhere(args);

    const [rows, total] = await Promise.all([
      this.prisma.trackedComment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: args.limit,
        skip: args.offset ?? 0,
        include: {
          trackedPost: {
            select: {
              externalId: true,
              permalink: true,
              trackedPage: {
                select: { id: true, name: true, platform: true, kind: true },
              },
            },
          },
        },
      }),
      this.prisma.trackedComment.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        authorId: r.authorId,
        authorName: r.authorName,
        message: r.message,
        createdAtMs: r.createdAt.getTime(),
        trackedPageId: r.trackedPost.trackedPage.id,
        pageName: r.trackedPost.trackedPage.name,
        platform: r.trackedPost.trackedPage.platform as TrackedPlatform,
        kind: r.trackedPost.trackedPage.kind as TrackedKind,
        commentExternalId: r.externalId,
        moderatedStatus: r.moderatedStatus,
        moderatedAtMs: r.moderatedAt?.getTime() ?? null,
        postPermalink: r.trackedPost.permalink,
        externalId: r.trackedPost.externalId,
      })),
    };
  }

  /**
   * คอมเมนต์ทั้งช่วงในรูปย่อ — เอาไปนับหัวข้อและหาแฟนตัวยง
   *
   * ดึงเฉพาะคอลัมน์ที่ต้องใช้จริง (ข้อความ + คนพูด + เพจ) เพราะการจัดหมวด
   * ภาษาไทยทำใน JS จะ `GROUP BY` ใน SQL แทนไม่ได้
   *
   * มีเพดานกันหน้าเว็บค้างเมื่อข้อมูลโต — และ**บอกกลับไปว่าถูกตัดหรือเปล่า**
   * เพราะเปอร์เซ็นต์ที่คิดจากตัวอย่างบางส่วนกับคิดจากทั้งหมดเป็นคนละเรื่องกัน
   * ถ้าไม่บอก คนจะอ่านว่าเป็นตัวเลขของทั้งหมด
   */
  async commentDigest(args: {
    workspaceId?: string;
    trackedPageId?: string;
    keyword?: string;
    fromMs: number;
    toMs: number;
    cap?: number;
  }): Promise<CommentDigest> {
    const cap = args.cap ?? DIGEST_CAP;
    const where = this.commentWhere(args);

    const [rows, total] = await Promise.all([
      this.prisma.trackedComment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: cap,
        select: {
          message: true,
          authorId: true,
          authorName: true,
          createdAt: true,
          trackedPost: { select: { trackedPageId: true } },
        },
      }),
      this.prisma.trackedComment.count({ where }),
    ]);

    return {
      total,
      truncated: total > rows.length,
      rows: rows.map((r) => ({
        message: r.message,
        authorId: r.authorId,
        authorName: r.authorName,
        trackedPageId: r.trackedPost.trackedPageId,
        createdAtMs: r.createdAt.getTime(),
      })),
    };
  }

  /** เงื่อนไขค้นหาที่ใช้ร่วมกันระหว่างรายการกับตัวนับ — ต้องเป็นชุดเดียวกันเป๊ะ */
  private commentWhere(args: {
    workspaceId?: string;
    trackedPageId?: string;
    keyword?: string;
    fromMs: number;
    toMs: number;
  }): Record<string, unknown> {
    const keyword = args.keyword?.trim() ?? "";
    const pageWhere: Record<string, unknown> = {};
    if (args.trackedPageId !== undefined) pageWhere["id"] = args.trackedPageId;
    if (args.workspaceId !== undefined) pageWhere["workspaceId"] = args.workspaceId;

    return {
      createdAt: { gte: new Date(args.fromMs), lt: new Date(args.toMs) },
      ...(keyword === ""
        ? {}
        : { message: { contains: keyword, mode: "insensitive" } }),
      ...(Object.keys(pageWhere).length === 0
        ? {}
        : { trackedPost: { trackedPage: pageWhere } }),
    };
  }

  /** เพิ่มเพจเข้ารายการเฝ้าดู — เพจเดิมใน workspace เดิมเพิ่มซ้ำไม่ได้ */
  async addPage(args: {
    workspaceId: string;
    externalId: string;
    /** ไม่ส่งมา = Facebook — ค่าเริ่มต้นเดียวกับคอลัมน์ใน schema */
    platform?: TrackedPlatform;
    name: string;
    kind: TrackedKind;
    source: TrackedSource;
    /** ผูกกลับไปที่เพจที่เราดูแล เมื่อเป็นเพจของเราเอง */
    pageId?: string;
    followers?: number;
  }): Promise<TrackedPageRow> {
    const row = await this.prisma.trackedPage.create({
      data: {
        workspaceId: args.workspaceId,
        externalId: args.externalId,
        ...(args.platform !== undefined ? { platform: args.platform } : {}),
        name: args.name,
        kind: args.kind,
        source: args.source,
        ...(args.pageId !== undefined ? { pageId: args.pageId } : {}),
        ...(args.followers !== undefined ? { followers: args.followers } : {}),
      },
    });
    return toRow(row);
  }

  /** เอาเพจออกจากรายการเฝ้าดู — โพสต์กับคอมเมนต์ที่เก็บไว้หายตามไปด้วย (cascade) */
  async removePage(id: string): Promise<void> {
    await this.prisma.trackedPage.delete({ where: { id } });
  }

  /**
   * แปลง id ภายในของคอมเมนต์ → รหัสบนแพลตฟอร์ม พร้อมข้อมูลช่องที่มันอยู่
   *
   * ─── ทำไมต้องผ่านขั้นนี้ ไม่ให้หน้าจอส่งรหัสแพลตฟอร์มมาตรงๆ ───
   *
   * รหัสที่มาจากฟอร์มคือสิ่งที่ผู้ใช้ส่งมา ถ้าเชื่อแล้วยิงต่อทันที คนที่แก้ค่าใน
   * ฟอร์มจะสั่งซ่อน/ลบคอมเมนต์อะไรก็ได้บนช่องที่เราเป็นเจ้าของ — ตรงนี้จึงอ่าน
   * จากฐานข้อมูลเราเองเสมอ id ที่ไม่มีอยู่จริงก็จะหายไปเองโดยไม่ต้องดักเพิ่ม
   *
   * จัดกลุ่มตามช่องด้วย เพราะการสั่งซ่อนหนึ่งครั้งทำได้ทีละช่อง
   * (สิทธิ์ผูกกับช่อง และ `owned` ของแต่ละช่องไม่เหมือนกัน)
   */
  async resolveCommentsForModeration(args: {
    workspaceId?: string;
    commentIds: readonly string[];
  }): Promise<
    Array<{
      trackedPageId: string;
      channelExternalId: string;
      channelName: string;
      platform: TrackedPlatform;
      owned: boolean;
      comments: Array<{ id: string; externalId: string }>;
    }>
  > {
    if (args.commentIds.length === 0) return [];

    const rows = await this.prisma.trackedComment.findMany({
      where: {
        id: { in: [...args.commentIds] },
        ...(args.workspaceId !== undefined
          ? { trackedPost: { trackedPage: { workspaceId: args.workspaceId } } }
          : {}),
      },
      select: {
        id: true,
        externalId: true,
        trackedPost: {
          select: {
            trackedPage: {
              select: {
                id: true,
                externalId: true,
                name: true,
                platform: true,
                kind: true,
              },
            },
          },
        },
      },
    });

    const byChannel = new Map<
      string,
      {
        trackedPageId: string;
        channelExternalId: string;
        channelName: string;
        platform: TrackedPlatform;
        owned: boolean;
        comments: Array<{ id: string; externalId: string }>;
      }
    >();

    for (const r of rows) {
      const page = r.trackedPost.trackedPage;
      let group = byChannel.get(page.id);
      if (group === undefined) {
        group = {
          trackedPageId: page.id,
          channelExternalId: page.externalId,
          channelName: page.name,
          platform: page.platform as TrackedPlatform,
          owned: page.kind === "OWNED",
          comments: [],
        };
        byChannel.set(page.id, group);
      }
      group.comments.push({ id: r.id, externalId: r.externalId });
    }

    return [...byChannel.values()];
  }

  /**
   * จดว่าเราสั่งอะไรไปกับคอมเมนต์ชุดนี้
   *
   * จดเฉพาะตัวที่**สำเร็จจริง** — ถ้าจดทุกตัวที่สั่งไป หน้าจอจะบอกว่า "ซ่อนแล้ว"
   * ทั้งที่บางตัวยังอยู่ คนจะเลิกเชื่อหน้าจอตั้งแต่ครั้งแรกที่จับได้
   */
  async recordModeration(args: {
    commentIds: readonly string[];
    status: string;
    atMs: number;
  }): Promise<number> {
    if (args.commentIds.length === 0) return 0;
    const res = await this.prisma.trackedComment.updateMany({
      where: { id: { in: [...args.commentIds] } },
      data: { moderatedStatus: args.status, moderatedAt: new Date(args.atMs) },
    });
    return res.count;
  }

  async findByFbPageId(args: {
    workspaceId: string;
    externalId: string;
  }): Promise<TrackedPageRow | null> {
    const row = await this.prisma.trackedPage.findUnique({
      where: {
        workspaceId_externalId: {
          workspaceId: args.workspaceId,
          externalId: args.externalId,
        },
      },
    });
    return row === null ? null : toRow(row);
  }
}

interface RawTrackedPage {
  id: string;
  externalId: string;
  platform: string;
  name: string;
  kind: string;
  source: string;
  followers: number | null;
  lastFetchedAt: Date | null;
}

function toRow(r: RawTrackedPage): TrackedPageRow {
  return {
    id: r.id,
    externalId: r.externalId,
    platform: r.platform as TrackedPlatform,
    name: r.name,
    kind: r.kind as TrackedKind,
    source: r.source as TrackedSource,
    followers: r.followers,
    lastFetchedAtMs: r.lastFetchedAt?.getTime() ?? null,
  };
}

function countDistinct(values: string[]): number {
  return new Set(values).size;
}
