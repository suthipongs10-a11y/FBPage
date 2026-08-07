/**
 * CommentProcessor — จัดการคอมเมนต์ที่เข้ามา 1 อัน ตั้งแต่ต้นจนจบ (M3)
 *
 * ลำดับสำคัญ:
 *   1. กัน webhook ซ้ำด้วย commentId (กฎข้อ 6)
 *   2. ข้ามคอมเมนต์ของเพจเราเอง (กัน echo loop — สเปกข้อ 6.2)
 *   3. เช็ค blocklist
 *   4. ประเมินกฎ
 *   5. ลงมือ โดยกัน private reply ซ้ำ/เกิน 7 วัน
 *
 * ทุกขั้นต้องไม่ทำให้คอมเมนต์อื่นค้าง — action หนึ่งพังต้องทำ action ที่เหลือต่อ
 */
import { nullLogger, systemClock, type Clock, type Logger } from "@page-os/core";
import { MetaApiError } from "@page-os/meta";
import { CommentActions, PRIVATE_REPLY_WINDOW_MS } from "./actions.js";
import { evaluateRules, type RuleContext } from "./rules.js";
import { shouldAlert } from "./sentiment.js";
import type {
  AutomationRule,
  IncomingComment,
  ModerationDecision,
  PlannedAction,
  TemplateVars,
} from "./types.js";

export interface CommentStore {
  /** เคยประมวลผลคอมเมนต์นี้แล้วหรือยัง (idempotency — กฎข้อ 6) */
  hasProcessed(commentId: string): Promise<boolean>;
  markProcessed(args: {
    commentId: string;
    pageId: string;
    sentiment: string;
    actionsTaken: string[];
    atMs: number;
  }): Promise<void>;
  /** เคยทัก private reply คอมเมนต์นี้ไปแล้วหรือยัง */
  hasPrivateReplied(commentId: string): Promise<boolean>;
  markPrivateReplied(commentId: string, atMs: number): Promise<void>;
  /** ผู้ใช้คนนี้อยู่ใน blocklist ของเพจไหม */
  isBlocked(pageId: string, userId: string): Promise<boolean>;
}

export interface ModerationAlertSink {
  send(alert: {
    severity: "warn" | "critical";
    pageId: string;
    commentId: string;
    authorName?: string;
    message: string;
    reason: string;
    /** ลิงก์ deep link เข้าคอมเมนต์ */
    permalink?: string;
  }): Promise<void>;
}

export const noopModerationAlerts: ModerationAlertSink = {
  send: async () => {},
};

export interface CommentProcessorOptions {
  actions: CommentActions;
  store: CommentStore;
  alerts?: ModerationAlertSink;
  clock?: Clock;
  logger?: Logger;
}

export interface ProcessResult extends ModerationDecision {
  /** action ที่ทำสำเร็จจริง */
  executed: string[];
  /** action ที่พัง พร้อมเหตุผลไทย */
  failed: Array<{ kind: string; th: string }>;
}

export class CommentProcessor {
  private readonly actions: CommentActions;
  private readonly store: CommentStore;
  private readonly alerts: ModerationAlertSink;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(opts: CommentProcessorOptions) {
    this.actions = opts.actions;
    this.store = opts.store;
    this.alerts = opts.alerts ?? noopModerationAlerts;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
  }

  async process(args: {
    comment: IncomingComment;
    rules: readonly AutomationRule[];
    vars?: TemplateVars;
    customProfanity?: string[];
    customBuyingIntent?: string[];
    customComplaint?: string[];
    permalink?: string;
  }): Promise<ProcessResult> {
    const { comment } = args;
    const log = this.logger.child({
      page_id: comment.pageId,
      commentId: comment.commentId,
    });

    const skip = (reason: string, th: string): ProcessResult => ({
      commentId: comment.commentId,
      pageId: comment.pageId,
      actions: [],
      sentiment: "neutral",
      skippedReason: reason,
      th,
      executed: [],
      failed: [],
    });

    // 1. กัน echo loop — คอมเมนต์ที่เพจเราเขียนเองจะเด้งกลับมาเป็น webhook ด้วย
    if (comment.isFromPage) {
      return skip("from_page", "คอมเมนต์นี้เพจเราเขียนเอง — ข้ามเพื่อกันวนลูป");
    }

    // 2. กัน webhook ซ้ำ (Meta ส่งซ้ำได้)
    if (await this.store.hasProcessed(comment.commentId)) {
      return skip(
        "already_processed",
        "คอมเมนต์นี้ประมวลผลไปแล้ว — ข้ามเพื่อไม่ให้ทำงานซ้ำ",
      );
    }

    // 3. blocklist
    if (await this.store.isBlocked(comment.pageId, comment.authorId)) {
      await this.safely("hide", () =>
        this.actions.hide(comment.pageId, comment.commentId),
      );
      await this.store.markProcessed({
        commentId: comment.commentId,
        pageId: comment.pageId,
        sentiment: "neutral",
        actionsTaken: ["hide"],
        atMs: this.clock.now(),
      });
      return {
        ...skip("blocked_user", "ผู้ใช้อยู่ใน blocklist — ซ่อนคอมเมนต์ทันที"),
        executed: ["hide"],
      };
    }

    // 4. ประเมินกฎ
    const ctx: RuleContext = { comment };
    if (args.vars !== undefined) ctx.vars = args.vars;
    if (args.customProfanity !== undefined)
      ctx.customProfanity = args.customProfanity;
    if (args.customBuyingIntent !== undefined)
      ctx.customBuyingIntent = args.customBuyingIntent;
    if (args.customComplaint !== undefined)
      ctx.customComplaint = args.customComplaint;

    const evaluation = evaluateRules(args.rules, ctx);

    // 5. ลงมือ
    const executed: string[] = [];
    const failed: Array<{ kind: string; th: string }> = [];

    for (const action of evaluation.actions) {
      const outcome = await this.execute(action, comment, args.permalink);
      if (outcome.ok) executed.push(action.kind);
      else if (outcome.th) failed.push({ kind: action.kind, th: outcome.th });
    }

    await this.store.markProcessed({
      commentId: comment.commentId,
      pageId: comment.pageId,
      sentiment: evaluation.sentiment.sentiment,
      actionsTaken: executed,
      atMs: this.clock.now(),
    });

    if (failed.length > 0) {
      log.warn("บาง action ทำไม่สำเร็จ", { failed });
    }

    return {
      commentId: comment.commentId,
      pageId: comment.pageId,
      actions: evaluation.actions,
      sentiment: evaluation.sentiment.sentiment,
      executed,
      failed,
      th:
        executed.length > 0
          ? `ทำแล้ว: ${executed.join(", ")}`
          : "ไม่มีกฎไหนเข้าเงื่อนไข — ปล่อยคอมเมนต์ไว้ตามเดิม",
    };
  }

  private async execute(
    action: PlannedAction,
    comment: IncomingComment,
    permalink?: string,
  ): Promise<{ ok: boolean; th?: string }> {
    switch (action.kind) {
      case "hide":
        return this.safely("hide", () =>
          this.actions.hide(comment.pageId, comment.commentId),
        );

      case "unhide":
        return this.safely("unhide", () =>
          this.actions.unhide(comment.pageId, comment.commentId),
        );

      case "delete":
        return this.safely("delete", () =>
          this.actions.remove(comment.pageId, comment.commentId),
        );

      case "like":
        return this.safely("like", () =>
          this.actions.like(comment.pageId, comment.commentId),
        );

      case "reply": {
        if (!action.message) {
          return { ok: false, th: "กฎสั่งให้ตอบกลับ แต่ไม่ได้ตั้งข้อความไว้" };
        }
        return this.safely("reply", () =>
          this.actions.reply(
            comment.pageId,
            comment.commentId,
            action.message!,
          ),
        );
      }

      case "private_reply":
        return this.privateReply(action, comment);

      case "alert":
        return this.sendAlert(action, comment, permalink);

      case "flag":
        // ปักธงคือการไม่ทำอะไรกับคอมเมนต์ แต่บันทึกไว้ให้คนดู
        return { ok: true };
    }
  }

  /**
   * Private Reply มีข้อจำกัดสองชั้นที่ต้องกันเองทั้งคู่
   * (Meta จะตอบ error ถ้าผิด แต่การยิงไปแล้วโดนปฏิเสธก็เปลืองโควตาและทำให้ log รก)
   */
  private async privateReply(
    action: PlannedAction,
    comment: IncomingComment,
  ): Promise<{ ok: boolean; th?: string }> {
    if (!action.message) {
      return { ok: false, th: "กฎสั่งให้ทักเข้า inbox แต่ไม่ได้ตั้งข้อความไว้" };
    }

    const ageMs = this.clock.now() - comment.createdAtMs;
    if (ageMs > PRIVATE_REPLY_WINDOW_MS) {
      return {
        ok: false,
        th: `คอมเมนต์เก่าเกิน 7 วัน (${Math.floor(ageMs / 86_400_000)} วัน) — Meta ไม่ให้ทักเข้า inbox แล้ว`,
      };
    }

    if (await this.store.hasPrivateReplied(comment.commentId)) {
      return {
        ok: false,
        th: "เคยทักเข้า inbox จากคอมเมนต์นี้แล้ว — Meta ให้ทำได้ครั้งเดียวต่อคอมเมนต์",
      };
    }

    const result = await this.safely("private_reply", () =>
      this.actions.privateReply(
        comment.pageId,
        comment.commentId,
        action.message!,
      ),
    );
    if (result.ok) {
      // บันทึกหลังยิงสำเร็จเท่านั้น ไม่งั้นยิงไม่ผ่านแล้วจะทักไม่ได้อีกเลย
      await this.store.markPrivateReplied(
        comment.commentId,
        this.clock.now(),
      );
    }
    return result;
  }

  private async sendAlert(
    action: PlannedAction,
    comment: IncomingComment,
    permalink?: string,
  ): Promise<{ ok: boolean; th?: string }> {
    try {
      await this.alerts.send({
        severity: action.confidence >= 0.8 ? "critical" : "warn",
        pageId: comment.pageId,
        commentId: comment.commentId,
        message: comment.message,
        reason: action.reason,
        ...(comment.authorName !== undefined
          ? { authorName: comment.authorName }
          : {}),
        ...(permalink !== undefined ? { permalink } : {}),
      });
      return { ok: true };
    } catch (err) {
      this.logger.error("ส่ง alert คอมเมนต์ไม่สำเร็จ", {
        page_id: comment.pageId,
        commentId: comment.commentId,
        err,
      });
      return { ok: false, th: "ส่งแจ้งเตือนไม่สำเร็จ" };
    }
  }

  /** ทำ action หนึ่งโดยไม่ให้ error ทำให้ action ที่เหลือไม่ได้ทำ */
  private async safely(
    kind: string,
    fn: () => Promise<unknown>,
  ): Promise<{ ok: boolean; th?: string }> {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      const th =
        err instanceof MetaApiError
          ? err.th
          : `ทำ ${kind} ไม่สำเร็จ: ${(err as Error)?.message ?? String(err)}`;
      this.logger.warn(`action ${kind} ไม่สำเร็จ`, { err });
      return { ok: false, th };
    }
  }
}

/** ควรยิง alert ไหม — export ต่อจาก sentiment เพื่อให้ที่เดียวจบ */
export { shouldAlert };
