/**
 * Chatbot Engine 3 ชั้น (M2) — จุดขายหลักของบริการ
 *
 *   ข้อความเข้า
 *     ↓
 *   [ชั้น 1] Keyword / Regex Rules   ← เร็ว ฟรี แม่นยำ 100%
 *     ↓ ไม่แมตช์
 *   [ชั้น 2] RAG + LLM (ไทย)         ← ค้น FAQ ของเพจนั้น แล้วให้ LLM เรียบเรียง
 *     ↓ confidence ต่ำ
 *   [ชั้น 3] Escalate to Human       ← ส่ง LINE + ตอบ "รอสักครู่นะคะ"
 *
 * "อย่าใช้ LLM ตอบทุกข้อความ เปลืองและคุมไม่ได้" — สเปกข้อ M2
 *
 * กฎที่บังคับในไฟล์นี้:
 *   - บอทตอบได้เฉพาะในหน้าต่าง 24 ชม. และห้ามใช้ HUMAN_AGENT (กฎข้อ 7)
 *   - ตอบจากข้อมูลจริงเท่านั้น ไม่มีข้อมูลให้ยอมบอกว่าไม่รู้
 *   - ประกาศว่าเป็นบอทในข้อความแรก
 */
import { nullLogger, type Logger } from "@page-os/core";
import { decideSend, HOLDING_REPLY_TH } from "@page-os/inbox";
import { normalizeText } from "@page-os/moderation";
import {
  buildContext,
  retrieve,
  type Embedder,
} from "./knowledge.js";
import { applyTone, botDisclosure, checkBannedWords } from "./tone.js";
import type {
  AnswerLayer,
  BotContext,
  BotReply,
  KnowledgeChunk,
  PageBotConfig,
  RetrievedChunk,
} from "./types.js";

/** กฎชั้นที่ 1 */
export interface KeywordRule {
  id: string;
  pageId: string;
  /** คำที่ต้องเจอ (เจอตัวใดตัวหนึ่งก็ถือว่าแมตช์) */
  keywords?: string[];
  /** หรือใช้ regex */
  pattern?: string;
  /** ข้อความตอบ — รองรับตัวแปรของ tone */
  reply: string;
  quickReplies?: Array<{ title: string; payload: string }>;
  priority: number;
  isActive: boolean;
}

/** ผู้ให้บริการ LLM — inject เข้ามาเพื่อสลับ Gemini/Qwen ได้ตามสเปกข้อ 4 */
export interface LlmClient {
  complete(args: {
    systemPrompt: string;
    userMessage: string;
    context: string;
    history?: Array<{ role: "customer" | "bot" | "human"; text: string }>;
  }): Promise<{
    text: string;
    /** โมเดลบอกเองว่ามั่นใจแค่ไหน (ถ้ารองรับ) */
    confidence?: number;
  }>;
}

/** คำที่แปลว่าลูกค้าอยากคุยกับคน — ต้องข้ามบอทไปเลย */
const ASK_FOR_HUMAN = [
  "ขอคุยกับแอดมิน",
  "คุยกับแอดมิน",
  "ขอคุยกับคน",
  "แอดมินอยู่ไหม",
  "เรียกแอดมิน",
  "ขอเจ้าหน้าที่",
  "ติดต่อเจ้าหน้าที่",
  "ไม่อยากคุยกับบอท",
  "บอทตอบไม่ตรง",
];

export interface BotEngineOptions {
  config: PageBotConfig;
  rules: readonly KeywordRule[];
  chunks: readonly KnowledgeChunk[];
  llm?: LlmClient;
  embedder?: Embedder;
  logger?: Logger;
}

export interface AnswerResult {
  reply: BotReply | null;
  /** ต้องส่งข้อความประกาศว่าเป็นบอทก่อนไหม */
  disclosure?: string;
  /** ส่งไม่ได้เพราะอะไร (นอกหน้าต่าง 24 ชม. ฯลฯ) */
  blocked?: string;
}

export class BotEngine {
  private readonly config: PageBotConfig;
  private readonly rules: readonly KeywordRule[];
  private readonly chunks: readonly KnowledgeChunk[];
  private readonly llm: LlmClient | undefined;
  private readonly embedder: Embedder | undefined;
  private readonly logger: Logger;

  constructor(opts: BotEngineOptions) {
    this.config = opts.config;
    this.rules = opts.rules;
    this.chunks = opts.chunks;
    this.llm = opts.llm;
    this.embedder = opts.embedder;
    this.logger = opts.logger ?? nullLogger;
  }

  /**
   * ตอบข้อความหนึ่งข้อความ
   *
   * @param lastCustomerMessageAtMs ใช้เช็คหน้าต่าง 24 ชม.
   */
  async answer(
    ctx: BotContext,
    lastCustomerMessageAtMs: number | null,
  ): Promise<AnswerResult> {
    // ---- เช็คก่อนว่าส่งได้ไหม (บอทห้ามใช้ HUMAN_AGENT — กฎข้อ 7) ----
    const send = decideSend({
      lastCustomerMessageAtMs,
      nowMs: ctx.nowMs,
      sentBy: "bot",
    });
    if (!send.allowed) {
      return { reply: null, blocked: send.th };
    }

    const disclosure = ctx.disclosureSent
      ? undefined
      : botDisclosure(this.config);

    // ---- ลูกค้าขอคุยกับคน → ข้ามทุกชั้น ----
    if (this.asksForHuman(ctx.message)) {
      return {
        ...(disclosure !== undefined ? { disclosure } : {}),
        reply: this.escalateReply(
          "ลูกค้าขอคุยกับเจ้าหน้าที่โดยตรง",
        ),
      };
    }

    // ---- ชั้น 1: keyword / regex ----
    const ruleReply = this.matchRules(ctx.message);
    if (ruleReply) {
      const safe = this.guard(ruleReply);
      return {
        ...(disclosure !== undefined ? { disclosure } : {}),
        reply: safe,
      };
    }

    // ---- ชั้น 2: RAG + LLM ----
    if (this.llm) {
      const ragReply = await this.answerWithRag(ctx);
      if (ragReply && ragReply.confidence >= this.config.minConfidence) {
        const safe = this.guard(ragReply);
        return {
          ...(disclosure !== undefined ? { disclosure } : {}),
          reply: safe,
        };
      }
      this.logger.info("ชั้น RAG มั่นใจไม่พอ ส่งต่อให้คน", {
        page_id: ctx.pageId,
        confidence: ragReply?.confidence ?? 0,
      });
    }

    // ---- ชั้น 3: ส่งต่อให้คน ----
    return {
      ...(disclosure !== undefined ? { disclosure } : {}),
      reply: this.escalateReply("บอทไม่มีข้อมูลพอจะตอบคำถามนี้"),
    };
  }

  private asksForHuman(message: string): boolean {
    const n = normalizeText(message);
    return ASK_FOR_HUMAN.some((p) => n.includes(normalizeText(p)));
  }

  /** ชั้นที่ 1 — เร็ว ฟรี แม่นยำ 100% */
  matchRules(message: string): BotReply | null {
    const n = normalizeText(message);
    const active = [...this.rules]
      .filter((r) => r.isActive && r.pageId === this.config.pageId)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

    for (const rule of active) {
      let matched = false;

      if (rule.keywords && rule.keywords.length > 0) {
        matched = rule.keywords.some((k) => {
          const nk = normalizeText(k);
          return nk !== "" && n.includes(nk);
        });
      }
      if (!matched && rule.pattern) {
        try {
          matched = new RegExp(rule.pattern, "i").test(n);
        } catch {
          // กฎที่ลูกค้าตั้ง regex ผิด ต้องไม่ทำให้บอททั้งตัวพัง
          this.logger.warn("regex ของกฎบอทไม่ถูกต้อง ข้ามกฎนี้", {
            ruleId: rule.id,
          });
          matched = false;
        }
      }
      if (!matched) continue;

      const reply: BotReply = {
        layer: "rule",
        text: applyTone(rule.reply, this.config, {
          ชื่อลูกค้า: undefined,
        }),
        // กฎที่คนเขียนเองถือว่าแม่น 100% ตามสเปก
        confidence: 1,
        sources: [`rule:${rule.id}`],
        th: `ตอบจากกฎ "${rule.id}"`,
      };
      if (rule.quickReplies) reply.quickReplies = rule.quickReplies;
      return reply;
    }
    return null;
  }

  /** ชั้นที่ 2 — ค้นข้อมูลของเพจแล้วให้ LLM เรียบเรียง */
  private async answerWithRag(ctx: BotContext): Promise<BotReply | null> {
    if (!this.llm) return null;

    let queryEmbedding: number[] | undefined;
    if (this.embedder) {
      try {
        const [vec] = await this.embedder.embed([ctx.message]);
        if (vec) queryEmbedding = vec;
      } catch (err) {
        // embed ไม่ได้ก็ยังค้นด้วยการจับคำได้ ไม่ต้องล้มทั้งคำตอบ
        this.logger.warn("สร้าง embedding ของคำถามไม่สำเร็จ ใช้การจับคำแทน", {
          err,
        });
      }
    }

    const found = retrieve({
      query: ctx.message,
      ...(queryEmbedding !== undefined ? { queryEmbedding } : {}),
      chunks: this.chunks,
      pageId: ctx.pageId,
    });

    // ไม่มีข้อมูลเลย → อย่าเรียก LLM ให้เปลืองและเสี่ยงแต่งเรื่อง
    if (found.length === 0) {
      return {
        layer: "rag",
        text: "",
        confidence: 0,
        th: "ไม่พบข้อมูลที่เกี่ยวข้องใน Knowledge Base ของเพจนี้",
      };
    }

    const { buildSystemPrompt } = await import("./tone.js");
    let result: { text: string; confidence?: number };
    try {
      result = await this.llm.complete({
        systemPrompt: buildSystemPrompt(this.config),
        userMessage: ctx.message,
        context: buildContext(found),
        ...(ctx.history !== undefined ? { history: ctx.history } : {}),
      });
    } catch (err) {
      this.logger.error("เรียก LLM ไม่สำเร็จ", { page_id: ctx.pageId, err });
      return null;
    }

    const text = result.text.trim();
    if (text === "") return null;

    return {
      layer: "rag",
      text,
      // ถ้าโมเดลไม่บอกความมั่นใจ ใช้คะแนนความตรงของข้อมูลที่ค้นได้แทน
      confidence: result.confidence ?? retrievalConfidence(found),
      sources: found.map((c) => c.id),
      th: `ตอบจากข้อมูลในเพจ ${found.length} แหล่ง`,
    };
  }

  /** ชั้นที่ 3 */
  private escalateReply(reason: string): BotReply {
    return {
      layer: "escalated",
      text: applyTone(HOLDING_REPLY_TH, this.config),
      confidence: 1,
      escalate: true,
      th: reason,
    };
  }

  /**
   * ด่านสุดท้ายก่อนส่ง — ตรวจคำต้องห้ามของเพจ
   *
   * ต้องตรวจแม้คำตอบจะมาจากกฎที่คนเขียนเอง เพราะคนก็เผลอได้
   * และคำต้องห้ามส่วนใหญ่มีเหตุผลทางกฎหมาย
   */
  private guard(reply: BotReply): BotReply {
    const violation = checkBannedWords(reply.text, this.config);
    if (!violation) return reply;

    this.logger.warn("คำตอบของบอทมีคำต้องห้าม ไม่ส่งและเรียกคนแทน", {
      page_id: this.config.pageId,
      layer: reply.layer,
    });
    return this.escalateReply(violation.th);
  }
}

/**
 * แปลงคะแนนความตรงของข้อมูลเป็นความมั่นใจ
 *
 * ใช้คะแนนสูงสุด แต่ลดทอนถ้ามีแหล่งเดียว — คำตอบที่อ้างอิงหลายแหล่ง
 * ที่สอดคล้องกันน่าเชื่อกว่าแหล่งเดียวที่บังเอิญคำตรง
 */
export function retrievalConfidence(
  found: readonly RetrievedChunk[],
): number {
  if (found.length === 0) return 0;
  const top = found[0]!.score;
  const multiplier = found.length === 1 ? 0.85 : 1;
  return Math.min(1, top * multiplier);
}

/** ชั้นไหนตอบ — ใช้คำนวณ containment rate (M7) */
export function isContained(layer: AnswerLayer): boolean {
  return layer !== "escalated";
}
