/**
 * WebhookProcessor — รับ event จาก webhook แล้วอัปเดตสถานะ inbox (M1)
 *
 * ลำดับที่ห้ามสลับ:
 *   1. กันซ้ำด้วย idempotency key (กฎข้อ 6) — ทำก่อนอย่างอื่นทั้งหมด
 *   2. จัดการ echo (สเปกข้อ 6.2 + 6.7) — ข้ามของเราเอง แต่ถ้าเป็นคนพิมพ์ในแอป FB
 *      ต้องพักบอท ไม่ใช่ข้ามเฉยๆ
 *   3. อัปเดตหน้าต่าง 24 ชม. + SLA
 *   4. ค่อยตัดสินว่าบอทควรตอบไหม
 *
 * event หนึ่งพังต้องไม่ทำให้ event ที่เหลือใน request เดียวกันไม่ได้ทำ
 * — Meta ส่งมาหลาย event ต่อ request และถ้าเราตอบ error มันจะยิงซ้ำทั้งชุด
 */
import { nullLogger, systemClock, type Clock, type Logger } from "@page-os/core";
import {
  idempotencyKey,
  type CommentEvent,
  type InboxEvent,
  type IncomingMessageEvent,
  type PostbackEvent,
  type RatingEvent,
  type ReactionEvent,
} from "./events.js";
import { isHumanTypedEcho, pauseForHuman, shouldBotRespond } from "./handover.js";
import { windowStatus } from "./messaging-policy.js";

export interface ConversationState {
  conversationId: string;
  pageId: string;
  contactId: string;
  /** ลูกค้าทักล่าสุดเมื่อไหร่ */
  lastCustomerMessageAtMs: number | null;
  /** ข้อความที่ยังไม่ได้ตอบเริ่มตั้งแต่เมื่อไหร่ (null = ตอบครบแล้ว) */
  awaitingSinceMs: number | null;
  botPausedUntilMs: number | null;
  assignedTo: string | null;
  unread: number;
}

export interface InboxStore {
  /** เคยประมวลผล event นี้แล้วหรือยัง (กฎข้อ 6) */
  hasSeen(key: string): Promise<boolean>;
  markSeen(key: string, atMs: number): Promise<void>;

  /** หา/สร้างบทสนทนาสำหรับผู้ติดต่อคนนี้ */
  upsertConversation(args: {
    pageId: string;
    contactId: string;
    channel: string;
  }): Promise<ConversationState>;

  /** บันทึกข้อความเข้า/ออก */
  appendMessage(args: {
    conversationId: string;
    mid: string;
    direction: "inbound" | "outbound";
    sentBy: "human" | "bot" | "system";
    body?: string;
    attachments?: Array<{ type: string; url?: string }>;
    createdAtMs: number;
  }): Promise<void>;

  updateConversation(
    conversationId: string,
    patch: Partial<
      Pick<
        ConversationState,
        | "lastCustomerMessageAtMs"
        | "awaitingSinceMs"
        | "botPausedUntilMs"
        | "unread"
      >
    >,
  ): Promise<void>;

  /** บอทของเพจนี้เปิดอยู่ไหม (Kill Switch) */
  isBotEnabled(pageId: string): Promise<boolean>;
}

export interface ProcessedEvent {
  key: string;
  type: InboxEvent["type"];
  /** ควรให้บอทตอบไหม (มีเฉพาะ event ที่เป็นข้อความเข้า) */
  botShouldRespond?: boolean;
  conversationId?: string;
  skipped?: string;
  th: string;
}

export interface WebhookProcessorOptions {
  store: InboxStore;
  clock?: Clock;
  logger?: Logger;
  /** ส่งคอมเมนต์ต่อให้ moderation (M-C) */
  onComment?: (event: CommentEvent) => Promise<void>;
  /** แจ้งเตือนรีวิวเชิงลบ */
  onRating?: (event: RatingEvent) => Promise<void>;
}

export class WebhookProcessor {
  private readonly store: InboxStore;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly onComment: WebhookProcessorOptions["onComment"];
  private readonly onRating: WebhookProcessorOptions["onRating"];

  constructor(opts: WebhookProcessorOptions) {
    this.store = opts.store;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
    this.onComment = opts.onComment;
    this.onRating = opts.onRating;
  }

  /** ประมวลผลทุก event ใน request เดียว */
  async processAll(events: readonly InboxEvent[]): Promise<ProcessedEvent[]> {
    const out: ProcessedEvent[] = [];
    for (const ev of events) {
      try {
        out.push(await this.processOne(ev));
      } catch (err) {
        // event เดียวพังต้องไม่ทำให้ที่เหลือไม่ได้ทำ และต้องไม่ตอบ error
        // ให้ Meta ไม่งั้นมันจะยิงซ้ำทั้งชุด
        this.logger.error("ประมวลผล event ไม่สำเร็จ", {
          page_id: ev.pageId,
          type: ev.type,
          err,
        });
        out.push({
          key: idempotencyKey(ev),
          type: ev.type,
          skipped: "error",
          th: "ประมวลผล event นี้ไม่สำเร็จ — ดู log ประกอบ",
        });
      }
    }
    return out;
  }

  private async processOne(ev: InboxEvent): Promise<ProcessedEvent> {
    const key = idempotencyKey(ev);

    if (await this.store.hasSeen(key)) {
      return {
        key,
        type: ev.type,
        skipped: "duplicate",
        th: "event นี้ประมวลผลไปแล้ว — ข้าม (Meta ส่งซ้ำได้)",
      };
    }

    let result: ProcessedEvent;
    switch (ev.type) {
      case "message":
        result = await this.handleMessage(ev, key);
        break;
      case "postback":
        result = await this.handlePostback(ev, key);
        break;
      case "reaction":
        result = await this.handleReaction(ev, key);
        break;
      case "comment":
        result = await this.handleComment(ev, key);
        break;
      case "rating":
        result = await this.handleRating(ev, key);
        break;
    }

    await this.store.markSeen(key, this.clock.now());
    return result;
  }

  private async handleMessage(
    ev: IncomingMessageEvent,
    key: string,
  ): Promise<ProcessedEvent> {
    // ---- echo: ข้อความที่เพจส่งออกไป เด้งกลับมา ----
    if (ev.isEcho) {
      // คนพิมพ์ในแอป FB เอง — ต้องพักบอท ไม่ใช่ข้ามเฉยๆ (สเปกข้อ 6.7)
      if (isHumanTypedEcho(ev)) {
        // ตอน echo ลูกค้าอยู่ฝั่งผู้รับ — parser คำนวณ contactId ให้ถูกฝั่งแล้ว
        const conv = await this.store.upsertConversation({
          pageId: ev.pageId,
          contactId: ev.contactId,
          channel: ev.channel,
        });
        const pause = pauseForHuman({
          nowMs: this.clock.now(),
          reason: "human_replied_in_app",
          currentPausedUntilMs: conv.botPausedUntilMs,
        });
        await this.store.updateConversation(conv.conversationId, {
          botPausedUntilMs: pause.pausedUntilMs,
          // คนตอบไปแล้ว SLA จึงจบ
          awaitingSinceMs: null,
        });
        await this.store.appendMessage({
          conversationId: conv.conversationId,
          mid: ev.mid,
          direction: "outbound",
          sentBy: "human",
          ...(ev.text !== undefined ? { body: ev.text } : {}),
          createdAtMs: ev.timestampMs,
        });
        return {
          key,
          type: ev.type,
          conversationId: conv.conversationId,
          botShouldRespond: false,
          th: pause.th,
        };
      }

      // ระบบเราส่งเอง — บันทึกไว้เฉยๆ ไม่ต้องทำอะไรต่อ
      return {
        key,
        type: ev.type,
        skipped: "own_echo",
        th: "ข้อความที่ระบบเราส่งเอง — ข้ามเพื่อกันวนลูป",
      };
    }

    // ---- ข้อความจากลูกค้า ----
    const conv = await this.store.upsertConversation({
      pageId: ev.pageId,
      contactId: ev.contactId,
      channel: ev.channel,
    });

    await this.store.appendMessage({
      conversationId: conv.conversationId,
      mid: ev.mid,
      direction: "inbound",
      sentBy: "system",
      ...(ev.text !== undefined ? { body: ev.text } : {}),
      ...(ev.attachments.length > 0 ? { attachments: ev.attachments } : {}),
      createdAtMs: ev.timestampMs,
    });

    await this.store.updateConversation(conv.conversationId, {
      lastCustomerMessageAtMs: ev.timestampMs,
      // ถ้ามีข้อความค้างอยู่แล้ว ให้ยึดเวลาแรกสุด SLA จะได้ไม่ถูกรีเซ็ต
      // ทุกครั้งที่ลูกค้าพิมพ์ต่อ (ไม่งั้นลูกค้าที่พิมพ์รัวจะไม่มีวันเกิน SLA)
      awaitingSinceMs: conv.awaitingSinceMs ?? ev.timestampMs,
      unread: conv.unread + 1,
    });

    const gate = shouldBotRespond({
      botPausedUntilMs: conv.botPausedUntilMs,
      botEnabledForPage: await this.store.isBotEnabled(ev.pageId),
      assignedToHuman: conv.assignedTo !== null,
      nowMs: this.clock.now(),
    });

    const win = windowStatus(ev.timestampMs, this.clock.now());

    return {
      key,
      type: ev.type,
      conversationId: conv.conversationId,
      botShouldRespond: gate.shouldRespond,
      th: `ลูกค้าทักเข้ามา (${win.badgeTh}) — ${gate.th}`,
    };
  }

  private async handlePostback(
    ev: PostbackEvent,
    key: string,
  ): Promise<ProcessedEvent> {
    const conv = await this.store.upsertConversation({
      pageId: ev.pageId,
      contactId: ev.senderId,
      channel: ev.channel,
    });

    await this.store.appendMessage({
      conversationId: conv.conversationId,
      mid: ev.mid,
      direction: "inbound",
      sentBy: "system",
      body: ev.title ?? ev.payload,
      createdAtMs: ev.timestampMs,
    });

    // การกดปุ่มถือเป็นการโต้ตอบ จึงเปิดหน้าต่าง 24 ชม. ใหม่เหมือนพิมพ์ข้อความ
    await this.store.updateConversation(conv.conversationId, {
      lastCustomerMessageAtMs: ev.timestampMs,
      awaitingSinceMs: conv.awaitingSinceMs ?? ev.timestampMs,
    });

    const gate = shouldBotRespond({
      botPausedUntilMs: conv.botPausedUntilMs,
      botEnabledForPage: await this.store.isBotEnabled(ev.pageId),
      assignedToHuman: conv.assignedTo !== null,
      nowMs: this.clock.now(),
    });

    return {
      key,
      type: ev.type,
      conversationId: conv.conversationId,
      botShouldRespond: gate.shouldRespond,
      th: `ลูกค้ากดปุ่ม "${ev.title ?? ev.payload}" — ${gate.th}`,
    };
  }

  private async handleReaction(
    ev: ReactionEvent,
    key: string,
  ): Promise<ProcessedEvent> {
    // รีแอ็กชันไม่เปิดหน้าต่าง 24 ชม. และไม่ต้องให้บอทตอบ
    // แต่บันทึกไว้เพื่อให้เห็นใน thread ว่าลูกค้าตอบรับยังไง
    return {
      key,
      type: ev.type,
      botShouldRespond: false,
      th:
        ev.action === "react"
          ? `ลูกค้ากดรีแอ็ก ${ev.emoji ?? ""} ต่อข้อความ`
          : "ลูกค้าถอนรีแอ็กชัน",
    };
  }

  private async handleComment(
    ev: CommentEvent,
    key: string,
  ): Promise<ProcessedEvent> {
    if (ev.isFromPage) {
      return {
        key,
        type: ev.type,
        skipped: "own_comment",
        th: "คอมเมนต์ที่เพจเราเขียนเอง — ข้ามเพื่อกันวนลูป",
      };
    }
    if (ev.verb !== "add") {
      return {
        key,
        type: ev.type,
        skipped: `verb_${ev.verb}`,
        th:
          ev.verb === "remove"
            ? "คอมเมนต์ถูกลบ — ไม่ต้องทำอะไรต่อ"
            : "คอมเมนต์ถูกแก้ไข — ไม่ต้องทำอะไรต่อ",
      };
    }

    // ส่งต่อให้ moderation ทำงาน (M-C)
    if (this.onComment) await this.onComment(ev);

    return {
      key,
      type: ev.type,
      th: "ส่งคอมเมนต์ให้ระบบดูแลคอมเมนต์แล้ว",
    };
  }

  private async handleRating(
    ev: RatingEvent,
    key: string,
  ): Promise<ProcessedEvent> {
    if (ev.verb === "remove") {
      return {
        key,
        type: ev.type,
        skipped: "verb_remove",
        th: "รีวิวถูกลบ — ไม่ต้องทำอะไรต่อ",
      };
    }
    if (this.onRating) await this.onRating(ev);

    return {
      key,
      type: ev.type,
      th:
        ev.recommendation === "negative"
          ? "ได้รีวิวเชิงลบ — แจ้งเตือนแล้ว"
          : "ได้รีวิวเชิงบวก",
    };
  }
}
