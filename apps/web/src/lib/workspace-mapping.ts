/**
 * แปลงแถวจากฐานข้อมูล → รูปร่างที่หน้าจอฝั่งปฏิบัติการใช้
 *
 * ─── ทำไมแยกออกมาจาก `server/workspace.ts` ───
 *
 * ไฟล์นั้นมี `import "server-only"` เพราะมันแตะ Prisma กับตัวแปรลับ
 * ส่วนตรงนี้เป็นฟังก์ชันบริสุทธิ์ล้วนๆ — รับแถวเข้ามา คืนรูปร่างที่ UI ใช้
 * ไม่มีความลับ ไม่ต่อเน็ต ไม่อ่านนาฬิกา จึงเทสต์ได้โดยไม่ต้องมี Postgres
 *
 * และมันคือชั้นที่ผิดแล้ว**ไม่มี error ให้เห็น** — หน้าจอยังเรนเดอร์ปกติ
 * แค่ตัวเลขผิด เช่นเพจที่ token หมดอายุขึ้นว่า "เชื่อมต่อปกติ" หรือบทสนทนา
 * ที่คนกำลังคุยอยู่หายจากคิวเพราะถูกนับว่าบอทดูแล — ยิ่งต้องมีเทสต์
 */
import type { ConnectionState } from "@page-os/meta";
import type { ApprovalStatus, PostType } from "@page-os/publish";
import type {
  StoredTokenStatus,
  WorkspacePageRow,
  WorkspaceSnapshot,
} from "@page-os/store";
/**
 * ⚠️ ใช้ alias `@/` ไม่ใช่ `./workspace.js`
 *
 * ไฟล์ข้างเคียง (`today.ts`) เขียน `import type ... from "./workspace.js"` ได้
 * เพราะเป็น **type ล้วน** TypeScript ลบทิ้งตอน compile ตัว bundler จึงไม่เคยเห็น
 * แต่บรรทัดนี้ดึง `CLIENT_COLOR_COUNT` ซึ่งเป็นค่าจริงตอนรัน นามสกุล `.js`
 * จะรอดไปถึง webpack ของ Next แล้วหาไฟล์ไม่เจอ (บนดิสก์ชื่อ `.ts`)
 * — พังตอนเปิดหน้าเว็บเท่านั้น `tsc` กับ vitest ผ่านฉลุย
 */
import {
  CLIENT_COLOR_COUNT,
  type ClientPage,
  type ConversationRow,
  type IncidentRow,
  type PlanKey,
  type ScheduledPostRow,
  type Workspace,
} from "@/lib/workspace";

export function emptyWorkspace(nowMs: number): Workspace {
  return { nowMs, pages: [], conversations: [], scheduled: [], incidents: [] };
}

/**
 * สถานะ token ในฐานข้อมูล → สถานะการเชื่อมต่อที่หน้าจอเข้าใจ
 *
 * เพจที่**ไม่มี token เลย**ต่างจากเพจที่ token มีปัญหา — อันแรกแปลว่า
 * "ยังไม่ได้เชื่อม" (ทำต่อได้เลย) อันหลังแปลว่า "เคยเชื่อมแล้วพัง" (ต้องแก้)
 * ถ้ายุบเป็นอันเดียวกัน คนจะไม่รู้ว่าต้องไปกดปุ่มไหน
 */
function toConnectionState(token: WorkspacePageRow["token"]): ConnectionState {
  if (token === null) return "no_token";
  const map: Record<StoredTokenStatus, ConnectionState> = {
    active: "ok",
    expiring_soon: "expiring_soon",
    expired: "expired",
    revoked: "revoked",
    missing_permissions: "missing_permissions",
    unknown: "unknown",
  };
  return map[token.status] ?? "unknown";
}

const PLANS: readonly PlanKey[] = ["STARTER", "GROWTH", "FULL"];

function toPlan(raw: string): PlanKey {
  const up = raw.toUpperCase();
  return (PLANS as readonly string[]).includes(up) ? (up as PlanKey) : "STARTER";
}

const POST_TYPES: readonly PostType[] = [
  "text",
  "link",
  "photo",
  "album",
  "video",
  "reel",
  "story",
];

function toPostType(raw: string): PostType {
  return (POST_TYPES as readonly string[]).includes(raw) ? (raw as PostType) : "text";
}

const APPROVALS: readonly ApprovalStatus[] = [
  "none",
  "pending",
  "approved",
  "changes_requested",
];

function toApproval(raw: string): ApprovalStatus {
  return (APPROVALS as readonly string[]).includes(raw)
    ? (raw as ApprovalStatus)
    : "none";
}

/**
 * ตารางเนื้อหายังไม่มีคอลัมน์ "เสาคอนเทนต์"
 *
 * `packages/studio` วางแผนเป็นเสา (ให้ความรู้ / ขาย / มีส่วนร่วม / เบื้องหลัง)
 * แต่ตอนบันทึกลง `posts` ข้อมูลนั้นหายไป — จะเติมคอลัมน์ให้ก็ยังไม่มีใครเขียน
 * ค่าลงไป การเดาจากชนิดโพสต์ (`photo` = ?) ก็ไม่ได้แปลว่าอะไรเลย
 *
 * จึงบอกตรงๆ ว่ายังไม่ได้บันทึก ดีกว่าเดาแล้วให้คนเอาไปดูสัดส่วนที่ผิด
 */
const NO_PILLAR_TH = "ยังไม่ได้ระบุเสา";

/** ข้อความยาวๆ ในการ์ดปฏิทินอ่านได้แค่บรรทัดเดียวอยู่ดี */
function preview(text: string | null, max = 120): string {
  const one = (text ?? "").replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/**
 * ประกอบ `Workspace` จากแถวที่อ่านมา
 *
 * แยกออกมาจาก `loadWorkspace()` เพื่อให้เทสต์ป้อนแถวเข้ามาตรงๆ ได้
 * โดยไม่ต้องมี Postgres
 */
export function assembleWorkspace(
  snapshot: WorkspaceSnapshot,
  nowMs: number,
): Workspace {
  /**
   * เพจของลูกค้าเดียวกันได้สีเดียวกัน — นั่นคือประเด็นของ "สีแยกตามลูกค้า"
   * วนตามจำนวนสีที่มี ถ้าลูกค้าเยอะกว่าสี สีจะซ้ำ ซึ่งดีกว่าไม่มีสีเลย
   */
  const clients = [...new Set(snapshot.pages.map((p) => p.clientName))];
  const colorOf = (clientName: string): number =>
    clients.indexOf(clientName) % CLIENT_COLOR_COUNT;

  const pages: ClientPage[] = snapshot.pages.map((p) => {
    const state = toConnectionState(p.token);
    const expiresAtMs = p.token?.expiresAtMs ?? null;
    const hours =
      expiresAtMs === null ? undefined : Math.max(0, (expiresAtMs - nowMs) / 3_600_000);

    return {
      pageId: p.id,
      pageName: p.name,
      clientName: p.clientName,
      colorIndex: colorOf(p.clientName),
      plan: toPlan(p.plan),
      timeZone: p.timeZone,
      connection: {
        state,
        ...(hours !== undefined ? { hoursUntilExpiry: hours } : {}),
      },
      lastWebhookAtMs: p.lastWebhookAtMs,
      // ยังไม่เคย sync insights → นับเป็น 0 ตอนรวมยอด แต่ไม่ได้แปลว่าไม่มีคนตาม
      followers: p.followers ?? 0,
    };
  });

  const botEnabledOf = new Map(snapshot.pages.map((p) => [p.id, p.botEnabled]));

  const conversations: ConversationRow[] = snapshot.conversations.map((c) => ({
    conversationId: c.id,
    pageId: c.pageId,
    contactName: c.contactName ?? "ไม่ทราบชื่อ",
    preview: preview(c.preview, 80),
    awaitingSinceMs: c.awaitingSinceMs,
    unread: c.unread,
    /**
     * บอทดูแลอยู่ = เพจเปิดบอท **และ** ยังไม่ถูกสั่งหยุด
     *
     * `botPausedUntil` ถูกเซ็ตทุกครั้งที่คนพิมพ์เอง (ข้อ 6.3) — ระหว่างนั้น
     * บทสนทนาต้องกลับเข้าคิวคน ไม่งั้นคนที่เพิ่งคุยค้างไว้จะหายจากหน้าจอ
     */
    handledByBot:
      (botEnabledOf.get(c.pageId) ?? false) &&
      (c.botPausedUntilMs === null || c.botPausedUntilMs <= nowMs),
  }));

  const scheduled: ScheduledPostRow[] = snapshot.scheduled.map((s) => ({
    postId: s.id,
    pageId: s.pageId,
    scheduledAtMs: s.scheduledAtMs,
    type: toPostType(s.type),
    preview: preview(s.body),
    pillarLabelTh: NO_PILLAR_TH,
    approval: toApproval(s.approvalStatus),
    failedAttempts: s.status === "failed" ? Math.max(1, s.attempts) : 0,
    ...(s.lastErrorTh !== null ? { lastErrorTh: s.lastErrorTh } : {}),
  }));

  const incidents: IncidentRow[] = snapshot.incidents.map((i) => ({
    id: i.id,
    pageId: i.pageId,
    kind: i.kind,
    atMs: i.atMs,
    th: i.th,
  }));

  return { nowMs, pages, conversations, scheduled, incidents };
}
