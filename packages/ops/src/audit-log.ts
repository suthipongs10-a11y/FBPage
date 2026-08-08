/**
 * Audit Log (M8)
 *
 * สเปก: "ทุก action (ใครทำอะไร เมื่อไหร่ กับเพจไหน) — ป้องกันข้อพิพาทกับลูกค้า"
 *
 * ประโยคสุดท้ายคือเหตุผลทั้งหมดของไฟล์นี้ เคสจริงที่เกิดแน่นอนคือ:
 * ลูกค้าโทรมาบอก "ทำไมโพสต์นี้ขึ้น ฉันไม่ได้อนุมัติ" — ถ้าตอบไม่ได้ว่า
 * ใครกดเมื่อไหร่จากที่ไหน เอเจนซี่เป็นฝ่ายผิดโดยปริยาย
 *
 * สามข้อที่ตามมาจากเหตุผลนั้น:
 *   1. **เขียนแล้วแก้ไม่ได้** — log ที่แก้ได้ใช้เป็นหลักฐานไม่ได้
 *      ที่เก็บจึงไม่มีเมธอด update และการลบทำได้เฉพาะการล้างตามอายุที่บันทึกตัวเอง
 *   2. **ห้ามมี token หลุดลงไป** (กฎข้อ 3) — ค่าที่บันทึกผ่าน `redact()` เสมอ
 *      เพราะการตั้งค่าที่เปลี่ยนอาจมีฟิลด์ที่เป็นความลับปนมา
 *   3. **การบันทึกล้มต้องไม่ทำให้งานหลักล้ม** — แต่ต้องนับไว้ ไม่ใช่กลืนเงียบ
 */
import { nullLogger, redact, systemClock, type Clock, type Logger } from "@page-os/core";

export type ActorKind =
  /** คนในทีมเรา */
  | "human"
  /** ลูกค้ากดจาก Client Portal */
  | "client"
  /** งานอัตโนมัติ (worker, cron) */
  | "system"
  /** บอทตอบลูกค้าเอง */
  | "bot";

export interface Actor {
  kind: ActorKind;
  /** อีเมล หรือชื่องาน เช่น "worker:publish" */
  id: string;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AuditEntry {
  id: string;
  atMs: number;
  actor: Actor;
  /** ชื่อการกระทำแบบจุด เช่น "post.publish" "settings.update" "portal.approve" */
  action: string;
  pageId?: string;
  targetId?: string;
  changes?: FieldChange[];
  /** อธิบายเป็นภาษาไทยว่าเกิดอะไรขึ้น — คนอ่านตอนสอบสวนย้อนหลัง */
  th: string;
}

export interface AuditQuery {
  pageId?: string;
  actorId?: string;
  action?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

/**
 * ที่เก็บ audit — **จงใจไม่มีเมธอดแก้ไข**
 *
 * มีแค่ append, query และ purge ตามอายุ ถ้าวันหนึ่งมีคนอยากเพิ่ม `update()`
 * นั่นคือสัญญาณว่ากำลังจะทำลายคุณค่าเดียวที่ log นี้มี
 */
export interface AuditStore {
  append(entry: AuditEntry): Promise<void>;
  query(q: AuditQuery): Promise<AuditEntry[]>;
  /** ลบรายการที่เก่ากว่าเวลาที่กำหนด คืนจำนวนที่ลบ */
  purgeBefore(atMs: number): Promise<number>;
}

export class InMemoryAuditStore implements AuditStore {
  private readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    // คืนสำเนา ไม่เก็บ reference ที่คนเรียกยังถืออยู่ — ไม่งั้นแก้ทีหลังได้
    this.entries.push(structuredClone(entry));
  }

  async query(q: AuditQuery): Promise<AuditEntry[]> {
    const out = this.entries.filter(
      (e) =>
        (q.pageId === undefined || e.pageId === q.pageId) &&
        (q.actorId === undefined || e.actor.id === q.actorId) &&
        (q.action === undefined || e.action === q.action) &&
        (q.fromMs === undefined || e.atMs >= q.fromMs) &&
        (q.toMs === undefined || e.atMs <= q.toMs),
    );
    // ใหม่สุดขึ้นก่อน — คนสอบสวนย้อนหลังเริ่มจาก "เมื่อกี้เกิดอะไรขึ้น" เสมอ
    out.sort((a, b) => b.atMs - a.atMs);
    return out.slice(0, q.limit ?? 100).map((e) => structuredClone(e));
  }

  async purgeBefore(atMs: number): Promise<number> {
    let removed = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]!.atMs < atMs) {
        this.entries.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }
}

export interface AuditLogOptions {
  store: AuditStore;
  clock?: Clock;
  logger?: Logger;
  /** ฉีดเข้ามาเพื่อให้เทสต์คาดเดาได้ */
  newId?: () => string;
}

export interface RecordArgs {
  actor: Actor;
  action: string;
  th: string;
  pageId?: string;
  targetId?: string;
  changes?: FieldChange[];
}

export class AuditLog {
  private readonly store: AuditStore;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly newId: () => string;
  /** จำนวนครั้งที่บันทึกไม่สำเร็จ — ต้องมีคนเฝ้าตัวเลขนี้ */
  private failed = 0;
  private seq = 0;

  constructor(opts: AuditLogOptions) {
    this.store = opts.store;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
    this.newId = opts.newId ?? (() => `a${++this.seq}`);
  }

  get failedWrites(): number {
    return this.failed;
  }

  /** บันทึกแบบเข้มงวด — ล้มแล้วโยนต่อ ใช้กับงานที่ยอมให้ไม่มี audit ไม่ได้ */
  async record(args: RecordArgs): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: this.newId(),
      atMs: this.clock.now(),
      actor: args.actor,
      action: args.action,
      th: args.th,
      ...(args.pageId !== undefined ? { pageId: args.pageId } : {}),
      ...(args.targetId !== undefined ? { targetId: args.targetId } : {}),
      ...(args.changes !== undefined
        ? { changes: scrubChanges(args.changes) }
        : {}),
    };
    await this.store.append(entry);
    return entry;
  }

  /**
   * บันทึกแบบกลืน error
   *
   * ใช้ในเส้นทางที่ผู้ใช้กำลังรออยู่ — DB สะดุดตอนบันทึก audit ไม่ควรทำให้
   * การอนุมัติของลูกค้าล้มเหลว (เหตุผลเดียวกับ `safeLog()` ของ M-A)
   * แต่ **นับไว้** เพราะ audit ที่หายเงียบๆ คือ audit ที่พึ่งไม่ได้
   */
  async recordSafe(args: RecordArgs): Promise<AuditEntry | null> {
    try {
      return await this.record(args);
    } catch (err) {
      this.failed += 1;
      this.logger.error("บันทึก audit ไม่สำเร็จ", {
        action: args.action,
        pageId: args.pageId,
        err,
      });
      return null;
    }
  }

  query(q: AuditQuery = {}): Promise<AuditEntry[]> {
    return this.store.query(q);
  }

  /**
   * ล้างรายการเก่าตามนโยบายเก็บข้อมูล
   *
   * ตัวการล้างเองก็ถูกบันทึก — ไม่งั้นจะแยกไม่ออกระหว่าง "ไม่มีเหตุการณ์ในช่วงนั้น"
   * กับ "มีคนลบทิ้ง" ซึ่งเป็นคำถามแรกที่จะถูกถามตอนมีข้อพิพาท
   */
  async purge(olderThanMs: number, actor: Actor): Promise<number> {
    const cutoff = this.clock.now() - olderThanMs;
    const removed = await this.store.purgeBefore(cutoff);
    await this.record({
      actor,
      action: "audit.purge",
      th: `ล้างประวัติที่เก่ากว่า ${Math.round(olderThanMs / 86_400_000)} วัน จำนวน ${removed} รายการ`,
    });
    return removed;
  }
}

/** ค่าที่บันทึกต้องผ่านการ scrub เสมอ — การตั้งค่าอาจมีฟิลด์ที่เป็นความลับปนมา */
function scrubChanges(changes: readonly FieldChange[]): FieldChange[] {
  return changes.map((c) => ({
    field: c.field,
    before: redact(c.before),
    after: redact(c.after),
  }));
}

/**
 * หาว่าการตั้งค่าเปลี่ยนอะไรบ้าง
 *
 * เก็บเฉพาะฟิลด์ที่เปลี่ยนจริง ไม่เก็บทั้งก้อน — log ที่บันทึกค่าทั้งชุดทุกครั้ง
 * ทำให้ตอนไล่ดูย้อนหลังต้องเทียบเองว่าอะไรต่างจากเดิม ซึ่งคือเหตุผลที่คนเลิกอ่าน log
 */
export function diffSettings(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];
  for (const field of [...keys].sort()) {
    const b = before[field];
    const a = after[field];
    if (sameValue(b, a)) continue;
    changes.push({ field, before: b, after: a });
  }
  return changes;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }
  if (typeof a !== "object" || typeof b !== "object") return false;
  // เทียบโครงสร้างแบบง่าย พอสำหรับค่าการตั้งค่าที่เป็น JSON
  return JSON.stringify(a) === JSON.stringify(b);
}

/** สรุปการเปลี่ยนแปลงเป็นภาษาไทยหนึ่งบรรทัด สำหรับแสดงในหน้า Audit */
export function describeChanges(changes: readonly FieldChange[]): string {
  if (changes.length === 0) return "ไม่มีอะไรเปลี่ยน";
  return changes
    .map((c) => `${c.field}: ${show(c.before)} → ${show(c.after)}`)
    .join(" · ");
}

function show(v: unknown): string {
  if (v === undefined) return "(ไม่ได้ตั้ง)";
  if (v === null) return "(ว่าง)";
  if (typeof v === "string") return v === "" ? "(ว่าง)" : v;
  if (typeof v === "boolean") return v ? "เปิด" : "ปิด";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export const ACTOR_KIND_TH: Record<ActorKind, string> = {
  human: "ทีมงาน",
  client: "ลูกค้า",
  system: "ระบบอัตโนมัติ",
  bot: "บอท",
};
