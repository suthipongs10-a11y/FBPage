/**
 * ฝั่งอ่านของหน้าจอฝั่งปฏิบัติการ — `/`, `/inbox`, `/calendar`, `/ops`, `/pages`
 *
 * ก่อนมีไฟล์นี้ ห้าหน้านั้นอ่านจาก `demo-workspace.ts` ซึ่งเป็นข้อมูลสมมติ
 * คนที่เพิ่งติดตั้งเสร็จจึงเห็น "มี 3 เรื่องที่พังอยู่ตอนนี้" ทั้งที่ยังไม่ได้
 * เชื่อมเพจสักเพจ
 *
 * ─── ทำไมโหลดมาทั้งชุดแล้วค่อยคำนวณใน JS ───
 *
 * เหตุผลเดียวกับ `listening-queries.ts`: การจัดลำดับคิว การตัดสินว่าอะไรพัง
 * และการนับ SLA อยู่ใน `packages/inbox` กับ `packages/ops` ซึ่งมีเทสต์ครอบแล้ว
 * ถ้าเขียน SQL คำนวณซ้ำอีกชุด จะได้สูตรสองที่ที่ต้องตรงกันเอง
 *
 * ขนาดข้อมูลรองรับสบาย — คนดูแล 10–20 เพจ บทสนทนาที่ยังเปิดอยู่หลักร้อย
 * โพสต์ในกรอบเวลาหลักร้อย ทุกชุดมีเพดานกันไว้หมดแล้ว
 *
 * ─── ทำไมยิงหลาย query แทนที่จะ include ซ้อนกัน ───
 *
 * Prisma แปลง `include` ซ้อนหลายชั้นเป็น query แยกอยู่ดี แต่ควบคุมเพดาน
 * แต่ละชั้นไม่ได้ — เพจที่มีบทสนทนา 50,000 อันจะลากมาทั้งหมด เขียนแยกแล้ว
 * ใส่ `take` ได้ตรงจุด
 *
 * ─── ⚠️ กฎเหล็กของไฟล์นี้: ห้าม `include` ความสัมพันธ์แบบ required ───
 *
 * `page.workspace`, `conversation.contact`, `postTarget.post` ประกาศเป็น
 * required ใน schema ทั้งหมด ถ้า `include` มันแล้วเจอแถวที่ปลายทางหายไป
 * Prisma โยน `Inconsistent query result: Field X is required` แล้ว
 * **query ทั้งก้อนพัง** ไม่ใช่แค่แถวนั้นหาย
 *
 * "ปลายทางหายไป" เกิดขึ้นได้จริงแม้จะมี foreign key แบบ cascade เพราะ
 * cascade ไม่ได้เกิดพร้อมกันในพริบตา — ระหว่างที่ Postgres ทยอยลบ
 * คนที่อ่านพร้อมกันจะเห็นสถานะครึ่งๆ กลางๆ ได้
 *
 * และ `snapshot()` อ่าน**ทุกเพจในเครื่อง**โดยตั้งใจ โอกาสชนจึงสูงกว่าที่คิด
 * — เจอครั้งแรกตอนรันเทสต์ขนานกัน แต่บนของจริงคือ "มีคนกดลบลูกค้าพอดีกับ
 * ที่อีกจอกำลังโหลด" แล้วหน้าแรกทั้งหน้าขึ้น "อ่านข้อมูลไม่ได้"
 *
 * วิธีที่ใช้แทน: `select` เอา foreign key มา แล้วยิงอีกรอบไปดึงของที่ต้องใช้
 * ค่าที่หายกลายเป็น `null` ซึ่งชั้นแปลงรองรับอยู่แล้ว
 */
import type { PrismaClient } from "./client.js";

/** สถานะ token ตามที่เก็บใน DB — ตรงกับ enum `TokenStatus` ใน schema */
export type StoredTokenStatus =
  | "active"
  | "expiring_soon"
  | "expired"
  | "revoked"
  | "missing_permissions"
  | "unknown";

export interface WorkspacePageRow {
  /** id ภายในระบบเรา (uuid) — ไม่ใช่เลขเพจของ Facebook */
  id: string;
  fbPageId: string;
  name: string;
  timeZone: string;
  botEnabled: boolean;
  lastWebhookAtMs: number | null;
  /** ชื่อลูกค้าจาก workspace ที่เพจนี้สังกัด */
  clientName: string;
  /** แพ็กเกจของ workspace — `STARTER` / `GROWTH` / `FULL` */
  plan: string;
  /**
   * ผู้ติดตามล่าสุดที่จดไว้ — `null` = ยังไม่เคย sync insights
   *
   * ต่างจาก 0 ที่แปลว่ารู้แล้วว่าไม่มีคนตาม ถ้ายุบสองอย่างนี้เป็นค่าเดียวกัน
   * หน้าจอจะโชว์ "0 ผู้ติดตามรวม" ให้คนที่แค่ยังไม่ได้ sync
   */
  followers: number | null;
  /** `null` = ยังไม่เคยใส่ token ให้เพจนี้เลย */
  token: {
    status: StoredTokenStatus;
    expiresAtMs: number | null;
    statusReasonTh: string | null;
  } | null;
}

export interface WorkspaceConversationRow {
  id: string;
  pageId: string;
  contactName: string | null;
  preview: string | null;
  awaitingSinceMs: number | null;
  unread: number;
  botPausedUntilMs: number | null;
}

export interface WorkspaceScheduledRow {
  id: string;
  pageId: string;
  scheduledAtMs: number;
  type: string;
  body: string;
  approvalStatus: string;
  status: string;
  /** ยิงไปแล้วกี่รอบ — รวมทุก target ของโพสต์นี้ */
  attempts: number;
  lastErrorTh: string | null;
}

export interface WorkspaceIncidentRow {
  id: string;
  pageId: string;
  kind: "publish_failed" | "rate_limit" | "comment_deleted";
  atMs: number;
  th: string;
}

export interface WorkspaceSnapshot {
  pages: WorkspacePageRow[];
  conversations: WorkspaceConversationRow[];
  scheduled: WorkspaceScheduledRow[];
  incidents: WorkspaceIncidentRow[];
}

/**
 * เพดานของแต่ละชุด
 *
 * ตั้งไว้สูงกว่าที่ใช้จริงมาก (คนดูแล 20 เพจไม่มีทางมีบทสนทนาค้าง 500 อัน)
 * แต่มีไว้เพื่อไม่ให้หน้าเว็บล่มถ้าวันหนึ่งมีอะไรผิดปกติจนข้อมูลบวม
 */
export const WORKSPACE_CAPS = {
  pages: 200,
  conversations: 500,
  scheduled: 500,
  incidents: 50,
} as const;

/** ย้อนหลังแค่ไหนถึงยังเรียกว่า "เพิ่งเกิด" สำหรับฟีดเหตุการณ์ */
export const INCIDENT_WINDOW_MS = 24 * 3_600_000;

/** โพสต์ในกรอบนี้เท่านั้นที่เอามาแสดงในปฏิทิน/หน้าวันนี้ */
export const SCHEDULE_PAST_MS = 7 * 86_400_000;
export const SCHEDULE_FUTURE_MS = 45 * 86_400_000;

/**
 * เมตริกที่นับว่าเป็น "ผู้ติดตาม"
 *
 * `page_fans` ปลดระวางไปแล้วบางส่วน แต่ข้อมูลเก่าที่ sync ไว้ยังใช้ชื่อนี้
 * จึงยอมรับทั้งสองชื่อแล้วเอาอันที่ใหม่กว่า
 */
const FOLLOWER_METRICS = ["page_follows", "page_fans"];

function ms(d: Date | null | undefined): number | null {
  return d == null ? null : d.getTime();
}

export class PrismaWorkspaceQueries {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * ประกอบทุกอย่างที่หน้าจอฝั่งปฏิบัติการต้องใช้ ในการเรียกครั้งเดียว
   *
   * รับ `nowMs` เข้ามาแทนที่จะอ่านนาฬิกาเอง เพื่อให้ทุกตัวเลขในหน้าเดียวกัน
   * คิดจากเวลาจุดเดียว (กฎข้อ 4) — ไม่งั้น "เหลืออีก 3 นาที" กับ
   * "เลยมาแล้ว 1 วินาที" อาจโผล่พร้อมกันในหน้าเดียว
   */
  async snapshot(nowMs: number): Promise<WorkspaceSnapshot> {
    const pages = await this.pages();
    if (pages.length === 0) {
      // ยังไม่ได้เชื่อมเพจเลย — ไม่ต้องยิง query ที่เหลือให้เปลืองรอบ
      return { pages: [], conversations: [], scheduled: [], incidents: [] };
    }

    const pageIds = pages.map((p) => p.id);
    const [conversations, scheduled, incidents] = await Promise.all([
      this.conversations(pageIds),
      this.scheduled(pageIds, nowMs),
      this.incidents(pages, nowMs),
    ]);

    return { pages, conversations, scheduled, incidents };
  }

  private async pages(): Promise<WorkspacePageRow[]> {
    const rows = await this.prisma.page.findMany({
      take: WORKSPACE_CAPS.pages,
      orderBy: { createdAt: "asc" },
      // ⚠️ ไม่ include `workspace` — ดูกฎ "ห้าม include ความสัมพันธ์แบบ required"
      select: {
        id: true,
        workspaceId: true,
        fbPageId: true,
        name: true,
        timezone: true,
        botEnabled: true,
        lastWebhookAt: true,
        /**
         * เอา token ทุกชนิดของเพจมา แล้วค่อยเลือกตัวที่ "แย่ที่สุด" ทีหลัง
         *
         * เพจหนึ่งมีได้ทั้ง page token และ system user token — ถ้าหยิบตัวแรก
         * ที่เจอ สถานะที่โชว์จะขึ้นกับลำดับที่ Postgres คืนมา ซึ่งไม่แน่นอน
         */
        tokens: {
          select: {
            status: true,
            expiresAt: true,
            statusReason: true,
            tokenType: true,
          },
        },
      },
    });
    if (rows.length === 0) return [];

    const [workspaces, followers] = await Promise.all([
      this.prisma.workspace.findMany({
        where: { id: { in: rows.map((r) => r.workspaceId) } },
        select: { id: true, clientName: true, plan: true },
      }),
      this.followersByPage(rows.map((r) => r.id)),
    ]);
    const wsOf = new Map(workspaces.map((w) => [w.id, w]));

    return rows.map((r) => {
      const ws = wsOf.get(r.workspaceId);
      return {
        id: r.id,
        fbPageId: r.fbPageId,
        name: r.name,
        timeZone: r.timezone,
        botEnabled: r.botEnabled,
        lastWebhookAtMs: ms(r.lastWebhookAt),
        // workspace หายระหว่างทาง = กำลังถูกลบอยู่ — แสดงชื่อเพจไปก่อน
        clientName: ws?.clientName ?? r.name,
        plan: ws?.plan ?? "STARTER",
        followers: followers.get(r.id) ?? null,
        token: worstToken(r.tokens),
      };
    });
  }

  /**
   * ผู้ติดตามล่าสุดของแต่ละเพจ
   *
   * `groupBy` หา max(date) แล้วค่อยดึงค่ากลับมาต้องยิงสองรอบและ join เอง
   * — ข้อมูลเล็ก (เพจละไม่กี่ร้อยแถวต่อปี) เลยดึงมาเรียงใน JS ตรงๆ
   * ชัดกว่าและไม่มี SQL ให้พลาด
   */
  private async followersByPage(pageIds: string[]): Promise<Map<string, number>> {
    if (pageIds.length === 0) return new Map();

    const rows = await this.prisma.insightsDaily.findMany({
      where: { pageId: { in: pageIds }, metricKey: { in: FOLLOWER_METRICS } },
      orderBy: { date: "desc" },
      select: { pageId: true, value: true, date: true },
      take: pageIds.length * 40,
    });

    const latest = new Map<string, number>();
    // เรียงมาจากใหม่ไปเก่าแล้ว — ตัวแรกที่เจอต่อเพจคือตัวล่าสุด
    for (const r of rows) {
      if (!latest.has(r.pageId)) latest.set(r.pageId, Math.round(r.value));
    }
    return latest;
  }

  private async conversations(pageIds: string[]): Promise<WorkspaceConversationRow[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { pageId: { in: pageIds }, status: "open" },
      take: WORKSPACE_CAPS.conversations,
      /**
       * ตัวที่รอนานที่สุดมาก่อน และ `nulls: "last"` เพราะ Postgres เรียง NULL
       * ไว้หน้าสุดตอน ASC ไม่ได้ — ตัวที่ตอบครบแล้ว (`awaitingSince = null`)
       * ต้องไปอยู่ท้ายแถว ไม่ใช่มาแย่งที่คนที่ยังรออยู่ตอนโดนเพดานตัด
       */
      orderBy: { awaitingSince: { sort: "asc", nulls: "last" } },
      /**
       * ⚠️ **ห้าม `include: { contact: … }`**
       *
       * ความสัมพันธ์นี้ประกาศเป็น required ใน schema — Prisma จึงโยน
       * `Inconsistent query result: Field contact is required` ทันทีที่อ่านเจอ
       * บทสนทนาที่ผู้ติดต่อของมันเพิ่งถูกลบไปพร้อมกัน (cascade กำลังทำงานอยู่)
       * แล้ว **query ทั้งก้อนพัง** ไม่ใช่แค่แถวนั้นหาย
       *
       * เกิดขึ้นจริงตอนรันเทสต์ขนานกัน และเกิดได้บนของจริงเหมือนกันเมื่อมีคน
       * กดลบผู้ติดต่อพอดีกับที่หน้าจอกำลังโหลด — หน้าแรกทั้งหน้าจะขึ้น
       * "อ่านข้อมูลไม่ได้" เพราะบทสนทนาใบเดียวที่กำลังจะหายอยู่แล้ว
       *
       * ดึงแยกสองรอบแล้วต่อกันใน JS จึงทนกว่า: ผู้ติดต่อที่หายไปกลายเป็น
       * "ไม่ทราบชื่อ" ซึ่งเป็นสิ่งที่ชั้นแปลงรองรับอยู่แล้ว
       *
       * (เขียนเทสต์จำลองสถานะนี้ตรงๆ ไม่ได้ เพราะ foreign key เป็น cascade —
       * ลบผู้ติดต่อแล้วบทสนทนาหายตามทันที สถานะ "บทสนทนาที่ไม่มีผู้ติดต่อ"
       * มีอยู่ชั่วขณะระหว่าง cascade เท่านั้น ซึ่งเป็นตอนที่คนอ่านพร้อมกันพอดี)
       */
      select: {
        id: true,
        pageId: true,
        contactId: true,
        awaitingSince: true,
        unread: true,
        botPausedUntil: true,
        /** ข้อความล่าสุดใบเดียวพอ — เอาไว้โชว์เป็นตัวอย่างในคิว */
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true },
        },
      },
    });
    if (rows.length === 0) return [];

    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: rows.map((r) => r.contactId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(contacts.map((c) => [c.id, c.name]));

    return rows.map((r) => ({
      id: r.id,
      pageId: r.pageId,
      contactName: nameOf.get(r.contactId) ?? null,
      preview: r.messages[0]?.body ?? null,
      awaitingSinceMs: ms(r.awaitingSince),
      unread: r.unread,
      botPausedUntilMs: ms(r.botPausedUntil),
    }));
  }

  private async scheduled(
    pageIds: string[],
    nowMs: number,
  ): Promise<WorkspaceScheduledRow[]> {
    const rows = await this.prisma.post.findMany({
      where: {
        pageId: { in: pageIds },
        scheduledAt: {
          gte: new Date(nowMs - SCHEDULE_PAST_MS),
          lte: new Date(nowMs + SCHEDULE_FUTURE_MS),
        },
        /**
         * โพสต์ที่ขึ้นไปแล้วไม่ต้องอยู่ในปฏิทิน "ที่จะขึ้น" — แต่ `failed`
         * ต้องอยู่ เพราะนั่นคือของที่ต้องมีคนไปจัดการ
         */
        status: { in: ["draft", "pending_approval", "scheduled", "failed"] },
      },
      take: WORKSPACE_CAPS.scheduled,
      orderBy: { scheduledAt: "asc" },
      include: {
        targets: {
          select: { attempts: true, error: true },
          orderBy: { attempts: "desc" },
        },
      },
    });

    return rows.map((r) => {
      // โพสต์หนึ่งใบยิงได้หลายเพจ — จำนวนครั้งที่ล้มคือของ target ที่แย่ที่สุด
      const worst = r.targets[0];
      return {
        id: r.id,
        pageId: r.pageId,
        scheduledAtMs: r.scheduledAt?.getTime() ?? nowMs,
        type: r.type,
        body: r.body,
        approvalStatus: r.approvalStatus,
        status: r.status,
        attempts: worst?.attempts ?? 0,
        lastErrorTh: worst?.error ?? null,
      };
    });
  }

  /**
   * ฟีดเหตุการณ์ 24 ชม.ล่าสุด
   *
   * ตั้งใจ**ไม่**รวมเรื่อง token กับ webhook เงียบ เพราะสองเรื่องนั้น
   * `collectProblems()` ของ `packages/ops` ตรวจจากสถานะปัจจุบันอยู่แล้ว
   * ถ้าใส่ซ้ำที่นี่ คนจะเห็นเรื่องเดียวกันสองที่แล้วนับซ้ำ
   *
   * ⚠️ **`meta_call_logs.page_id` เก็บรหัสเพจของ Facebook ไม่ใช่ UUID ของเรา**
   *
   * ตารางนั้นไม่มี foreign key ไปที่ `pages` เพราะ gateway เขียน log ได้แม้
   * ตอนที่ยังไม่มีแถว `Page` (เช่นตอนดึงรายชื่อเพจครั้งแรก) ค่าที่เขียนลงไป
   * จึงเป็น `pageId` ตามความหมายของโดเมน = รหัสเพจของ Facebook
   *
   * ถ้าเผลอ query ด้วย UUID ที่นี่ จะได้ผลลัพธ์ว่าง**โดยไม่มี error** แล้ว
   * หน้าจอจะบอกว่า "ไม่เคยชน rate limit เลย" ตลอดกาล ทั้งที่ชนอยู่ทุกวัน
   * (คำเตือนเดียวกับหัวไฟล์ `token-repository.ts`)
   */
  private async incidents(
    pages: WorkspacePageRow[],
    nowMs: number,
  ): Promise<WorkspaceIncidentRow[]> {
    const since = new Date(nowMs - INCIDENT_WINDOW_MS);
    const pageIds = pages.map((p) => p.id);
    const fbPageIds = pages.map((p) => p.fbPageId);
    /** รหัสเพจของ Facebook → UUID ภายใน เพื่อแปลง log กลับมาให้ UI ใช้ได้ */
    const byFbId = new Map(pages.map((p) => [p.fbPageId, p.id]));

    const [failed, rateLimited, moderated] = await Promise.all([
      // `postId` แทนการ include `post` — ดูกฎเรื่องความสัมพันธ์แบบ required
      this.prisma.postTarget.findMany({
        where: { pageId: { in: pageIds }, status: "failed" },
        take: WORKSPACE_CAPS.incidents,
        orderBy: { attempts: "desc" },
        select: { id: true, pageId: true, error: true, postId: true },
      }),
      this.prisma.metaCallLog.findMany({
        where: {
          pageId: { in: fbPageIds },
          createdAt: { gte: since },
          errorCode: { in: [4, 32, 80001] },
        },
        take: WORKSPACE_CAPS.incidents,
        orderBy: { createdAt: "desc" },
        select: { id: true, pageId: true, createdAt: true, errorCode: true },
      }),
      this.prisma.comment.findMany({
        where: {
          pageId: { in: pageIds },
          createdAt: { gte: since },
          actionTaken: { in: ["deleted", "hidden"] },
        },
        take: WORKSPACE_CAPS.incidents,
        orderBy: { createdAt: "desc" },
        select: { id: true, pageId: true, createdAt: true, actionTaken: true },
      }),
    ]);

    const posts =
      failed.length === 0
        ? []
        : await this.prisma.post.findMany({
            where: { id: { in: failed.map((f) => f.postId) } },
            select: { id: true, updatedAt: true },
          });
    const postUpdatedAt = new Map(posts.map((p) => [p.id, p.updatedAt]));

    const out: WorkspaceIncidentRow[] = [
      ...failed.map((f) => ({
        id: `pub-${f.id}`,
        pageId: f.pageId,
        kind: "publish_failed" as const,
        // โพสต์หายไปแล้ว → ใช้เวลาปัจจุบันแทน ดีกว่าทำทั้ง query พัง
        atMs: postUpdatedAt.get(f.postId)?.getTime() ?? nowMs,
        th: f.error ?? "โพสต์ไม่สำเร็จ แต่ระบบไม่ได้บันทึกสาเหตุไว้",
      })),
      ...rateLimited.flatMap((r) => {
        const internalId = r.pageId === null ? undefined : byFbId.get(r.pageId);
        // log ที่ไม่ผูกกับเพจไหน (เช่น call ระดับแอป) ไม่มีที่แสดงในหน้านี้
        if (internalId === undefined) return [];
        return [
          {
            id: `rate-${r.id}`,
            pageId: internalId,
            kind: "rate_limit" as const,
            atMs: r.createdAt.getTime(),
            th: `ชนโควตา API ของ Meta (error ${r.errorCode ?? "?"}) — ระบบชะลอคิวให้อัตโนมัติ`,
          },
        ];
      }),
      ...moderated.map((c) => ({
        id: `mod-${c.id}`,
        pageId: c.pageId,
        kind: "comment_deleted" as const,
        atMs: c.createdAt.getTime(),
        th:
          c.actionTaken === "deleted"
            ? "ลบคอมเมนต์ที่เข้าเงื่อนไขอัตโนมัติ — ตรวจได้ที่ประวัติการดำเนินการ"
            : "ซ่อนคอมเมนต์ที่เข้าเงื่อนไขอัตโนมัติ — ตรวจได้ที่ประวัติการดำเนินการ",
      })),
    ];

    return out.sort((a, b) => b.atMs - a.atMs).slice(0, WORKSPACE_CAPS.incidents);
  }
}

/**
 * เพจมี token ได้หลายชนิด — เลือกตัวที่สถานะ "แย่ที่สุด" มาโชว์
 *
 * เพราะหน้าจอตอบคำถามว่า "เพจนี้มีอะไรต้องแก้ไหม" ไม่ใช่ "มี token ที่ดีอยู่ไหม"
 * ถ้าเพจมี system token ที่ใช้ได้ แต่ page token หมดอายุ นั่นยังเป็นเรื่องที่
 * ต้องรู้ — การโชว์แต่ตัวที่เขียวจะซ่อนปัญหาไว้จนวันที่มันพัง
 */
function worstToken(
  tokens: ReadonlyArray<{
    status: string;
    expiresAt: Date | null;
    statusReason: string | null;
  }>,
): WorkspacePageRow["token"] {
  if (tokens.length === 0) return null;

  const RANK: Record<string, number> = {
    revoked: 0,
    expired: 1,
    missing_permissions: 2,
    expiring_soon: 3,
    unknown: 4,
    active: 5,
  };
  const worst = [...tokens].sort(
    (a, b) => (RANK[a.status] ?? 4) - (RANK[b.status] ?? 4),
  )[0];
  if (worst === undefined) return null;

  return {
    status: worst.status as StoredTokenStatus,
    expiresAtMs: ms(worst.expiresAt),
    statusReasonTh: worst.statusReason,
  };
}
