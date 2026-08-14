/**
 * รูปร่างของ "ทั้งเวิร์กสเปซ" ที่หน้าจอต้องใช้
 *
 * ตั้งใจให้เป็นชนิดข้อมูลล้วนๆ ไม่มีตรรกะ — ตรรกะอยู่ที่ `today.ts`
 * และแพ็กเกจโดเมน ส่วนที่นี่คือสัญญาระหว่างชั้นข้อมูลกับชั้น UI
 *
 * หน้าจอฝั่งปฏิบัติการอ่านของจริงจาก `server/workspace.ts` แล้ว
 * ส่วน `demo-workspace.ts` เหลือไว้ป้อนแผงคำสั่งหมู่ใน `/ops` กับหน้า portal
 * ตัวอย่างเท่านั้น — สองส่วนนั้นเป็นเส้นทาง**เขียน** ต้องต่อพร้อมด่านยืนยันตัวตน
 */
import type { ConnectionState } from "@page-os/meta";
import type { ApprovalStatus, PostType } from "@page-os/publish";

export type PlanKey = "STARTER" | "GROWTH" | "FULL";

export const PLAN_LABEL_TH: Record<PlanKey, string> = {
  STARTER: "เริ่มต้น",
  GROWTH: "เติบโต",
  FULL: "ดูแลเต็มรูปแบบ",
};

/**
 * สีประจำลูกค้า (สเปกข้อ M4 "สีแยกตามลูกค้า")
 *
 * เก็บเป็น index ไม่ใช่ค่าสี เพราะโหมดสว่างกับมืดต้องใช้ค่าคนละชุด
 * ให้ CSS เป็นคนตัดสิน ไม่ใช่ข้อมูล
 */
export const CLIENT_COLOR_COUNT = 10;

export interface ClientPage {
  /** id ภายในระบบเรา (uuid) — ใช้เป็นคีย์และอ้างอิงข้ามตาราง */
  pageId: string;
  /**
   * รหัสเพจของ Facebook — ตัวที่คนเอาไปค้นหรือส่งให้ลูกค้าดูได้
   *
   * ต้องมีแยกจาก `pageId` เพราะสองอันนี้คนละค่ากัน (ดูคำเตือนเรื่อง
   * "pageId สองความหมาย" ที่หัว `token-repository.ts`) — เคยโชว์ uuid
   * ภายใต้ป้าย "รหัสเพจ" ซึ่งเอาไปใช้ทำอะไรไม่ได้เลย
   */
  fbPageId: string;
  /** ชื่อเพจตามที่แสดงบน Facebook */
  pageName: string;
  /** ชื่อลูกค้า (บริษัท/เจ้าของ) — เพจหลายเพจอาจเป็นลูกค้าเดียวกัน */
  clientName: string;
  colorIndex: number;
  plan: PlanKey;
  /** timezone ของเพจ — เวลาทุกอย่างใน DB เป็น UTC แล้วแปลงตอนแสดง (กฎข้อ 4) */
  timeZone: string;
  connection: {
    state: ConnectionState;
    hoursUntilExpiry?: number;
  };
  /** webhook เงียบมานานแค่ไหน — null = ไม่เคยได้รับเลย */
  lastWebhookAtMs: number | null;
  /** จำนวนคนติดตาม ใช้แสดงบริบท ไม่ใช่ตัวชี้วัด */
  followers: number;
}

export interface ConversationRow {
  conversationId: string;
  pageId: string;
  contactName: string;
  /** ข้อความล่าสุดที่ลูกค้าส่งมา ใช้แสดงในคิว */
  preview: string;
  /** ลูกค้าทักมาแล้วยังไม่ได้ตอบตั้งแต่เมื่อไหร่ — null = ตอบครบแล้ว */
  awaitingSinceMs: number | null;
  unread: number;
  /** บอทตอบเองอยู่ หรือรอคนตอบ */
  handledByBot: boolean;
}

export interface ScheduledPostRow {
  postId: string;
  pageId: string;
  /** เวลาที่จะโพสต์ (epoch ms, UTC) */
  scheduledAtMs: number;
  type: PostType;
  /** ข้อความย่อสำหรับแสดงในปฏิทิน */
  preview: string;
  pillarLabelTh: string;
  approval: ApprovalStatus;
  /** ล้มเหลวไปกี่ครั้งแล้ว */
  failedAttempts: number;
  /** เหตุผลที่ล้มครั้งล่าสุด (ภาษาไทย) */
  lastErrorTh?: string;
}

export interface IncidentRow {
  id: string;
  pageId: string;
  kind:
    | "publish_failed"
    | "webhook_silent"
    | "rate_limit"
    | "comment_deleted"
    | "token";
  /** เกิดเมื่อไหร่ */
  atMs: number;
  th: string;
}

/** ตัวเลขที่ใช้โชว์ผลรวมของทั้งเวิร์กสเปซ */
export interface WorkspaceTotals {
  pages: number;
  clients: number;
  followers: number;
  /** โพสต์ที่ตั้งเวลาไว้ในอีก 7 วัน */
  scheduledThisWeek: number;
}

export interface Workspace {
  /** เวลาที่ประกอบข้อมูลนี้ — ทุกอย่างในหน้าคำนวณจากค่านี้ค่าเดียว */
  nowMs: number;
  pages: ClientPage[];
  conversations: ConversationRow[];
  scheduled: ScheduledPostRow[];
  incidents: IncidentRow[];
}

export interface WorkspaceSource {
  load(nowMs: number): Promise<Workspace>;
}

export function pageById(ws: Workspace, pageId: string): ClientPage | undefined {
  return ws.pages.find((p) => p.pageId === pageId);
}

export function totalsOf(ws: Workspace): WorkspaceTotals {
  const weekEnd = ws.nowMs + 7 * 86_400_000;
  return {
    pages: ws.pages.length,
    clients: new Set(ws.pages.map((p) => p.clientName)).size,
    followers: ws.pages.reduce((s, p) => s + p.followers, 0),
    scheduledThisWeek: ws.scheduled.filter(
      (s) => s.scheduledAtMs >= ws.nowMs && s.scheduledAtMs <= weekEnd,
    ).length,
  };
}
