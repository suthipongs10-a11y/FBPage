/**
 * PublishWorker — ตรรกะของงานโพสต์ 1 งาน (M4)
 *
 * แยกจาก BullMQ โดยตั้งใจ: ตรงนี้คือ "ตัดสินใจว่าจะทำอะไร" ซึ่งเป็นส่วนที่ผิดแล้ว
 * เจ็บที่สุด (โพสต์ซ้ำ/โพสต์ผิดเพจ) จึงต้องเทสต์ได้โดยไม่ต้องมี Redis
 * ส่วน BullMQ เป็นแค่ตัวจับเวลาและเรียก process() เท่านั้น
 */
import { nullLogger, systemClock, type Clock, type Logger } from "@page-os/core";
import { MetaApiError } from "@page-os/meta";
import {
  checkDuplicate,
  hashableFromPost,
  type PublishedPostLookup,
} from "./content-hash.js";
import { RETRY_SCHEDULE_MS, decideRetry } from "./retry-policy.js";
import { PublishError, type PostPublisher } from "./publisher.js";
import type {
  PostTarget,
  PublishJob,
  PublishOutcome,
  ScheduledPost,
} from "./types.js";

export interface PostRepository {
  findPost(postId: string): Promise<ScheduledPost | null>;
  findTarget(postId: string, pageId: string): Promise<PostTarget | null>;
  /**
   * จองเป้าหมายนี้ก่อนยิง — คืน false ถ้ามีคนจองไปแล้วหรือโพสต์ไปแล้ว
   *
   * จำเป็นเพราะการเช็ค fbPostId เฉยๆ มีช่องว่างระหว่าง "อ่าน" กับ "ยิง"
   * ถ้าคิวส่งงานเดียวกันให้ worker สองตัว (retry ซ้อน / worker restart)
   * ทั้งคู่จะเห็นว่ายังไม่มี fbPostId แล้วยิงพร้อมกัน = โพสต์ซ้ำในเพจลูกค้า
   *
   * ต้อง implement เป็น atomic update เช่น
   *   UPDATE post_targets SET status='publishing'
   *   WHERE post_id=? AND page_id=? AND status NOT IN ('published','publishing')
   */
  claimTarget(args: {
    postId: string;
    pageId: string;
    attempt: number;
  }): Promise<boolean>;
  /** คืนการจองเมื่อจะลองใหม่ทีหลัง */
  releaseTarget(args: { postId: string; pageId: string }): Promise<void>;
  /** บันทึกว่าเป้าหมายนี้โพสต์สำเร็จแล้ว */
  markTargetPublished(args: {
    postId: string;
    pageId: string;
    fbPostId: string;
    publishedAtMs: number;
  }): Promise<void>;
  markTargetFailed(args: {
    postId: string;
    pageId: string;
    error: string;
    attempts: number;
    /** true = เลิกลองแล้ว, false = ยังจะลองใหม่ */
    terminal: boolean;
  }): Promise<void>;
  /** เมื่อทุกเป้าหมายจบแล้ว อัปเดตสถานะโพสต์แม่ */
  refreshPostStatus(postId: string): Promise<void>;
}

export interface PublishAlertSink {
  send(alert: {
    severity: "warn" | "critical";
    title: string;
    body: string;
    pageId: string;
    postId: string;
  }): Promise<void>;
}

export const noopPublishAlerts: PublishAlertSink = { send: async () => {} };

export interface PublishWorkerOptions {
  repo: PostRepository;
  publisher: PostPublisher;
  duplicateLookup: PublishedPostLookup;
  alerts?: PublishAlertSink;
  clock?: Clock;
  logger?: Logger;
}

/**
 * ย้อนหลังแค่ไหนตอนเช็คว่า "โพสต์ขึ้นไปแล้วหรือยัง" ก่อน retry
 * เผื่อไว้กว้างกว่าช่วง retry ที่ยาวสุด (30 นาที) เล็กน้อย
 */
const ALREADY_PUBLISHED_LOOKBACK_MS = 45 * 60_000;

export class PublishWorker {
  private readonly repo: PostRepository;
  private readonly publisher: PostPublisher;
  private readonly duplicateLookup: PublishedPostLookup;
  private readonly alerts: PublishAlertSink;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(opts: PublishWorkerOptions) {
    this.repo = opts.repo;
    this.publisher = opts.publisher;
    this.duplicateLookup = opts.duplicateLookup;
    this.alerts = opts.alerts ?? noopPublishAlerts;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
  }

  async process(job: PublishJob): Promise<PublishOutcome> {
    const log = this.logger.child({
      page_id: job.pageId,
      postId: job.postId,
      attempt: job.attempt,
    });

    const post = await this.repo.findPost(job.postId);
    if (!post) {
      return {
        kind: "skipped",
        reason: "cancelled",
        th: "ไม่พบโพสต์นี้แล้ว (อาจถูกลบไป) — ข้ามงานนี้",
      };
    }
    if (post.status === "cancelled") {
      return {
        kind: "skipped",
        reason: "cancelled",
        th: "โพสต์ถูกยกเลิกไปแล้ว — ไม่ยิงขึ้นเพจ",
      };
    }

    // กันโพสต์ผิดเพจ (สเปกข้อ 6.4): เพจในงานต้องเป็นเป้าหมายของโพสต์นี้จริง
    const target = await this.repo.findTarget(job.postId, job.pageId);
    if (!target) {
      log.error("งานอ้างถึงเพจที่ไม่ใช่เป้าหมายของโพสต์นี้");
      return {
        kind: "skipped",
        reason: "no_target",
        th: "เพจนี้ไม่ได้อยู่ในรายการเป้าหมายของโพสต์ — ยกเลิกเพื่อกันโพสต์ผิดเพจ",
      };
    }

    // เคยโพสต์สำเร็จแล้ว — งานซ้ำจากคิว ไม่ต้องยิงอีก
    if (target.fbPostId) {
      return {
        kind: "skipped",
        reason: "already_published",
        th: "เป้าหมายนี้โพสต์สำเร็จไปแล้ว — ข้ามเพื่อกันโพสต์ซ้ำ",
      };
    }

    if (
      post.approvalStatus === "pending" ||
      post.approvalStatus === "changes_requested"
    ) {
      return {
        kind: "skipped",
        reason: "not_approved",
        th: "ลูกค้ายังไม่อนุมัติโพสต์นี้ — ไม่ยิงขึ้นเพจ",
      };
    }

    // จองก่อนทำอะไรที่มีผลข้างเคียง — กัน worker สองตัวยิงโพสต์เดียวกันพร้อมกัน
    const claimed = await this.repo.claimTarget({
      postId: job.postId,
      pageId: job.pageId,
      attempt: job.attempt,
    });
    if (!claimed) {
      log.warn("มี worker อื่นกำลังทำงานนี้อยู่แล้ว — ข้าม");
      return {
        kind: "skipped",
        reason: "in_progress",
        th: "งานนี้มีตัวอื่นกำลังทำอยู่แล้ว — ข้ามเพื่อกันโพสต์ซ้ำ",
      };
    }

    const body = target.overrideBody ?? post.content.body;

    // ก่อนลองใหม่ ต้องเช็คก่อนว่ารอบก่อนหน้าโพสต์ขึ้นไปแล้วหรือเปล่า
    // (ยิงสำเร็จแล้วเน็ตขาดตอนรับ response = ถ้า retry ตรงๆ ลูกค้าเห็นโพสต์ซ้ำ)
    if (job.attempt > 1) {
      const check = await this.publisher.findRecentPostByMessage({
        pageId: job.pageId,
        message: body,
        sinceMs: this.clock.now() - ALREADY_PUBLISHED_LOOKBACK_MS,
      });

      if (check.status === "found") {
        await this.repo.markTargetPublished({
          postId: job.postId,
          pageId: job.pageId,
          fbPostId: check.fbPostId,
          publishedAtMs: this.clock.now(),
        });
        await this.repo.refreshPostStatus(job.postId);
        log.warn("พบว่าโพสต์ขึ้นเพจไปแล้วตั้งแต่รอบก่อน — ไม่ยิงซ้ำ", {
          fbPostId: check.fbPostId,
        });
        return {
          kind: "skipped",
          reason: "already_published",
          th: "รอบก่อนหน้าโพสต์ขึ้นไปแล้ว (แค่ตอบกลับไม่ทัน) — ไม่ยิงซ้ำ",
        };
      }

      if (check.status === "unknown") {
        // ยังไม่รู้ว่าโพสต์ไปแล้วหรือยัง — เลื่อนไปลองใหม่ดีกว่าเสี่ยงโพสต์ซ้ำ
        // โพสต์ช้าไปหน่อยแก้ได้ แต่โพสต์ซ้ำในเพจลูกค้าลบทีหลังก็สายไปแล้ว
        return this.deferUnverifiable(job, check.th, log);
      }
      // check.status === "not_found" — ยิงต่อได้
    }

    // เช็คซ้ำ 90 วัน — ทำเฉพาะรอบแรก รอบ retry ไม่ต้องเช็คใหม่
    if (job.attempt === 1 && !post.allowDuplicate) {
      const dup = await checkDuplicate({
        pageId: job.pageId,
        content: hashableFromPost({ ...post.content, body }),
        nowMs: this.clock.now(),
        lookup: this.duplicateLookup,
      });
      if (dup.isDuplicate) {
        await this.repo.markTargetFailed({
          postId: job.postId,
          pageId: job.pageId,
          error: dup.th,
          attempts: job.attempt,
          terminal: true,
        });
        await this.repo.refreshPostStatus(job.postId);
        await this.notify("warn", "โพสต์ซ้ำ", dup.th, job);
        return { kind: "skipped", reason: "duplicate", th: dup.th };
      }
    }

    // ยิงจริง
    try {
      const fbPostId = await this.publisher.publish({
        pageId: job.pageId,
        content: post.content,
        body,
      });
      await this.repo.markTargetPublished({
        postId: job.postId,
        pageId: job.pageId,
        fbPostId,
        publishedAtMs: this.clock.now(),
      });
      await this.repo.refreshPostStatus(job.postId);
      log.info("โพสต์สำเร็จ", { fbPostId });
      return { kind: "published", fbPostId, th: "โพสต์ขึ้นเพจเรียบร้อย" };
    } catch (err) {
      return this.handleFailure(job, err, log);
    }
  }

  /**
   * เช็คไม่ได้ว่าโพสต์ขึ้นไปแล้วหรือยัง → เลื่อนไปรอบหน้า
   * ถ้าหมดรอบแล้วยังเช็คไม่ได้ ให้คนมาดูเอง ห้ามเดาแล้วยิง
   */
  private async deferUnverifiable(
    job: PublishJob,
    reason: string,
    log: Logger,
  ): Promise<PublishOutcome> {
    const delayMs = RETRY_SCHEDULE_MS[job.attempt - 1];
    if (delayMs === undefined) {
      const th = `${reason} — ลองครบทุกรอบแล้วยังยืนยันไม่ได้ กรุณาเปิดเพจเช็คด้วยตัวเองก่อนสั่งโพสต์ใหม่`;
      await this.repo.markTargetFailed({
        postId: job.postId,
        pageId: job.pageId,
        error: th,
        attempts: job.attempt,
        terminal: true,
      });
      await this.repo.refreshPostStatus(job.postId);
      await this.notify("critical", "ต้องเช็คด้วยตัวเอง", th, job);
      log.error("ยืนยันสถานะโพสต์ไม่ได้จนหมดรอบ");
      return { kind: "failed", th, needsAlert: true };
    }

    const th = `${reason} — เลื่อนไปลองใหม่ในอีก ${Math.round(delayMs / 60_000)} นาที เพื่อกันโพสต์ซ้ำ`;
    await this.repo.markTargetFailed({
      postId: job.postId,
      pageId: job.pageId,
      error: th,
      attempts: job.attempt,
      terminal: false,
    });
    // ต้องคืนการจอง ไม่งั้นรอบถัดไปจะจองไม่ได้แล้วค้างเป็น publishing ตลอดกาล
    await this.repo.releaseTarget({
      postId: job.postId,
      pageId: job.pageId,
    });
    log.warn("ยืนยันสถานะโพสต์ไม่ได้ เลื่อนไปรอบหน้า");
    return {
      kind: "retry",
      delayMs,
      nextAttempt: job.attempt + 1,
      th,
    };
  }

  private async handleFailure(
    job: PublishJob,
    err: unknown,
    log: Logger,
  ): Promise<PublishOutcome> {
    // ข้อมูลไม่ครบ/ผิดรูปแบบ — ลองใหม่ไปก็ผลเดิม
    if (err instanceof PublishError) {
      await this.repo.markTargetFailed({
        postId: job.postId,
        pageId: job.pageId,
        error: err.th,
        attempts: job.attempt,
        terminal: true,
      });
      await this.repo.refreshPostStatus(job.postId);
      await this.notify("critical", "โพสต์ไม่สำเร็จ", err.th, job);
      return { kind: "failed", th: err.th, needsAlert: true };
    }

    if (!(err instanceof MetaApiError)) {
      const th = `โพสต์ไม่สำเร็จด้วยข้อผิดพลาดที่ไม่คาดคิด: ${
        (err as Error)?.message ?? String(err)
      }`;
      await this.repo.markTargetFailed({
        postId: job.postId,
        pageId: job.pageId,
        error: th,
        attempts: job.attempt,
        terminal: true,
      });
      await this.repo.refreshPostStatus(job.postId);
      await this.notify("critical", "โพสต์ไม่สำเร็จ", th, job);
      log.error("โพสต์ล้มเหลวด้วย error ที่ไม่รู้จัก", { err });
      return { kind: "failed", th, needsAlert: true };
    }

    const decision = decideRetry({ attempt: job.attempt, error: err });

    if (decision.kind === "retry") {
      await this.repo.markTargetFailed({
        postId: job.postId,
        pageId: job.pageId,
        error: decision.th,
        attempts: job.attempt,
        terminal: false,
      });
      // คืนการจองก่อนรอบหน้า ไม่งั้น retry จะจองไม่ได้แล้วค้างเป็น publishing
      await this.repo.releaseTarget({
        postId: job.postId,
        pageId: job.pageId,
      });
      log.warn("โพสต์ไม่สำเร็จ จะลองใหม่", {
        delayMs: decision.delayMs,
        code: err.code,
      });
      return {
        kind: "retry",
        delayMs: decision.delayMs,
        nextAttempt: decision.attempt,
        th: decision.th,
      };
    }

    await this.repo.markTargetFailed({
      postId: job.postId,
      pageId: job.pageId,
      error: decision.th,
      attempts: job.attempt,
      terminal: true,
    });
    await this.repo.refreshPostStatus(job.postId);
    await this.notify("critical", "โพสต์ไม่สำเร็จ", decision.th, job);
    log.error("โพสต์ล้มเหลวถาวร", { code: err.code, action: err.action });
    return { kind: "failed", th: decision.th, needsAlert: true };
  }

  /** ส่ง alert แล้วต้องไม่ทำให้งานพัง — แจ้งเตือนไม่ได้ ไม่ควรกลายเป็นโพสต์ค้าง */
  private async notify(
    severity: "warn" | "critical",
    title: string,
    body: string,
    job: PublishJob,
  ): Promise<void> {
    try {
      await this.alerts.send({
        severity,
        title,
        body,
        pageId: job.pageId,
        postId: job.postId,
      });
    } catch (err) {
      this.logger.error("ส่ง alert เรื่องโพสต์ไม่สำเร็จ", {
        page_id: job.pageId,
        postId: job.postId,
        err,
      });
    }
  }
}
