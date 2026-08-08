/**
 * ที่เก็บของ Unified Inbox ที่ต่อ Postgres จริง (M-E)
 *
 * ⚠️ เรื่อง `pageId` สองความหมาย เหมือน `token-repository.ts` และ
 * `publish-repository.ts` — โดเมนใช้รหัสเพจของ Facebook ส่วน DB ใช้ UUID ภายใน
 * ที่นี่แปลงที่ขอบทุกครั้ง
 *
 * ─── ค่าที่คำนวณแล้ว (`windowExpiresAt`, `slaDueAt`) ───
 *
 * สองคอลัมน์นั้นไม่ใช่ข้อเท็จจริง แต่เป็นค่าที่คำนวณจาก `lastCustomerMessageAt`
 * กับ `awaitingSince` มีไว้ให้ query หา "ใกล้หมดเวลา / ใกล้ผิด SLA" ได้เร็ว
 * โดยไม่ต้องคำนวณทีละแถว
 *
 * ที่นี่เป็น **ผู้เขียนคนเดียว** ของทั้งสี่คอลัมน์ และเขียนพร้อมกันในคำสั่งเดียว
 * เสมอ — ถ้าปล่อยให้ที่อื่นเขียนได้ด้วย ค่าที่คำนวณจะเพี้ยนจากต้นทางแบบเงียบๆ
 * แล้วอาการที่ได้คือ "badge นับถอยหลังบอกว่าเหลือ 3 ชม. แต่ส่งข้อความไม่ได้แล้ว"
 */
import { STANDARD_WINDOW_MS, type ConversationState, type InboxStore } from "@page-os/inbox";
import type { PrismaClient } from "./client.js";

type DbChannel = "messenger" | "instagram" | "comment" | "rating";

export interface PrismaInboxStoreOptions {
  prisma: PrismaClient;
  /**
   * นานแค่ไหนถึงถือว่าเป็นการตอบช้า (นาที) — ค่าเริ่มต้นตามแพ็กเกจของลูกค้า
   * ที่อ่านจาก workspace ถ้าอ่านไม่ได้ใช้ค่านี้แทน
   */
  fallbackSlaMinutes?: number;
}

export class PrismaInboxStore implements InboxStore {
  private readonly prisma: PrismaClient;
  private readonly fallbackSlaMinutes: number;

  constructor(opts: PrismaInboxStoreOptions) {
    this.prisma = opts.prisma;
    this.fallbackSlaMinutes = opts.fallbackSlaMinutes ?? 240;
  }

  // ── กันซ้ำ (กฎข้อ 6) ──────────────────────────────────────────────────

  async hasSeen(key: string): Promise<boolean> {
    const row = await this.prisma.webhookSeen.findUnique({
      where: { key },
      select: { key: true },
    });
    return row !== null;
  }

  /**
   * จดว่าเคยเห็นแล้ว
   *
   * ต้องทนต่อการจดซ้ำ เพราะ event เดิมอาจถูกหยิบไปทำพร้อมกันโดย worker
   * คนละตัว การให้ตัวที่มาทีหลังพังทั้งงานเพราะจดซ้ำนั้นไม่ถูก —
   * ด่านที่กันซ้ำจริงคือ `hasSeen()` ที่ตรวจก่อนหน้านั้น
   *
   * ⚠️ `upsert` ของ Prisma **ใช้แทนไม่ได้** ถึงจะดูเหมือนตรงความหมายกว่า
   * เพราะมันแปลเป็น "อ่านก่อนแล้วค่อยเขียน" ซึ่งมีช่องระหว่างสองขั้น —
   * เทสต์ที่จดพร้อมกัน 8 ครั้งจับได้ว่า 6 ใน 8 ล้มด้วย unique violation
   *
   * `createMany` + `skipDuplicates` แปลเป็น `INSERT ... ON CONFLICT DO NOTHING`
   * ซึ่ง Postgres รับประกันความถูกต้องให้ในคำสั่งเดียว
   */
  async markSeen(key: string, atMs: number): Promise<void> {
    await this.prisma.webhookSeen.createMany({
      data: [{ key, seenAt: new Date(atMs) }],
      skipDuplicates: true,
    });
  }

  /** ล้างของเก่าทิ้ง — ตารางนี้โตตามจำนวน event ไม่ใช่จำนวนบทสนทนา */
  async purgeSeenBefore(atMs: number): Promise<number> {
    const r = await this.prisma.webhookSeen.deleteMany({
      where: { seenAt: { lt: new Date(atMs) } },
    });
    return r.count;
  }

  // ── บทสนทนา ───────────────────────────────────────────────────────────

  async upsertConversation(args: {
    pageId: string;
    contactId: string;
    channel: string;
  }): Promise<ConversationState> {
    const page = await this.prisma.page.findUnique({
      where: { fbPageId: args.pageId },
      select: { id: true },
    });
    if (page === null) {
      throw new Error(
        `ไม่พบเพจรหัส ${args.pageId} ในระบบ — ได้ webhook ของเพจที่ยังไม่ได้เชื่อม ` +
          `ให้เช็คว่า subscribe เพจนี้ไว้โดยไม่ได้เพิ่มเข้าระบบหรือเปล่า`,
      );
    }

    const channel = toDbChannel(args.channel);
    // Instagram ใช้ ig_id ส่วนที่เหลือใช้ psid — สองคอลัมน์นี้มี unique คนละตัว
    const isIg = channel === "instagram";
    const contact = isIg
      ? await this.prisma.contact.upsert({
          where: { pageId_igId: { pageId: page.id, igId: args.contactId } },
          create: { pageId: page.id, igId: args.contactId },
          update: {},
        })
      : await this.prisma.contact.upsert({
          where: { pageId_psid: { pageId: page.id, psid: args.contactId } },
          create: { pageId: page.id, psid: args.contactId },
          update: {},
        });

    const existing = await this.prisma.conversation.findFirst({
      where: { pageId: page.id, contactId: contact.id, channel },
    });
    const row =
      existing ??
      (await this.prisma.conversation.create({
        data: { pageId: page.id, contactId: contact.id, channel },
      }));

    return {
      conversationId: row.id,
      // คืนรหัสของ Facebook กลับไป ไม่ใช่ UUID ภายใน
      pageId: args.pageId,
      contactId: args.contactId,
      lastCustomerMessageAtMs: row.lastCustomerMessageAt?.getTime() ?? null,
      awaitingSinceMs: row.awaitingSince?.getTime() ?? null,
      botPausedUntilMs: row.botPausedUntil?.getTime() ?? null,
      assignedTo: row.assignedTo,
      unread: row.unread,
    };
  }

  async updateConversation(
    conversationId: string,
    patch: Partial<
      Pick<
        ConversationState,
        "lastCustomerMessageAtMs" | "awaitingSinceMs" | "botPausedUntilMs" | "unread"
      >
    >,
  ): Promise<void> {
    const data: Record<string, unknown> = {};

    if (patch.lastCustomerMessageAtMs !== undefined) {
      const ms = patch.lastCustomerMessageAtMs;
      data["lastCustomerMessageAt"] = ms === null ? null : new Date(ms);
      // เขียนคู่กันเสมอ ดูเหตุผลในหัวไฟล์
      data["windowExpiresAt"] = ms === null ? null : new Date(ms + STANDARD_WINDOW_MS);
    }

    if (patch.awaitingSinceMs !== undefined) {
      const ms = patch.awaitingSinceMs;
      data["awaitingSince"] = ms === null ? null : new Date(ms);
      data["slaDueAt"] =
        ms === null
          ? null
          : new Date(ms + (await this.slaMinutesFor(conversationId)) * 60_000);
    }

    if (patch.botPausedUntilMs !== undefined) {
      data["botPausedUntil"] =
        patch.botPausedUntilMs === null ? null : new Date(patch.botPausedUntilMs);
    }

    if (patch.unread !== undefined) data["unread"] = patch.unread;
    if (Object.keys(data).length === 0) return;

    await this.prisma.conversation.update({ where: { id: conversationId }, data });
  }

  // ── ข้อความ ───────────────────────────────────────────────────────────

  /**
   * บันทึกข้อความ
   *
   * `mid` มี unique index — ข้อความเดิมที่ถูกส่งมาซ้ำจะชน จึงจับ P2002 แล้วปล่อยผ่าน
   * แทนที่จะโยนต่อ เพราะ "มีอยู่แล้ว" คือผลลัพธ์ที่เราต้องการอยู่แล้ว
   * ไม่ใช่ความผิดพลาด (กฎข้อ 6)
   */
  async appendMessage(args: {
    conversationId: string;
    mid: string;
    direction: "inbound" | "outbound";
    sentBy: "human" | "bot" | "system";
    body?: string;
    attachments?: Array<{ type: string; url?: string }>;
    createdAtMs: number;
  }): Promise<void> {
    try {
      await this.prisma.message.create({
        data: {
          conversationId: args.conversationId,
          direction: args.direction,
          sentBy: args.sentBy,
          mid: args.mid,
          ...(args.body !== undefined ? { body: args.body } : {}),
          attachments: JSON.parse(
            JSON.stringify(args.attachments ?? []),
          ) as object[],
          createdAt: new Date(args.createdAtMs),
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }

  // ── Kill Switch ───────────────────────────────────────────────────────

  /**
   * บอทของเพจนี้เปิดอยู่ไหม
   *
   * เพจที่หาไม่เจอคืน `false` — ปิดไว้ก่อนปลอดภัยกว่า ถ้าคืน `true`
   * บอทจะไปตอบแทนเพจที่เราไม่รู้จัก ซึ่งเป็นสิ่งที่อธิบายกับลูกค้ายากที่สุด
   */
  async isBotEnabled(fbPageId: string): Promise<boolean> {
    const page = await this.prisma.page.findUnique({
      where: { fbPageId },
      select: { botEnabled: true },
    });
    return page?.botEnabled ?? false;
  }

  private async slaMinutesFor(conversationId: string): Promise<number> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { page: { select: { workspace: { select: { slaMinutes: true } } } } },
    });
    return row?.page.workspace.slaMinutes ?? this.fallbackSlaMinutes;
  }
}

function toDbChannel(channel: string): DbChannel {
  const known: DbChannel[] = ["messenger", "instagram", "comment", "rating"];
  if ((known as string[]).includes(channel)) return channel as DbChannel;
  throw new Error(
    `ไม่รู้จักช่องทาง "${channel}" — ถ้า Meta เพิ่มช่องทางใหม่ ต้องเพิ่มใน enum Channel ก่อน`,
  );
}

/** Prisma บอกว่า unique constraint ชนด้วยรหัส P2002 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}
