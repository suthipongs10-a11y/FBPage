/**
 * ต่อหน้า Ops Center เข้ากับ `@page-os/ops` ของจริง
 *
 * เหมือน `demo-portal.ts` คือของปลอมมีแค่ที่เก็บข้อมูล ส่วนตรรกะทั้งหมด
 * — ตัวตรวจปัญหา, การวางแผน bulk, การบันทึก audit — วิ่งผ่านโค้ดตัวจริง
 */
import {
  AuditLog,
  InMemoryAuditStore,
  applyBulkChange,
  buildDigest,
  planBulkChange,
  type Actor,
  type AuditEntry,
  type BulkApplier,
  type BulkPlan,
  type BulkResult,
  type BulkTarget,
  type Digest,
} from "@page-os/ops";
import { buildDemoWorkspace } from "@/lib/demo-workspace";
import { buildTodayView } from "@/lib/today";

export const OPERATOR: Actor = { kind: "human", id: "tanakon@example.com" };

/** ค่าการตั้งค่าต่อเพจ — ในของจริงอยู่ในตาราง pages */
const settings = new Map<string, Record<string, unknown>>();

/** ค่าเริ่มต้นที่ต่างกันจริง เพื่อให้เห็นว่าตัววางแผนข้ามเพจที่ค่าตรงอยู่แล้ว */
function defaultsFor(pageId: string, plan: string): Record<string, unknown> {
  return {
    slaMinutes: plan === "FULL" ? 30 : plan === "GROWTH" ? 60 : 240,
    botEnabled: pageId.endsWith("2") || pageId.endsWith("4"),
    autoHideProfanity: true,
  };
}

const store = new InMemoryAuditStore();
const auditLog = new AuditLog({ store });
let seeded = false;

/**
 * ใส่ประวัติตัวอย่างให้หน้าจอมีอะไรให้ดู
 *
 * เขียนผ่าน `store.append()` ตรงๆ ไม่ผ่าน `AuditLog.record()` เพราะต้องการ
 * เวลาย้อนหลัง ส่วน `record()` ประทับเวลาจากนาฬิกาเสมอโดยเจตนา —
 * ถ้าเปิดให้ผู้เรียกกำหนดเวลาเองได้ log ก็ใช้เป็นหลักฐานไม่ได้อีกต่อไป
 *
 * **โค้ดจริงห้ามทำแบบนี้** ที่นี่ทำได้เพราะเป็นที่เก็บของข้อมูลตัวอย่างเท่านั้น
 */
async function seed(nowMs: number): Promise<void> {
  if (seeded) return;
  seeded = true;
  const HOUR = 3_600_000;
  const rows: Array<{
    agoMs: number;
    actor: Actor;
    action: string;
    th: string;
    pageId?: string;
  }> = [
    { agoMs: 0.4 * HOUR, actor: OPERATOR, action: "post.publish", th: "โพสต์ขึ้นเพจแล้ว", pageId: "1013" },
    {
      agoMs: 2 * HOUR,
      actor: { kind: "client", id: "owner@kruakhunyai.example" },
      action: "portal.approve",
      th: "ลูกค้าอนุมัติโพสต์จากหน้า portal",
      pageId: "1013",
    },
    {
      agoMs: 5 * HOUR,
      actor: { kind: "system", id: "worker:token-health" },
      action: "token.check",
      th: "ตรวจสุขภาพ token ครบทุกเพจ พบใกล้หมดอายุ 1 เพจ",
    },
    {
      agoMs: 7 * HOUR,
      actor: { kind: "bot", id: "bot:1058" },
      action: "bot.handover",
      th: "บอทส่งต่อให้คนเพราะตอบไม่ได้ 2 ครั้งติด",
      pageId: "1058",
    },
    {
      agoMs: 11 * HOUR,
      actor: { kind: "client", id: "boss@pladang.example" },
      action: "portal.request_changes",
      th: "ลูกค้าขอแก้ไข: ขอเปลี่ยนรูปเป็นเมนูใหม่",
      pageId: "1044",
    },
    {
      agoMs: 26 * HOUR,
      actor: OPERATOR,
      action: "settings.bulk_update",
      th: "แก้ค่าแบบหลายเพจ: slaMinutes: 240 → 60",
      pageId: "1071",
    },
  ];

  let n = 0;
  for (const r of rows) {
    await store.append({
      id: `seed-${++n}`,
      atMs: nowMs - r.agoMs,
      actor: r.actor,
      action: r.action,
      th: r.th,
      ...(r.pageId !== undefined ? { pageId: r.pageId } : {}),
    });
  }
}

export async function recentAudit(nowMs: number): Promise<AuditEntry[]> {
  await seed(nowMs);
  return auditLog.query({ limit: 20 });
}

export function bulkTargets(nowMs: number): BulkTarget[] {
  const ws = buildDemoWorkspace(nowMs);
  return ws.pages.map((p) => {
    const current =
      settings.get(p.pageId) ?? defaultsFor(p.pageId, p.plan);
    settings.set(p.pageId, current);
    return {
      pageId: p.pageId,
      pageName: p.pageName,
      clientName: p.clientName,
      connectionState: p.connection.state,
      settings: current,
    };
  });
}

/** วางแผนอย่างเดียว ไม่แตะอะไร — หน้าจอเรียกตัวนี้เพื่อแสดงตัวอย่าง */
export function previewBulk(
  nowMs: number,
  pageIds: readonly string[],
  patch: Record<string, unknown>,
): BulkPlan {
  const all = bulkTargets(nowMs);
  const targets = all.filter((t) => pageIds.includes(t.pageId));
  return planBulkChange({ targets, patch });
}

const applier: BulkApplier = {
  async apply(pageId, patch) {
    const current = settings.get(pageId);
    if (!current) throw new Error("ไม่พบเพจนี้");
    settings.set(pageId, { ...current, ...patch });
  },
};

export async function runBulk(
  nowMs: number,
  pageIds: readonly string[],
  patch: Record<string, unknown>,
  confirmed: boolean,
): Promise<BulkResult> {
  await seed(nowMs);
  const plan = previewBulk(nowMs, pageIds, patch);
  return applyBulkChange({
    plan,
    applier,
    audit: auditLog,
    actor: OPERATOR,
    confirmed,
  });
}

/** สรุปงานเช้า สร้างจากข้อมูลจริงของ workspace */
export function morningDigest(nowMs: number): Digest {
  const ws = buildDemoWorkspace(nowMs);
  const today = buildTodayView(ws);
  return buildDigest({
    nowMs,
    problems: today.problems,
    waitingConversations: today.inbox.summary.total,
    breachedConversations: today.inbox.summary.breached,
    pendingApprovals: today.approvals.length,
    lateApprovals: today.approvals.filter((a) => a.remainingMs < 0).length,
    postsToday: today.goingOut.length,
    pageCount: ws.pages.length,
  });
}
