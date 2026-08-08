/**
 * งานตามเวลา (cron)
 *
 * BullMQ เก็บตารางเวลาไว้ใน Redis ไม่ใช่ในโปรเซส แปลว่ารัน worker กี่ตัวก็ตาม
 * งานรอบหนึ่งจะเกิดใบเดียว — ไม่ต้องเขียน leader election เอง
 *
 * แต่มีกับดักที่ตามมา: **ตารางที่ลบออกจากโค้ดแล้วไม่หายไปจาก Redis เอง**
 * ถ้าเราเลิกใช้รอบไหนแล้วแค่ลบบรรทัดออก มันจะยังยิงต่อไปเรื่อยๆ ทุกวัน
 * โดยไม่มีใครรู้ จนกว่าจะไปเห็นงานประหลาดในคิว ไฟล์นี้จึงมีตัวเทียบ
 * "ของที่มีอยู่ใน Redis" กับ "ของที่ควรมีตามโค้ด" แล้วเก็บกวาดทุกครั้งที่สตาร์ท
 */
import { QUEUE, type QueueName } from "./names.js";

/** timezone ที่ใช้ตีความ pattern — เพจลูกค้าอยู่ไทยทั้งหมด (กฎข้อ 4) */
export const CRON_TZ = "Asia/Bangkok";

export interface CronSpec {
  /** ตัวระบุของตารางนี้ — เปลี่ยนชื่อ = เกิดตารางใหม่ ตัวเก่าจะถูกเก็บกวาดทิ้ง */
  name: string;
  queue: QueueName;
  /** cron 5 ช่อง */
  pattern: string;
  /** อธิบายว่ารอบนี้มีไว้ทำอะไร */
  th: string;
}

export const CRON_JOBS: readonly CronSpec[] = [
  {
    name: "publish-tick",
    queue: QUEUE.cron,
    pattern: "* * * * *",
    th: "ทุกนาที: หาโพสต์ที่ถึงเวลาแล้วยัดเข้าคิวยิง",
  },
  {
    name: "alerts-tick",
    queue: QUEUE.cron,
    pattern: "*/5 * * * *",
    th: "ทุก 5 นาที: ตรวจปัญหาทุกเพจแล้วส่งแจ้งเตือนที่ถึงกำหนด",
  },
  {
    name: "token-health",
    queue: QUEUE.cron,
    // สเปกข้อ 1: health check ทุก 6 ชม.
    pattern: "0 */6 * * *",
    th: "ทุก 6 ชม.: เช็คว่า token ของแต่ละเพจยังใช้ได้และใกล้หมดอายุหรือยัง",
  },
  {
    name: "analytics-sync",
    queue: QUEUE.cron,
    // สเปกข้อ 4: sync Insights รายวัน cron 03:00
    // ตี 3 ตามเวลาไทย = ข้อมูลของ "เมื่อวาน" ปิดวันเรียบร้อยแล้วแน่นอน
    pattern: "0 3 * * *",
    th: "ตี 3: ดึง Insights ของเมื่อวานมาเก็บใน DB ของเราเอง",
  },
  {
    name: "morning-digest",
    queue: QUEUE.cron,
    pattern: "30 8 * * *",
    th: "8:30 น.: สรุปงานเช้า — วันนี้ต้องทำอะไรบ้าง",
  },
  {
    name: "monthly-report",
    queue: QUEUE.cron,
    // สเปกข้อ 4: ส่งรายงานให้ลูกค้าทุกวันที่ 1
    pattern: "0 9 1 * *",
    th: "วันที่ 1 เวลา 9 โมง: สร้างรายงานเดือนที่แล้วส่งให้ลูกค้า",
  },
  {
    name: "purge-expired",
    queue: QUEUE.cron,
    pattern: "0 4 * * *",
    th: "ตี 4: ล้างลิงก์เข้าระบบที่หมดอายุแล้วออกจากตารางกันใช้ซ้ำ",
  },
];

// ---------------------------------------------------------------------------

/** ตารางที่มีอยู่จริงใน Redis ตอนนี้ (ย่อจากที่ `getJobSchedulers()` คืนมา) */
export interface ExistingRepeat {
  /** jobSchedulerId — ตรงกับ `CronSpec.name` ของเรา */
  key: string;
  pattern?: string | undefined;
  tz?: string | undefined;
}

export interface CronReconcilePlan {
  /** ต้องเขียนทับ (ยังไม่มี หรือมีแล้วแต่เวลาไม่ตรง) */
  toUpsert: CronSpec[];
  /** ต้องลบ พร้อมเหตุผลไว้ขึ้น log */
  toRemove: Array<{ key: string; reasonTh: string }>;
  unchanged: string[];
}

/**
 * เทียบตารางที่มีอยู่กับที่ควรมี
 *
 * แยกเป็นฟังก์ชันบริสุทธิ์เพราะนี่คือส่วนที่ผิดแล้วเจ็บและสังเกตยาก:
 * ลบผิดตัว = งานประจำหายไปเงียบๆ, ไม่ลบตัวเก่า = งานเบิ้ล
 * ทั้งสองแบบไม่มี error ให้เห็น กว่าจะรู้คือหลายวันหลังจากนั้น
 */
export function planCronReconcile(
  existing: readonly ExistingRepeat[],
  desired: readonly CronSpec[] = CRON_JOBS,
): CronReconcilePlan {
  const byName = new Map<string, CronSpec>(desired.map((s) => [s.name, s]));
  const plan: CronReconcilePlan = { toUpsert: [], toRemove: [], unchanged: [] };
  const matched = new Set<string>();

  for (const e of existing) {
    const want = byName.get(e.key);
    if (want === undefined) {
      plan.toRemove.push({
        key: e.key,
        reasonTh: "ไม่มีตารางชื่อนี้ในโค้ดแล้ว — ของค้างจากเวอร์ชันก่อน",
      });
      continue;
    }
    matched.add(e.key);
    if (e.pattern !== want.pattern) {
      plan.toUpsert.push(want);
      continue;
    }
    if (e.tz !== CRON_TZ) {
      plan.toUpsert.push(want);
      continue;
    }
    plan.unchanged.push(e.key);
  }

  for (const s of desired) {
    if (!matched.has(s.name)) plan.toUpsert.push(s);
  }

  return plan;
}

/**
 * ตรวจว่า pattern เป็น cron 5 ช่อง
 *
 * ไม่ได้ตั้งใจตรวจไวยากรณ์ cron ให้ครบ — ตั้งใจดักความผิดพลาดที่คนทำจริง
 * คือใส่ 6 ช่องแบบที่มีวินาที แล้วทุกช่องเลื่อนไปหนึ่งตำแหน่ง
 * `0 0 3 * * *` ที่ตั้งใจให้เป็นตี 3 จะกลายเป็น "ทุกวันที่ 3 ของเดือน"
 */
export function assertValidCronPattern(pattern: string): void {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `cron pattern ต้องมี 5 ช่อง แต่ "${pattern}" มี ${fields.length} ช่อง ` +
        `— ถ้าเผลอใส่ช่องวินาทีมาด้วย ทุกรอบจะเลื่อนไปคนละเวลา`,
    );
  }
}
