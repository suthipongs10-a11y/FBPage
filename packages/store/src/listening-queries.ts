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
import type { PostStat, TrackedKind, TrackedSource } from "@page-os/listening";
import type { PrismaClient } from "./client.js";

export interface TrackedPageRow {
  id: string;
  fbPageId: string;
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

  /** เพิ่มเพจเข้ารายการเฝ้าดู — เพจเดิมใน workspace เดิมเพิ่มซ้ำไม่ได้ */
  async addPage(args: {
    workspaceId: string;
    fbPageId: string;
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
        fbPageId: args.fbPageId,
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

  async findByFbPageId(args: {
    workspaceId: string;
    fbPageId: string;
  }): Promise<TrackedPageRow | null> {
    const row = await this.prisma.trackedPage.findUnique({
      where: {
        workspaceId_fbPageId: {
          workspaceId: args.workspaceId,
          fbPageId: args.fbPageId,
        },
      },
    });
    return row === null ? null : toRow(row);
  }
}

interface RawTrackedPage {
  id: string;
  fbPageId: string;
  name: string;
  kind: string;
  source: string;
  followers: number | null;
  lastFetchedAt: Date | null;
}

function toRow(r: RawTrackedPage): TrackedPageRow {
  return {
    id: r.id,
    fbPageId: r.fbPageId,
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
