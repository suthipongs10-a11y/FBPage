/**
 * รูปร่างของข้อมูลในงานแต่ละใบ + ตัวตรวจตอนหยิบออกมา
 *
 * ทำไมต้องตรวจ ทั้งที่ฝั่งที่ยัดเข้าไปก็เป็นโค้ดเราเอง:
 *
 * งานในคิว **ข้ามการ deploy** ตอนเราปล่อยเวอร์ชันใหม่ ในคิวยังมีงานที่ยัดไว้ด้วย
 * โค้ดเก่าค้างอยู่ ถ้ารูปร่างเปลี่ยนแล้วเราหยิบมาใช้ตรงๆ จะได้ error หน้าตาแบบ
 * `Cannot read properties of undefined` โผล่กลางตัวยิงโพสต์ ซึ่งไล่ยากมาก
 * ตรวจตั้งแต่ปากทางแล้วบอกเป็นภาษาไทยว่างานใบนี้รูปร่างผิดตรงไหน จะจบเร็วกว่ามาก
 *
 * `v` คือเวอร์ชันรูปร่าง — ขึ้นเลขเมื่อไหร่ที่เปลี่ยนแบบเข้ากันไม่ได้
 */
import type { CommentEvent, InboxEvent } from "@page-os/inbox";

export const JOB_SCHEMA_VERSION = 1;

export class JobPayloadError extends Error {
  override readonly name = "JobPayloadError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

interface Envelope {
  v: number;
}

function obj(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JobPayloadError(
      `${what} is not an object`,
      `ข้อมูลของงาน ${what} ไม่ใช่ออบเจ็กต์ — งานใบนี้ทำต่อไม่ได้`,
    );
  }
  return value as Record<string, unknown>;
}

function str(o: Record<string, unknown>, key: string, what: string): string {
  const v = o[key];
  if (typeof v !== "string" || v === "") {
    throw new JobPayloadError(
      `${what}.${key} must be a non-empty string`,
      `ข้อมูลของงาน ${what} ขาดฟิลด์ "${key}" (ต้องเป็นข้อความและห้ามว่าง)`,
    );
  }
  return v;
}

function int(o: Record<string, unknown>, key: string, what: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new JobPayloadError(
      `${what}.${key} must be a finite number`,
      `ข้อมูลของงาน ${what} ขาดฟิลด์ "${key}" (ต้องเป็นตัวเลข)`,
    );
  }
  return v;
}

function checkVersion(o: Record<string, unknown>, what: string): void {
  const v = o["v"];
  if (v !== JOB_SCHEMA_VERSION) {
    throw new JobPayloadError(
      `${what} schema version ${String(v)} != ${JOB_SCHEMA_VERSION}`,
      `งาน ${what} ใบนี้เป็นรูปแบบเวอร์ชัน ${String(v)} แต่โค้ดตอนนี้อ่านเวอร์ชัน ` +
        `${JOB_SCHEMA_VERSION} — เป็นงานค้างจากก่อน deploy ให้ล้างคิวหรือเขียนตัวแปลงเพิ่ม`,
    );
  }
}

// --------------------------------------------------------------- webhook event

export interface WebhookEventJob extends Envelope {
  /** คีย์กันซ้ำจาก `idempotencyKey()` (กฎข้อ 6) */
  key: string;
  event: InboxEvent;
  receivedAtMs: number;
  deliveryId: string;
}

export function encodeWebhookEventJob(
  args: Omit<WebhookEventJob, "v">,
): WebhookEventJob {
  return { v: JOB_SCHEMA_VERSION, ...args };
}

/**
 * ตรวจแค่ส่วนที่ระบบใช้ตัดสินใจ — ชนิด, เพจ, และคีย์กันซ้ำ
 *
 * ไม่ไล่ตรวจทุกฟิลด์ย่อยของ event เพราะออบเจ็กต์นี้ออกมาจาก
 * `parseWebhookPayload()` ซึ่งตรวจให้แล้วรอบหนึ่ง การเขียนตรวจซ้ำทั้งก้อน
 * คือการมีที่ให้ผิดสองที่ พอแก้ที่หนึ่งแล้วลืมอีกที่ก็เพี้ยน
 */
export function decodeWebhookEventJob(data: unknown): WebhookEventJob {
  const o = obj(data, "webhook-event");
  checkVersion(o, "webhook-event");
  const event = obj(o["event"], "webhook-event.event");
  str(event, "pageId", "webhook-event.event");
  const type = str(event, "type", "webhook-event.event");
  const known = ["message", "postback", "reaction", "comment", "rating"];
  if (!known.includes(type)) {
    throw new JobPayloadError(
      `unknown event type ${type}`,
      `งาน webhook-event เป็นชนิด "${type}" ที่ระบบไม่รู้จัก`,
    );
  }
  return {
    v: JOB_SCHEMA_VERSION,
    key: str(o, "key", "webhook-event"),
    event: event as unknown as InboxEvent,
    receivedAtMs: int(o, "receivedAtMs", "webhook-event"),
    deliveryId: str(o, "deliveryId", "webhook-event"),
  };
}

// -------------------------------------------------------------------- publish

export interface PublishJobPayload extends Envelope {
  postId: string;
  pageId: string;
  /** รอบที่เท่าไหร่ — ตัวตัดสิน retry อยู่ในโดเมน ไม่ใช่ของ BullMQ ดู publish-queue.ts */
  attempt: number;
}

export function encodePublishJob(args: {
  postId: string;
  pageId: string;
  attempt: number;
}): PublishJobPayload {
  return { v: JOB_SCHEMA_VERSION, ...args };
}

export function decodePublishJob(data: unknown): PublishJobPayload {
  const o = obj(data, "publish");
  checkVersion(o, "publish");
  const attempt = int(o, "attempt", "publish");
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new JobPayloadError(
      `publish.attempt must be >= 1`,
      `งาน publish มี attempt = ${attempt} ซึ่งต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`,
    );
  }
  return {
    v: JOB_SCHEMA_VERSION,
    postId: str(o, "postId", "publish"),
    pageId: str(o, "pageId", "publish"),
    attempt,
  };
}

// ----------------------------------------------------------------- moderation

export interface ModerationJobPayload extends Envelope {
  comment: CommentEvent;
  receivedAtMs: number;
}

export function encodeModerationJob(args: {
  comment: CommentEvent;
  receivedAtMs: number;
}): ModerationJobPayload {
  return { v: JOB_SCHEMA_VERSION, ...args };
}

export function decodeModerationJob(data: unknown): ModerationJobPayload {
  const o = obj(data, "moderation");
  checkVersion(o, "moderation");
  const comment = obj(o["comment"], "moderation.comment");
  str(comment, "commentId", "moderation.comment");
  str(comment, "pageId", "moderation.comment");
  return {
    v: JOB_SCHEMA_VERSION,
    comment: comment as unknown as CommentEvent,
    receivedAtMs: int(o, "receivedAtMs", "moderation"),
  };
}

// ------------------------------------------------------------------ analytics

export interface AnalyticsJobPayload extends Envelope {
  pageId: string;
  /** ดึงย้อนหลังถึงวันไหน (YYYY-MM-DD) — ไม่ใส่ = ต่อจากวันล่าสุดที่มีข้อมูล */
  fromDate?: string;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function encodeAnalyticsJob(args: {
  pageId: string;
  fromDate?: string;
}): AnalyticsJobPayload {
  return {
    v: JOB_SCHEMA_VERSION,
    pageId: args.pageId,
    ...(args.fromDate !== undefined ? { fromDate: args.fromDate } : {}),
  };
}

export function decodeAnalyticsJob(data: unknown): AnalyticsJobPayload {
  const o = obj(data, "analytics");
  checkVersion(o, "analytics");
  const from = o["fromDate"];
  if (from !== undefined && (typeof from !== "string" || !DATE_KEY_RE.test(from))) {
    throw new JobPayloadError(
      "analytics.fromDate must be YYYY-MM-DD",
      `งาน analytics มี fromDate = "${String(from)}" ซึ่งต้องอยู่ในรูป YYYY-MM-DD`,
    );
  }
  return {
    v: JOB_SCHEMA_VERSION,
    pageId: str(o, "pageId", "analytics"),
    ...(typeof from === "string" ? { fromDate: from } : {}),
  };
}

// ------------------------------------------------------ งานที่ไม่ต้องมีข้อมูล

/**
 * งานกวาดทั้งระบบที่มาจาก cron (เช็ค token ทุกเพจ / ตรวจปัญหา / sync)
 *
 * ไม่มีพารามิเตอร์โดยตั้งใจ — งาน cron ใช้ "template" ใบเดียวสร้างงานทุกรอบ
 * ข้อมูลข้างในจึงถูกแช่แข็งไว้ตั้งแต่ตอนตั้งตาราง ถ้าใส่เวลาลงไป มันจะเป็นเวลาเดิม
 * ทุกรอบไปตลอดกาล ซึ่งหลอกคนอ่าน log ได้เนียนมาก
 * ตัวจัดการงานให้อ่านเวลาจาก Clock ของตัวเองแทน
 */
export interface SweepJobPayload extends Envelope {
  kind: "sweep";
}

export function encodeSweepJob(): SweepJobPayload {
  return { v: JOB_SCHEMA_VERSION, kind: "sweep" };
}

export function decodeSweepJob(data: unknown): SweepJobPayload {
  const o = obj(data, "sweep");
  checkVersion(o, "sweep");
  return { v: JOB_SCHEMA_VERSION, kind: "sweep" };
}
