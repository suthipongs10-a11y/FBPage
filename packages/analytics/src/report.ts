/**
 * รายงานรายเดือน (M7)
 *
 * สเปกกำหนดหน้าที่ต้องมีไว้ชัดเจน:
 *   1. สรุปผู้บริหาร 1 หน้า
 *   2. กราฟเทียบเดือนก่อน
 *   3. 5 โพสต์ที่ดีที่สุด
 *   4. สรุปงาน inbox
 *   5. สิ่งที่จะทำเดือนหน้า
 *
 * ไฟล์นี้สร้าง "ข้อมูลรายงาน" อย่างเดียว การเรนเดอร์เป็น HTML/PDF อยู่ที่ render.ts
 * แยกกันเพื่อให้เทสต์ตัวเลขได้โดยไม่ต้องยุ่งกับการจัดหน้า
 */
import { formatMetric, metricDef, type MetricGroup } from "./metrics.js";
import { daysBetween, shiftDate, type DailyMetric } from "./sync.js";

export interface TopPost {
  postId: string;
  fbPostId?: string;
  /** ตัดให้สั้นพอใส่ในรายงาน */
  excerpt: string;
  publishedAtMs: number;
  engagement: number;
  mediaViews?: number;
  permalink?: string;
}

export interface MetricComparison {
  key: string;
  labelTh: string;
  group: MetricGroup;
  current: number;
  previous: number;
  /** เปลี่ยนกี่ % เทียบเดือนก่อน; null = เดือนก่อนเป็น 0 คำนวณไม่ได้ */
  changePct: number | null;
  /** ดีขึ้นหรือแย่ลง (คิดจาก higherIsBetter แล้ว) */
  direction: "up" | "down" | "flat";
  improved: boolean;
  currentText: string;
  previousText: string;
  changeText: string;
}

export interface InboxSummary {
  conversations: number;
  newContacts: number;
  avgResponseSeconds: number;
  slaBreaches: number;
  botContainmentRate: number;
  botEscalations: number;
  th: string;
}

export interface MonthlyReport {
  pageId: string;
  pageName: string;
  /** YYYY-MM */
  month: string;
  monthLabelTh: string;
  periodFrom: string;
  periodTo: string;
  /** ข้อความสรุปผู้บริหาร 3-5 บรรทัด */
  executiveSummary: string[];
  highlights: MetricComparison[];
  allMetrics: MetricComparison[];
  topPosts: TopPost[];
  inbox: InboxSummary;
  /** สิ่งที่จะทำเดือนหน้า */
  nextMonthPlan: string[];
  /** ข้อมูลไม่ครบ เตือนไว้ไม่ให้ลูกค้าเข้าใจผิด */
  warnings: string[];
  generatedAtMs: number;
}

const MONTH_TH = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

/** "2026-08" → "สิงหาคม 2569" (พ.ศ.) */
export function monthLabelTh(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTH_TH[m - 1] ?? "?"} ${y + 543}`;
}

/** วันแรกและวันสุดท้ายของเดือน */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** เดือนก่อนหน้า */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function sumBy(rows: readonly DailyMetric[], key: string): number {
  return rows
    .filter((r) => r.metricKey === key)
    .reduce((acc, r) => acc + r.value, 0);
}

function avgBy(rows: readonly DailyMetric[], key: string): number {
  const vals = rows.filter((r) => r.metricKey === key).map((r) => r.value);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** เมตริกที่ควรเฉลี่ยแทนที่จะรวม (อัตราส่วนและเวลา) */
const AVERAGED = new Set([
  "avg_response_seconds",
  "bot_containment_rate",
  "followers_total",
]);

function aggregate(rows: readonly DailyMetric[], key: string): number {
  return AVERAGED.has(key) ? avgBy(rows, key) : sumBy(rows, key);
}

export function compareMetric(
  key: string,
  current: number,
  previous: number,
): MetricComparison {
  const def = metricDef(key);
  const higherIsBetter = def?.higherIsBetter ?? true;

  const changePct =
    previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;

  const direction: "up" | "down" | "flat" =
    current > previous ? "up" : current < previous ? "down" : "flat";
  const improved =
    direction === "flat"
      ? true
      : higherIsBetter
        ? direction === "up"
        : direction === "down";

  const changeText =
    changePct === null
      ? previous === 0 && current > 0
        ? "เริ่มมีข้อมูลเดือนนี้"
        : "ไม่มีข้อมูลเดือนก่อนให้เทียบ"
      : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`;

  return {
    key,
    labelTh: def?.labelTh ?? key,
    group: def?.group ?? "engagement",
    current,
    previous,
    changePct,
    direction,
    improved,
    currentText: formatMetric(key, current),
    previousText: formatMetric(key, previous),
    changeText,
  };
}

export interface BuildReportArgs {
  pageId: string;
  pageName: string;
  /** YYYY-MM */
  month: string;
  currentRows: readonly DailyMetric[];
  previousRows: readonly DailyMetric[];
  topPosts: readonly TopPost[];
  /** สิ่งที่วางแผนไว้เดือนหน้า — คนกรอกเอง หรือ M-G สร้างให้ */
  nextMonthPlan?: string[];
  generatedAtMs: number;
}

/** เมตริกที่ขึ้นหน้าแรก (สรุปผู้บริหาร) */
const HIGHLIGHT_KEYS = [
  "viewers",
  "engagements",
  "followers",
  "inbox_conversations",
  "bot_containment_rate",
];

export function buildMonthlyReport(args: BuildReportArgs): MonthlyReport {
  const { from, to } = monthRange(args.month);
  const warnings: string[] = [];

  const daysInMonth = daysBetween(from, to) + 1;
  const daysWithData = new Set(args.currentRows.map((r) => r.date)).size;
  if (daysWithData === 0) {
    warnings.push(
      "ไม่มีข้อมูลของเดือนนี้เลย — อาจเพิ่งเชื่อมเพจ หรือ sync ยังไม่ทำงาน",
    );
  } else if (daysWithData < daysInMonth * 0.8) {
    warnings.push(
      `มีข้อมูลแค่ ${daysWithData} จาก ${daysInMonth} วัน — ตัวเลขอาจต่ำกว่าความจริง`,
    );
  }
  if (args.previousRows.length === 0) {
    warnings.push("ยังไม่มีข้อมูลเดือนก่อนให้เทียบ — รายงานหน้าถัดไปจะเทียบได้");
  }

  const keys = [
    ...new Set([
      ...args.currentRows.map((r) => r.metricKey),
      ...args.previousRows.map((r) => r.metricKey),
      ...HIGHLIGHT_KEYS,
    ]),
  ];

  const allMetrics = keys
    .map((k) =>
      compareMetric(
        k,
        aggregate(args.currentRows, k),
        aggregate(args.previousRows, k),
      ),
    )
    .sort((a, b) => a.labelTh.localeCompare(b.labelTh, "th"));

  const highlights = HIGHLIGHT_KEYS.map(
    (k) => allMetrics.find((m) => m.key === k)!,
  ).filter(Boolean);

  const inbox: InboxSummary = {
    conversations: aggregate(args.currentRows, "inbox_conversations"),
    newContacts: aggregate(args.currentRows, "inbox_new_contacts"),
    avgResponseSeconds: aggregate(args.currentRows, "avg_response_seconds"),
    slaBreaches: aggregate(args.currentRows, "sla_breaches"),
    botContainmentRate: aggregate(args.currentRows, "bot_containment_rate"),
    botEscalations: aggregate(args.currentRows, "bot_escalations"),
    th: "",
  };
  inbox.th = describeInbox(inbox);

  return {
    pageId: args.pageId,
    pageName: args.pageName,
    month: args.month,
    monthLabelTh: monthLabelTh(args.month),
    periodFrom: from,
    periodTo: to,
    executiveSummary: buildExecutiveSummary(
      args.pageName,
      args.month,
      highlights,
      inbox,
    ),
    highlights,
    allMetrics,
    topPosts: [...args.topPosts]
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 5),
    inbox,
    nextMonthPlan: args.nextMonthPlan ?? defaultNextMonthPlan(highlights, inbox),
    warnings,
    generatedAtMs: args.generatedAtMs,
  };
}

function describeInbox(i: InboxSummary): string {
  if (i.conversations === 0) {
    return "เดือนนี้ยังไม่มีลูกค้าทักเข้ามาในระบบ";
  }
  const parts = [
    `มีลูกค้าทักเข้ามา ${i.conversations.toLocaleString("th-TH")} บทสนทนา`,
    `เป็นลูกค้าใหม่ ${i.newContacts.toLocaleString("th-TH")} คน`,
    `ตอบเฉลี่ย ${formatMetric("avg_response_seconds", i.avgResponseSeconds)}`,
  ];
  if (i.botContainmentRate > 0) {
    parts.push(
      `บอทจบงานได้เอง ${formatMetric("bot_containment_rate", i.botContainmentRate)}`,
    );
  }
  if (i.slaBreaches > 0) {
    parts.push(`ตอบเกินเวลาที่สัญญาไว้ ${i.slaBreaches} ครั้ง`);
  }
  return parts.join(" · ");
}

/**
 * สรุปผู้บริหาร — ต้องอ่านจบใน 30 วินาทีแล้วรู้ว่าเดือนนี้เป็นยังไง
 * เขียนเป็นประโยคเต็ม ไม่ใช่ตัวเลขลอยๆ เพราะลูกค้าส่วนใหญ่ไม่ได้อ่านกราฟเป็น
 */
function buildExecutiveSummary(
  pageName: string,
  month: string,
  highlights: MetricComparison[],
  inbox: InboxSummary,
): string[] {
  const lines: string[] = [];
  lines.push(`สรุปผลการดูแลเพจ ${pageName} ประจำเดือน${monthLabelTh(month)}`);

  const viewers = highlights.find((h) => h.key === "viewers");
  if (viewers && viewers.current > 0) {
    lines.push(
      viewers.changePct === null
        ? `มีคนเห็นเพจ ${viewers.currentText} คน`
        : `มีคนเห็นเพจ ${viewers.currentText} คน (${viewers.changeText} จากเดือนก่อน)`,
    );
  }

  const eng = highlights.find((h) => h.key === "engagements");
  if (eng && eng.current > 0) {
    lines.push(
      eng.improved
        ? `การมีส่วนร่วมเพิ่มขึ้นเป็น ${eng.currentText} ครั้ง`
        : `การมีส่วนร่วมอยู่ที่ ${eng.currentText} ครั้ง ${eng.changeText} จากเดือนก่อน`,
    );
  }

  if (inbox.conversations > 0) lines.push(inbox.th);

  const declining = highlights.filter(
    (h) => !h.improved && h.changePct !== null && Math.abs(h.changePct) >= 10,
  );
  if (declining.length > 0) {
    lines.push(
      `จุดที่ต้องแก้เดือนหน้า: ${declining.map((d) => d.labelTh).join(", ")}`,
    );
  }
  return lines;
}

/** ถ้าไม่ได้กรอกแผนมา ให้เสนอจากตัวเลขที่เห็น */
function defaultNextMonthPlan(
  highlights: MetricComparison[],
  inbox: InboxSummary,
): string[] {
  const plan: string[] = [];

  const viewers = highlights.find((h) => h.key === "viewers");
  if (viewers && !viewers.improved) {
    plan.push("เพิ่มความถี่การโพสต์ในช่วงเวลาที่คนเห็นเยอะที่สุดของเพจ");
  }
  const eng = highlights.find((h) => h.key === "engagements");
  if (eng && !eng.improved) {
    plan.push("เพิ่มคอนเทนต์แบบมีส่วนร่วม (ถาม-ตอบ / โพล) ให้มากขึ้น");
  }
  if (inbox.slaBreaches > 0) {
    plan.push(`ลดการตอบเกินเวลา (เดือนนี้เกิน ${inbox.slaBreaches} ครั้ง)`);
  }
  if (inbox.botEscalations > 0) {
    plan.push("เพิ่มข้อมูลใน Knowledge Base จากคำถามที่บอทตอบไม่ได้");
  }
  if (plan.length === 0) {
    plan.push("รักษาความถี่และคุณภาพคอนเทนต์ตามเดือนนี้");
  }
  return plan;
}
