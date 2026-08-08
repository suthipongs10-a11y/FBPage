/**
 * Bulk Actions (M8)
 *
 * สเปก: "เปลี่ยนการตั้งค่าทีเดียวหลายเพจ"
 *
 * ฟีเจอร์นี้คือฟีเจอร์ที่ **ประหยัดเวลาที่สุดและพังหนักที่สุด**พร้อมกัน
 * กดครั้งเดียวแก้ 20 เพจคือเหตุผลที่คนเดียวดูแล 20 เพจไหว
 * แต่กดผิดครั้งเดียวก็พัง 20 เพจของลูกค้า 6 รายพร้อมกันเหมือนกัน
 *
 * ตัวป้องกันที่วางไว้:
 *   1. **ต้องดูตัวอย่างก่อนเสมอ** — `planBulkChange()` ไม่แตะอะไรเลย
 *      บอกแค่ว่าเพจไหนจะเปลี่ยนอะไร
 *   2. **ข้ามเพจที่ค่าเดิมตรงอยู่แล้ว** — ไม่งั้น audit จะมี 20 บรรทัดที่กลบ
 *      3 บรรทัดที่เปลี่ยนจริง
 *   3. **เกินเกณฑ์ต้องยืนยันซ้ำ** — โดยเฉพาะเวลาข้ามลูกค้าหลายราย
 *   4. **ล้มบางเพจไม่ล้มทั้งชุด** และรายงานให้ครบว่าเพจไหนไม่ผ่าน
 */
import type { AuditLog, Actor, FieldChange } from "./audit-log.js";
import { describeChanges } from "./audit-log.js";
import { isTokenDead } from "./problems.js";
import type { ConnectionState } from "@page-os/meta";

/** เกินจำนวนนี้ต้องกดยืนยันอีกครั้ง */
export const CONFIRM_ABOVE_PAGES = 5;
/** ข้ามลูกค้ามากกว่านี้ต้องกดยืนยันอีกครั้ง */
export const CONFIRM_ABOVE_CLIENTS = 2;

export class BulkError extends Error {
  override readonly name = "BulkError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface BulkTarget {
  pageId: string;
  pageName: string;
  clientName: string;
  connectionState: ConnectionState;
  /** ค่าการตั้งค่าปัจจุบันของเพจนี้ */
  settings: Readonly<Record<string, unknown>>;
}

export interface PagePlan {
  pageId: string;
  pageName: string;
  clientName: string;
  changes: FieldChange[];
  /** ข้ามเพราะอะไร — undefined = ไม่ข้าม */
  skippedTh?: string;
  /** เตือนแต่ยังทำ */
  warningTh?: string;
}

export interface BulkPlan {
  /** ค่าที่จะตั้ง */
  patch: Readonly<Record<string, unknown>>;
  pages: PagePlan[];
  willChange: number;
  willSkip: number;
  affectedClients: number;
  needsConfirmation: boolean;
  th: string;
}

/**
 * ดูว่าจะเกิดอะไรขึ้น โดยไม่เปลี่ยนอะไรเลย
 *
 * แยกจากตัวลงมือทำโดยเจตนา — หน้าจอต้องเรียกตัวนี้ก่อนเสมอ แล้วเอาผลไปแสดง
 * ให้คนอ่านก่อนกดจริง ไม่มีทางลัดที่ข้ามขั้นนี้ได้
 */
export function planBulkChange(args: {
  targets: readonly BulkTarget[];
  patch: Readonly<Record<string, unknown>>;
}): BulkPlan {
  const fields = Object.keys(args.patch);
  if (fields.length === 0) {
    throw new BulkError("empty patch", "ยังไม่ได้เลือกว่าจะเปลี่ยนค่าอะไร");
  }
  if (args.targets.length === 0) {
    throw new BulkError("no targets", "ยังไม่ได้เลือกเพจที่จะเปลี่ยน");
  }

  const pages: PagePlan[] = args.targets.map((t) => {
    const changes: FieldChange[] = [];
    for (const field of fields) {
      const before = t.settings[field];
      const after = args.patch[field];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changes.push({ field, before, after });
    }

    const base = {
      pageId: t.pageId,
      pageName: t.pageName,
      clientName: t.clientName,
      changes,
    };

    if (changes.length === 0) {
      return { ...base, skippedTh: "ค่าตรงกับที่ตั้งไว้อยู่แล้ว" };
    }
    // เพจที่ต่อไม่ได้ยังบันทึกค่าลงระบบเราได้ แต่จะยังไม่มีผลกับ Facebook
    // จนกว่าจะเชื่อมใหม่ — ต้องบอก ไม่งั้นคนจะคิดว่าแก้แล้วเรียบร้อย
    if (isTokenDead(t.connectionState)) {
      return {
        ...base,
        warningTh: "เพจนี้ยังเชื่อมต่อไม่ได้ ค่าจะถูกเก็บไว้แต่ยังไม่มีผลจนกว่าจะเชื่อมใหม่",
      };
    }
    return base;
  });

  const changing = pages.filter((p) => p.skippedTh === undefined);
  const clients = new Set(changing.map((p) => p.clientName));
  const needsConfirmation =
    changing.length > CONFIRM_ABOVE_PAGES || clients.size > CONFIRM_ABOVE_CLIENTS;

  return {
    patch: args.patch,
    pages,
    willChange: changing.length,
    willSkip: pages.length - changing.length,
    affectedClients: clients.size,
    needsConfirmation,
    th: planSummary(changing.length, pages.length - changing.length, clients.size),
  };
}

function planSummary(change: number, skip: number, clients: number): string {
  if (change === 0) return "ไม่มีเพจไหนต้องเปลี่ยน ค่าตรงกับที่ตั้งไว้อยู่แล้วทั้งหมด";
  const parts = [`จะเปลี่ยน ${change} เพจ ของลูกค้า ${clients} ราย`];
  if (skip > 0) parts.push(`ข้าม ${skip} เพจที่ค่าตรงอยู่แล้ว`);
  return parts.join(" · ");
}

export interface BulkApplier {
  /** เขียนค่าลงเพจหนึ่ง — โยน error ถ้าไม่สำเร็จ */
  apply(pageId: string, patch: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface PageOutcome {
  pageId: string;
  pageName: string;
  ok: boolean;
  /** ทำไมไม่สำเร็จ หรือทำไมถูกข้าม */
  th?: string;
}

export interface BulkResult {
  applied: number;
  skipped: number;
  failed: number;
  outcomes: PageOutcome[];
  th: string;
}

/**
 * ลงมือเปลี่ยนจริง
 *
 * รับ **แผนที่คำนวณไว้แล้ว** ไม่ใช่รายการเพจดิบ — เพื่อให้สิ่งที่ถูกเปลี่ยน
 * เป็นสิ่งเดียวกับที่คนเห็นตอนกดยืนยัน ถ้ารับรายการเพจแล้วคำนวณใหม่ในนี้
 * จะมีช่องว่างที่ข้อมูลเปลี่ยนระหว่างดูกับกด
 *
 * เพจที่ล้มไม่หยุดทั้งชุด และ **ไม่ย้อนคืนของที่สำเร็จไปแล้ว** — การย้อนคืน
 * บางส่วนทำให้สถานะสุดท้ายเดายากกว่าเดิม บอกให้ชัดว่าเพจไหนไม่ผ่านแล้วให้คนกดซ้ำ
 * เฉพาะเพจนั้นดีกว่า
 */
export async function applyBulkChange(args: {
  plan: BulkPlan;
  applier: BulkApplier;
  audit: AuditLog;
  actor: Actor;
  /** ยืนยันแล้วหรือยัง — จำเป็นเมื่อ `plan.needsConfirmation` เป็นจริง */
  confirmed?: boolean;
}): Promise<BulkResult> {
  const { plan } = args;

  if (plan.needsConfirmation && args.confirmed !== true) {
    throw new BulkError(
      "confirmation required",
      `การเปลี่ยนนี้กระทบ ${plan.willChange} เพจ ของลูกค้า ${plan.affectedClients} ราย — กรุณายืนยันอีกครั้งก่อนดำเนินการ`,
    );
  }

  const outcomes: PageOutcome[] = [];
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const page of plan.pages) {
    if (page.skippedTh !== undefined) {
      skipped++;
      outcomes.push({
        pageId: page.pageId,
        pageName: page.pageName,
        ok: true,
        th: page.skippedTh,
      });
      continue;
    }

    try {
      // ส่งเฉพาะฟิลด์ที่เปลี่ยนจริงของเพจนี้ ไม่ใช่ patch ทั้งก้อน —
      // เพจที่ตรงอยู่แล้วบางฟิลด์ไม่ควรถูกเขียนทับให้เกิด event ซ้ำ
      const patch = Object.fromEntries(
        page.changes.map((c) => [c.field, c.after]),
      );
      await args.applier.apply(page.pageId, patch);
      applied++;
      outcomes.push({
        pageId: page.pageId,
        pageName: page.pageName,
        ok: true,
        ...(page.warningTh !== undefined ? { th: page.warningTh } : {}),
      });
      await args.audit.recordSafe({
        actor: args.actor,
        action: "settings.bulk_update",
        pageId: page.pageId,
        th: `แก้ค่าแบบหลายเพจ: ${describeChanges(page.changes)}`,
        changes: page.changes,
      });
    } catch (err) {
      failed++;
      outcomes.push({
        pageId: page.pageId,
        pageName: page.pageName,
        ok: false,
        th:
          err !== null && typeof err === "object" && "th" in err
            ? String((err as { th: unknown }).th)
            : "บันทึกไม่สำเร็จ ลองใหม่เฉพาะเพจนี้ได้",
      });
    }
  }

  // บันทึกภาพรวมหนึ่งรายการ เพื่อให้ไล่ย้อนได้ว่า "การกดครั้งนั้น" ทำอะไรไปบ้าง
  await args.audit.recordSafe({
    actor: args.actor,
    action: "settings.bulk_run",
    th: `กดแก้หลายเพจ: สำเร็จ ${applied} · ข้าม ${skipped} · ล้มเหลว ${failed}`,
  });

  return {
    applied,
    skipped,
    failed,
    outcomes,
    th:
      failed === 0
        ? `เปลี่ยนเรียบร้อย ${applied} เพจ${skipped > 0 ? ` (ข้าม ${skipped} เพจที่ค่าตรงอยู่แล้ว)` : ""}`
        : `เปลี่ยนสำเร็จ ${applied} เพจ แต่มี ${failed} เพจที่ไม่สำเร็จ — กดซ้ำเฉพาะเพจที่ล้มได้`,
  };
}
