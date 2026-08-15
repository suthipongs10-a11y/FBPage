/**
 * ดึงวิดีโอ + คอมเมนต์ของช่อง YouTube ที่เฝ้าดู เข้ามาเก็บใน DB ของเราเอง
 *
 * ใช้ **สัญญาเดียวกับฝั่ง Facebook** (`ListeningRepository`) โดยตั้งใจ —
 * เพราะสิ่งที่อยู่ปลายทางคือหน้าจอเดียวกัน: ตารางหัวข้อที่คนพูดถึง, กระดาน
 * แฟนตัวยง, ตัวสแกนคอมเมนต์ผิดปกติ ทั้งหมดนี้ไม่ควรต้องรู้ว่าคอมเมนต์มาจาก
 * แพลตฟอร์มไหน มีแค่ตัวดึงเท่านั้นที่ต้องรู้
 *
 * ─── ทำไมหน้าตาไม่เหมือน `ingest.ts` ทั้งที่ทำเรื่องเดียวกัน ───
 *
 * 1. **โควตาเป็นรายวัน ไม่ใช่รายชั่วโมง** — ของ Meta เต็มแล้วรอชั่วโมงเดียวก็หาย
 *    ของ YouTube ใช้หมดตอนเช้า = ตาบอดไปทั้งวัน ตัวนี้จึงหยุดตัวเองกลางคัน
 *    (`quotaExceeded` → เลิกทั้งรอบ) แทนที่จะไล่ยิงต่อให้ครบทุกช่อง
 * 2. **ไม่มี `search.list` เลยแม้แต่ที่เดียว** — ราคา 100 หน่วยต่อครั้ง
 *    เรียก 100 ครั้งโควตาหมดทั้งวัน เส้นทางที่ใช้คือ
 *    `channels.list` (ได้ id เพลย์ลิสต์ "อัปโหลด" มาด้วย) → `playlistItems.list`
 *    → `videos.list` → `commentThreads.list` รวมแล้วราคา 1 ต่อ call ทุกตัว
 * 3. **ยอดวิวต้องขอแยก** — `playlistItems.list` ให้แค่ว่ามีวิดีโออะไรบ้าง
 *    ไม่ให้ยอด ต้องเอา id ไปถาม `videos.list` ต่อ แต่ถามได้ทีละ 50 id
 *    ใน call เดียว จึงยังถูกอยู่
 * 4. **`commentThreads.list` ให้คอมเมนต์ตอบกลับมาในก้อนเดียวกัน** ต่างจาก
 *    Facebook ที่ต้องขอแยก — เราแบนมันออกมาเก็บรวมกับคอมเมนต์ระดับบน
 *
 * ─── สิ่งที่ YouTube มี/ไม่มี ต่างจาก Facebook ───
 *
 * | ฟิลด์ | Facebook | YouTube |
 * |---|---|---|
 * | reactions | ครบทุกแบบ | ไลก์อย่างเดียว (ดิสไลก์ถูกปิดตั้งแต่ ธ.ค. 2021) |
 * | shares | มี | **ไม่มี** — เก็บเป็น 0 |
 * | ยอดวิว | ของวิดีโอเท่านั้น | **ทุกวิดีโอ** |
 * | รหัสคนคอมเมนต์ | ผูกกับเพจ เทียบข้ามเพจไม่ได้ | **รหัสช่อง เทียบข้ามช่องได้** |
 *
 * ข้อสุดท้ายคือของแถมที่ใหญ่ที่สุด — "แฟนตัวยงที่ตามหลายช่อง" ทำได้จริงบน
 * YouTube แต่ทำบน Facebook ไม่ได้เลย เพราะ Meta ให้ id แบบผูกกับเพจ
 */
import { nullLogger, systemClock, type Clock, type Logger } from "@page-os/core";
import { YouTubeApiError, type YouTubeGateway } from "@page-os/youtube";
import type {
  FetchedComment,
  FetchedPost,
  ListeningRepository,
  PageSyncResult,
  TrackedPageRef,
} from "./ingest.js";
import { dateKeyUtc } from "./ingest.js";

/** ─── รูปร่างที่ YouTube Data API ตอบกลับ ─────────────────────────────── */

interface RawChannel {
  id?: string;
  snippet?: { title?: string };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

interface RawPlaylistItem {
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  snippet?: { title?: string; publishedAt?: string };
}

interface RawVideo {
  id?: string;
  snippet?: { title?: string; description?: string; publishedAt?: string };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface RawCommentSnippet {
  textOriginal?: string;
  textDisplay?: string;
  publishedAt?: string;
  authorDisplayName?: string;
  authorChannelId?: { value?: string };
}

interface RawCommentThread {
  snippet?: {
    topLevelComment?: { id?: string; snippet?: RawCommentSnippet };
  };
  replies?: { comments?: Array<{ id?: string; snippet?: RawCommentSnippet }> };
}

interface Listed<T> {
  items?: T[];
  nextPageToken?: string;
}

export interface YouTubeSyncOptions {
  gateway: YouTubeGateway;
  repo: ListeningRepository;
  clock?: Clock;
  logger?: Logger;
  /** ดึงวิดีโอย้อนหลังกี่วัน — ค่าเริ่มต้น 30 ตรงกับหน้าจอ */
  lookbackDays?: number;
  /** เพดานวิดีโอต่อช่องต่อรอบ */
  maxVideosPerChannel?: number;
  /** เพดานคอมเมนต์ต่อวิดีโอ */
  maxCommentsPerVideo?: number;
}

export const DEFAULT_YT_LOOKBACK_DAYS = 30;
export const DEFAULT_YT_MAX_VIDEOS = 50;
export const DEFAULT_YT_MAX_COMMENTS = 500;

/** `playlistItems`/`commentThreads` รับได้สูงสุด 50 ต่อ call */
const LIST_PAGE_SIZE = 50;
/** `videos.list` รับ id ได้ 50 ตัวต่อ call — ตรงนี้คือที่มาของความประหยัด */
const VIDEO_BATCH = 50;

/**
 * `publishedAt` ของ YouTube เป็น RFC 3339 (`2026-08-07T08:57:00Z`)
 * `Date.parse` อ่านได้ แต่คืน NaN ถ้าฟิลด์หายหรือเพี้ยน — ต้องดักเอง
 * ไม่งั้นได้แถวที่ `publishedAt` เป็น Invalid Date ลง DB แล้วกรองช่วงเวลาพลาดทั้งตาราง
 */
function parseTimeMs(value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * ตัวเลขของ YouTube มาเป็น**สตริง** ทุกตัว (`"1234"`) เพราะ JSON ไม่มี int64
 * `Number()` ของ `""` คือ 0 และของ `undefined` คือ NaN — ต้องแยกสองกรณีนี้
 * ไม่งั้นช่องที่ปิดยอดผู้ติดตามจะถูกบันทึกเป็น "0 คน" ซึ่งผิดคนละเรื่องกับ "ไม่รู้"
 */
function parseCount(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ลิงก์วิดีโอ — ประกอบเองได้ ไม่ต้องเสีย call ไปขอ */
function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export class YouTubeListeningSync {
  private readonly gateway: YouTubeGateway;
  private readonly repo: ListeningRepository;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly lookbackDays: number;
  private readonly maxVideos: number;
  private readonly maxComments: number;

  constructor(opts: YouTubeSyncOptions) {
    this.gateway = opts.gateway;
    this.repo = opts.repo;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
    this.lookbackDays = opts.lookbackDays ?? DEFAULT_YT_LOOKBACK_DAYS;
    this.maxVideos = opts.maxVideosPerChannel ?? DEFAULT_YT_MAX_VIDEOS;
    this.maxComments = opts.maxCommentsPerVideo ?? DEFAULT_YT_MAX_COMMENTS;
  }

  async syncChannel(channel: TrackedPageRef): Promise<PageSyncResult> {
    const result: PageSyncResult = {
      trackedPageId: channel.id,
      externalId: channel.externalId,
      postsWritten: 0,
      commentsWritten: 0,
      followers: channel.followers,
      th: "",
      errors: [],
    };

    /**
     * ข้ามแล้ว **ยังต้องจดว่าดูแล้ว** ไม่งั้นช่องนี้จะยึดหัวคิวไว้ตลอดกาล
     * (คิวเรียง `lastFetchedAt` เก่าสุดก่อน และ `null` มาก่อนเพื่อน)
     * — มีช่องแบบนี้ครบเท่า `limit` ของรอบเมื่อไหร่ ช่องจริงจะไม่ถูกดึงเลย
     * ดูคำอธิบายเต็มที่ `ListeningSync.skip()`
     */
    if (channel.platform !== "YOUTUBE") {
      result.th =
        `ข้าม "${channel.name}" — เป็นเพจ ${channel.platform} ไม่ใช่ช่อง YouTube ` +
        `ต้องให้ตัวดึงของแพลตฟอร์มนั้นทำ`;
      await this.repo.markFetched({ trackedPageId: channel.id, atMs: this.clock.now() });
      return result;
    }
    if (channel.source !== "YOUTUBE_API") {
      result.th =
        `ข้ามช่อง "${channel.name}" — ตั้งไว้ว่าข้อมูลมาจากแหล่งภายนอก ` +
        `ไม่ได้ดึงผ่าน YouTube Data API`;
      await this.repo.markFetched({ trackedPageId: channel.id, atMs: this.clock.now() });
      return result;
    }

    // ── 1. ข้อมูลช่อง — ได้ผู้ติดตาม + id เพลย์ลิสต์อัปโหลดในราคา 1 หน่วย ──
    let uploadsPlaylistId: string | null = null;
    try {
      const res = await this.gateway.call<Listed<RawChannel>>({
        endpoint: "channels.list",
        params: {
          part: "snippet,statistics,contentDetails",
          id: channel.externalId,
        },
        channelId: channel.externalId,
      });

      const info = res.data.items?.[0];
      if (info === undefined) {
        /**
         * ช่องหายไปแล้ว หรือรหัสผิด — API ตอบ 200 พร้อม `items: []`
         * ไม่ใช่ 404 ถ้าไม่ดักตรงนี้ จะกลายเป็น "ดึงเรียบร้อย 0 วิดีโอ"
         * ทุกชั่วโมง โดยไม่มีอะไรบอกว่าเพิ่มรหัสผิดไว้ตั้งแต่แรก
         */
        result.errors.push(
          `ไม่พบช่องรหัส ${channel.externalId} บน YouTube — ` +
            `ตรวจว่ารหัสช่องถูกไหม (ต้องขึ้นต้นด้วย UC ไม่ใช่ @ชื่อช่อง)`,
        );
        await this.repo.markFetched({
          trackedPageId: channel.id,
          atMs: this.clock.now(),
        });
        result.th = `ดึงช่อง "${channel.name}" ไม่ได้ — ไม่พบช่องนี้`;
        return result;
      }

      uploadsPlaylistId = info.contentDetails?.relatedPlaylists?.uploads ?? null;

      /**
       * ช่องที่ตั้งค่าซ่อนยอดผู้ติดตามจะไม่ส่ง `subscriberCount` มาเลย
       * — บันทึกเป็น null (ไม่รู้) ไม่ใช่ 0 ไม่งั้นกราฟจะดิ่งลงศูนย์
       */
      const followers = info.statistics?.hiddenSubscriberCount === true
        ? null
        : parseCount(info.statistics?.subscriberCount);
      if (followers !== null) {
        result.followers = followers;
        await this.repo.saveFollowers({
          trackedPageId: channel.id,
          followers,
          dateKey: dateKeyUtc(this.clock.now()),
        });
      }
    } catch (err) {
      result.errors.push(describeError(err));
      if (isQuotaExhausted(err)) return this.stopForQuota(channel, result);
    }

    // ── 2. วิดีโอในช่วงย้อนหลัง ──────────────────────────────────────────
    const sinceMs = this.clock.now() - this.lookbackDays * 86_400_000;
    let videos: FetchedPost[] = [];
    if (uploadsPlaylistId !== null) {
      try {
        videos = await this.fetchVideos(uploadsPlaylistId, channel.externalId, sinceMs);
        result.postsWritten = await this.repo.savePosts({
          trackedPageId: channel.id,
          posts: videos,
          fetchedAtMs: this.clock.now(),
        });
      } catch (err) {
        result.errors.push(describeError(err));
        if (isQuotaExhausted(err)) return this.stopForQuota(channel, result);
      }
    } else if (result.errors.length === 0) {
      result.errors.push(
        `ช่อง "${channel.name}" ไม่มีเพลย์ลิสต์อัปโหลด — ` +
          `ช่องนี้อาจยังไม่เคยลงวิดีโอเลย`,
      );
    }

    // ── 3. คอมเมนต์ของแต่ละวิดีโอ ───────────────────────────────────────
    for (const video of videos) {
      // วิดีโอที่ไม่มีคอมเมนต์เลย ไม่ต้องเสียโควตาไปถาม
      if (video.commentCount === 0) continue;
      try {
        const comments = await this.fetchComments(video.externalId);
        result.commentsWritten += await this.repo.saveComments({
          trackedPageId: channel.id,
          externalId: video.externalId,
          comments,
        });
      } catch (err) {
        result.errors.push(describeError(err));
        if (isQuotaExhausted(err)) return this.stopForQuota(channel, result);
      }
    }

    await this.repo.markFetched({ trackedPageId: channel.id, atMs: this.clock.now() });

    result.th =
      result.errors.length === 0
        ? `ดึงช่อง "${channel.name}" เรียบร้อย — ${result.postsWritten} วิดีโอ / ` +
          `${result.commentsWritten} คอมเมนต์ใหม่`
        : `ดึงช่อง "${channel.name}" ได้บางส่วน — ${result.postsWritten} วิดีโอ / ` +
          `${result.commentsWritten} คอมเมนต์ใหม่ แต่มี ${result.errors.length} เรื่องที่พลาด`;

    this.logger.info(result.th, {
      trackedPageId: channel.id,
      videos: result.postsWritten,
      comments: result.commentsWritten,
    });
    return result;
  }

  /**
   * ดึงช่องที่ถึงเวลาแล้วทั้งชุด
   *
   * ต่างจากฝั่ง Facebook ตรงที่**หยุดทั้งรอบทันทีเมื่อโควตาหมด** ไม่ไล่ต่อ
   * ให้ครบทุกช่อง เพราะ call ที่โดนปฏิเสธเพราะโควตาหมด**ยังกินโควตา** —
   * ไล่ยิงต่อ 40 ช่องที่เหลือคือการเผาโควตาของวันพรุ่งนี้ทิ้งเปล่าๆ
   */
  async syncDue(args: {
    staleAfterMs: number;
    limit: number;
  }): Promise<PageSyncResult[]> {
    const due = await this.repo.duePages({
      nowMs: this.clock.now(),
      staleAfterMs: args.staleAfterMs,
      limit: args.limit,
      platform: "YOUTUBE",
    });

    const out: PageSyncResult[] = [];
    for (const channel of due) {
      const res = await this.syncChannel(channel);
      out.push(res);
      if (res.quotaExhausted === true) {
        const left = due.length - out.length;
        if (left > 0) {
          this.logger.warn(
            `โควตา YouTube หมดกลางรอบ — เหลืออีก ${left} ช่องที่ยังไม่ได้ดึง ` +
              `จะดึงต่อรอบหน้าหลังโควตารีเซ็ต`,
            { done: out.length, left },
          );
        }
        break;
      }
    }
    return out;
  }

  /**
   * โควตาหมดกลางคัน — **ไม่** `markFetched`
   *
   * ถ้าจดว่าดึงแล้ว ช่องนี้จะไปต่อท้ายแถวแล้วไม่ถูกหยิบอีกจนกว่าจะครบรอบถัดไป
   * ทั้งที่จริงยังไม่ได้ข้อมูล — ปล่อยให้มันยังค้างคิวไว้ พอโควตากลับมาจะถูก
   * หยิบขึ้นก่อนใครเพราะเรียงจากตัวที่ค้างนานสุด
   */
  private stopForQuota(
    channel: TrackedPageRef,
    result: PageSyncResult,
  ): PageSyncResult {
    result.quotaExhausted = true;
    result.th =
      `หยุดดึงช่อง "${channel.name}" กลางคัน — โควตา YouTube วันนี้หมด ` +
      `(ได้ ${result.postsWritten} วิดีโอ / ${result.commentsWritten} คอมเมนต์ก่อนหยุด) ` +
      `โควตารีเซ็ตเที่ยงคืนเวลาแปซิฟิก ราวบ่าย 2–3 โมงบ้านเรา`;
    this.logger.warn(result.th, { trackedPageId: channel.id });
    return result;
  }

  /**
   * วิดีโอของช่อง — `playlistItems.list` แล้วเติมยอดด้วย `videos.list`
   *
   * `playlistItems` เรียงจากใหม่ไปเก่าเสมอ จึง**หยุดได้ทันทีที่เจอตัวแรกที่เก่า
   * เกินกรอบ** ไม่ต้องไล่จนหมดเพลย์ลิสต์ (ช่องที่ลงมา 10 ปีมีหลายพันวิดีโอ
   * ไล่หมดคือ 100+ call ทั้งที่ต้องการแค่ 30 วันหลัง)
   */
  private async fetchVideos(
    uploadsPlaylistId: string,
    channelId: string,
    sinceMs: number,
  ): Promise<FetchedPost[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    let reachedOld = false;

    while (ids.length < this.maxVideos && !reachedOld) {
      const res = await this.gateway.call<Listed<RawPlaylistItem>>({
        endpoint: "playlistItems.list",
        params: {
          part: "contentDetails",
          playlistId: uploadsPlaylistId,
          maxResults: Math.min(LIST_PAGE_SIZE, this.maxVideos - ids.length),
          pageToken,
        },
        channelId,
      });

      const batch = res.data.items ?? [];
      const before = ids.length;
      /** เวลาของรายการที่อ่านได้ตัวสุดท้ายในหน้านี้ — ใช้ตัดสินว่าพ้นกรอบหรือยัง */
      let lastReadableAtMs: number | null = null;

      for (const item of batch) {
        /**
         * เช็คเพดานใน**ลูปชั้นใน**ด้วย ไม่ใช่แค่ตอนขึ้นหน้าใหม่
         *
         * `maxResults` เป็นแค่คำขอ ไม่ใช่สัญญา — YouTube ส่งเกินมาได้ และ
         * ถ้าเกินมาแม้แต่ตัวเดียวจนข้ามหลัก 50 จะกลายเป็น `videos.list`
         * เพิ่มอีกหนึ่ง call เต็มๆ ทั้งที่ผู้ใช้ตั้งเพดานไว้แล้วว่าไม่เอา
         */
        if (ids.length >= this.maxVideos) break;
        const videoId = item.contentDetails?.videoId;
        const publishedAtMs = parseTimeMs(item.contentDetails?.videoPublishedAt);
        if (videoId === undefined || publishedAtMs === null) continue;
        lastReadableAtMs = publishedAtMs;
        // เก่าเกินกรอบ = **ข้ามตัวนี้** ไม่ใช่ตัดจบทั้งหน้า (ดูเหตุผลข้างล่าง)
        if (publishedAtMs < sinceMs) continue;
        ids.push(videoId);
      }

      /**
       * หยุดไล่หน้าถัดไปเมื่อ**ตัวสุดท้ายของหน้านี้**พ้นกรอบไปแล้ว
       *
       * เพลย์ลิสต์อัปโหลดเรียงใหม่→เก่า ตัวท้ายสุดของหน้าเก่าแล้วจึงแปลว่า
       * ขอบเขตอยู่ในหน้านี้ และหน้าถัดไปเก่ากว่านี้ทั้งหมด
       *
       * ─── ทำไมไม่หยุดที่ตัวแรกที่เก่า (ซึ่งเขียนง่ายกว่า) ───
       *
       * ลำดับในเพลย์ลิสต์เรียงตาม**วันอัปโหลด** แต่เราเทียบด้วย
       * `videoPublishedAt` (วันที่เผยแพร่) สองอย่างนี้ไม่ตรงกันเมื่อวิดีโอถูก
       * อัปไว้เป็นส่วนตัวก่อนแล้วค่อยเปิดทีหลัง หรือเป็นวิดีโอที่ตั้งเวลาไว้
       *
       * ถ้าหยุดที่ตัวแรกที่เก่า วิดีโอสลับลำดับตัวเดียวที่บังเอิญอยู่หัวรายการ
       * จะทำให้**ทั้งช่องไม่ถูกดึงเลย** และเงียบสนิท ไม่มี error อะไรให้เห็น
       */
      if (lastReadableAtMs !== null && lastReadableAtMs < sinceMs) reachedOld = true;

      pageToken = res.data.nextPageToken;
      /**
       * หน้าที่ใช้อะไรไม่ได้เลย = จบ ไม่ใช่ขอหน้าถัดไป
       *
       * เงื่อนไข `batch.length === 0` อย่างเดียวไม่พอ — API ที่ตอบมา 50 รายการ
       * ที่ไม่มี `videoId` เลยพร้อม `nextPageToken` จะทำให้วนขอไปเรื่อยๆ
       * โดยที่ `ids.length` ไม่ขยับ **ตัวนับเพดานจึงไม่มีวันถึง**
       * (พิสูจน์แล้วว่าวนได้เกิน 2,000 call = โควตาทั้งวันหมดในไม่กี่วินาที)
       */
      if (pageToken === undefined || ids.length === before) break;
    }

    return ids.length === 0 ? [] : await this.fetchVideoStats(ids, channelId);
  }

  /** ยอดวิว/ไลก์/จำนวนคอมเมนต์ — ถามทีละ 50 id ต่อ call */
  private async fetchVideoStats(
    ids: string[],
    channelId: string,
  ): Promise<FetchedPost[]> {
    const out: FetchedPost[] = [];

    for (let i = 0; i < ids.length; i += VIDEO_BATCH) {
      const chunk = ids.slice(i, i + VIDEO_BATCH);
      const res = await this.gateway.call<Listed<RawVideo>>({
        endpoint: "videos.list",
        params: { part: "snippet,statistics", id: chunk.join(",") },
        channelId,
      });

      for (const raw of res.data.items ?? []) {
        const publishedAtMs = parseTimeMs(raw.snippet?.publishedAt);
        if (raw.id === undefined || publishedAtMs === null) continue;
        out.push({
          externalId: raw.id,
          publishedAtMs,
          /**
           * เก็บชื่อเรื่องนำหน้าคำบรรยาย เพราะหน้าจอเดิมโชว์ฟิลด์เดียว
           * (`message`) และชื่อเรื่องคือสิ่งที่คนจำวิดีโอได้ ส่วนคำบรรยาย
           * ของ YouTube มักยาวเป็นหน้าและมีแต่ลิงก์
           */
          message: buildVideoMessage(raw.snippet?.title, raw.snippet?.description),
          permalink: watchUrl(raw.id),
          // YouTube มีแต่ไลก์ — ดิสไลก์ถูกปิดตั้งแต่ ธ.ค. 2021
          reactions: parseCount(raw.statistics?.likeCount) ?? 0,
          // ไม่มีตัวเลขการแชร์ให้เลย ไม่ใช่ว่าเป็นศูนย์ — ดูหัวไฟล์
          shares: 0,
          commentCount: parseCount(raw.statistics?.commentCount) ?? 0,
        });
      }
    }

    return out;
  }

  /**
   * คอมเมนต์ของวิดีโอ — รวมคอมเมนต์ตอบกลับที่ติดมาในก้อนเดียวกัน
   *
   * `commentThreads.list` ให้ reply มาด้วย (สูงสุด 5 อันแรกต่อเธรด) เราแบน
   * ออกมาเก็บรวมกับคอมเมนต์ระดับบน เพราะตัววิเคราะห์หัวข้อ/แฟนตัวยง
   * ไม่สนใจว่าใครตอบใคร สนใจแค่ว่า "ใครพูดอะไร"
   */
  private async fetchComments(videoId: string): Promise<FetchedComment[]> {
    const out: FetchedComment[] = [];
    let pageToken: string | undefined;

    while (out.length < this.maxComments) {
      let res;
      try {
        res = await this.gateway.call<Listed<RawCommentThread>>({
          endpoint: "commentThreads.list",
          params: {
            part: "snippet,replies",
            videoId,
            maxResults: LIST_PAGE_SIZE,
            // เอาคอมเมนต์ใหม่ก่อน — ถ้าชนเพดานจะได้ของที่ยังมีความหมาย
            order: "time",
            // ตัด HTML entity ออก ตัววิเคราะห์หัวข้อทำงานกับข้อความดิบ
            textFormat: "plainText",
            pageToken,
          },
        });
      } catch (err) {
        /**
         * ปิดคอมเมนต์ไว้ = `commentsDisabled` (403) ซึ่งเป็นสถานะปกติของ
         * วิดีโอ ไม่ใช่ความผิดพลาด คืนที่ได้มาแล้วแทนที่จะโยนขึ้นไปให้
         * นับเป็น "เรื่องที่พลาด" — ไม่งั้นช่องที่ปิดคอมเมนต์ทุกวิดีโอจะขึ้น
         * เตือนสีแดงตลอดกาลทั้งที่ไม่มีอะไรต้องแก้
         */
        if (err instanceof YouTubeApiError && err.reason === "commentsDisabled") {
          return out;
        }
        throw err;
      }

      const batch = res.data.items ?? [];
      const before = out.length;
      for (const thread of batch) {
        /**
         * เพดานต้องเช็คในลูปชั้นในด้วย เพราะหนึ่งเธรดพ่วง reply มาได้อีก 5
         * — หน้าหนึ่ง 50 เธรดจึงกลายเป็นได้ถึง 300 คอมเมนต์ ถ้าเช็คแค่ตอน
         * ขึ้นหน้าใหม่ เพดาน 100 จะทะลุไป 300 โดยที่ผู้ใช้ตั้งค่าไว้แล้ว
         */
        if (out.length >= this.maxComments) break;
        const top = thread.snippet?.topLevelComment;
        const mapped = toComment(top?.id, top?.snippet);
        if (mapped !== null) out.push(mapped);

        for (const reply of thread.replies?.comments ?? []) {
          if (out.length >= this.maxComments) break;
          const r = toComment(reply.id, reply.snippet);
          if (r !== null) out.push(r);
        }
      }

      pageToken = res.data.nextPageToken;
      // หน้าที่ใช้อะไรไม่ได้เลย = จบ — เหตุผลเดียวกับใน `fetchVideos()`
      if (pageToken === undefined || out.length === before) break;
    }

    return out;
  }
}

/** ชื่อเรื่อง + คำบรรยาย รวมเป็นข้อความเดียวที่หน้าจอเดิมใช้ได้ */
function buildVideoMessage(
  title: string | undefined,
  description: string | undefined,
): string | null {
  const t = (title ?? "").trim();
  const d = (description ?? "").trim();
  if (t === "" && d === "") return null;
  if (d === "") return t;
  if (t === "") return d;
  return `${t}\n\n${d}`;
}

/** แปลงคอมเมนต์ดิบเป็นรูปที่เก็บได้ — คืน null ถ้าใช้ต่อไม่ได้ */
function toComment(
  id: string | undefined,
  snippet: RawCommentSnippet | undefined,
): FetchedComment | null {
  const createdAtMs = parseTimeMs(snippet?.publishedAt);
  if (id === undefined || createdAtMs === null) return null;
  return {
    externalId: id,
    /**
     * `authorChannelId.value` คือ **รหัสช่องระดับโลก** ไม่ผูกกับช่องที่เราดู
     * — ต่างจาก Facebook ที่ให้ id แบบผูกกับเพจ นี่คือเหตุผลที่ "แฟนที่ตาม
     * หลายช่อง" ทำได้จริงบน YouTube แต่ทำบน Facebook ไม่ได้
     */
    authorId: snippet?.authorChannelId?.value ?? null,
    authorName: snippet?.authorDisplayName ?? null,
    // `textOriginal` คือข้อความดิบ ส่วน `textDisplay` มี HTML ปนมา
    message: snippet?.textOriginal ?? snippet?.textDisplay ?? null,
    createdAtMs,
  };
}

/** โควตาหมดจริงๆ (ไม่ใช่แค่ยิงถี่เกิน) — ต้องหยุดทั้งรอบ ไม่ใช่ลองใหม่ */
function isQuotaExhausted(err: unknown): boolean {
  return err instanceof YouTubeApiError && err.action === "wait_quota";
}

/** error จาก gateway มีข้อความไทยติดมาแล้ว ส่วนอย่างอื่นต้องแปลงเอง */
function describeError(err: unknown): string {
  if (err instanceof YouTubeApiError) return err.th;
  return err instanceof Error ? err.message : String(err);
}
