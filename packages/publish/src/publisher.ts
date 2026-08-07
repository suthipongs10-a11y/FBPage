/**
 * ตัวยิงโพสต์ขึ้นเพจจริง (M4)
 *
 * ทุก call ผ่าน MetaGateway (กฎข้อ 1) — ไฟล์นี้รู้แค่ว่าจะเรียก endpoint ไหน
 * ไม่รู้เรื่อง token, rate limit, retry ระดับ HTTP เลย
 *
 * หมายเหตุสำคัญ: **ไม่ใช้** `scheduled_publish_time` ของ Meta ตามสเปกข้อ M4
 * เพราะเราต้องแก้/ยกเลิก/ดู log ได้เอง — เวลาถึงกำหนดค่อยยิงโพสต์ทันที
 */
import type { MetaGateway } from "@page-os/meta";
import { MetaApiError } from "@page-os/meta";
import type { MediaItem, PostContent } from "./types.js";

/** ผลจาก Graph ตอนสร้างโพสต์ */
interface CreatedPost {
  id?: string;
  post_id?: string;
}

export class PublishError extends Error {
  override readonly name = "PublishError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

function requireMedia(content: PostContent, atLeast = 1): MediaItem[] {
  const media = content.media ?? [];
  if (media.length < atLeast) {
    throw new PublishError(
      `${content.type} requires at least ${atLeast} media`,
      `โพสต์ประเภท "${content.type}" ต้องมีสื่ออย่างน้อย ${atLeast} ไฟล์`,
    );
  }
  return media;
}

export class PostPublisher {
  constructor(private readonly gateway: MetaGateway) {}

  /**
   * ยิงโพสต์ขึ้นเพจ คืน fb post id
   *
   * ตั้งใจให้ retry ไม่ได้ในระดับ HTTP (noRetry) — การยิงซ้ำโพสต์คือการโพสต์ซ้ำ
   * ให้ชั้นบน (PublishWorker) เป็นคนตัดสินใจลองใหม่ พร้อมเช็คก่อนว่าโพสต์ขึ้นไปแล้วหรือยัง
   */
  async publish(args: {
    pageId: string;
    content: PostContent;
    body: string;
  }): Promise<string> {
    switch (args.content.type) {
      case "text":
        return this.publishFeed(args.pageId, { message: args.body });

      case "link": {
        if (!args.content.link) {
          throw new PublishError(
            "link post requires link",
            'โพสต์ประเภท "ลิงก์" ต้องระบุ URL',
          );
        }
        return this.publishFeed(args.pageId, {
          message: args.body,
          link: args.content.link,
        });
      }

      case "photo": {
        const media = requireMedia(args.content);
        return this.publishPhoto(args.pageId, media[0]!, args.body);
      }

      case "album":
        return this.publishAlbum(args.pageId, requireMedia(args.content, 2), args.body);

      case "video":
        return this.publishVideo(args.pageId, requireMedia(args.content)[0]!, args.body);

      case "reel":
        return this.publishReel(args.pageId, requireMedia(args.content)[0]!, args.body);

      case "story":
        return this.publishStory(args.pageId, requireMedia(args.content)[0]!);

      default: {
        const t: never = args.content.type;
        throw new PublishError(
          `unsupported post type ${String(t)}`,
          `ยังไม่รองรับโพสต์ประเภท "${String(t)}"`,
        );
      }
    }
  }

  private idOf(data: CreatedPost, what: string): string {
    const id = data.post_id ?? data.id;
    if (!id) {
      throw new PublishError(
        `${what}: no id returned`,
        `${what} สำเร็จแต่ Facebook ไม่ส่ง id กลับมา — ต้องเช็คในเพจว่าขึ้นจริงไหมก่อนลองใหม่`,
      );
    }
    return id;
  }

  private async publishFeed(
    pageId: string,
    params: Record<string, string>,
  ): Promise<string> {
    const res = await this.gateway.call<CreatedPost>({
      pageId,
      method: "POST",
      path: `${pageId}/feed`,
      priority: "high",
      params,
      noRetry: true,
    });
    return this.idOf(res.data, "โพสต์ข้อความ");
  }

  private async publishPhoto(
    pageId: string,
    item: MediaItem,
    body: string,
  ): Promise<string> {
    const res = await this.gateway.call<CreatedPost>({
      pageId,
      method: "POST",
      path: `${pageId}/photos`,
      priority: "high",
      params: { url: item.url, caption: body, published: true },
      noRetry: true,
    });
    return this.idOf(res.data, "โพสต์รูป");
  }

  /**
   * อัลบั้ม: อัปรูปทีละใบแบบ unpublished → เอา id ทั้งหมดไปแนบกับโพสต์เดียว
   * ถ้าอัปกลางคันแล้วพัง รูปที่อัปไปแล้วจะค้างเป็น unpublished (ไม่โผล่ในเพจ)
   */
  private async publishAlbum(
    pageId: string,
    media: MediaItem[],
    body: string,
  ): Promise<string> {
    const photoIds: string[] = [];
    for (const item of media) {
      const res = await this.gateway.call<{ id?: string }>({
        pageId,
        method: "POST",
        path: `${pageId}/photos`,
        priority: "high",
        params: { url: item.url, published: false },
        noRetry: true,
      });
      const id = res.data?.id;
      if (!id) {
        throw new PublishError(
          "album: photo upload returned no id",
          "อัปรูปสำหรับอัลบั้มไม่สำเร็จ — เช็คว่า URL รูปเปิดสาธารณะจริง",
        );
      }
      photoIds.push(id);
    }

    const attached = photoIds.map((id) => ({ media_fbid: id }));
    const res = await this.gateway.call<CreatedPost>({
      pageId,
      method: "POST",
      path: `${pageId}/feed`,
      priority: "high",
      params: { message: body, attached_media: attached },
      noRetry: true,
    });
    return this.idOf(res.data, "โพสต์อัลบั้ม");
  }

  private async publishVideo(
    pageId: string,
    item: MediaItem,
    body: string,
  ): Promise<string> {
    const res = await this.gateway.call<CreatedPost>({
      pageId,
      method: "POST",
      path: `${pageId}/videos`,
      priority: "high",
      params: { file_url: item.url, description: body },
      noRetry: true,
    });
    return this.idOf(res.data, "โพสต์วิดีโอ");
  }

  /**
   * Reels ต้องทำ 3 เฟส: start → upload → finish
   * เฟส upload ยิงไปที่ rupload.facebook.com (คนละโฮสต์กับ Graph)
   * แต่ยังผ่าน gateway เพื่อให้ token/log/rate limit อยู่ที่เดียว
   */
  private async publishReel(
    pageId: string,
    item: MediaItem,
    body: string,
  ): Promise<string> {
    const start = await this.gateway.call<{
      video_id?: string;
      upload_url?: string;
    }>({
      pageId,
      method: "POST",
      path: `${pageId}/video_reels`,
      priority: "high",
      params: { upload_phase: "start" },
      noRetry: true,
    });

    const videoId = start.data?.video_id;
    if (!videoId) {
      throw new PublishError(
        "reel: start phase returned no video_id",
        "เริ่มอัป Reels ไม่สำเร็จ — Facebook ไม่ส่ง video_id กลับมา",
      );
    }

    // เฟสอัป: บอก URL ให้ Meta ไปดึงเอง ไม่ต้องสตรีมไบต์ผ่านเรา
    await this.gateway.call({
      pageId,
      method: "POST",
      path: videoId,
      host: "upload",
      priority: "high",
      headers: { file_url: item.url, offset: "0" },
      noRetry: true,
    });

    const finish = await this.gateway.call<CreatedPost>({
      pageId,
      method: "POST",
      path: `${pageId}/video_reels`,
      priority: "high",
      params: {
        video_id: videoId,
        upload_phase: "finish",
        video_state: "PUBLISHED",
        description: body,
      },
      noRetry: true,
    });

    // finish คืน success ไม่ได้คืน post id — ใช้ video_id เป็นตัวอ้างอิง
    return finish.data?.post_id ?? videoId;
  }

  private async publishStory(
    pageId: string,
    item: MediaItem,
  ): Promise<string> {
    // Story ของรูป: อัปรูปแบบ unpublished ก่อน แล้วค่อยสร้าง story จาก id นั้น
    const photo = await this.gateway.call<{ id?: string }>({
      pageId,
      method: "POST",
      path: `${pageId}/photos`,
      priority: "high",
      params: { url: item.url, published: false },
      noRetry: true,
    });
    const photoId = photo.data?.id;
    if (!photoId) {
      throw new PublishError(
        "story: photo upload returned no id",
        "อัปรูปสำหรับ Story ไม่สำเร็จ — เช็คว่า URL รูปเปิดสาธารณะจริง",
      );
    }

    const res = await this.gateway.call<CreatedPost>({
      pageId,
      method: "POST",
      path: `${pageId}/photo_stories`,
      priority: "high",
      params: { photo_id: photoId },
      noRetry: true,
    });
    return this.idOf(res.data, "โพสต์ Story");
  }

  /**
   * เช็คว่าโพสต์ขึ้นเพจไปแล้วจริงไหม — ใช้ก่อน retry
   *
   * กรณีที่ต้องมี: ยิงไปแล้ว Meta รับเรียบร้อยแต่เน็ตขาดตอนรับ response
   * ถ้า retry ตรงๆ จะได้โพสต์ซ้ำในเพจลูกค้า
   *
   * ต้องแยก "ไม่เจอ" กับ "เช็คไม่ได้" ออกจากกันให้ชัด — ถ้ายุบเป็น null เหมือนกัน
   * ชั้นบนจะเข้าใจว่ายังไม่ได้โพสต์แล้วยิงซ้ำ ทั้งที่ความจริงคือเราไม่รู้
   */
  async findRecentPostByMessage(args: {
    pageId: string;
    message: string;
    sinceMs: number;
  }): Promise<ExistingPostCheck> {
    const needle = args.message.trim();
    if (needle === "") {
      // ไม่มีข้อความให้เทียบ (โพสต์รูปล้วน) — เทียบด้วยวิธีนี้ไม่ได้
      return {
        status: "unknown",
        th: "โพสต์นี้ไม่มีข้อความให้เทียบ จึงยืนยันไม่ได้ว่าขึ้นเพจไปแล้วหรือยัง",
      };
    }
    try {
      const res = await this.gateway.call<{
        data?: Array<{ id?: string; message?: string; created_time?: string }>;
      }>({
        pageId: args.pageId,
        path: `${args.pageId}/feed`,
        priority: "high",
        params: {
          fields: "id,message,created_time",
          since: Math.floor(args.sinceMs / 1000),
          limit: 25,
        },
        // เช็คให้ไว ไม่ต้อง retry ยาว — ตอบ "ไม่รู้" แล้วให้ชั้นบนเลื่อนไปรอบหน้าดีกว่า
        noRetry: true,
      });
      for (const p of res.data?.data ?? []) {
        if (p.message?.trim() === needle && p.id) {
          return { status: "found", fbPostId: p.id };
        }
      }
      return { status: "not_found" };
    } catch (err) {
      if (err instanceof MetaApiError) {
        return {
          status: "unknown",
          th: `เช็คไม่ได้ว่าโพสต์ขึ้นเพจไปแล้วหรือยัง: ${err.th}`,
        };
      }
      throw err;
    }
  }
}

/**
 * ผลการเช็คว่าโพสต์ขึ้นเพจไปแล้วหรือยัง
 * "unknown" ต่างจาก "not_found" — unknown แปลว่าเรายังไม่รู้ ห้ามถือว่ายังไม่ได้โพสต์
 */
export type ExistingPostCheck =
  | { status: "found"; fbPostId: string }
  | { status: "not_found" }
  | { status: "unknown"; th: string };
