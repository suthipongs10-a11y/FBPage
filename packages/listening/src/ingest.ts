/**
 * ดึงโพสต์ + คอมเมนต์ของเพจที่เฝ้าดู เข้ามาเก็บใน DB ของเราเอง
 *
 * ─── ทำไมต้องคัดลอกมาเก็บเอง แทนที่จะถาม Meta ตอนเปิดหน้าจอ ───
 *
 * 1. Meta คิด rate limit ต่อแอป ถ้าทุกครั้งที่เปิดหน้าแดชบอร์ดยิงไป 40 call
 *    เปิดสิบครั้งก็ตัน แล้ว **งานที่ลูกค้ารออยู่จริง** (ตอบแชท, ยิงโพสต์ตามเวลา)
 *    จะโดนบล็อกไปด้วยเพราะใช้โควตาก้อนเดียวกัน
 * 2. เทียบย้อนหลังไม่ได้เลยถ้าไม่จด — Meta ให้ยอด ณ ปัจจุบันอย่างเดียว
 * 3. ค้นคอมเมนต์ด้วยคำ ทำบนฐานข้อมูลเราเองได้ แต่ทำผ่าน Graph API ไม่ได้
 *
 * ทุก call ใช้ `priority: "low"` — งานฟังเสียงไม่มีใครนั่งรอ ห้ามไปเบียดคิว
 * ของงานที่มีคนรอ
 *
 * ─── ข้อจำกัดที่ต้องรู้ ───
 *
 * ดึงเพจ **ที่เราไม่ได้เป็นแอดมิน** ต้องมีสิทธิ์ Page Public Content Access
 * ซึ่งต้องผ่าน App Review + Business Verification ของ Meta ก่อน
 * ตัวนี้จึงข้ามเพจที่ `source !== "META_API"` ไปเฉยๆ แทนที่จะยิงแล้วโดนปฏิเสธ
 * — เพจพวกนั้นรอข้อมูลจากแหล่งภายนอกมาเติมทีหลัง
 */
import { nullLogger, systemClock, type Clock, type Logger } from "@page-os/core";
import { MetaApiError, type MetaGateway } from "@page-os/meta";

export type TrackedKind = "OWNED" | "COMPETITOR" | "GROUP";
export type TrackedSource = "META_API" | "EXTERNAL" | "MANUAL";

export interface TrackedPageRef {
  /** id ภายในของเรา (uuid) — ไม่ใช่รหัสเพจของ Facebook */
  id: string;
  fbPageId: string;
  name: string;
  kind: TrackedKind;
  source: TrackedSource;
  followers: number | null;
  lastFetchedAtMs: number | null;
}

export interface FetchedPost {
  fbPostId: string;
  publishedAtMs: number;
  message: string | null;
  permalink: string | null;
  reactions: number;
  shares: number;
  commentCount: number;
}

export interface FetchedComment {
  fbCommentId: string;
  authorId: string | null;
  authorName: string | null;
  message: string | null;
  createdAtMs: number;
}

export interface ListeningRepository {
  /** เพจที่ถึงเวลาดึงใหม่ — เรียงตัวที่ค้างนานสุดขึ้นก่อน */
  duePages(args: {
    nowMs: number;
    staleAfterMs: number;
    limit: number;
  }): Promise<TrackedPageRef[]>;

  /** จดจำนวนผู้ติดตามของวันนี้ — รันซ้ำวันเดิมต้องทับของเดิม ไม่ใช่เพิ่มแถว */
  saveFollowers(args: {
    trackedPageId: string;
    followers: number;
    dateKey: string;
  }): Promise<void>;

  /**
   * upsert โพสต์ — คืนจำนวนแถวที่เขียน (ทั้งใหม่และอัปเดตยอด)
   *
   * `fetchedAtMs` ส่งมาจากตัวเรียกเสมอ ที่เก็บข้อมูลห้ามอ่านเวลาเอง —
   * ไม่งั้นเทสต์จะล็อกเวลาไม่ได้ และ `FakeClock` จะไร้ความหมาย
   */
  savePosts(args: {
    trackedPageId: string;
    posts: FetchedPost[];
    fetchedAtMs: number;
  }): Promise<number>;

  /** เขียนคอมเมนต์แบบไม่ซ้ำ — คืนจำนวนที่เพิ่มเข้ามาใหม่จริงๆ */
  saveComments(args: {
    trackedPageId: string;
    fbPostId: string;
    comments: FetchedComment[];
  }): Promise<number>;

  markFetched(args: { trackedPageId: string; atMs: number }): Promise<void>;
}

/** รูปร่างที่ Graph API ตอบกลับมา — เขียนไว้เพื่อให้ TypeScript ช่วยจับตอนแกะ */
interface RawPost {
  id?: string;
  created_time?: string;
  message?: string;
  permalink_url?: string;
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
}

interface RawComment {
  id?: string;
  message?: string;
  created_time?: string;
  from?: { id?: string; name?: string };
}

interface Paged<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

interface RawPageInfo {
  id?: string;
  name?: string;
  followers_count?: number;
  fan_count?: number;
}

export interface ListeningSyncOptions {
  gateway: MetaGateway;
  repo: ListeningRepository;
  clock?: Clock;
  logger?: Logger;
  /** ดึงโพสต์ย้อนหลังกี่วัน — ค่าเริ่มต้น 30 ตรงกับหน้าจอ */
  lookbackDays?: number;
  /** เพดานจำนวนโพสต์ต่อเพจต่อรอบ กัน quota หมดกับเพจที่โพสต์วันละ 50 ครั้ง */
  maxPostsPerPage?: number;
  /** เพดานคอมเมนต์ต่อโพสต์ */
  maxCommentsPerPost?: number;
}

export const DEFAULT_LOOKBACK_DAYS = 30;
export const DEFAULT_MAX_POSTS = 100;
export const DEFAULT_MAX_COMMENTS = 500;
/** ขอทีละกี่ชิ้นต่อ call — Meta เพดาน 100 สำหรับ endpoint พวกนี้ */
const PAGE_SIZE = 100;

export interface PageSyncResult {
  trackedPageId: string;
  fbPageId: string;
  postsWritten: number;
  commentsWritten: number;
  followers: number | null;
  /** ข้อความไทยสรุปว่าเกิดอะไรขึ้น ใช้ขึ้น log และหน้าจอ */
  th: string;
  errors: string[];
}

/**
 * `created_time` ของ Meta เป็น ISO 8601 พร้อม offset เช่น `2026-08-07T08:57:00+0000`
 * `Date.parse` อ่านรูปนี้ได้ แต่คืน `NaN` ถ้าฟิลด์หายหรือเพี้ยน — ต้องดักเอง
 * ไม่งั้นจะได้แถวที่ `publishedAt` เป็น Invalid Date ลง DB แล้วทุกช่วงเวลากรองพลาด
 */
function parseTimeMs(value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export class ListeningSync {
  private readonly gateway: MetaGateway;
  private readonly repo: ListeningRepository;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly lookbackDays: number;
  private readonly maxPosts: number;
  private readonly maxComments: number;

  constructor(opts: ListeningSyncOptions) {
    this.gateway = opts.gateway;
    this.repo = opts.repo;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
    this.lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    this.maxPosts = opts.maxPostsPerPage ?? DEFAULT_MAX_POSTS;
    this.maxComments = opts.maxCommentsPerPost ?? DEFAULT_MAX_COMMENTS;
  }

  /** ดึงข้อมูลเพจเดียว */
  async syncPage(page: TrackedPageRef): Promise<PageSyncResult> {
    const result: PageSyncResult = {
      trackedPageId: page.id,
      fbPageId: page.fbPageId,
      postsWritten: 0,
      commentsWritten: 0,
      followers: page.followers,
      th: "",
      errors: [],
    };

    if (page.source !== "META_API") {
      result.th =
        `ข้ามเพจ "${page.name}" — ตั้งไว้ว่าข้อมูลมาจากแหล่งภายนอก ` +
        `ไม่ได้ดึงผ่าน Graph API`;
      return result;
    }

    /**
     * ใช้ token ของเพจนั้นเองเมื่อเป็นเพจเรา ส่วนเพจอื่นต้องใช้ token ของเพจเรา
     * เพจใดเพจหนึ่งบวกสิทธิ์ PPCA — ตรงนี้ส่ง `pageId` ของเพจเป้าหมายไปก่อน
     * ถ้าไม่มี token ให้ gateway จะโยน error ที่บอกชัดว่าขาดอะไร
     */
    const tokenPageId = page.fbPageId;

    // ── 1. ข้อมูลเพจ (ผู้ติดตาม) ────────────────────────────────────────
    try {
      const info = await this.gateway.call<RawPageInfo>({
        pageId: tokenPageId,
        path: `/${page.fbPageId}`,
        params: { fields: "id,name,followers_count,fan_count" },
        priority: "low",
      });
      /**
       * `followers_count` คือคนกดติดตาม ส่วน `fan_count` คือคนกดถูกใจเพจ
       * สองอย่างนี้ต่างกันและ Meta ทยอยเลิกให้ `fan_count` — เอา followers ก่อน
       * แล้วค่อยถอยไป fan_count เมื่อไม่มี ดีกว่าปล่อยเป็น null แล้วเทียบเพจไม่ได้
       */
      const followers = info.data.followers_count ?? info.data.fan_count ?? null;
      if (followers !== null) {
        result.followers = followers;
        await this.repo.saveFollowers({
          trackedPageId: page.id,
          followers,
          dateKey: dateKeyUtc(this.clock.now()),
        });
      }
    } catch (err) {
      result.errors.push(describeError(err));
    }

    // ── 2. โพสต์ในช่วงย้อนหลัง ─────────────────────────────────────────
    const sinceMs = this.clock.now() - this.lookbackDays * 86_400_000;
    let posts: FetchedPost[] = [];
    try {
      posts = await this.fetchPosts(page.fbPageId, tokenPageId, sinceMs);
      result.postsWritten = await this.repo.savePosts({
        trackedPageId: page.id,
        posts,
        fetchedAtMs: this.clock.now(),
      });
    } catch (err) {
      result.errors.push(describeError(err));
    }

    // ── 3. คอมเมนต์ของแต่ละโพสต์ ───────────────────────────────────────
    for (const post of posts) {
      // โพสต์ที่ไม่มีคอมเมนต์เลย ไม่ต้องเสีย call ไปถาม
      if (post.commentCount === 0) continue;
      try {
        const comments = await this.fetchComments(post.fbPostId, tokenPageId);
        result.commentsWritten += await this.repo.saveComments({
          trackedPageId: page.id,
          fbPostId: post.fbPostId,
          comments,
        });
      } catch (err) {
        result.errors.push(describeError(err));
      }
    }

    await this.repo.markFetched({ trackedPageId: page.id, atMs: this.clock.now() });

    result.th =
      result.errors.length === 0
        ? `ดึงเพจ "${page.name}" เรียบร้อย — ${result.postsWritten} โพสต์ / ${result.commentsWritten} คอมเมนต์ใหม่`
        : `ดึงเพจ "${page.name}" ได้บางส่วน — ${result.postsWritten} โพสต์ / ` +
          `${result.commentsWritten} คอมเมนต์ใหม่ แต่มี ${result.errors.length} เรื่องที่พลาด`;

    this.logger.info(result.th, {
      trackedPageId: page.id,
      posts: result.postsWritten,
      comments: result.commentsWritten,
    });
    return result;
  }

  /** ดึงเพจที่ถึงเวลาแล้วทั้งชุด */
  async syncDue(args: {
    staleAfterMs: number;
    limit: number;
  }): Promise<PageSyncResult[]> {
    const due = await this.repo.duePages({
      nowMs: this.clock.now(),
      staleAfterMs: args.staleAfterMs,
      limit: args.limit,
    });

    const out: PageSyncResult[] = [];
    // ทีละเพจ ไม่ขนานกัน — ขนานแล้วจะไปกิน rate limit ของงานที่มีคนรออยู่
    for (const page of due) {
      out.push(await this.syncPage(page));
    }
    return out;
  }

  private async fetchPosts(
    fbPageId: string,
    tokenPageId: string,
    sinceMs: number,
  ): Promise<FetchedPost[]> {
    const out: FetchedPost[] = [];
    let after: string | undefined;

    while (out.length < this.maxPosts) {
      const res = await this.gateway.call<Paged<RawPost>>({
        pageId: tokenPageId,
        path: `/${fbPageId}/posts`,
        params: {
          fields:
            "id,created_time,message,permalink_url,shares," +
            // limit(0) = ขอแค่ยอดรวม ไม่เอารายการมาด้วย ประหยัดทั้งเวลาและ payload
            "reactions.summary(true).limit(0),comments.summary(true).limit(0)",
          since: Math.floor(sinceMs / 1000),
          limit: Math.min(PAGE_SIZE, this.maxPosts - out.length),
          ...(after !== undefined ? { after } : {}),
        },
        priority: "low",
      });

      const batch = res.data.data ?? [];
      for (const raw of batch) {
        const publishedAtMs = parseTimeMs(raw.created_time);
        // ไม่มีรหัสหรือไม่มีเวลา = แถวที่เอาไปใช้ต่อไม่ได้ ทิ้งดีกว่าเก็บของเสีย
        if (raw.id === undefined || publishedAtMs === null) continue;
        out.push({
          fbPostId: raw.id,
          publishedAtMs,
          message: raw.message ?? null,
          permalink: raw.permalink_url ?? null,
          reactions: raw.reactions?.summary?.total_count ?? 0,
          shares: raw.shares?.count ?? 0,
          commentCount: raw.comments?.summary?.total_count ?? 0,
        });
      }

      after = res.data.paging?.cursors?.after;
      // ไม่มีหน้าถัดไป หรือหน้านี้ว่าง = จบ (เช็คสองอย่างกันวนไม่รู้จบ)
      if (after === undefined || batch.length === 0) break;
    }

    return out;
  }

  private async fetchComments(
    fbPostId: string,
    tokenPageId: string,
  ): Promise<FetchedComment[]> {
    const out: FetchedComment[] = [];
    let after: string | undefined;

    while (out.length < this.maxComments) {
      const res = await this.gateway.call<Paged<RawComment>>({
        pageId: tokenPageId,
        path: `/${fbPostId}/comments`,
        params: {
          fields: "id,message,created_time,from",
          // stream = เอาคอมเมนต์ย่อยมาด้วย ไม่ใช่แค่ระดับบนสุด
          filter: "stream",
          limit: Math.min(PAGE_SIZE, this.maxComments - out.length),
          ...(after !== undefined ? { after } : {}),
        },
        priority: "low",
      });

      const batch = res.data.data ?? [];
      for (const raw of batch) {
        const createdAtMs = parseTimeMs(raw.created_time);
        if (raw.id === undefined || createdAtMs === null) continue;
        out.push({
          fbCommentId: raw.id,
          /**
           * `from` มักไม่มีมาให้เมื่อคนคอมเมนต์ไม่ได้ให้สิทธิ์แอปเรา —
           * เป็นเรื่องปกติ ไม่ใช่ error เก็บคอมเมนต์ไว้แบบไม่รู้ว่าใครพูดยังมีค่า
           * (เอาไปนับหัวข้อที่คนพูดถึงได้ แค่ทำ "แฟนตัวยง" ไม่ได้)
           */
          authorId: raw.from?.id ?? null,
          authorName: raw.from?.name ?? null,
          message: raw.message ?? null,
          createdAtMs,
        });
      }

      after = res.data.paging?.cursors?.after;
      if (after === undefined || batch.length === 0) break;
    }

    return out;
  }
}

/** YYYY-MM-DD ตาม UTC — snapshot ผู้ติดตามใช้วันเดียวกันทั้งระบบ ไม่แยกตามเพจ */
export function dateKeyUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** error จาก gateway มีข้อความไทยติดมาแล้ว ส่วนอย่างอื่นต้องแปลงเอง */
function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return err.th;
  return err instanceof Error ? err.message : String(err);
}
