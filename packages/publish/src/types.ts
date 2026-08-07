/** ชนิดข้อมูลของงานเผยแพร่ (M4) */

/** ประเภทโพสต์ที่สเปกข้อ M4 ระบุไว้ */
export type PostType =
  | "text"
  | "link"
  | "photo"
  | "album"
  | "video"
  | "reel"
  | "story";

export interface MediaItem {
  /** URL สาธารณะ (Cloudflare R2) — Meta ต้องเข้าถึงได้เอง */
  url: string;
  caption?: string;
}

export interface PostContent {
  type: PostType;
  /** ข้อความ/แคปชั่น */
  body: string;
  /** ใช้กับ type = "link" */
  link?: string;
  media?: MediaItem[];
}

/** ผลลัพธ์ของการเผยแพร่ 1 เป้าหมาย */
export interface PublishSuccess {
  fbPostId: string;
  publishedAtMs: number;
}

export type PublishStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

/**
 * 1 คอนเทนต์ยิงได้หลายเพจ (cross-posting)
 * แต่ละเพจมีสถานะของตัวเอง — เพจหนึ่งพังต้องไม่ทำให้เพจอื่นไม่ได้โพสต์
 */
export interface PostTarget {
  postId: string;
  pageId: string;
  /** ข้อความเฉพาะเพจนี้ (ถ้ามี) ทับ body หลัก */
  overrideBody?: string | null;
  fbPostId?: string | null;
  status: PublishStatus;
  attempts: number;
  lastError?: string | null;
}

export interface ScheduledPost {
  id: string;
  /** เพจต้นทางที่สร้างคอนเทนต์นี้ */
  pageId: string;
  content: PostContent;
  /** epoch ms (UTC) — กฎข้อ 4 */
  scheduledAtMs: number | null;
  status: PublishStatus;
  contentHash: string;
  approvalStatus: "none" | "pending" | "approved" | "changes_requested";
  /** ผู้ใช้ติ๊กว่า "อนุญาตให้ซ้ำ" */
  allowDuplicate?: boolean;
}

/** สิ่งที่ worker ได้รับมาทำ */
export interface PublishJob {
  postId: string;
  pageId: string;
  /** ครั้งที่เท่าไหร่ (เริ่มที่ 1) */
  attempt: number;
}

export type PublishOutcome =
  | { kind: "published"; fbPostId: string; th: string }
  | { kind: "retry"; delayMs: number; nextAttempt: number; th: string }
  | { kind: "failed"; th: string; needsAlert: boolean }
  | { kind: "skipped"; reason: SkipReason; th: string };

export type SkipReason =
  | "already_published"
  | "duplicate"
  | "cancelled"
  | "not_approved"
  | "no_target";
