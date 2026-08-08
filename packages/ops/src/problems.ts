/**
 * รวบรวมทุกอย่างที่พังอยู่ตอนนี้ (M8)
 *
 * ย้ายมาจาก `apps/web` โดยเจตนา เพราะตอนนี้มีผู้ใช้สองราย:
 *   - หน้าจอ Today View ที่คนเปิดดู
 *   - Alert Center ที่ยิงเข้า LINE ตอนคนไม่ได้เปิดจอ
 *
 * ถ้าปล่อยให้สองทางคำนวณเอง วันหนึ่งจะได้คำตอบไม่ตรงกัน แล้วคนจะเชื่อ
 * ทางไหนไม่ถูก — ซึ่งแย่กว่าไม่มีการแจ้งเตือนเลย
 */
import { STATE_LABEL_TH } from "@page-os/db";
import { needsAlert, type ConnectionState } from "@page-os/meta";

/** webhook เงียบเกินนี้ถือว่าผิดปกติ (สเปกข้อ M8 Alert Center) */
export const WEBHOOK_SILENT_MS = 30 * 60_000;
/** เงียบนานกว่านี้ = ข้อความหายไปเยอะแล้ว ยกระดับเป็นเรื่องรุนแรง */
export const WEBHOOK_CRITICAL_MS = 4 * 3_600_000;

export type Severity = "critical" | "warning" | "info";

export type ProblemKind =
  | "token"
  | "webhook"
  | "publish"
  | "rate_limit"
  | "moderation";

export interface Problem {
  /** คีย์ที่คงที่ตลอดอายุของปัญหาเดียวกัน — Alert Center ใช้กันการเตือนซ้ำ */
  id: string;
  severity: Severity;
  kind: ProblemKind;
  pageId: string;
  pageName: string;
  clientName: string;
  colorIndex: number;
  /** อะไรพัง — ภาษาไทย บอกด้วยว่าต้องทำอะไรต่อ */
  th: string;
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export interface PageHealthSnapshot {
  pageId: string;
  pageName: string;
  clientName: string;
  colorIndex?: number;
  connectionState: ConnectionState;
  /** เหลือกี่ชั่วโมงก่อน token หมดอายุ */
  hoursUntilExpiry?: number;
  /** ได้รับ webhook ล่าสุดเมื่อไหร่ — null = ไม่เคยได้รับเลย */
  lastWebhookAtMs: number | null;
}

export interface FailedPostSnapshot {
  postId: string;
  pageId: string;
  failedAttempts: number;
  lastErrorTh?: string;
}

export interface IncidentSnapshot {
  id: string;
  pageId: string;
  kind: "rate_limit" | "comment_deleted" | "other";
  atMs: number;
  th: string;
}

export interface CollectProblemsArgs {
  pages: readonly PageHealthSnapshot[];
  failedPosts?: readonly FailedPostSnapshot[];
  incidents?: readonly IncidentSnapshot[];
  nowMs: number;
}

function info(page: PageHealthSnapshot): Pick<
  Problem,
  "pageId" | "pageName" | "clientName" | "colorIndex"
> {
  return {
    pageId: page.pageId,
    pageName: page.pageName,
    clientName: page.clientName,
    colorIndex: page.colorIndex ?? 0,
  };
}

/**
 * รวบรวมปัญหาทั้งหมดเป็นรายการเดียว เรียงตามความแรง
 *
 * จงใจไม่แยกเป็นหลายลิสต์ — คนใช้ไม่ได้อยากรู้ว่าปัญหาเป็นหมวดไหน
 * อยากรู้ว่า "ต้องแก้อะไรก่อน"
 */
export function collectProblems(args: CollectProblemsArgs): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map<string, PageHealthSnapshot>(
    args.pages.map((p) => [p.pageId, p]),
  );

  for (const page of args.pages) {
    // 1. token — ถ้าเชื่อมไม่ได้ ฟีเจอร์อื่นของเพจนี้ไม่ทำงานเลย
    if (needsAlert(page.connectionState)) {
      const critical =
        page.connectionState === "expired" || page.connectionState === "revoked";
      problems.push({
        id: `token:${page.pageId}`,
        severity: critical ? "critical" : "warning",
        kind: "token",
        ...info(page),
        th: critical
          ? `${STATE_LABEL_TH[page.connectionState]} — เพจนี้หยุดทำงานทั้งหมด ต้องให้ลูกค้ากดเชื่อมใหม่`
          : `${STATE_LABEL_TH[page.connectionState]}${
              page.hoursUntilExpiry !== undefined
                ? ` (เหลือ ${Math.max(0, Math.floor(page.hoursUntilExpiry / 24))} วัน)`
                : ""
            } — ต่ออายุก่อนหมด ไม่งั้นโพสต์ที่ตั้งไว้จะไม่ขึ้น`,
      });
    }

    // 2. webhook เงียบ — อาการนี้เงียบมาก คนไม่รู้จนลูกค้าโวย
    //
    // ข้ามถ้า token ใช้ไม่ได้แล้ว: เพจที่ token หมดอายุย่อมไม่มี webhook เข้า
    // นั่นคือ "ผลของปัญหาเดิม" ไม่ใช่ปัญหาใหม่ ขึ้นสองบรรทัดให้เรื่องเดียวกัน
    // ทำให้รายการดูแย่กว่าความจริง แล้วคนจะเริ่มไม่เชื่อตัวเลขในหน้านี้
    if (isTokenDead(page.connectionState)) continue;

    if (page.lastWebhookAtMs === null) {
      problems.push({
        id: `webhook:${page.pageId}`,
        severity: "warning",
        kind: "webhook",
        ...info(page),
        th: "ยังไม่เคยได้รับ webhook จากเพจนี้เลย — ตรวจว่า subscribe ครบหรือยัง",
      });
      continue;
    }

    const silentFor = args.nowMs - page.lastWebhookAtMs;
    if (silentFor > WEBHOOK_SILENT_MS) {
      problems.push({
        id: `webhook:${page.pageId}`,
        severity: silentFor > WEBHOOK_CRITICAL_MS ? "critical" : "warning",
        kind: "webhook",
        ...info(page),
        th: `ไม่ได้รับ webhook มา ${Math.floor(silentFor / 60_000)} นาที — ข้อความลูกค้าอาจตกหล่นอยู่ตอนนี้`,
      });
    }
  }

  // 3. โพสต์ที่ล้มเหลว — ลูกค้าจ่ายเงินเพื่อให้โพสต์ขึ้น
  //
  // รวมเป็นบรรทัดเดียวต่อเพจ ไม่ใช่บรรทัดต่อโพสต์: เวลา token เพจหนึ่งหมด
  // โพสต์ของเพจนั้นล้มพร้อมกันหมด ถ้าแตกเป็นบรรทัดละโพสต์ รายการจะยาว
  // จนกลบเรื่องอื่นที่คนละสาเหตุ ทั้งที่ทั้งหมดแก้ด้วยการกดครั้งเดียว
  const failedByPage = new Map<string, FailedPostSnapshot[]>();
  for (const post of args.failedPosts ?? []) {
    if (post.failedAttempts <= 0) continue;
    const list = failedByPage.get(post.pageId) ?? [];
    list.push(post);
    failedByPage.set(post.pageId, list);
  }

  for (const [pageId, posts] of failedByPage) {
    const page = byId.get(pageId);
    const dead = posts.filter((p) => p.failedAttempts >= 3);
    const reason = (dead[0] ?? posts[0])?.lastErrorTh ?? "ไม่ทราบสาเหตุ";
    const noun = posts.length === 1 ? "โพสต์" : `${posts.length} โพสต์`;

    problems.push({
      id: `publish:${pageId}`,
      severity: dead.length > 0 ? "critical" : "warning",
      kind: "publish",
      ...(page
        ? info(page)
        : {
            pageId,
            pageName: pageId,
            clientName: "ไม่ทราบลูกค้า",
            colorIndex: 0,
          }),
      th:
        dead.length > 0
          ? `${noun}ล้มเหลวครบ 3 ครั้ง หยุด retry แล้ว — ${reason}`
          : `${noun}ล้มเหลว กำลัง retry อยู่ — ${reason}`,
    });
  }

  // 4. เหตุการณ์อื่นที่ระบบบันทึกไว้
  for (const inc of args.incidents ?? []) {
    const page = byId.get(inc.pageId);
    problems.push({
      id: inc.id,
      severity: inc.kind === "rate_limit" ? "warning" : "info",
      kind: inc.kind === "rate_limit" ? "rate_limit" : "moderation",
      ...(page
        ? info(page)
        : {
            pageId: inc.pageId,
            pageName: inc.pageId,
            clientName: "ไม่ทราบลูกค้า",
            colorIndex: 0,
          }),
      th: inc.th,
    });
  }

  return problems.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.clientName.localeCompare(b.clientName, "th"),
  );
}

export function isTokenDead(state: ConnectionState): boolean {
  return state === "expired" || state === "revoked" || state === "no_token";
}
