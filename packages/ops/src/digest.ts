/**
 * สรุปงานเช้าส่งเข้า LINE (M8)
 *
 * เกณฑ์รับงานของ M-I คือ **"ดูแล 10 เพจโดยใช้เวลา < 2 ชม./วัน"**
 *
 * สิ่งที่กินเวลาจริงไม่ใช่การทำงาน แต่คือการ **เปิดจอไปไล่ดูว่ามีอะไรต้องทำบ้าง**
 * ถ้าเช้ามาได้ข้อความเดียวที่บอกว่าวันนี้ต้องทำอะไร เรียงตามลำดับแล้ว
 * ก็ลงมือได้เลยโดยไม่ต้องเปิดจอ
 *
 * ข้อความต้อง **อ่านจบในหน้าจอมือถือเดียว** — สรุปที่ต้องเลื่อนสามหน้า
 * ก็คือจออีกจอหนึ่ง ไม่ได้ช่วยอะไร
 */
import type { Problem } from "./problems.js";

export interface DigestInput {
  nowMs: number;
  /** ปัญหาที่ค้างอยู่ (จาก collectProblems) */
  problems: readonly Problem[];
  /** บทสนทนาที่รอตอบ */
  waitingConversations: number;
  /** บทสนทนาที่เลยเวลาที่สัญญาไว้ */
  breachedConversations: number;
  /** โพสต์ที่รอลูกค้าอนุมัติ */
  pendingApprovals: number;
  /** โพสต์ที่เลยเวลาแล้วแต่ยังไม่อนุมัติ */
  lateApprovals: number;
  /** โพสต์ที่จะขึ้นเองวันนี้ */
  postsToday: number;
  pageCount: number;
}

export interface Digest {
  /** ข้อความพร้อมส่งเข้า LINE */
  th: string;
  /** มีอะไรต้องทำไหม — ไม่มีก็ไม่ต้องส่ง */
  hasWork: boolean;
  /** จำนวนงานที่ต้องแตะวันนี้ */
  taskCount: number;
}

/** เอาปัญหามาแสดงกี่บรรทัด — เกินนี้ยุบเป็น "และอีก N" */
const MAX_PROBLEM_LINES = 4;

/**
 * ประกอบสรุปเช้า
 *
 * ลำดับในข้อความคือลำดับที่ควรลงมือ ไม่ใช่ลำดับที่โค้ดคำนวณ:
 * ของพัง → ข้อความที่เลยเวลา → ข้อความที่ยังมีเวลา → โพสต์รออนุมัติ →
 * ของที่จะเกิดเองวันนี้
 */
export function buildDigest(input: DigestInput): Digest {
  const critical = input.problems.filter((p) => p.severity === "critical");
  const warnings = input.problems.filter((p) => p.severity === "warning");

  const taskCount =
    input.problems.length +
    input.waitingConversations +
    input.pendingApprovals;

  const lines: string[] = [];

  if (critical.length > 0) {
    lines.push(`🔴 พังอยู่ ${critical.length} เรื่อง — แก้ก่อนอย่างอื่น`);
    for (const p of critical.slice(0, MAX_PROBLEM_LINES)) {
      lines.push(`   • ${p.pageName}: ${p.th}`);
    }
    if (critical.length > MAX_PROBLEM_LINES) {
      lines.push(`   • และอีก ${critical.length - MAX_PROBLEM_LINES} เรื่อง`);
    }
  }

  if (input.breachedConversations > 0) {
    lines.push(
      `⏰ เลยเวลาที่สัญญากับลูกค้าไว้ ${input.breachedConversations} บทสนทนา — ตอบเดี๋ยวนี้`,
    );
  }

  const stillOk = input.waitingConversations - input.breachedConversations;
  if (stillOk > 0) {
    lines.push(`💬 รอตอบอีก ${stillOk} บทสนทนา ยังอยู่ในเวลา`);
  }

  if (input.lateApprovals > 0) {
    lines.push(
      `📝 มี ${input.lateApprovals} โพสต์ที่เลยเวลาแล้วแต่ลูกค้ายังไม่กดอนุมัติ — ต้องตามลูกค้า`,
    );
  }
  const normalApprovals = input.pendingApprovals - input.lateApprovals;
  if (normalApprovals > 0) {
    lines.push(`📝 รอลูกค้าอนุมัติอีก ${normalApprovals} โพสต์`);
  }

  if (warnings.length > 0 && critical.length === 0) {
    lines.push(`🟡 มี ${warnings.length} เรื่องที่ควรดูเมื่อว่าง`);
  }

  if (input.postsToday > 0) {
    lines.push(`📅 วันนี้มี ${input.postsToday} โพสต์ที่จะขึ้นเอง ไม่ต้องทำอะไร`);
  }

  if (lines.length === 0) {
    return {
      hasWork: false,
      taskCount: 0,
      th: `☀️ สรุปเช้านี้: ไม่มีอะไรค้าง ทั้ง ${input.pageCount} เพจเรียบร้อย`,
    };
  }

  return {
    hasWork: taskCount > 0,
    taskCount,
    th: [`☀️ สรุปเช้านี้ (${input.pageCount} เพจ)`, ...lines].join("\n"),
  };
}
