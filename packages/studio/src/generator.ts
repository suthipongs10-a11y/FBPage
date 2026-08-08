/**
 * สร้างคอนเทนต์เป็นชุด (M5)
 *
 * สเปก: "ป้อนหัวข้อ 1 บรรทัด → ได้ 10 โพสต์พร้อมแคปชั่น + hashtag ไทย"
 *
 * หน้าที่ของไฟล์นี้คือ **ทำให้ผลลัพธ์จาก LLM ใช้ได้จริง** ไม่ใช่แค่เรียก LLM
 * ของที่ LLM คืนมามักมีปัญหาเดิมๆ: แท็กมีช่องว่าง, ใช้คำต้องห้าม,
 * เขียนซ้ำกันเองในชุดเดียว, ยาวเกินจนโดนตัดใน feed
 */
import { nullLogger, type Logger } from "@page-os/core";
import { normalizeText } from "@page-os/moderation";
import { briefToPrompt, type BrandBrief } from "./brand.js";
import { cleanHashtags, extractHashtags } from "./hashtags.js";
import type { PillarKey, PillarPlanEntry } from "./pillars.js";

/** Facebook ตัดข้อความใน feed ประมาณนี้ — ยาวกว่านี้คนต้องกด "ดูเพิ่มเติม" */
export const FEED_TRUNCATE_CHARS = 280;
/** ยาวเกินนี้ถือว่าไม่เหมาะกับโพสต์เพจ */
export const MAX_CAPTION_CHARS = 2000;

export interface GeneratedPost {
  /** เนื้อโพสต์ (ไม่มีแฮชแท็ก) */
  body: string;
  hashtags: string[];
  /** ข้อความเต็มพร้อมโพสต์ */
  caption: string;
  pillar: PillarKey;
  pillarLabelTh: string;
  /** แนวคิดสั้นๆ ว่าโพสต์นี้จะสื่ออะไร — ใช้แสดงในปฏิทิน */
  idea: string;
  /** ปัญหาที่เจอตอนตรวจ — ไม่บล็อก แต่ต้องให้คนเห็นก่อนอนุมัติ */
  warnings: string[];
}

export interface ContentLlm {
  generatePosts(args: {
    brief: string;
    topic: string;
    /** โพสต์ที่ต้องสร้าง พร้อมแนวของแต่ละโพสต์ */
    slots: Array<{ pillar: string; guidance: string }>;
  }): Promise<
    Array<{ idea: string; body: string; hashtags?: string[] }>
  >;
}

export interface GenerateOptions {
  brief: BrandBrief;
  topic: string;
  plan: readonly PillarPlanEntry[];
  llm: ContentLlm;
  /** แท็กประจำแบรนด์ที่ต้องมีทุกโพสต์ */
  brandTags?: string[];
  logger?: Logger;
}

export interface GenerateResult {
  posts: GeneratedPost[];
  /** โพสต์ที่ถูกตัดทิ้งเพราะซ้ำกับตัวอื่นในชุดเดียวกัน */
  droppedDuplicates: number;
  th: string;
}

/**
 * สร้างคอนเทนต์เป็นชุดตามแผนเสาหลัก
 *
 * ทุกโพสต์ผ่านด่านตรวจก่อนคืนออกไป — คำต้องห้าม แฮชแท็ก ความยาว
 * และความซ้ำกันเองภายในชุด
 */
export async function generateBatch(
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const logger = opts.logger ?? nullLogger;
  if (opts.plan.length === 0) {
    return { posts: [], droppedDuplicates: 0, th: "ไม่ได้ระบุจำนวนโพสต์" };
  }

  const raw = await opts.llm.generatePosts({
    brief: briefToPrompt(opts.brief),
    topic: opts.topic,
    slots: opts.plan.map((p) => ({
      pillar: p.labelTh,
      guidance: p.guidanceTh,
    })),
  });

  const posts: GeneratedPost[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (let i = 0; i < opts.plan.length; i++) {
    const slot = opts.plan[i]!;
    const item = raw[i];
    if (!item || item.body.trim() === "") {
      logger.warn("LLM ไม่ได้สร้างโพสต์สำหรับช่องนี้", {
        index: i,
        pillar: slot.pillar,
      });
      continue;
    }

    // AI มักใส่แท็กปนมาในเนื้อโพสต์ — แยกออกมาเก็บแยกเพื่อให้แก้และวิเคราะห์ได้
    const split = extractHashtags(item.body);
    const hashtags = cleanHashtags(
      [...(item.hashtags ?? []), ...split.hashtags],
      opts.brandTags !== undefined
        ? { brandTags: opts.brandTags }
        : {},
    );

    const body = split.body;
    const warnings = checkPost(body, opts.brief);

    // กันซ้ำกันเองในชุดเดียว — LLM ชอบเขียนซ้ำเมื่อขอเยอะๆ
    const fingerprint = normalizeText(body).slice(0, 120);
    if (seen.has(fingerprint)) {
      dropped++;
      logger.info("ตัดโพสต์ที่ซ้ำกับตัวอื่นในชุดเดียวกัน", { index: i });
      continue;
    }
    seen.add(fingerprint);

    posts.push({
      body,
      hashtags,
      caption:
        hashtags.length > 0 ? `${body}\n\n${hashtags.join(" ")}` : body,
      pillar: slot.pillar,
      pillarLabelTh: slot.labelTh,
      idea: item.idea?.trim() || body.slice(0, 40),
      warnings,
    });
  }

  const th =
    dropped > 0
      ? `ได้ ${posts.length} โพสต์ (ตัดที่ซ้ำกันเองออก ${dropped} โพสต์)`
      : `ได้ ${posts.length} โพสต์`;

  return { posts, droppedDuplicates: dropped, th };
}

/**
 * ตรวจโพสต์ก่อนส่งให้คนรีวิว
 *
 * ไม่บล็อก แต่ต้องขึ้นเตือน — คนตัดสินใจเอง เพราะบางเคสตั้งใจ
 * ยกเว้นคำต้องห้ามที่ต้องเด่นชัดเป็นพิเศษ
 */
export function checkPost(body: string, brief: BrandBrief): string[] {
  const warnings: string[] = [];
  const lower = normalizeText(body);

  for (const w of brief.bannedWords) {
    const nw = normalizeText(w);
    if (nw !== "" && lower.includes(nw)) {
      warnings.push(
        `มีคำต้องห้ามของแบรนด์: "${w}" — ต้องแก้ก่อนโพสต์`,
      );
    }
  }
  for (const t of brief.avoidTopics ?? []) {
    const nt = normalizeText(t);
    if (nt !== "" && lower.includes(nt)) {
      warnings.push(`พูดถึงหัวข้อที่ขอให้เลี่ยง: "${t}"`);
    }
  }

  if (body.trim().length === 0) {
    warnings.push("โพสต์ว่าง");
  }
  if (body.length > MAX_CAPTION_CHARS) {
    warnings.push(
      `ยาว ${body.length} ตัวอักษร เกิน ${MAX_CAPTION_CHARS} — ควรตัดให้สั้นลง`,
    );
  }
  if (body.length > FEED_TRUNCATE_CHARS) {
    warnings.push(
      `ยาวเกิน ${FEED_TRUNCATE_CHARS} ตัวอักษร คนต้องกด "ดูเพิ่มเติม" — ควรใส่ประเด็นสำคัญไว้ต้นโพสต์`,
    );
  }

  // ไม่มี CTA เลยในโพสต์แนวขาย = เสียโอกาส
  const hasCta = brief.ctas.some((c) => lower.includes(normalizeText(c)));
  if (!hasCta && brief.ctas.length > 0) {
    warnings.push("ไม่มี CTA ที่ตั้งไว้ในโพสต์นี้");
  }

  return warnings;
}

/** ตัวอย่างข้อความที่จะเห็นใน feed ก่อนโดนตัด — ใช้แสดงในหน้ารีวิว */
export function feedPreview(caption: string): {
  visible: string;
  truncated: boolean;
} {
  const trimmed = caption.trim();
  if (trimmed.length <= FEED_TRUNCATE_CHARS) {
    return { visible: trimmed, truncated: false };
  }
  return {
    visible: `${trimmed.slice(0, FEED_TRUNCATE_CHARS)}…`,
    truncated: true,
  };
}
