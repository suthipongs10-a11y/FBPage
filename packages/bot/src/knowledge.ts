/**
 * Knowledge Base ต่อเพจ (M2)
 *
 * สเปก: "อัปโหลด PDF/ข้อความ/ราคาสินค้า → chunk → embed → pgvector
 *        → บอทตอบจากข้อมูลจริงเท่านั้น (ลด hallucination)"
 *
 * ออกแบบให้ทำงานได้ **แม้ยังไม่มี embedding** โดยถอยไปใช้การจับคำแทน
 * เหตุผล: ตอน onboarding ลูกค้าใหม่ ข้อมูลเพิ่งอัปโหลดและยังไม่ได้ embed
 * บอทต้องตอบได้ทันทีไม่ใช่รอ ส่วนคุณภาพจะดีขึ้นเองเมื่อ embed เสร็จ
 */
import { normalizeText } from "@page-os/moderation";
import type { KnowledgeChunk, RetrievedChunk } from "./types.js";

/** ขนาด chunk ที่พอดีกับการตอบแชท — ยาวไปคำตอบจะเยิ่นเย้อ */
export const TARGET_CHUNK_CHARS = 500;
export const CHUNK_OVERLAP_CHARS = 80;

/**
 * ตัดเอกสารเป็น chunk
 *
 * ตัดที่ย่อหน้าก่อน แล้วค่อยที่ประโยค เพราะการตัดกลางประโยคภาษาไทย
 * ทำให้ความหมายเพี้ยนและ embedding แย่ลงมาก (ไทยไม่มีช่องว่างระหว่างคำ
 * การตัดตามจำนวนตัวอักษรดิบจึงอันตรายกว่าภาษาอังกฤษ)
 */
export function chunkText(
  text: string,
  opts: { targetChars?: number; overlapChars?: number } = {},
): string[] {
  const target = opts.targetChars ?? TARGET_CHUNK_CHARS;
  const overlap = opts.overlapChars ?? CHUNK_OVERLAP_CHARS;

  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (cleaned === "") return [];
  if (cleaned.length <= target) return [cleaned];

  // ย่อหน้าคือขอบเขตความหมายที่ชัดที่สุด
  const paragraphs = cleaned.split(/\n{2,}/).filter((p) => p.trim() !== "");
  const chunks: string[] = [];
  let current = "";

  const flush = (): void => {
    const c = current.trim();
    if (c !== "") chunks.push(c);
    current = "";
  };

  for (const para of paragraphs) {
    const p = para.trim();

    if (current !== "" && current.length + p.length + 2 > target) flush();

    if (p.length <= target) {
      current = current === "" ? p : `${current}\n\n${p}`;
      continue;
    }

    // ย่อหน้ายาวเกิน → ตัดตามประโยค
    flush();
    for (const sentence of splitSentences(p)) {
      if (current !== "" && current.length + sentence.length + 1 > target) {
        const tail = current.slice(-overlap);
        flush();
        // เอาท้ายของ chunk ก่อนหน้ามาต่อ กันความหมายขาดตอน
        current = tail.trim();
      }
      current = current === "" ? sentence : `${current} ${sentence}`;
    }
  }
  flush();
  return chunks.filter((c) => c.length > 0);
}

/**
 * ตัดประโยคภาษาไทย
 *
 * ไทยไม่ใช้จุดจบประโยค แต่ใช้ช่องว่างคั่นวรรค จึงตัดที่ช่องว่างที่ตามหลัง
 * ข้อความยาวพอ และที่เครื่องหมายวรรคตอนของภาษาอังกฤษด้วย
 */
function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?。！？])\s+|\n+|(?<=\S{12})\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return parts.length > 0 ? parts : [text];
}

// ---------------------------------------------------------------------------

/** ตัวแปลงข้อความเป็นเวกเตอร์ — inject เข้ามาเพื่อไม่ผูกกับผู้ให้บริการรายใดราย */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  /** มิติของเวกเตอร์ ต้องตรงกับ schema (vector(768)) */
  readonly dimensions: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * คะแนนความตรงแบบจับคำ — ใช้ตอนยังไม่มี embedding
 *
 * ให้น้ำหนักคำที่ยาวกว่า เพราะคำยาวในภาษาไทยมักเป็นคำเฉพาะ
 * (เช่น "ค่าจัดส่ง" มีความหมายมากกว่า "ค่า")
 */
export function keywordScore(query: string, text: string): number {
  const q = normalizeText(query);
  const t = normalizeText(text);
  if (q === "" || t === "") return 0;

  // ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงใช้ n-gram แทนการตัดคำ
  const grams = new Set<string>();
  for (let n = 3; n <= 5; n++) {
    for (let i = 0; i + n <= q.length; i++) grams.add(q.slice(i, i + n));
  }
  if (grams.size === 0) return 0;

  let matched = 0;
  let weight = 0;
  for (const g of grams) {
    weight += g.length;
    if (t.includes(g)) matched += g.length;
  }
  return weight === 0 ? 0 : matched / weight;
}

export interface RetrieveOptions {
  /** คืนกี่ chunk */
  topK?: number;
  /** ต่ำกว่านี้ถือว่าไม่เกี่ยว */
  minScore?: number;
}

export const DEFAULT_TOP_K = 4;
/** ต่ำกว่านี้ถือว่าไม่มีข้อมูลตอบ — ยอมบอกว่าไม่รู้ ดีกว่าเดา */
export const DEFAULT_MIN_SCORE = 0.25;

/**
 * ค้นข้อมูลที่เกี่ยวข้องกับคำถาม
 *
 * ใช้ embedding ถ้ามีทั้งฝั่งคำถามและฝั่งข้อมูล ไม่งั้นถอยไปจับคำ
 * chunk ที่ไม่มี embedding ยังถูกค้นเจอได้ด้วยการจับคำ — สำคัญตอนเพิ่งอัปโหลด
 */
export function retrieve(args: {
  query: string;
  queryEmbedding?: number[];
  chunks: readonly KnowledgeChunk[];
  pageId: string;
  options?: RetrieveOptions;
}): RetrievedChunk[] {
  const topK = args.options?.topK ?? DEFAULT_TOP_K;
  const minScore = args.options?.minScore ?? DEFAULT_MIN_SCORE;

  const scored: RetrievedChunk[] = [];
  for (const c of args.chunks) {
    if (c.pageId !== args.pageId) continue;

    const kw = keywordScore(args.query, `${c.title} ${c.text}`);
    const vec =
      args.queryEmbedding && c.embedding
        ? cosineSimilarity(args.queryEmbedding, c.embedding)
        : null;

    // ผสมสองแบบเมื่อมีทั้งคู่ — เวกเตอร์จับความหมาย คำจับชื่อเฉพาะ/ตัวเลข
    const score = vec === null ? kw : vec * 0.7 + kw * 0.3;
    if (score >= minScore) scored.push({ ...c, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** ประกอบข้อมูลที่ค้นได้เป็นบริบทให้ LLM */
export function buildContext(chunks: readonly RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks
    .map((c, i) => `[${i + 1}] ${c.title}\n${c.text}`)
    .join("\n\n");
}

/** เตรียม chunk จากเอกสารที่อัปโหลด */
export function prepareChunks(args: {
  pageId: string;
  title: string;
  text: string;
  source?: string;
  idPrefix?: string;
}): KnowledgeChunk[] {
  const prefix = args.idPrefix ?? `${args.pageId}:${args.title}`;
  return chunkText(args.text).map((text, i) => ({
    id: `${prefix}#${i}`,
    pageId: args.pageId,
    title: args.title,
    text,
    ...(args.source !== undefined ? { source: args.source } : {}),
  }));
}
