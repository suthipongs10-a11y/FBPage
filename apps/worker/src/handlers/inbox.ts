/**
 * ตัวจัดการ event ที่ `apps/webhook` ส่งต่อมา
 *
 * ตรรกะทั้งหมดอยู่ใน `WebhookProcessor` แล้ว (กันซ้ำ → จัดการ echo →
 * อัปเดตหน้าต่าง 24 ชม. → ตัดสินว่าบอทควรตอบไหม) ที่นี่มีหน้าที่แค่แกะงาน
 * แล้วส่งเข้าไป
 *
 * ─── เรื่อง error ที่ต้องคิดให้ขาด ───
 *
 * `WebhookProcessor.processAll()` **กลืน error ของ event แต่ละใบ** โดยตั้งใจ
 * เพราะออกแบบไว้ให้รับหลาย event ต่อ request เดียว แล้วใบหนึ่งพังต้องไม่ทำให้
 * ใบที่เหลือไม่ได้ทำ
 *
 * แต่ตอนนี้เรามาจากคิว ซึ่ง **หนึ่งงาน = หนึ่ง event** เงื่อนไขเปลี่ยนไปหมด:
 * ถ้ายังกลืน error งานจะขึ้นว่า "สำเร็จ" ทั้งที่ข้อความลูกค้าหายไป และไม่มีใครรู้
 * ที่นี่จึงเรียก `processAll()` แล้ว **ตรวจผลลัพธ์เอง** ถ้าใบนี้ถูกข้ามเพราะ error
 * ให้โยนต่อเพื่อให้งานไปกองในรายการที่ล้มเหลว
 */
import type { WebhookProcessor } from "@page-os/inbox";
import { decodeWebhookEventJob } from "@page-os/queue";
import type { JobContext, JobHandler, JobOutcome } from "../router.js";

export const INBOX_EVENT_JOB = "inbox-event";

export interface InboxHandlerOptions {
  processor: WebhookProcessor;
  /**
   * ส่งคอมเมนต์ต่อเข้าคิว moderation
   *
   * ไม่ทำในงานเดียวกันเพราะการซ่อน/ลบ/ตอบคอมเมนต์คือการยิง Graph API
   * ซึ่งต้องผ่านคิวของตัวเอง (กฎข้อ 5) และมี rate limit คนละเลนกับ inbox
   */
  onComment?: (args: {
    commentId: string;
    pageId: string;
  }) => Promise<void>;
}

export function inboxHandler(opts: InboxHandlerOptions): JobHandler {
  return {
    name: INBOX_EVENT_JOB,
    async run(data: unknown, ctx: JobContext): Promise<JobOutcome> {
      const job = decodeWebhookEventJob(data);
      const log = ctx.logger.child({
        page_id: job.event.pageId,
        deliveryId: job.deliveryId,
        key: job.key,
      });

      const [result] = await opts.processor.processAll([job.event]);
      if (result === undefined) {
        // เป็นไปไม่ได้ตามสัญญาของ processAll แต่ถ้าเกิดขึ้นจริงต้องดัง
        throw new Error(
          `ประมวลผล event "${job.key}" แล้วไม่ได้ผลลัพธ์กลับมา — ` +
            `สัญญาของ WebhookProcessor เปลี่ยนไปหรือเปล่า`,
        );
      }

      // ดูเหตุผลในหัวไฟล์ว่าทำไมต้องยกระดับ error ที่ถูกกลืนไว้
      if (result.skipped === "error") {
        throw new Error(
          `ประมวลผล event "${job.key}" ไม่สำเร็จ — ${result.th}`,
        );
      }

      if (job.event.type === "comment" && opts.onComment !== undefined) {
        await opts.onComment({
          commentId: job.event.commentId,
          pageId: job.event.pageId,
        });
      }

      log.info("ประมวลผล event แล้ว", { th: result.th });
      return {
        th: result.th,
        details: {
          type: result.type,
          ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
          ...(result.botShouldRespond !== undefined
            ? { botShouldRespond: result.botShouldRespond }
            : {}),
        },
      };
    },
  };
}
