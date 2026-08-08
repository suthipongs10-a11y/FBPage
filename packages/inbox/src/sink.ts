/**
 * ปลายทางที่ตัวรับ webhook โยนงานต่อให้ (กฎข้อ 5)
 *
 * ตัวรับ webhook **ห้ามทำงานจริงเอง** — ห้ามยิง Graph API ห้ามเรียกบอท
 * ห้ามเขียน DB ก้อนใหญ่ เพราะ Meta ให้เวลาตอบสั้นมาก ตอบช้าหรือตอบ error
 * บ่อยๆ มันจะยิงซ้ำทั้งชุดแล้วปิด subscription ของเราไปเลย
 *
 * หน้าที่ของ endpoint จึงมีแค่: ตรวจลายเซ็น → แปลงเป็น event → ส่งต่อ → ตอบ 200
 */
import type { InboxEvent } from "./events.js";

export interface QueuedWebhookEvent {
  /**
   * คีย์กันซ้ำจาก `idempotencyKey()` (กฎข้อ 6)
   * ใช้เป็น jobId ของคิวด้วย — ได้การกันซ้ำอีกชั้นก่อนถึง DB
   */
  key: string;
  event: InboxEvent;
  /** เวลาที่ request มาถึงเรา ไม่ใช่เวลาใน event (Meta ส่งย้อนหลังได้) */
  receivedAtMs: number;
  /** id ที่เราออกเองต่อ 1 request — ใช้ไล่ log ว่า event ชุดนี้มาจาก request ไหน */
  deliveryId: string;
}

export interface WebhookEventSink {
  /**
   * ส่งทั้งชุดต่อ
   *
   * **ต้องโยน error ถ้าเก็บไม่สำเร็จ** เพื่อให้ endpoint ตอบ 500 แล้ว Meta ยิงซ้ำ
   * การกลืน error ตรงนี้คือการทำแชทลูกค้าหายแบบเงียบๆ ซึ่งแย่กว่าการโดนยิงซ้ำมาก
   */
  enqueue(events: readonly QueuedWebhookEvent[]): Promise<void>;
  /** ใช้ตอบ /readyz — ไม่มีก็ถือว่าพร้อมเสมอ */
  ping?(): Promise<void>;
  close?(): Promise<void>;
}

/** ใช้ตอนเทสต์ และตอน `pnpm dev` ที่ยังไม่อยากยก Redis ขึ้น */
export class InMemoryWebhookEventSink implements WebhookEventSink {
  readonly delivered: QueuedWebhookEvent[] = [];
  /** ตั้งเป็น error เพื่อจำลองคิวล่ม */
  failWith: Error | null = null;

  async enqueue(events: readonly QueuedWebhookEvent[]): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    this.delivered.push(...events);
  }

  async ping(): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
  }
}
