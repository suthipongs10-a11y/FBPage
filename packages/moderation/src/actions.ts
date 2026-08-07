/**
 * ลงมือทำจริงกับคอมเมนต์ผ่าน Meta Gateway (M3)
 *
 * ทุก call ผ่าน gateway (กฎข้อ 1)
 */
import type { MetaGateway } from "@page-os/meta";

/** Private Reply ทำได้ครั้งเดียวต่อคอมเมนต์ และภายใน 7 วัน (สเปกข้อ M3) */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 86_400_000;

export class CommentActions {
  constructor(private readonly gateway: MetaGateway) {}

  /** ซ่อนคอมเมนต์ — ผู้เขียนยังเห็นของตัวเอง คนอื่นไม่เห็น */
  async hide(pageId: string, commentId: string): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "POST",
      path: commentId,
      priority: "high",
      params: { is_hidden: true },
    });
  }

  async unhide(pageId: string, commentId: string): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "POST",
      path: commentId,
      priority: "normal",
      params: { is_hidden: false },
    });
  }

  /** ลบถาวร — กู้คืนไม่ได้ */
  async remove(pageId: string, commentId: string): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "DELETE",
      path: commentId,
      priority: "high",
      // ลบซ้ำได้ผลเดิม แต่ยิงซ้ำไปก็เปลืองโควตา
      noRetry: true,
    });
  }

  /** ตอบใต้คอมเมนต์ (คนอื่นเห็น) */
  async reply(
    pageId: string,
    commentId: string,
    message: string,
  ): Promise<string> {
    const res = await this.gateway.call<{ id?: string }>({
      pageId,
      method: "POST",
      path: `${commentId}/comments`,
      priority: "high",
      params: { message },
      // ยิงซ้ำ = ตอบซ้ำใต้คอมเมนต์เดียวกัน
      noRetry: true,
    });
    return res.data?.id ?? "";
  }

  /**
   * ทักเข้า inbox จากคอมเมนต์ (Comment → Inbox)
   *
   * ข้อจำกัดของ Meta: ทำได้ **ครั้งเดียวต่อคอมเมนต์** และภายใน **7 วัน**
   * ตัวกัน duplicate อยู่ที่ CommentProcessor ไม่ใช่ที่นี่ เพราะต้องเช็คก่อนยิง
   */
  async privateReply(
    pageId: string,
    commentId: string,
    message: string,
  ): Promise<string> {
    const res = await this.gateway.call<{ id?: string }>({
      pageId,
      method: "POST",
      path: `${commentId}/private_replies`,
      priority: "realtime",
      params: { message },
      noRetry: true,
    });
    return res.data?.id ?? "";
  }

  /** กดไลก์คอมเมนต์ (เพิ่ม engagement ฟรี) */
  async like(pageId: string, commentId: string): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "POST",
      path: `${commentId}/likes`,
      priority: "low",
    });
  }

  /** ปิดคอมเมนต์ของผู้ใช้คนนี้ทั้งเพจ (blocklist) */
  async blockUser(pageId: string, userId: string): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "POST",
      path: `${pageId}/blocked`,
      priority: "normal",
      params: { user: userId },
    });
  }

  async unblockUser(pageId: string, userId: string): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "DELETE",
      path: `${pageId}/blocked`,
      priority: "normal",
      params: { user: userId },
    });
  }
}
