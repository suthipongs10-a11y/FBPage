/**
 * Recycle Engine (M5)
 *
 * สเปก: "โพสต์ที่ engagement สูงสุด → เขียนใหม่แล้วโพสต์ซ้ำหลัง 60 วัน"
 *
 * ⚠️ จุดที่ต้องระวังที่สุดของโมดูลนี้:
 *
 * สเปกบอกให้ recycle หลัง **60 วัน** แต่ Duplicate Guard ของ M-B บล็อกเนื้อหา
 * ที่ซ้ำภายใน **90 วัน** ถ้าเขียนใหม่ไม่มากพอ ระบบจะบล็อกโพสต์ของตัวเอง
 * แล้วคนจะงงว่าทำไมกด recycle แล้วไม่ขึ้น
 *
 * ตัวนี้จึงต้อง **พิสูจน์ว่า hash เปลี่ยนจริง** ก่อนคืนผลลัพธ์ ไม่ใช่หวังว่า
 * LLM จะเขียนต่างพอ
 */
import { nullLogger, type Logger } from "@page-os/core";
import { contentHash, hashableFromPost } from "@page-os/publish";
import { normalizeText } from "@page-os/moderation";
import type { BrandBrief } from "./brand.js";
import { briefToPrompt } from "./brand.js";

/** รอกี่วันก่อนเอาโพสต์เดิมมาใช้ใหม่ (สเปกข้อ M5) */
export const RECYCLE_AFTER_DAYS = 60;
/** Duplicate Guard ของ M-B — เนื้อหาที่ซ้ำภายในช่วงนี้จะถูกบล็อก */
export const DUPLICATE_WINDOW_DAYS = 90;

export interface PastPost {
  postId: string;
  pageId: string;
  body: string;
  media?: Array<{ url: string }>;
  type?: string;
  publishedAtMs: number;
  /** engagement ที่ได้ */
  engagement: number;
  /** จำนวนคนที่เห็น — ใช้ normalize */
  reach?: number;
  /** เคยถูกเอามา recycle แล้วกี่ครั้ง */
  recycleCount?: number;
}

export interface RecycleCandidate extends PastPost {
  /** คะแนนที่ใช้จัดอันดับ */
  score: number;
  daysAgo: number;
  th: string;
}

export interface FindCandidatesArgs {
  posts: readonly PastPost[];
  nowMs: number;
  /** เอากี่โพสต์ */
  limit?: number;
  /** ไม่เอาโพสต์ที่ recycle ไปแล้วเกินกี่ครั้ง */
  maxRecycleCount?: number;
}

/**
 * หาโพสต์ที่ควรเอามาใช้ใหม่
 *
 * เลือกจาก engagement ต่อ reach ไม่ใช่ engagement ดิบ — ไม่งั้นโพสต์ที่ยิงแอด
 * จะครองอันดับตลอด ทั้งที่คอนเทนต์อาจไม่ได้ดีเป็นพิเศษ
 */
export function findRecycleCandidates(
  args: FindCandidatesArgs,
): RecycleCandidate[] {
  const limit = args.limit ?? 5;
  const maxRecycle = args.maxRecycleCount ?? 2;
  const cutoff = args.nowMs - RECYCLE_AFTER_DAYS * 86_400_000;

  return args.posts
    .filter((p) => {
      // ยังไม่ถึง 60 วัน — เอามาใช้เร็วไปคนที่ตามเพจจะจำได้
      if (p.publishedAtMs > cutoff) return false;
      if ((p.recycleCount ?? 0) >= maxRecycle) return false;
      if (p.engagement <= 0) return false;
      return true;
    })
    .map((p) => {
      const rate = p.reach && p.reach > 0 ? p.engagement / p.reach : p.engagement;
      const daysAgo = Math.floor((args.nowMs - p.publishedAtMs) / 86_400_000);
      return {
        ...p,
        score: rate,
        daysAgo,
        th: `โพสต์เมื่อ ${daysAgo} วันก่อน ได้ ${p.engagement.toLocaleString("th-TH")} engagement`,
      };
    })
    .sort((a, b) => b.score - a.score || b.engagement - a.engagement)
    .slice(0, limit);
}

export interface RewriteLlm {
  rewrite(args: {
    brief: string;
    original: string;
    /** บอกว่าทำไมต้องเขียนใหม่ ให้โมเดลรู้ว่าต้องต่างจากเดิมจริงๆ */
    instruction: string;
  }): Promise<{ body: string; hashtags?: string[] }>;
}

export interface RecycleResult {
  ok: boolean;
  /** เนื้อหาใหม่ */
  body?: string;
  hashtags?: string[];
  /** hash ใหม่ที่จะถูกเก็บ */
  contentHash?: string;
  originalPostId: string;
  /** ต่างจากเดิมกี่ % */
  differenceRatio: number;
  th: string;
}

/** ต้องต่างจากเดิมอย่างน้อยเท่านี้ถึงจะถือว่า "เขียนใหม่" จริง */
export const MIN_DIFFERENCE_RATIO = 0.4;

/** จำนวนครั้งที่ยอมให้ลองใหม่ถ้า LLM เขียนออกมาเหมือนเดิมเกินไป */
const MAX_REWRITE_ATTEMPTS = 3;

/**
 * เขียนโพสต์เดิมใหม่ให้ผ่าน Duplicate Guard
 *
 * ตรวจสองชั้น:
 *   1. hash ต้องไม่ตรงกับของเดิม (ถ้าตรง จะโดนบล็อกแน่นอน)
 *   2. ต้องต่างจากเดิมพอสมควร ไม่ใช่แค่สลับคำสองคำ
 *      (hash ต่างแต่คนอ่านรู้ว่าซ้ำ = แย่กว่าโดนบล็อกอีก)
 */
export async function rewriteForRecycle(args: {
  post: PastPost;
  brief: BrandBrief;
  llm: RewriteLlm;
  logger?: Logger;
}): Promise<RecycleResult> {
  const logger = args.logger ?? nullLogger;
  const originalHash = contentHash(
    hashableFromPost({
      type: args.post.type ?? "text",
      body: args.post.body,
      ...(args.post.media !== undefined ? { media: args.post.media } : {}),
    }),
  );

  let best: { body: string; hashtags?: string[]; diff: number } | null = null;

  for (let attempt = 1; attempt <= MAX_REWRITE_ATTEMPTS; attempt++) {
    const instruction =
      attempt === 1
        ? "เขียนโพสต์นี้ใหม่ให้สื่อสารเรื่องเดียวกัน แต่ใช้มุมมอง โครงประโยค และคำเปิดที่ต่างจากเดิมทั้งหมด ห้ามลอกประโยคเดิมมาใช้ซ้ำ"
        : `เขียนใหม่อีกครั้ง — ครั้งก่อนยังเหมือนของเดิมมากเกินไป (ต่างแค่ ${Math.round((best?.diff ?? 0) * 100)}%) คราวนี้ให้เปลี่ยนมุมเล่าไปเลย เช่น จากบอกเล่าเป็นตั้งคำถาม หรือจากมุมร้านเป็นมุมลูกค้า`;

    let result: { body: string; hashtags?: string[] };
    try {
      result = await args.llm.rewrite({
        brief: briefToPrompt(args.brief),
        original: args.post.body,
        instruction,
      });
    } catch (err) {
      logger.error("เขียนโพสต์ใหม่ไม่สำเร็จ", {
        postId: args.post.postId,
        attempt,
        err,
      });
      return {
        ok: false,
        originalPostId: args.post.postId,
        differenceRatio: 0,
        th: "เรียก AI เขียนใหม่ไม่สำเร็จ — ลองอีกครั้งภายหลัง",
      };
    }

    const body = result.body.trim();
    if (body === "") continue;

    const diff = differenceRatio(args.post.body, body);
    const newHash = contentHash(
      hashableFromPost({
        type: args.post.type ?? "text",
        body,
        ...(args.post.media !== undefined ? { media: args.post.media } : {}),
      }),
    );

    if (newHash !== originalHash && diff >= MIN_DIFFERENCE_RATIO) {
      return {
        ok: true,
        body,
        ...(result.hashtags !== undefined ? { hashtags: result.hashtags } : {}),
        contentHash: newHash,
        originalPostId: args.post.postId,
        differenceRatio: diff,
        th: `เขียนใหม่สำเร็จ ต่างจากเดิม ${Math.round(diff * 100)}% — ผ่าน Duplicate Guard แน่นอน`,
      };
    }

    if (!best || diff > best.diff) {
      best = {
        body,
        ...(result.hashtags !== undefined ? { hashtags: result.hashtags } : {}),
        diff,
      };
    }
    logger.info("เนื้อหาที่เขียนใหม่ยังเหมือนเดิมเกินไป ลองอีกครั้ง", {
      postId: args.post.postId,
      attempt,
      diff,
    });
  }

  return {
    ok: false,
    ...(best ? { body: best.body } : {}),
    originalPostId: args.post.postId,
    differenceRatio: best?.diff ?? 0,
    th: `เขียนใหม่แล้วยังเหมือนของเดิมเกินไป (ต่างแค่ ${Math.round((best?.diff ?? 0) * 100)}% ต้องการอย่างน้อย ${Math.round(MIN_DIFFERENCE_RATIO * 100)}%) — Duplicate Guard จะบล็อก กรุณาแก้เองหรือเลือกโพสต์อื่น`,
  };
}

/**
 * วัดว่าข้อความสองอันต่างกันแค่ไหน (0 = เหมือนเป๊ะ, 1 = ต่างสิ้นเชิง)
 *
 * ใช้ n-gram เพราะภาษาไทยไม่เว้นวรรคระหว่างคำ การเทียบทีละคำทำไม่ได้
 */
export function differenceRatio(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === "" && nb === "") return 0;
  if (na === "" || nb === "") return 1;
  if (na === nb) return 0;

  const grams = (s: string, n = 4): Set<string> => {
    const out = new Set<string>();
    for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
    // ข้อความสั้นกว่า n ตัว ให้ใช้ทั้งก้อน
    if (out.size === 0) out.add(s);
    return out;
  };

  const ga = grams(na);
  const gb = grams(nb);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;

  // Jaccard: ยิ่งซ้อนทับกันน้อย ยิ่งต่างกันมาก
  const union = ga.size + gb.size - shared;
  return union === 0 ? 0 : 1 - shared / union;
}

/**
 * วันที่ปลอดภัยที่สุดที่จะโพสต์ซ้ำ
 *
 * ถ้าเขียนใหม่ไม่ผ่านเกณฑ์ ต้องรอให้พ้น 90 วันไปเลย
 * ไม่งั้นโดน Duplicate Guard บล็อก
 */
export function safeRepostDate(
  originalPublishedAtMs: number,
  rewritten: boolean,
): { atMs: number; th: string } {
  if (rewritten) {
    const at = originalPublishedAtMs + RECYCLE_AFTER_DAYS * 86_400_000;
    return {
      atMs: at,
      th: `โพสต์ซ้ำได้ตั้งแต่ ${RECYCLE_AFTER_DAYS} วันหลังโพสต์เดิม เพราะเขียนใหม่แล้ว`,
    };
  }
  const at = originalPublishedAtMs + DUPLICATE_WINDOW_DAYS * 86_400_000;
  return {
    atMs: at,
    th: `ยังไม่ได้เขียนใหม่ ต้องรอพ้น ${DUPLICATE_WINDOW_DAYS} วันจากโพสต์เดิม ไม่งั้นระบบกันโพสต์ซ้ำจะบล็อก`,
  };
}
