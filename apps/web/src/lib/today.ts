/**
 * Today View — หน้าเดียวที่ตอบว่า "วันนี้ต้องทำอะไร" (สเปกข้อ M8)
 *
 * สเปกบอกไว้ว่า "ผู้ใช้จริงมีคนเดียว = คุณ → UI ต้องออกแบบเป็น control tower
 * ไม่ใช่ dashboard สวยๆ ต่อเพจ" ไฟล์นี้คือหัวใจของข้อนั้น
 *
 * ตรรกะทั้งหมดอยู่ที่นี่ ไม่ใช่ใน component เพราะการเรียงลำดับว่า
 * "อะไรด่วนกว่าอะไร" คือสิ่งที่ผิดแล้วเสียลูกค้า — ต้องเทสต์ได้
 */
import {
  prioritizeQueue,
  summarizeQueue,
  PLAN_SLA_MINUTES,
  type QueuedConversation,
  type SlaSummary,
} from "@page-os/inbox";
import { STATE_LABEL_TH } from "@page-os/db";
import { needsAlert } from "@page-os/meta";
import type { ClientPage, ConversationRow, ScheduledPostRow, Workspace } from "./workspace.js";

/** webhook เงียบเกินนี้ถือว่าผิดปกติ (สเปกข้อ M8 Alert Center) */
export const WEBHOOK_SILENT_MS = 30 * 60_000;

export type Severity = "critical" | "warning" | "info";

export interface Problem {
  id: string;
  severity: Severity;
  pageId: string;
  pageName: string;
  clientName: string;
  colorIndex: number;
  /** อะไรพัง — ภาษาไทย บอกด้วยว่าต้องทำอะไรต่อ */
  th: string;
  /** หมวดไว้จัดกลุ่มและทำสถิติ */
  kind: "token" | "webhook" | "publish" | "rate_limit" | "moderation";
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export interface InboxTask extends QueuedConversation {
  contactName: string;
  preview: string;
  pageName: string;
  clientName: string;
  colorIndex: number;
}

export interface ApprovalTask {
  postId: string;
  pageId: string;
  pageName: string;
  clientName: string;
  colorIndex: number;
  scheduledAtMs: number;
  preview: string;
  pillarLabelTh: string;
  /** เหลือเวลาอีกกี่ ms ก่อนถึงคิวโพสต์ ติดลบ = เลยเวลาแล้วแต่ยังไม่อนุมัติ */
  remainingMs: number;
  /** ด่วนไหม — ใกล้ถึงเวลาโพสต์แล้วแต่ลูกค้ายังไม่กด */
  urgent: boolean;
  th: string;
}

/** ใกล้ถึงเวลาโพสต์ขนาดนี้แล้วยังไม่อนุมัติ = ต้องตามลูกค้าแล้ว */
export const APPROVAL_URGENT_MS = 12 * 3_600_000;

export interface TodayView {
  nowMs: number;
  inbox: {
    tasks: InboxTask[];
    summary: SlaSummary;
  };
  approvals: ApprovalTask[];
  problems: Problem[];
  /** โพสต์ที่จะขึ้นภายใน 24 ชม. ข้างหน้า (อนุมัติแล้ว) */
  goingOut: ScheduledPostRow[];
  /** ประโยคเดียวที่บอกว่าวันนี้หนักแค่ไหน — ขึ้นบนสุดของหน้า */
  headlineTh: string;
  /** จำนวนงานที่ต้องแตะจริงๆ วันนี้ */
  actionCount: number;
}

function pageInfo(page: ClientPage | undefined, pageId: string) {
  return {
    pageId,
    pageName: page?.pageName ?? pageId,
    clientName: page?.clientName ?? "ไม่ทราบลูกค้า",
    colorIndex: page?.colorIndex ?? 0,
  };
}

/**
 * รวบรวมทุกอย่างที่พังอยู่ตอนนี้
 *
 * จงใจไม่แยกเป็นหลายลิสต์ — คนใช้ไม่ได้อยากรู้ว่าปัญหาเป็นหมวดไหน
 * อยากรู้ว่า "ต้องแก้อะไรก่อน" ทุกอย่างจึงมากองรวมกันแล้วเรียงตามความแรง
 */
export function collectProblems(ws: Workspace): Problem[] {
  const problems: Problem[] = [];

  for (const page of ws.pages) {
    // 1. token — ถ้าเชื่อมไม่ได้ ฟีเจอร์อื่นของเพจนี้ไม่ทำงานเลย
    if (needsAlert(page.connection.state)) {
      const critical =
        page.connection.state === "expired" ||
        page.connection.state === "revoked";
      problems.push({
        id: `token:${page.pageId}`,
        severity: critical ? "critical" : "warning",
        ...pageInfo(page, page.pageId),
        kind: "token",
        th: critical
          ? `${STATE_LABEL_TH[page.connection.state]} — เพจนี้หยุดทำงานทั้งหมด ต้องให้ลูกค้ากดเชื่อมใหม่`
          : `${STATE_LABEL_TH[page.connection.state]}${
              page.connection.hoursUntilExpiry !== undefined
                ? ` (เหลือ ${Math.max(0, Math.floor(page.connection.hoursUntilExpiry / 24))} วัน)`
                : ""
            } — ต่ออายุก่อนหมด ไม่งั้นโพสต์ที่ตั้งไว้จะไม่ขึ้น`,
      });
    }

    // 2. webhook เงียบ — อาการนี้เงียบมาก คนไม่รู้จนลูกค้าโวย
    //
    // ข้ามถ้า token ใช้ไม่ได้แล้ว: เพจที่ token หมดอายุย่อมไม่มี webhook เข้า
    // นั่นคือ "ผลของปัญหาเดิม" ไม่ใช่ปัญหาใหม่ ขึ้นสองบรรทัดให้เรื่องเดียวกัน
    // ทำให้รายการดูแย่กว่าความจริง แล้วคนจะเริ่มไม่เชื่อตัวเลขในหน้านี้
    const tokenDead =
      page.connection.state === "expired" ||
      page.connection.state === "revoked" ||
      page.connection.state === "no_token";

    const silentFor =
      page.lastWebhookAtMs === null ? null : ws.nowMs - page.lastWebhookAtMs;
    if (tokenDead) {
      continue;
    }
    if (page.lastWebhookAtMs === null) {
      problems.push({
        id: `webhook:${page.pageId}`,
        severity: "warning",
        ...pageInfo(page, page.pageId),
        kind: "webhook",
        th: "ยังไม่เคยได้รับ webhook จากเพจนี้เลย — ตรวจว่า subscribe ครบหรือยัง",
      });
    } else if (silentFor !== null && silentFor > WEBHOOK_SILENT_MS) {
      problems.push({
        id: `webhook:${page.pageId}`,
        severity: silentFor > 4 * 3_600_000 ? "critical" : "warning",
        ...pageInfo(page, page.pageId),
        kind: "webhook",
        th: `ไม่ได้รับ webhook มา ${Math.floor(silentFor / 60_000)} นาที — ข้อความลูกค้าอาจตกหล่นอยู่ตอนนี้`,
      });
    }
  }

  // 3. โพสต์ที่ล้มเหลว — ลูกค้าจ่ายเงินเพื่อให้โพสต์ขึ้น
  //
  // รวมเป็นบรรทัดเดียวต่อเพจ ไม่ใช่บรรทัดต่อโพสต์: เวลา token เพจหนึ่งหมด
  // โพสต์ของเพจนั้นล้มพร้อมกันหมด ถ้าแตกเป็นบรรทัดละโพสต์ รายการจะยาว
  // จนกลบเรื่องอื่นที่คนละสาเหตุ ทั้งที่ทั้งหมดแก้ด้วยการกดครั้งเดียว
  const failedByPage = new Map<string, ScheduledPostRow[]>();
  for (const post of ws.scheduled) {
    if (post.failedAttempts <= 0) continue;
    const list = failedByPage.get(post.pageId) ?? [];
    list.push(post);
    failedByPage.set(post.pageId, list);
  }

  for (const [pageId, posts] of failedByPage) {
    const page = ws.pages.find((p) => p.pageId === pageId);
    const dead = posts.filter((p) => p.failedAttempts >= 3);
    // เหตุผลที่พบบ่อยที่สุดของเพจนี้ — บอกอันเดียวพอ ไม่ต้องไล่ทุกอัน
    const reason =
      (dead[0] ?? posts[0])?.lastErrorTh ?? "ไม่ทราบสาเหตุ";
    const noun = posts.length === 1 ? "โพสต์" : `${posts.length} โพสต์`;

    problems.push({
      id: `publish:${pageId}`,
      severity: dead.length > 0 ? "critical" : "warning",
      ...pageInfo(page, pageId),
      kind: "publish",
      th:
        dead.length > 0
          ? `${noun}ล้มเหลวครบ 3 ครั้ง หยุด retry แล้ว — ${reason}`
          : `${noun}ล้มเหลว กำลัง retry อยู่ — ${reason}`,
    });
  }

  // 4. เหตุการณ์อื่นที่ระบบบันทึกไว้ (rate limit, คอมเมนต์ถูกลบ ฯลฯ)
  for (const inc of ws.incidents) {
    const page = ws.pages.find((p) => p.pageId === inc.pageId);
    problems.push({
      id: inc.id,
      severity: inc.kind === "rate_limit" ? "warning" : "info",
      ...pageInfo(page, inc.pageId),
      kind: inc.kind === "rate_limit" ? "rate_limit" : "moderation",
      th: inc.th,
    });
  }

  return problems.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.clientName.localeCompare(b.clientName, "th"),
  );
}

/**
 * คิวข้อความที่ต้องตอบ เรียงตามเวลาที่เหลือ ไม่ใช่ตามลำดับที่เข้ามา
 *
 * `prioritizeQueue` ของ M-E เป็นคนตัดสินลำดับ ที่นี่แค่เติมข้อมูล
 * ที่ UI ต้องใช้ (ชื่อคน ชื่อเพจ สีลูกค้า) กลับเข้าไป
 */
export function buildInboxTasks(ws: Workspace): InboxTask[] {
  const byId = new Map<string, ConversationRow>(
    ws.conversations.map((c) => [c.conversationId, c]),
  );

  const queue = prioritizeQueue(
    ws.conversations
      // บทสนทนาที่บอทดูแลอยู่ไม่ต้องขึ้นคิวคน — ขึ้นมาก็แค่รบกวนสายตา
      .filter((c) => !c.handledByBot)
      .map((c) => {
        const page = ws.pages.find((p) => p.pageId === c.pageId);
        return {
          conversationId: c.conversationId,
          pageId: c.pageId,
          awaitingSinceMs: c.awaitingSinceMs,
          slaMinutes: PLAN_SLA_MINUTES[page?.plan ?? "STARTER"] ?? 240,
          unread: c.unread,
        };
      }),
    ws.nowMs,
  );

  return queue.map((q) => {
    const row = byId.get(q.conversationId);
    const page = ws.pages.find((p) => p.pageId === q.pageId);
    return {
      ...q,
      contactName: row?.contactName ?? "ไม่ทราบชื่อ",
      preview: row?.preview ?? "",
      pageName: page?.pageName ?? q.pageId,
      clientName: page?.clientName ?? "",
      colorIndex: page?.colorIndex ?? 0,
    };
  });
}

/**
 * โพสต์ที่รอลูกค้าอนุมัติ เรียงตาม "ใกล้ถึงเวลาโพสต์ที่สุดก่อน"
 *
 * อันที่เลยเวลาไปแล้วขึ้นก่อนสุด เพราะนั่นคือโพสต์ที่ลูกค้าคิดว่าขึ้นไปแล้ว
 * แต่จริงๆ ยังค้างอยู่ — เป็นเคสที่ทำให้ลูกค้าโกรธที่สุด
 */
export function buildApprovalTasks(ws: Workspace): ApprovalTask[] {
  return ws.scheduled
    .filter((s) => s.approval === "pending")
    .map((s) => {
      const page = ws.pages.find((p) => p.pageId === s.pageId);
      const remainingMs = s.scheduledAtMs - ws.nowMs;
      const late = remainingMs < 0;
      return {
        postId: s.postId,
        ...pageInfo(page, s.pageId),
        scheduledAtMs: s.scheduledAtMs,
        preview: s.preview,
        pillarLabelTh: s.pillarLabelTh,
        remainingMs,
        urgent: remainingMs < APPROVAL_URGENT_MS,
        th: late
          ? "เลยเวลาที่ตั้งไว้แล้วแต่ยังไม่ได้อนุมัติ — โพสต์นี้ยังไม่ขึ้น"
          : `เหลืออีก ${describeGap(remainingMs)} ก่อนถึงคิวโพสต์`,
      };
    })
    .sort((a, b) => a.remainingMs - b.remainingMs);
}

/** ระยะเวลาแบบอ่านง่าย ใช้กับช่วงที่เป็นบวกเท่านั้น */
export function describeGap(ms: number): string {
  const mins = Math.floor(Math.abs(ms) / 60_000);
  if (mins < 60) return `${mins} นาที`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชม.`;
  return `${Math.floor(hours / 24)} วัน`;
}

export function buildTodayView(ws: Workspace): TodayView {
  const tasks = buildInboxTasks(ws);
  const summary = summarizeQueue(tasks);
  const approvals = buildApprovalTasks(ws);
  const problems = collectProblems(ws);

  const dayAhead = ws.nowMs + 86_400_000;
  const goingOut = ws.scheduled
    .filter(
      (s) =>
        s.scheduledAtMs >= ws.nowMs &&
        s.scheduledAtMs <= dayAhead &&
        s.approval !== "pending" &&
        s.approval !== "changes_requested",
    )
    .sort((a, b) => a.scheduledAtMs - b.scheduledAtMs);

  const critical = problems.filter((p) => p.severity === "critical").length;
  const actionCount = summary.total + approvals.length + problems.length;

  return {
    nowMs: ws.nowMs,
    inbox: { tasks, summary },
    approvals,
    problems,
    goingOut,
    actionCount,
    headlineTh: headline({
      critical,
      breached: summary.breached,
      waiting: summary.total,
      approvals: approvals.length,
      goingOut: goingOut.length,
    }),
  };
}

/**
 * ประโยคเดียวบนสุดของหน้า
 *
 * เรียงตามลำดับที่คนควรสนใจ ไม่ใช่ตามลำดับที่โค้ดคำนวณ:
 * ของพัง → เลย SLA → รอตอบ → รออนุมัติ → ไม่มีอะไร
 * เพราะถ้าขึ้นทุกอย่างพร้อมกัน คนจะไม่รู้ว่าต้องเริ่มตรงไหน
 */
function headline(n: {
  critical: number;
  breached: number;
  waiting: number;
  approvals: number;
  goingOut: number;
}): string {
  if (n.critical > 0) {
    return `มี ${n.critical} เรื่องที่พังอยู่ตอนนี้ — แก้ก่อนอย่างอื่น`;
  }
  if (n.breached > 0) {
    return `เลยเวลาที่สัญญากับลูกค้าไว้ ${n.breached} บทสนทนา — ตอบเดี๋ยวนี้`;
  }
  if (n.waiting > 0) {
    return `มี ${n.waiting} บทสนทนารอตอบ ยังอยู่ในเวลาทั้งหมด`;
  }
  if (n.approvals > 0) {
    return `ตอบครบแล้ว เหลือ ${n.approvals} โพสต์ที่รอลูกค้าอนุมัติ`;
  }
  if (n.goingOut > 0) {
    return `ไม่มีอะไรค้าง วันนี้มี ${n.goingOut} โพสต์ที่จะขึ้นเอง`;
  }
  return "ไม่มีอะไรค้าง ทุกเพจเรียบร้อย";
}
