/**
 * แปลง payload ของ webhook เป็น event ที่ระบบเราเข้าใจ (M1)
 *
 * Meta ส่งมาหลายรูปแบบปนกันใน request เดียว และรูปแบบต่างกันระหว่าง
 * Messenger กับ Instagram จึงต้องแปลงให้เป็นชนิดเดียวก่อน ที่เหลือของระบบ
 * จะได้ไม่ต้องรู้ว่าข้อความมาจากช่องทางไหน
 *
 * สเปกข้อ M1 บอกให้ subscribe: messages, messaging_postbacks, message_reactions,
 * feed, ratings
 */

export type Channel = "messenger" | "instagram" | "comment" | "rating";

export interface BaseEvent {
  pageId: string;
  channel: Channel;
  /** epoch ms (UTC) — กฎข้อ 4 */
  timestampMs: number;
}

export interface IncomingMessageEvent extends BaseEvent {
  type: "message";
  channel: "messenger" | "instagram";
  /** id ข้อความของ Meta — unique key สำหรับ idempotency (กฎข้อ 6) */
  mid: string;
  /**
   * ผู้ส่ง — ปกติคือลูกค้า **แต่ตอน echo คือเพจ**
   * อย่าใช้ตัวนี้หาบทสนทนาโดยไม่เช็ค isEcho ก่อน ให้ใช้ `contactId` แทน
   */
  senderId: string;
  /** ผู้รับ — ตอน echo คือลูกค้า */
  recipientId: string;
  /**
   * id ของลูกค้าในบทสนทนานี้ ไม่ว่าใครจะเป็นคนส่ง
   * ใช้ตัวนี้หาบทสนทนาเสมอ
   */
  contactId: string;
  text?: string;
  attachments: Array<{ type: string; url?: string }>;
  /**
   * ข้อความที่ "เพจ" เป็นคนส่ง แล้วเด้งกลับมาเป็น webhook
   * (สเปกข้อ 6.2 — ต้องข้าม ไม่งั้นบอทจะคุยกับตัวเอง)
   */
  isEcho: boolean;
  /** ข้อความนี้ส่งจากแอป Facebook โดยตรง ไม่ได้ผ่านระบบเรา */
  isFromOtherApp?: boolean;
  quickReplyPayload?: string;
}

export interface PostbackEvent extends BaseEvent {
  type: "postback";
  channel: "messenger" | "instagram";
  mid: string;
  senderId: string;
  payload: string;
  title?: string;
}

export interface ReactionEvent extends BaseEvent {
  type: "reaction";
  channel: "messenger" | "instagram";
  senderId: string;
  /** ข้อความที่ถูกรีแอ็ก */
  targetMid: string;
  action: "react" | "unreact";
  emoji?: string;
}

export interface CommentEvent extends BaseEvent {
  type: "comment";
  channel: "comment";
  commentId: string;
  postId?: string;
  parentCommentId?: string;
  authorId: string;
  authorName?: string;
  message: string;
  /** คอมเมนต์นี้เพจเราเขียนเอง */
  isFromPage: boolean;
  verb: "add" | "edit" | "remove";
}

export interface RatingEvent extends BaseEvent {
  type: "rating";
  channel: "rating";
  ratingId: string;
  reviewerId: string;
  reviewerName?: string;
  /** Meta ใช้ recommendation type ไม่ใช่ดาวแล้ว */
  recommendation: "positive" | "negative";
  reviewText?: string;
  verb: "add" | "edit" | "remove";
}

export type InboxEvent =
  | IncomingMessageEvent
  | PostbackEvent
  | ReactionEvent
  | CommentEvent
  | RatingEvent;

/** event ที่ระบบไม่รู้จัก — เก็บไว้ดูว่า Meta ส่งอะไรมาใหม่ */
export interface UnknownEvent {
  pageId: string;
  field: string;
  raw: unknown;
}

export interface ParseResult {
  events: InboxEvent[];
  unknown: UnknownEvent[];
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Meta ส่ง timestamp มาเป็นวินาทีบ้าง มิลลิวินาทีบ้างแล้วแต่ field
 * ตัวเลขที่น้อยกว่าค่านี้แปลว่าเป็นวินาที (ปี 2001 ในหน่วย ms)
 */
const MS_THRESHOLD = 1_000_000_000_000;

export function normalizeTimestamp(v: unknown, fallbackMs: number): number {
  const n = num(v);
  if (n === null || n <= 0) return fallbackMs;
  return n < MS_THRESHOLD ? n * 1000 : n;
}

/**
 * แปลง payload ทั้งก้อนเป็น event
 *
 * ไม่โยน error เมื่อเจอรูปแบบแปลก — เก็บไว้ใน unknown แทน
 * เพราะ webhook ที่ตอบ error จะถูก Meta ยิงซ้ำเรื่อยๆ และถ้าซ้ำมากพอ
 * Meta จะปิด subscription ของเราไปเลย
 */
export function parseWebhookPayload(
  body: unknown,
  nowMs: number,
): ParseResult {
  const events: InboxEvent[] = [];
  const unknown: UnknownEvent[] = [];

  if (typeof body !== "object" || body === null) return { events, unknown };
  const root = body as Record<string, unknown>;

  const object = str(root["object"]);
  const entries = Array.isArray(root["entry"]) ? root["entry"] : [];

  for (const rawEntry of entries) {
    if (typeof rawEntry !== "object" || rawEntry === null) continue;
    const entry = rawEntry as Record<string, unknown>;
    const pageId = str(entry["id"]) ?? "";
    if (pageId === "") continue;

    const entryTime = normalizeTimestamp(entry["time"], nowMs);
    const isInstagram = object === "instagram";
    const dmChannel: "messenger" | "instagram" = isInstagram
      ? "instagram"
      : "messenger";

    // ---- messaging (DM, postback, reaction) ----
    const messaging = Array.isArray(entry["messaging"])
      ? entry["messaging"]
      : [];
    for (const rawM of messaging) {
      if (typeof rawM !== "object" || rawM === null) continue;
      const m = rawM as Record<string, unknown>;
      const sender = (m["sender"] ?? {}) as Record<string, unknown>;
      const recipient = (m["recipient"] ?? {}) as Record<string, unknown>;
      const senderId = str(sender["id"]) ?? "";
      const recipientId = str(recipient["id"]) ?? "";
      const ts = normalizeTimestamp(m["timestamp"], entryTime);

      if (m["message"] !== undefined) {
        const msg = m["message"] as Record<string, unknown>;
        const mid = str(msg["mid"]);
        if (!mid) {
          unknown.push({ pageId, field: "messages(no mid)", raw: m });
          continue;
        }
        const attachments: Array<{ type: string; url?: string }> = [];
        if (Array.isArray(msg["attachments"])) {
          for (const a of msg["attachments"]) {
            if (typeof a !== "object" || a === null) continue;
            const att = a as Record<string, unknown>;
            const payload = (att["payload"] ?? {}) as Record<string, unknown>;
            const url = str(payload["url"]);
            attachments.push({
              type: str(att["type"]) ?? "unknown",
              ...(url !== undefined ? { url } : {}),
            });
          }
        }
        const quickReply = (msg["quick_reply"] ?? {}) as Record<string, unknown>;

        const isEcho = msg["is_echo"] === true;
        const ev: IncomingMessageEvent = {
          type: "message",
          pageId,
          channel: dmChannel,
          timestampMs: ts,
          mid,
          senderId,
          recipientId,
          // ตอน echo ผู้ส่งคือเพจ ลูกค้าอยู่ฝั่งผู้รับ — ถ้าใช้ senderId ตรงๆ
          // จะไปพักบอทในบทสนทนาปลอมที่เพจคุยกับตัวเอง ส่วนบทสนทนาจริงไม่ถูกพัก
          // แล้วบอทจะแทรกกลางที่คนกำลังคุยอยู่ (คือบั๊กที่สเปกข้อ 6.7 เตือนไว้)
          contactId: isEcho ? recipientId : senderId,
          attachments,
          isEcho,
        };
        const text = str(msg["text"]);
        if (text !== undefined) ev.text = text;
        const qr = str(quickReply["payload"]);
        if (qr !== undefined) ev.quickReplyPayload = qr;
        // app_id บอกว่าข้อความนี้ส่งมาจากแอปไหน — ถ้าไม่มีแปลว่าคนพิมพ์ในแอป FB
        if (msg["is_echo"] === true) {
          ev.isFromOtherApp = msg["app_id"] === undefined;
        }
        events.push(ev);
        continue;
      }

      if (m["postback"] !== undefined) {
        const pb = m["postback"] as Record<string, unknown>;
        const ev: PostbackEvent = {
          type: "postback",
          pageId,
          channel: dmChannel,
          timestampMs: ts,
          // postback ไม่มี mid เสมอไป ใช้ค่าประกอบเป็นคีย์กันซ้ำ
          mid: str(pb["mid"]) ?? `postback:${senderId}:${ts}`,
          senderId,
          payload: str(pb["payload"]) ?? "",
        };
        const title = str(pb["title"]);
        if (title !== undefined) ev.title = title;
        events.push(ev);
        continue;
      }

      if (m["reaction"] !== undefined) {
        const rc = m["reaction"] as Record<string, unknown>;
        const ev: ReactionEvent = {
          type: "reaction",
          pageId,
          channel: dmChannel,
          timestampMs: ts,
          senderId,
          targetMid: str(rc["mid"]) ?? "",
          action: str(rc["action"]) === "unreact" ? "unreact" : "react",
        };
        const emoji = str(rc["emoji"]);
        if (emoji !== undefined) ev.emoji = emoji;
        events.push(ev);
        continue;
      }

      unknown.push({ pageId, field: "messaging", raw: m });
    }

    // ---- changes (feed, ratings) ----
    const changes = Array.isArray(entry["changes"]) ? entry["changes"] : [];
    for (const rawC of changes) {
      if (typeof rawC !== "object" || rawC === null) continue;
      const c = rawC as Record<string, unknown>;
      const field = str(c["field"]) ?? "";
      const value = (c["value"] ?? {}) as Record<string, unknown>;

      if (field === "feed" && str(value["item"]) === "comment") {
        const commentId = str(value["comment_id"]);
        if (!commentId) {
          unknown.push({ pageId, field, raw: c });
          continue;
        }
        const from = (value["from"] ?? {}) as Record<string, unknown>;
        const fromId = str(from["id"]) ?? "";
        const verbRaw = str(value["verb"]);
        const ev: CommentEvent = {
          type: "comment",
          pageId,
          channel: "comment",
          timestampMs: normalizeTimestamp(value["created_time"], entryTime),
          commentId,
          authorId: fromId,
          message: str(value["message"]) ?? "",
          // คอมเมนต์ที่ id ผู้เขียน = id เพจ คือเพจเราเขียนเอง (สเปกข้อ 6.2)
          isFromPage: fromId === pageId,
          verb:
            verbRaw === "edited"
              ? "edit"
              : verbRaw === "remove" || verbRaw === "removed"
                ? "remove"
                : "add",
        };
        const postId = str(value["post_id"]);
        if (postId !== undefined) ev.postId = postId;
        const parent = str(value["parent_id"]);
        // parent_id เท่ากับ post_id แปลว่าเป็นคอมเมนต์ระดับบนสุด ไม่ใช่การตอบ
        if (parent !== undefined && parent !== postId) {
          ev.parentCommentId = parent;
        }
        const name = str(from["name"]);
        if (name !== undefined) ev.authorName = name;
        events.push(ev);
        continue;
      }

      if (field === "ratings") {
        const reviewer = (value["reviewer"] ?? {}) as Record<string, unknown>;
        const recommendation =
          str(value["recommendation_type"]) === "negative"
            ? "negative"
            : "positive";
        const verbRaw = str(value["verb"]);
        const ev: RatingEvent = {
          type: "rating",
          pageId,
          channel: "rating",
          timestampMs: normalizeTimestamp(value["created_time"], entryTime),
          ratingId:
            str(value["open_graph_story_id"]) ??
            `rating:${str(reviewer["id"]) ?? "?"}:${entryTime}`,
          reviewerId: str(reviewer["id"]) ?? "",
          recommendation,
          verb:
            verbRaw === "edit" || verbRaw === "edited"
              ? "edit"
              : verbRaw === "remove" || verbRaw === "removed"
                ? "remove"
                : "add",
        };
        const name = str(reviewer["name"]);
        if (name !== undefined) ev.reviewerName = name;
        const text = str(value["review_text"]);
        if (text !== undefined) ev.reviewText = text;
        events.push(ev);
        continue;
      }

      unknown.push({ pageId, field: field || "changes", raw: c });
    }
  }

  return { events, unknown };
}

/** คีย์สำหรับกัน webhook ซ้ำ (กฎข้อ 6) */
export function idempotencyKey(event: InboxEvent): string {
  switch (event.type) {
    case "message":
    case "postback":
      return `msg:${event.mid}`;
    case "reaction":
      return `reaction:${event.targetMid}:${event.senderId}:${event.action}`;
    case "comment":
      return `comment:${event.commentId}:${event.verb}`;
    case "rating":
      return `rating:${event.ratingId}:${event.verb}`;
  }
}
