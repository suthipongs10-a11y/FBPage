/**
 * Duplicate Guard (M4)
 *
 * "hash เนื้อหา + เช็คว่าเคยโพสต์ในเพจนี้ใน 90 วันหรือยัง"
 *
 * เหตุผลที่ต้องมี: ระบบสร้างคอนเทนต์อัตโนมัติ (M5) + recycle engine + cross-post
 * ทำให้โพสต์ซ้ำเกิดง่ายมาก และลูกค้าจะเห็นทันทีว่าเราปล่อยของซ้ำ
 */
import { createHash } from "node:crypto";

/** ช่วงเวลาที่ถือว่า "ซ้ำ" ตามสเปก */
export const DUPLICATE_WINDOW_DAYS = 90;
export const DUPLICATE_WINDOW_MS = DUPLICATE_WINDOW_DAYS * 86_400_000;

/**
 * ทำข้อความให้เป็นรูปแบบมาตรฐานก่อน hash
 *
 * ต้อง normalize เพราะคนแก้คำเว้นวรรคหรือเปลี่ยน emoji นิดเดียวแล้วถือว่าเป็นคนละโพสต์
 * ไม่ได้ — ผู้อ่านเห็นว่าซ้ำอยู่ดี
 */
export function normalizeContent(text: string): string {
  return (
    text
      .normalize("NFC")
      .toLowerCase()
      // ตัด URL ที่มี tracking param ต่างกันแต่ปลายทางเดียวกัน
      .replace(/https?:\/\/\S+/g, (u) => u.split("?")[0] ?? u)
      // ยุบช่องว่างทุกชนิด (รวม zero-width ที่ copy มาจากที่อื่น)
      .replace(/[\s​-‍﻿]+/g, " ")
      .trim()
  );
}

export interface HashableContent {
  body: string;
  /** URL หรือ key ของสื่อ — เรียงก่อน hash เพราะลำดับอัลบั้มไม่ทำให้เป็นคนละโพสต์ */
  media?: string[];
  /** ประเภทโพสต์ — ข้อความเดียวกันแต่ลง Reels ถือว่าคนละโพสต์ */
  type?: string;
}

/**
 * แปลง PostContent → รูปแบบที่เอาไป hash ได้
 *
 * ต้องดึงเฉพาะ `url` ออกมา — ถ้าโยน object ทั้งก้อนเข้าไป join() จะได้
 * "[object Object]" เหมือนกันหมด ทำให้อัลบั้มคนละชุดที่มีรูปเท่ากันถูกมองว่าซ้ำ
 */
export function hashableFromPost(content: {
  type?: string;
  body: string;
  media?: Array<{ url: string }>;
}): HashableContent {
  const out: HashableContent = { body: content.body };
  if (content.type !== undefined) out.type = content.type;
  if (content.media !== undefined) out.media = content.media.map((m) => m.url);
  return out;
}

/** hash ที่ใช้เทียบว่าซ้ำ — เก็บลงคอลัมน์ content_hash */
export function contentHash(content: HashableContent): string {
  const parts = [
    `type:${content.type ?? "text"}`,
    `body:${normalizeContent(content.body)}`,
    `media:${[...(content.media ?? [])].sort().join("|")}`,
  ];
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

export interface DuplicateHit {
  postId: string;
  publishedAtMs: number;
  daysAgo: number;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  hash: string;
  hit?: DuplicateHit;
  th: string;
}

/** ที่เก็บประวัติโพสต์ สำหรับเช็คซ้ำ */
export interface PublishedPostLookup {
  /** หาโพสต์ในเพจนี้ที่ hash ตรงกันและเผยแพร่หลัง sinceMs */
  findByHash(args: {
    pageId: string;
    hash: string;
    sinceMs: number;
  }): Promise<DuplicateHit | null>;
}

export async function checkDuplicate(args: {
  pageId: string;
  content: HashableContent;
  nowMs: number;
  lookup: PublishedPostLookup;
  windowMs?: number;
}): Promise<DuplicateCheckResult> {
  const hash = contentHash(args.content);
  const windowMs = args.windowMs ?? DUPLICATE_WINDOW_MS;
  const hit = await args.lookup.findByHash({
    pageId: args.pageId,
    hash,
    sinceMs: args.nowMs - windowMs,
  });

  if (!hit) {
    return { isDuplicate: false, hash, th: "ไม่ซ้ำกับโพสต์เดิม" };
  }
  return {
    isDuplicate: true,
    hash,
    hit,
    th: `เนื้อหานี้เคยโพสต์ในเพจนี้ไปแล้วเมื่อ ${hit.daysAgo} วันก่อน — ถ้าตั้งใจโพสต์ซ้ำให้ติ๊ก "อนุญาตให้ซ้ำ"`,
  };
}
