/**
 * ที่เก็บของ Ops Center ที่ต่อ Postgres จริง (M-I)
 *
 * สองตัวนี้ต้องอยู่ใน DB จริง ไม่ใช่หน่วยความจำ ด้วยเหตุผลคนละข้อกัน:
 *
 * - **Audit** ต้องอยู่ต่อแม้ระบบรีสตาร์ท เพราะมีไว้ใช้เป็นหลักฐานตอนมีข้อพิพาท
 *   log ที่หายตอน deploy ก็ไม่ใช่หลักฐาน
 * - **Alert state** ต้องอยู่ต่อเพราะถ้าหาย worker จะถือว่าทุกปัญหาเป็นเรื่องใหม่
 *   แล้วยิงแจ้งเตือนทุกเรื่องซ้ำอีกรอบทุกครั้งที่ deploy — ซึ่งคือสาเหตุที่คนปิดเสียง
 */
import type {
  AlertState,
  AlertStore,
  AuditEntry,
  AuditQuery,
  AuditStore,
  Actor,
  FieldChange,
  Severity,
} from "@page-os/ops";
import type { PrismaClient } from "./client.js";

/** `{kind, id}` → `"kind:id"` สำหรับเก็บเป็นคอลัมน์เดียว */
function actorToString(a: Actor): string {
  return `${a.kind}:${a.id}`;
}

/**
 * แปลงกลับ — ต้องระวังว่า `id` เองมี `:` ได้ (เช่น `worker:publish`)
 * จึงตัดแค่ตัวแรกตัวเดียว
 */
function actorFromString(s: string): Actor {
  const i = s.indexOf(":");
  if (i < 0) return { kind: "system", id: s };
  const kind = s.slice(0, i);
  const id = s.slice(i + 1);
  const known = ["human", "client", "system", "bot"];
  return known.includes(kind)
    ? { kind: kind as Actor["kind"], id }
    : { kind: "system", id: s };
}

export class PrismaAuditStore implements AuditStore {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: entry.id,
        // ใช้เวลาที่โดเมนกำหนดมา ไม่ใช่ now() ของฐานข้อมูล —
        // เวลาต้องมาจาก Clock ที่ฉีดเข้ามา ไม่งั้นเทสต์ที่ใช้ FakeClock เพี้ยน
        createdAt: new Date(entry.atMs),
        actor: actorToString(entry.actor),
        action: entry.action,
        pageId: entry.pageId ?? null,
        target: entry.targetId ?? null,
        summaryTh: entry.th,
        // Prisma ต้องการ JSON ที่พิสูจน์ชนิดได้ ส่วน FieldChange มี unknown อยู่ข้างใน
        // แปลงผ่าน JSON หนึ่งรอบเพื่อให้เป็นค่า JSON แท้ๆ (และตัด undefined ทิ้งไปด้วย)
        meta: entry.changes
          ? (JSON.parse(JSON.stringify({ changes: entry.changes })) as object)
          : {},
      },
    });
  }

  async query(q: AuditQuery): Promise<AuditEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.pageId !== undefined ? { pageId: q.pageId } : {}),
        ...(q.action !== undefined ? { action: q.action } : {}),
        ...(q.actorId !== undefined
          ? { actor: { endsWith: `:${q.actorId}` } }
          : {}),
        ...(q.fromMs !== undefined || q.toMs !== undefined
          ? {
              createdAt: {
                ...(q.fromMs !== undefined ? { gte: new Date(q.fromMs) } : {}),
                ...(q.toMs !== undefined ? { lte: new Date(q.toMs) } : {}),
              },
            }
          : {}),
      },
      // ใหม่สุดขึ้นก่อน — คนสอบสวนย้อนหลังเริ่มจาก "เมื่อกี้เกิดอะไรขึ้น" เสมอ
      orderBy: { createdAt: "desc" },
      take: q.limit ?? 100,
    });

    return rows.map((r) => {
      const meta = (r.meta ?? {}) as { changes?: FieldChange[] };
      return {
        id: r.id,
        atMs: r.createdAt.getTime(),
        actor: actorFromString(r.actor),
        action: r.action,
        th: r.summaryTh ?? "",
        ...(r.pageId !== null ? { pageId: r.pageId } : {}),
        ...(r.target !== null ? { targetId: r.target } : {}),
        ...(meta.changes !== undefined ? { changes: meta.changes } : {}),
      };
    });
  }

  async purgeBefore(atMs: number): Promise<number> {
    const r = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(atMs) } },
    });
    return r.count;
  }
}

export class PrismaAlertStore implements AlertStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listOpen(): Promise<AlertState[]> {
    const rows = await this.prisma.alertState.findMany();
    return rows.map((r) => ({
      problemId: r.problemId,
      firstSeenAtMs: r.firstSeenAt.getTime(),
      lastSentAtMs: r.lastSentAt === null ? null : r.lastSentAt.getTime(),
      sendCount: r.sendCount,
      lastSeverity: r.lastSeverity as Severity,
      peakSeverity: r.peakSeverity as Severity,
      lastTh: r.lastTh,
      pageName: r.pageName,
    }));
  }

  async put(state: AlertState): Promise<void> {
    const data = {
      pageName: state.pageName,
      firstSeenAt: new Date(state.firstSeenAtMs),
      lastSentAt:
        state.lastSentAtMs === null ? null : new Date(state.lastSentAtMs),
      sendCount: state.sendCount,
      lastSeverity: state.lastSeverity,
      peakSeverity: state.peakSeverity,
      lastTh: state.lastTh,
    };
    await this.prisma.alertState.upsert({
      where: { problemId: state.problemId },
      create: { problemId: state.problemId, ...data },
      update: data,
    });
  }

  async remove(problemId: string): Promise<void> {
    // deleteMany ไม่ใช่ delete — ลบของที่ไม่มีอยู่แล้วต้องไม่ throw
    // เพราะ worker สองตัวอาจรันทับกันแล้วต่างคนต่างลบเรื่องเดียวกัน
    await this.prisma.alertState.deleteMany({ where: { problemId } });
  }
}
