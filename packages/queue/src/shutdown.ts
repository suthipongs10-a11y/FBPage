/**
 * ปิดโปรเซสให้จบงานที่ค้างก่อน
 *
 * ทำไมต้องมีของแบบนี้ ทั้งที่ "ก็แค่ปิดโปรแกรม":
 *
 * ตอน deploy ตัวจัดการ container จะส่ง SIGTERM แล้วรออีกไม่กี่วินาทีก่อน SIGKILL
 * ถ้าเราตายทันทีตอนได้ SIGTERM งานที่กำลังทำอยู่จะค้างเป็น "active" ใน Redis
 * แล้ว BullMQ ต้องรอจน stalled timeout หมดถึงจะเอามาทำใหม่ — ระหว่างนั้นโพสต์
 * ที่ควรขึ้นตอน 9 โมงก็ยังไม่ขึ้น และถ้าตายตอนยิงไปแล้วแต่ยังไม่ได้บันทึกผล
 * รอบใหม่จะยิงซ้ำ (มี claimTarget กันอยู่ แต่ก็ไม่ควรเข้าไปเสี่ยงตั้งแต่แรก)
 *
 * ─── ข้อคิดที่ฝังอยู่ในดีไซน์ ───
 *
 * 1. **มีเส้นตาย** ถ้ารอจนงานเสร็จโดยไม่จำกัด เราจะโดน SIGKILL อยู่ดี แล้วขั้นตอน
 *    ที่เหลือ (ปิด DB, flush log) จะไม่ได้ทำเลย รอแบบมีเพดานดีกว่ารอแบบไม่มี
 * 2. **ขั้นตอนหนึ่งค้าง ต้องไม่ลากขั้นตอนที่เหลือไปด้วย** — ให้เวลารายขั้นตอน
 *    ไม่ใช่ให้เวลารวมก้อนเดียว ไม่งั้นตัว drain ที่ค้างจะทำให้ไม่ได้ปิด Redis เลย
 * 3. **ขั้นตอนที่ error ต้องไม่หยุดขบวน** — ปิด DB ไม่ได้ ก็ยังต้องพยายามปิด Redis
 */
import { nullLogger, type Logger } from "@page-os/core";

export interface ShutdownStep {
  name: string;
  /** อธิบายเป็นไทยว่าขั้นนี้ทำอะไร — ขึ้น log ตอนปิด */
  th: string;
  run(): Promise<void>;
  /** เพดานเวลาของขั้นนี้ ไม่ใส่ = ใช้ค่ากลาง */
  timeoutMs?: number;
}

export interface ShutdownReport {
  signal: string;
  steps: Array<{
    name: string;
    outcome: "ok" | "error" | "timeout";
    ms: number;
    errorTh?: string;
  }>;
  /** true = มีอย่างน้อยหนึ่งขั้นที่ไม่เรียบร้อย */
  degraded: boolean;
}

export interface GracefulShutdownOptions {
  steps: readonly ShutdownStep[];
  /** เพดานเวลาต่อขั้น เมื่อขั้นนั้นไม่ได้ระบุเอง */
  stepTimeoutMs?: number;
  logger?: Logger;
}

const DEFAULT_STEP_TIMEOUT_MS = 15_000;

export class GracefulShutdown {
  private readonly steps: readonly ShutdownStep[];
  private readonly stepTimeoutMs: number;
  private readonly logger: Logger;
  private running: Promise<ShutdownReport> | null = null;

  constructor(opts: GracefulShutdownOptions) {
    this.steps = opts.steps;
    this.stepTimeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    this.logger = opts.logger ?? nullLogger;
  }

  /** เคยเริ่มปิดไปแล้วหรือยัง — ใช้ตัดสินว่าสัญญาณครั้งที่สองควรบังคับออกเลยไหม */
  get isShuttingDown(): boolean {
    return this.running !== null;
  }

  /**
   * ปิดตามลำดับที่ให้มา
   *
   * เรียกซ้ำได้ — ครั้งที่สองจะได้ผลลัพธ์เดียวกันกับครั้งแรก ไม่ใช่รันซ้ำ
   * (ตอน deploy จริงมักได้ทั้ง SIGTERM และ SIGINT ไล่กันมา)
   */
  async run(signal: string): Promise<ShutdownReport> {
    if (this.running !== null) return this.running;
    this.running = this.execute(signal);
    return this.running;
  }

  private async execute(signal: string): Promise<ShutdownReport> {
    this.logger.info("เริ่มปิดระบบ", { signal, steps: this.steps.length });
    const report: ShutdownReport = { signal, steps: [], degraded: false };

    for (const step of this.steps) {
      const limit = step.timeoutMs ?? this.stepTimeoutMs;
      const startedAt = Date.now();
      let timer: NodeJS.Timeout | undefined;

      try {
        const timeout = new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), limit);
          // ไม่ให้ timer ตัวนี้เป็นเหตุให้ process อยู่ต่อ
          timer.unref?.();
        });
        const result = await Promise.race([
          step.run().then(() => "ok" as const),
          timeout,
        ]);

        const ms = Date.now() - startedAt;
        if (result === "timeout") {
          report.degraded = true;
          report.steps.push({ name: step.name, outcome: "timeout", ms });
          this.logger.error("ขั้นตอนปิดระบบใช้เวลานานเกินเพดาน — ข้ามไปขั้นถัดไป", {
            step: step.name,
            th: step.th,
            limitMs: limit,
          });
        } else {
          report.steps.push({ name: step.name, outcome: "ok", ms });
          this.logger.info("ปิดเรียบร้อย", { step: step.name, th: step.th, ms });
        }
      } catch (err) {
        report.degraded = true;
        const ms = Date.now() - startedAt;
        const errorTh = err instanceof Error ? err.message : String(err);
        report.steps.push({ name: step.name, outcome: "error", ms, errorTh });
        // ไม่ throw ต่อ — ขั้นที่เหลือยังต้องได้ทำ
        this.logger.error("ขั้นตอนปิดระบบล้มเหลว — ทำขั้นถัดไปต่อ", {
          step: step.name,
          th: step.th,
          err,
        });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    this.logger.info("ปิดระบบครบทุกขั้นแล้ว", {
      signal,
      degraded: report.degraded,
    });
    return report;
  }
}
