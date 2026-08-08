/**
 * Alert Center (M8)
 *
 * สเปก: "token หมดอายุ / webhook เงียบเกิน 30 นาที / โพสต์ล้มเหลว /
 *        คอมเมนต์ลบ / rate limit ใกล้เต็ม → แจ้งเข้า LINE"
 *
 * ⚠️ ปัญหาที่แท้จริงของฟีเจอร์นี้ไม่ใช่ "ส่งข้อความยังไง" แต่คือ **ส่งเมื่อไหร่**
 *
 * ระบบแจ้งเตือนตายด้วยวิธีเดียวเสมอ: เตือนถี่เกินไป → คนปิดเสียง →
 * ตอนที่มีเรื่องจริงก็ไม่มีใครเห็น ผลลัพธ์แย่กว่าไม่มีระบบแจ้งเตือนเลย
 * เพราะคนเชื่อว่ามีระบบคอยดูให้อยู่
 *
 * ตัวนี้จึงมีสี่กลไกที่ทำงานร่วมกัน:
 *   1. **เตือนซ้ำแบบถอยห่างขึ้นเรื่อยๆ** — webhook เงียบ 6 ชม. ไม่ควรได้ 72 ข้อความ
 *   2. **รวมเป็นข้อความเดียว** — token 8 เพจหมดพร้อมกันคือเรื่องเดียว ไม่ใช่ 8 เรื่อง
 *   3. **บอกตอนกลับมาปกติ** — ถ้าไม่บอก คนจะไม่กล้าเลิกสนใจ ต้องเข้าไปเช็คเอง
 *   4. **ช่วงเวลาเงียบ** — เรื่องไม่ด่วนรอเช้าได้ เรื่องด่วนปลุกได้ตลอด
 */
import { systemClock, type Clock } from "@page-os/core";
import type { Problem, Severity } from "./problems.js";

/**
 * ระยะห่างของการเตือนซ้ำ ครั้งที่ 1, 2, 3, ...
 *
 * ครั้งแรกส่งทันที แล้วถอยห่างขึ้นเรื่อยๆ ตัวสุดท้ายใช้ซ้ำไปตลอด —
 * ปัญหาที่ค้างสามวันควรเตือนวันละครั้ง ไม่ใช่เงียบไปเลย (เดี๋ยวลืม)
 * และไม่ใช่ทุก 15 นาที (เดี๋ยวปิดเสียง)
 */
export const REMIND_AFTER_MS = [
  0,
  15 * 60_000,
  60 * 60_000,
  4 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
] as const;

/** เกินจำนวนนี้ในรอบเดียว รวมเป็นข้อความเดียว */
export const BATCH_THRESHOLD = 3;

export interface AlertState {
  problemId: string;
  firstSeenAtMs: number;
  /** ส่งครั้งล่าสุดเมื่อไหร่ — null = ยังไม่เคยส่ง (ถูกกลั้นไว้ในช่วงเงียบ) */
  lastSentAtMs: number | null;
  sendCount: number;
  lastSeverity: Severity;
  /**
   * ความรุนแรงสูงสุดที่เคยแจ้งไปแล้ว
   *
   * ใช้ตัดสินการยกระดับแทน `lastSeverity` เพราะปัญหาที่แกว่งอยู่ตรงเส้นแบ่ง
   * (webhook เงียบ 3 ชม. 58 นาที ↔ 4 ชม. 2 นาที) จะสลับ warning/critical
   * ทุกรอบ ถ้าเทียบกับครั้งก่อน มันจะนับเป็น "ยกระดับ" ทุกครั้งที่ข้ามขึ้น
   * แล้วส่งทุกห้านาที ซึ่งคือสิ่งที่ระบบนี้มีไว้เพื่อป้องกัน
   */
  peakSeverity: Severity;
  /** เก็บไว้เพื่อบอกตอนกลับมาปกติว่าเรื่องอะไรหาย */
  lastTh: string;
  pageName: string;
}

export interface AlertStore {
  listOpen(): Promise<AlertState[]>;
  put(state: AlertState): Promise<void>;
  remove(problemId: string): Promise<void>;
}

export class InMemoryAlertStore implements AlertStore {
  private readonly states = new Map<string, AlertState>();
  async listOpen(): Promise<AlertState[]> {
    // คืนสำเนา ให้พฤติกรรมตรงกับที่เก็บจริงที่อ่านมาจาก DB —
    // ไม่งั้นการแก้ object ก่อนเรียก put() จะติดไปเองเฉพาะตอนเก็บในหน่วยความจำ
    return [...this.states.values()].map((s) => ({ ...s }));
  }
  async put(state: AlertState): Promise<void> {
    this.states.set(state.problemId, { ...state });
  }
  async remove(problemId: string): Promise<void> {
    this.states.delete(problemId);
  }
}

export interface AlertMessage {
  /** ความแรงสูงสุดในข้อความนี้ */
  severity: Severity;
  /** ข้อความไทยพร้อมส่ง */
  th: string;
  /** ปัญหาที่อยู่ในข้อความนี้ — ใช้ทดสอบและทำสถิติ */
  problemIds: string[];
}

export interface AlertSink {
  send(message: AlertMessage): Promise<void>;
}

export const noopAlertSink: AlertSink = {
  async send() {
    /* ไม่ทำอะไร */
  },
};

export interface QuietHours {
  /** เริ่มเงียบกี่โมง (0-23) ตามเวลาท้องถิ่นของเอเจนซี่ */
  fromHour: number;
  /** เลิกเงียบกี่โมง */
  toHour: number;
  timeZone: string;
}

export interface AlertCenterOptions {
  store: AlertStore;
  sink: AlertSink;
  clock?: Clock;
  /**
   * ช่วงเวลาที่ไม่รบกวน
   *
   * เรื่องระดับ critical ยังส่งอยู่ — token หมดตอนตีสองแปลว่าโพสต์เช้าจะไม่ขึ้น
   * ซึ่งต้องรู้ก่อนตื่นมาเจอลูกค้าถาม
   */
  quietHours?: QuietHours;
}

export interface RunResult {
  sent: AlertMessage[];
  /** ถูกกลั้นไว้เพราะอยู่ในช่วงเงียบหรือยังไม่ถึงรอบเตือนซ้ำ */
  heldBack: number;
  resolved: string[];
  th: string;
}

function hourIn(atMs: number, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
    }).format(new Date(atMs)),
  );
}

/** อยู่ในช่วงเงียบไหม — รองรับช่วงที่คร่อมเที่ยงคืน (22:00–07:00) */
export function inQuietHours(atMs: number, q: QuietHours): boolean {
  const h = hourIn(atMs, q.timeZone);
  return q.fromHour <= q.toHour
    ? h >= q.fromHour && h < q.toHour
    : h >= q.fromHour || h < q.toHour;
}

/** เลขน้อย = แรงกว่า */
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_TH: Record<Severity, string> = {
  critical: "🔴 ด่วน",
  warning: "🟡 ต้องดู",
  info: "🔵 แจ้งให้ทราบ",
};

function dueForResend(state: AlertState, nowMs: number): boolean {
  if (state.lastSentAtMs === null) return true;
  const idx = Math.min(state.sendCount, REMIND_AFTER_MS.length - 1);
  const wait = REMIND_AFTER_MS[idx]!;
  return nowMs - state.lastSentAtMs >= wait;
}

export class AlertCenter {
  private readonly store: AlertStore;
  private readonly sink: AlertSink;
  private readonly clock: Clock;
  private readonly quiet: QuietHours | undefined;

  constructor(opts: AlertCenterOptions) {
    this.store = opts.store;
    this.sink = opts.sink;
    this.clock = opts.clock ?? systemClock;
    this.quiet = opts.quietHours;
  }

  /**
   * เอาปัญหาที่มีอยู่ตอนนี้มาเทียบกับที่เคยเตือนไปแล้ว แล้วตัดสินว่าจะส่งอะไร
   *
   * รับ "ภาพรวมทั้งหมด ณ ตอนนี้" ไม่ใช่ "เหตุการณ์ที่เพิ่งเกิด" โดยเจตนา —
   * เพราะการรู้ว่าอะไร **หายไปแล้ว** สำคัญพอๆ กับรู้ว่าอะไรเพิ่งเกิด
   * และรูปแบบนี้ทนต่อการที่ worker ตายกลางทางแล้วรันใหม่
   */
  async run(problems: readonly Problem[]): Promise<RunResult> {
    const now = this.clock.now();
    const open = await this.store.listOpen();
    const openById = new Map(open.map((s) => [s.problemId, s]));
    const current = new Map(problems.map((p) => [p.id, p]));

    // ── ของที่หายไปแล้ว ────────────────────────────────────────────────
    const resolved: string[] = [];
    for (const state of open) {
      if (current.has(state.problemId)) continue;
      await this.store.remove(state.problemId);
      // เคยเตือนไปจริงเท่านั้นถึงจะบอกว่าหายแล้ว —
      // ไม่งั้นจะได้ข้อความ "กลับมาปกติ" ของเรื่องที่ไม่เคยรู้ว่ามี
      if (state.lastSentAtMs !== null) resolved.push(state.problemId);
    }

    if (resolved.length > 0) {
      const names = resolved
        .map((id) => openById.get(id)?.lastTh ?? id)
        .slice(0, 5);
      await this.sink.send({
        severity: "info",
        problemIds: resolved,
        th:
          resolved.length === 1
            ? `✅ กลับมาปกติแล้ว: ${names[0]}`
            : `✅ กลับมาปกติแล้ว ${resolved.length} เรื่อง:\n${names.map((n) => `• ${n}`).join("\n")}`,
      });
    }

    // ── ของที่ต้องเตือน ────────────────────────────────────────────────
    const toSend: Problem[] = [];
    let heldBack = 0;

    for (const problem of problems) {
      const prev = openById.get(problem.id);
      // ยกระดับ = แรงกว่าที่เคยแจ้งไปแล้ว ไม่ใช่แรงกว่าครั้งก่อน
      const escalated =
        prev !== undefined &&
        prev.peakSeverity !== "critical" &&
        problem.severity === "critical";

      const state: AlertState = prev ?? {
        problemId: problem.id,
        firstSeenAtMs: now,
        lastSentAtMs: null,
        sendCount: 0,
        lastSeverity: problem.severity,
        peakSeverity: problem.severity,
        lastTh: `${problem.pageName} — ${problem.th}`,
        pageName: problem.pageName,
      };
      state.lastSeverity = problem.severity;
      if (SEVERITY_ORDER[problem.severity] < SEVERITY_ORDER[state.peakSeverity]) {
        state.peakSeverity = problem.severity;
      }
      state.lastTh = `${problem.pageName} — ${problem.th}`;
      state.pageName = problem.pageName;

      // เรื่องที่แรงขึ้นต้องส่งทันที ไม่ต้องรอรอบเตือนซ้ำ —
      // "webhook เงียบ 30 นาที" กับ "เงียบ 5 ชั่วโมง" คนละเรื่องกันในทางปฏิบัติ
      const due = escalated || dueForResend(state, now);
      const muted =
        this.quiet !== undefined &&
        problem.severity !== "critical" &&
        inQuietHours(now, this.quiet);

      if (due && !muted) {
        toSend.push(problem);
        state.lastSentAtMs = now;
        state.sendCount += 1;
      } else if (due && muted) {
        heldBack += 1;
      } else {
        heldBack += 1;
      }

      await this.store.put(state);
    }

    const sent: AlertMessage[] = [];
    if (toSend.length > 0) {
      sent.push(...(await this.deliver(toSend)));
    }

    return {
      sent,
      heldBack,
      resolved,
      th: summarize(sent.length, heldBack, resolved.length),
    };
  }

  /**
   * ส่งจริง — รวมเป็นข้อความเดียวถ้ามีหลายเรื่อง
   *
   * เรื่องด่วนแยกส่งเสมอ ไม่เอาไปรวมกับเรื่องไม่ด่วน เพราะข้อความที่ขึ้นต้นว่า
   * "มี 6 เรื่อง" ทำให้คนเลื่อนอ่านทีหลัง ส่วน "🔴 ด่วน: token หมด" ทำให้กดเปิดทันที
   */
  private async deliver(problems: Problem[]): Promise<AlertMessage[]> {
    const out: AlertMessage[] = [];
    const critical = problems.filter((p) => p.severity === "critical");
    const rest = problems.filter((p) => p.severity !== "critical");

    for (const p of critical) {
      const msg: AlertMessage = {
        severity: "critical",
        problemIds: [p.id],
        th: `${SEVERITY_TH.critical} ${p.pageName} (${p.clientName})\n${p.th}`,
      };
      await this.sink.send(msg);
      out.push(msg);
    }

    if (rest.length === 0) return out;

    if (rest.length <= BATCH_THRESHOLD) {
      for (const p of rest) {
        const msg: AlertMessage = {
          severity: p.severity,
          problemIds: [p.id],
          th: `${SEVERITY_TH[p.severity]} ${p.pageName} (${p.clientName})\n${p.th}`,
        };
        await this.sink.send(msg);
        out.push(msg);
      }
      return out;
    }

    const lines = rest.map((p) => `• ${p.pageName}: ${p.th}`);
    const msg: AlertMessage = {
      severity: "warning",
      problemIds: rest.map((p) => p.id),
      th: `🟡 มี ${rest.length} เรื่องที่ต้องดู\n${lines.join("\n")}`,
    };
    await this.sink.send(msg);
    out.push(msg);
    return out;
  }
}

function summarize(sent: number, held: number, resolved: number): string {
  const parts: string[] = [];
  if (sent > 0) parts.push(`ส่งแจ้งเตือน ${sent} ข้อความ`);
  if (resolved > 0) parts.push(`แจ้งว่ากลับมาปกติ ${resolved} เรื่อง`);
  if (held > 0) parts.push(`พักไว้ ${held} เรื่อง (ยังไม่ถึงรอบเตือนซ้ำหรืออยู่ในช่วงเงียบ)`);
  return parts.length === 0 ? "ไม่มีอะไรต้องแจ้ง" : parts.join(" · ");
}
