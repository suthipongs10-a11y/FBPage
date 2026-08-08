/**
 * ตัวส่งงานไปให้ตัวจัดการที่ถูกตัว
 *
 * แยกจาก BullMQ โดยตั้งใจ — ตรงนี้คือ "งานชื่อนี้ให้ใครทำ" ซึ่งเป็นตรรกะล้วนๆ
 * เทสต์ได้โดยไม่ต้องมี Redis ส่วน BullMQ เป็นแค่คนหยิบงานมาส่งให้
 *
 * ─── ทำไมต้องมีชั้นนี้ แทนที่จะให้ BullMQ เรียกฟังก์ชันตรงๆ ───
 *
 * 1. **งานที่ไม่มีคนทำต้องดังทันที** ถ้า cron ยิงงานชื่อที่ไม่มีใครรับ แล้วเราแค่
 *    `return` เฉยๆ งานจะขึ้นเป็น "สำเร็จ" ทุกรอบไปตลอดกาล โดยไม่มีอะไรเกิดขึ้นจริง
 *    — เป็นความพังที่เงียบที่สุดแบบหนึ่ง ที่นี่จึงโยน error พร้อมบอกชื่องานที่ไม่รู้จัก
 * 2. **ตัวจัดการที่ยังไม่ได้ต่อของจริง ต้องบอกว่ายังขาดอะไร** ไม่ใช่หายเงียบ
 */
import type { Logger } from "@page-os/core";

export interface JobContext {
  /** เวลาปัจจุบันจาก Clock ที่ฉีดเข้ามา — ห้ามใช้ Date.now() ในตัวจัดการงาน */
  nowMs: number;
  logger: Logger;
  jobId: string;
  /** BullMQ ลองมาแล้วกี่รอบ (คนละเรื่องกับ attempt ของโดเมน ดู queues.ts) */
  attemptsMade: number;
}

export interface JobOutcome {
  th: string;
  details?: Record<string, unknown>;
}

export interface JobHandler {
  /** ชื่องานที่รับผิดชอบ */
  name: string;
  run(data: unknown, ctx: JobContext): Promise<JobOutcome>;
}

/**
 * error ของตัวจัดการที่ยังไม่ได้ต่อของจริง
 *
 * มีไว้ให้งานตกลงไปกอง `failed` แล้วเห็นได้จากหน้าคิว พร้อมข้อความที่บอกตรงๆ
 * ว่าต้องเขียนอะไรเพิ่ม — ดีกว่าปล่อยให้งานกองอยู่ในคิวโดยไม่มีใครหยิบ
 * ซึ่งจากข้างนอกดูไม่ออกเลยว่าต่างจาก "ยังไม่ถึงคิว"
 */
export class NotWiredError extends Error {
  override readonly name = "NotWiredError";
  readonly th: string;
  constructor(jobName: string, missingTh: string) {
    super(`handler for "${jobName}" is not wired`);
    this.th =
      `งาน "${jobName}" ยังไม่ได้ต่อกับของจริง — ยังขาด${missingTh} ` +
      `งานใบนี้จะกองอยู่ในรายการที่ล้มเหลวจนกว่าจะเขียนส่วนที่ขาดเสร็จ`;
  }
}

export class UnknownJobError extends Error {
  override readonly name = "UnknownJobError";
  readonly th: string;
  constructor(jobName: string, known: readonly string[]) {
    super(`unknown job name "${jobName}"`);
    this.th =
      `ไม่รู้จักงานชื่อ "${jobName}" — ที่รู้จักมี ${known.join(", ")} ` +
      `ถ้าเพิ่งเปลี่ยนชื่องาน อาจเป็นงานค้างจากก่อน deploy`;
  }
}

export class JobRouter {
  private readonly handlers = new Map<string, JobHandler>();

  constructor(handlers: readonly JobHandler[] = []) {
    for (const h of handlers) this.register(h);
  }

  register(handler: JobHandler): void {
    if (this.handlers.has(handler.name)) {
      throw new Error(
        `มีตัวจัดการงานชื่อ "${handler.name}" ลงทะเบียนไว้แล้ว — ` +
          `ชื่อซ้ำแปลว่าตัวหลังจะทับตัวแรกเงียบๆ`,
      );
    }
    this.handlers.set(handler.name, handler);
  }

  get names(): string[] {
    return [...this.handlers.keys()].sort();
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  async dispatch(
    jobName: string,
    data: unknown,
    ctx: JobContext,
  ): Promise<JobOutcome> {
    const handler = this.handlers.get(jobName);
    if (handler === undefined) throw new UnknownJobError(jobName, this.names);
    return handler.run(data, ctx);
  }
}
