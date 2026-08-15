/**
 * ซ่อน / ปล่อย / ลบ คอมเมนต์บน YouTube
 *
 * ─── ทำไมไฟล์นี้หน้าตาไม่เหมือน `packages/moderation/src/actions.ts` ───
 *
 * ฝั่ง Facebook ยิงทีละคอมเมนต์ได้สบาย เพราะ rate limit คิดเป็นรายชั่วโมง
 * ฝั่ง YouTube **หนึ่งครั้งราคา 50 หน่วย** จากโควตาวันละ 10,000 —
 * ยิงทีละอันแค่ 200 ครั้งก็หมดวัน
 *
 * แต่ `comments.setModerationStatus` รับ **id หลายตัวใน call เดียว** และคิด
 * ราคา 50 เท่าเดิม ไม่ว่าจะส่งไป 1 หรือ 50 id — ตัวนี้จึงออกแบบให้รับเป็น
 * **รายการ** ตั้งแต่ต้น ไม่ใช่ตัวเดียวแล้วค่อยวนเรียก
 *
 * | วิธี | ซ่อน 50 คอมเมนต์ | ทำได้กี่ครั้งต่อวัน |
 * |---|---|---|
 * | ทีละอัน | 2,500 หน่วย | 4 ครั้ง |
 * | **เป็นก้อน** | **50 หน่วย** | **200 ครั้ง** |
 *
 * ต่างกัน 50 เท่า — ถ้าออกแบบเป็นตัวเดียวแล้วมาแก้ทีหลัง จะต้องรื้อทุกที่ที่เรียก
 *
 * ─── ข้อจำกัดที่ต้องรู้ก่อนใช้ ───
 *
 * 1. **ต้องใช้ OAuth เท่านั้น** API key เขียนอะไรไม่ได้เลย และสิทธิ์ที่ต้องขอคือ
 *    `youtube.force-ssl` (ไม่ใช่ `youtube.readonly`)
 * 2. **ทำได้เฉพาะคอมเมนต์บนช่องของเราเอง** — คอมเมนต์บนช่องคนอื่นเราไม่มีสิทธิ์
 *    ยิงไปก็โดนปฏิเสธ แต่**เสียโควตา 50 หน่วยไปแล้ว** ทุกวิธีจึงบังคับให้ส่ง
 *    `channel` มาด้วย เพื่อให้ตัวเรียก**ต้องตัดสินใจ**ว่าช่องนี้ของเราหรือเปล่า
 *    — ลืมไม่ได้เพราะชนิดข้อมูลบังคับไว้
 * 3. `banAuthor` ใช้ได้เฉพาะคู่กับ `rejected` เท่านั้น — ใส่คู่กับสถานะอื่น
 *    Google จะปฏิเสธทั้ง call (และกินโควตา)
 * 4. `comments.delete` ลบได้เฉพาะคอมเมนต์ที่**เราเป็นคนเขียนเอง** ส่วนคอมเมนต์
 *    ของคนอื่นบนช่องเรา ต้องใช้ `rejected` ซึ่งให้ผลที่คนดูเห็นเหมือนกัน
 */
import { nullLogger, type Logger } from "@page-os/core";
import { YouTubeApiError } from "./errors.js";
import type { YouTubeGateway } from "./gateway.js";

/**
 * id สูงสุดต่อหนึ่ง call
 *
 * เอกสารของ Google ไม่ได้ระบุเพดานไว้ตรงๆ — 50 คือค่าที่ปลอดภัยและตรงกับ
 * เพดาน `maxResults` ของ endpoint อื่นในชุดเดียวกัน ถ้าส่งยาวเกินไปจะไปชน
 * เพดานความยาว URL ซึ่งจะได้ 414 กลับมา (และเสียโควตาไปแล้ว)
 */
export const MODERATION_BATCH = 50;

export type ModerationStatus = "published" | "rejected" | "heldForReview";

/**
 * ช่องที่คอมเมนต์ชุดนี้อยู่
 *
 * บังคับให้ส่งมาทุกครั้งเพราะ **YouTube ให้เราจัดการได้เฉพาะช่องของตัวเอง**
 * ยิงไปที่ช่องคนอื่นได้ 403 กลับมา แต่เสียโควตา 50 หน่วยไปแล้ว
 *
 * ทำไมไม่ตั้งไว้ที่ constructor: instance เดียวใช้ได้หลายช่อง (คนเดียวดูแล
 * หลายช่องคือโจทย์ตั้งต้นของระบบนี้) ถ้าผูกไว้ตอนสร้าง จะกลายเป็นต้องสร้าง
 * instance ใหม่ทุกช่อง แล้วโทเคนที่จำไว้ก็จะไม่ถูกใช้ซ้ำ
 */
export interface ModerationChannel {
  /** รหัสช่อง (UC…) — ใช้ประกอบข้อความบอกว่าช่องไหน */
  id: string;
  /** เป็นช่องของเราเองไหม — `false` แล้วจะไม่ยิงอะไรออกไปเลย */
  owned: boolean;
}

export interface ModerationResult {
  /** จำนวนคอมเมนต์ที่สั่งไปสำเร็จ */
  done: number;
  /** จำนวน call ที่ยิงจริง — เอาไปคูณ 50 ได้เป็นโควตาที่ใช้ */
  calls: number;
  /** โควตาที่ใช้ไปกับงานนี้ (หน่วย) */
  quotaSpent: number;
  th: string;
  errors: string[];
}

export interface YouTubeModerationDeps {
  gateway: YouTubeGateway;
  /**
   * โทเคน OAuth ของเจ้าของช่อง — ฉีดเข้ามาเป็นฟังก์ชันเพราะมันหมดอายุทุกชั่วโมง
   * ตัวเรียกจึงต้องได้โอกาสต่ออายุก่อนคืนค่า
   */
  accessToken: () => Promise<string>;
  logger?: Logger;
}

/** ราคาต่อ call ของงานย้ายสถานะ — ใช้คำนวณโควตาที่ใช้ไปให้หน้าจอโชว์ */
const COST_PER_CALL = 50;

export class YouTubeCommentActions {
  private readonly gateway: YouTubeGateway;
  private readonly accessToken: () => Promise<string>;
  private readonly logger: Logger;

  constructor(deps: YouTubeModerationDeps) {
    this.gateway = deps.gateway;
    this.accessToken = deps.accessToken;
    this.logger = deps.logger ?? nullLogger;
  }

  /**
   * ซ่อนคอมเมนต์ — คนอื่นไม่เห็น (YouTube เรียกสถานะนี้ว่า `rejected`)
   *
   * ไม่ใช่การลบ ข้อมูลยังอยู่ในระบบของ YouTube และเจ้าของช่องยังเห็นได้ใน
   * หน้าจัดการคอมเมนต์ — ใกล้เคียงกับ `is_hidden` ของ Facebook มากที่สุด
   */
  async hide(args: {
    commentIds: readonly string[];
    channel: ModerationChannel;
    /** ปิดกั้นคนเขียนไม่ให้คอมเมนต์บนช่องเราอีก — ใช้ได้เฉพาะคู่กับการซ่อนเท่านั้น */
    banAuthor?: boolean;
  }): Promise<ModerationResult> {
    return await this.setStatus({
      commentIds: args.commentIds,
      channel: args.channel,
      status: "rejected",
      ...(args.banAuthor === true ? { banAuthor: true } : {}),
      verbTh: "ซ่อน",
    });
  }

  /** เอาการซ่อนออก — กลับมาให้คนอื่นเห็นตามปกติ */
  async unhide(args: {
    commentIds: readonly string[];
    channel: ModerationChannel;
  }): Promise<ModerationResult> {
    return await this.setStatus({
      commentIds: args.commentIds,
      channel: args.channel,
      status: "published",
      verbTh: "เอาการซ่อนออกจาก",
    });
  }

  /** พักไว้รอคนตรวจ — ยังไม่ตัดสินว่าผิดหรือไม่ผิด */
  async holdForReview(args: {
    commentIds: readonly string[];
    channel: ModerationChannel;
  }): Promise<ModerationResult> {
    return await this.setStatus({
      commentIds: args.commentIds,
      channel: args.channel,
      status: "heldForReview",
      verbTh: "พักไว้รอตรวจ",
    });
  }

  /**
   * ย้ายสถานะเป็นก้อน — หัวใจของไฟล์นี้
   *
   * แบ่งเป็นก้อนละ 50 แล้วยิงทีละก้อน ก้อนที่พังไม่ทำให้ก้อนอื่นไม่ได้ทำ
   * เพราะคนที่กด "ซ่อนทั้ง 120 อัน" ควรได้ 100 อันที่สำเร็จ ไม่ใช่ได้ 0
   */
  private async setStatus(args: {
    commentIds: readonly string[];
    channel: ModerationChannel;
    status: ModerationStatus;
    /**
     * ใช้ได้เฉพาะคู่กับ `rejected` — Google ปฏิเสธทั้ง call ถ้าใส่คู่กับสถานะอื่น
     * และการโดนปฏิเสธก็เสียโควตา 50 หน่วยไปแล้ว
     *
     * บังคับด้วย**ชนิดข้อมูล**แทนการเช็คตอนรัน: มีแต่ `hide()` (ซึ่งส่ง
     * `rejected` เสมอ) ที่เปิดช่องให้ส่งค่านี้ ส่วน `unhide`/`holdForReview`
     * ไม่รับพารามิเตอร์นี้เลย — คู่ที่ผิดจึงเขียนออกมาไม่ได้ตั้งแต่ต้น
     */
    banAuthor?: boolean;
    verbTh: string;
  }): Promise<ModerationResult> {
    const ids = dedupe(args.commentIds);
    const out: ModerationResult = {
      done: 0,
      calls: 0,
      quotaSpent: 0,
      th: "",
      errors: [],
    };

    if (ids.length === 0) {
      out.th = "ไม่มีคอมเมนต์ให้ทำ — ไม่ได้ยิงอะไรออกไป";
      return out;
    }

    const notOurs = rejectIfNotOwned(args.channel, args.verbTh);
    if (notOurs !== null) {
      out.errors.push(notOurs);
      out.th = notOurs;
      return out;
    }

    const token = await this.accessToken();

    for (const chunk of chunks(ids, MODERATION_BATCH)) {
      try {
        await this.gateway.call({
          endpoint: "comments.setModerationStatus",
          method: "POST",
          accessToken: token,
          // คนกดปุ่มนั่งรออยู่ — ห้ามโดนเบรกเพราะกันโควตาให้งานเบื้องหลัง
          background: false,
          params: {
            id: chunk.join(","),
            moderationStatus: args.status,
            ...(args.banAuthor === true ? { banAuthor: "true" } : {}),
          },
        });
        out.done += chunk.length;
      } catch (err) {
        out.errors.push(describeError(err));
        // โควตาหมดแล้วยิงก้อนถัดไปก็เสียเปล่า 50 หน่วยต่อครั้ง — หยุดเลย
        if (err instanceof YouTubeApiError && err.action === "wait_quota") {
          out.calls += 1;
          out.quotaSpent = out.calls * COST_PER_CALL;
          out.th = this.summaryTh(args.verbTh, out, ids.length, true);
          return out;
        }
      }
      out.calls += 1;
    }

    out.quotaSpent = out.calls * COST_PER_CALL;
    out.th = this.summaryTh(args.verbTh, out, ids.length, false);
    this.logger.info(out.th, {
      status: args.status,
      done: out.done,
      quotaSpent: out.quotaSpent,
    });
    return out;
  }

  /**
   * ลบถาวร — กู้คืนไม่ได้
   *
   * ⚠️ ลบได้เฉพาะคอมเมนต์ที่ **เราเป็นคนเขียนเอง** ส่วนคอมเมนต์ของคนอื่นบนช่องเรา
   * ต้องใช้ `hide()` แทน ซึ่งผลที่คนดูเห็นเหมือนกันทุกประการ
   *
   * และ `comments.delete` รับ **id เดียวต่อ call** — ราคา 50 หน่วยต่อคอมเมนต์
   * ลบ 20 อัน = 1,000 หน่วย เท่ากับหนึ่งในสิบของทั้งวัน จึงมีเพดานกันมือลั่น
   */
  async remove(args: {
    commentIds: readonly string[];
    channel: ModerationChannel;
    /** เพดานกันเผลอลบทีละมากๆ จนโควตาหมด — ตั้งใจให้ต่ำ */
    max?: number;
  }): Promise<ModerationResult> {
    const ids = dedupe(args.commentIds);
    const max = args.max ?? 20;
    const out: ModerationResult = {
      done: 0,
      calls: 0,
      quotaSpent: 0,
      th: "",
      errors: [],
    };

    if (ids.length === 0) {
      out.th = "ไม่มีคอมเมนต์ให้ลบ — ไม่ได้ยิงอะไรออกไป";
      return out;
    }

    const notOurs = rejectIfNotOwned(args.channel, "ลบ");
    if (notOurs !== null) {
      out.errors.push(notOurs);
      out.th = notOurs;
      return out;
    }

    if (ids.length > max) {
      out.th =
        `ขอลบ ${ids.length} อันพร้อมกัน ซึ่งกินโควตา ${ids.length * COST_PER_CALL} หน่วย ` +
        `(เกินเพดาน ${max} อันต่อครั้ง) — การลบกู้คืนไม่ได้และแพงกว่าการซ่อน 1 เท่าตัวต่ออัน ` +
        `ถ้าตั้งใจจริงให้แบ่งทำหลายรอบ หรือใช้ "ซ่อน" แทนซึ่งคนดูเห็นผลเหมือนกัน`;
      out.errors.push(out.th);
      return out;
    }

    const token = await this.accessToken();

    for (const id of ids) {
      try {
        await this.gateway.call({
          endpoint: "comments.delete",
          method: "DELETE",
          accessToken: token,
          background: false,
          params: { id },
        });
        out.done += 1;
      } catch (err) {
        out.errors.push(describeError(err));
        if (err instanceof YouTubeApiError && err.action === "wait_quota") {
          out.calls += 1;
          out.quotaSpent = out.calls * COST_PER_CALL;
          out.th =
            `ลบได้ ${out.done}/${ids.length} อันแล้วโควตาหมด — ` +
            `ที่เหลือรอรีเซ็ตเที่ยงคืนเวลาแปซิฟิก (ราวบ่าย 2–3 โมงบ้านเรา)`;
          return out;
        }
      }
      out.calls += 1;
    }

    out.quotaSpent = out.calls * COST_PER_CALL;
    out.th =
      out.errors.length === 0
        ? `ลบ ${out.done} คอมเมนต์แล้ว (ใช้โควตา ${out.quotaSpent} หน่วย)`
        : `ลบได้ ${out.done}/${ids.length} อัน — มี ${out.errors.length} อันที่ไม่สำเร็จ ` +
          `(ใช้โควตา ${out.quotaSpent} หน่วย)`;
    this.logger.info(out.th, { done: out.done, quotaSpent: out.quotaSpent });
    return out;
  }

  /** ข้อความสรุปที่บอกทั้งผลและราคาที่จ่ายไป */
  private summaryTh(
    verbTh: string,
    out: ModerationResult,
    total: number,
    quotaOut: boolean,
  ): string {
    if (quotaOut) {
      return (
        `${verbTh} ${out.done}/${total} คอมเมนต์แล้วโควตาหมด — ` +
        `ที่เหลือรอรีเซ็ตเที่ยงคืนเวลาแปซิฟิก (ราวบ่าย 2–3 โมงบ้านเรา)`
      );
    }
    if (out.errors.length === 0) {
      return (
        `${verbTh} ${out.done} คอมเมนต์แล้ว — ใช้โควตา ${out.quotaSpent} หน่วย ` +
        `จาก ${out.calls} ครั้ง (ถ้ายิงทีละอันจะใช้ ${total * COST_PER_CALL} หน่วย)`
      );
    }
    return (
      `${verbTh}ได้ ${out.done}/${total} คอมเมนต์ — มี ${out.errors.length} ก้อนที่ไม่สำเร็จ ` +
      `(ใช้โควตา ${out.quotaSpent} หน่วย)`
    );
  }
}

/**
 * ปฏิเสธก่อนยิงถ้าไม่ใช่ช่องของเรา — คืน `null` เมื่อทำได้
 *
 * YouTube ให้เราจัดการคอมเมนต์ได้เฉพาะบนช่องที่เราเป็นเจ้าของ ยิงไปที่ช่องอื่น
 * ได้ 403 กลับมาแต่**เสียโควตา 50 หน่วยไปแล้ว** — กด "ซ่อนทั้งหมด" ผิดช่อง
 * สัก 20 ครั้งก็หายไป 1,000 หน่วยโดยไม่มีอะไรเกิดขึ้นเลย
 */
function rejectIfNotOwned(channel: ModerationChannel, verbTh: string): string | null {
  if (channel.owned) return null;
  return (
    `${verbTh}คอมเมนต์บนช่อง ${channel.id} ไม่ได้ — YouTube ให้จัดการคอมเมนต์ได้` +
    `เฉพาะช่องที่เราเป็นเจ้าของเท่านั้น ` +
    `ช่องนี้อยู่ในรายการแบบ "ช่องที่อยากส่อง" ซึ่งอ่านคอมเมนต์ได้แต่แก้ไขไม่ได้ ` +
    `(ไม่ได้ยิงอะไรออกไป จึงไม่เสียโควตา)`
  );
}

/**
 * ตัด id ซ้ำออกก่อนยิง
 *
 * id ซ้ำไม่ทำให้ผลลัพธ์ผิด แต่ทำให้ก้อนเต็มเร็วกว่าที่ควร — 100 id ที่ซ้ำกัน
 * ครึ่งหนึ่งจะกลายเป็น 2 call (100 หน่วย) ทั้งที่ควรเป็น 1 call (50 หน่วย)
 */
function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim() !== ""))];
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

function describeError(err: unknown): string {
  if (err instanceof YouTubeApiError) return err.th;
  return err instanceof Error ? err.message : String(err);
}
