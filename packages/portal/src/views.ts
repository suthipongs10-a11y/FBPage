/**
 * สิ่งที่ลูกค้าเห็นใน portal (M9)
 *
 * สเปก: "เห็น: ปฏิทินคอนเทนต์, กดอนุมัติ/ขอแก้, ดูรายงาน, ดูรายชื่อ lead"
 *
 * ทุกฟังก์ชันในไฟล์นี้รับ `PortalScope` เป็นอาร์กิวเมนต์แรก และปิดท้ายด้วย
 * `assertNoLeak()` — สร้าง view โดยไม่มีขอบเขตไม่ได้ตามตั้งใจ
 *
 * และทุกฟังก์ชัน **แปลงข้อมูลภายในเป็นรูปร่างใหม่** ไม่ได้ส่งของจาก DB ตรงๆ
 * เพราะการส่งตรงคือวิธีที่ฟิลด์ใหม่ที่ใครสักคนเพิ่มในอีกหกเดือนจะหลุดออกไป
 * โดยไม่มีใครสังเกต
 */
import type { MonthlyReport } from "@page-os/analytics";
import type { ApprovalStatus } from "@page-os/publish";
import { statusTh } from "@page-os/publish";
import {
  assertCan,
  assertNoLeak,
  onlyInScope,
  type PortalScope,
} from "./scope.js";

/** โพสต์ในมุมมองลูกค้า — ไม่มีข้อมูลภายในติดมาเลย */
export interface PortalPost {
  postId: string;
  pageId: string;
  pageName: string;
  scheduledAtMs: number;
  /** ข้อความที่จะโพสต์จริง */
  body: string;
  /** ประเภทคอนเทนต์ เช่น "ให้ความรู้" — ช่วยให้ลูกค้าเห็นว่าไม่ได้ขายอย่างเดียว */
  pillarLabelTh: string;
  approval: ApprovalStatus;
  approvalTh: string;
  /** กดอนุมัติ/ขอแก้ได้ตอนนี้ไหม */
  canDecide: boolean;
  /** ทำไมกดไม่ได้ (ถ้ากดไม่ได้) */
  lockedReasonTh?: string;
}

export interface PortalCalendar {
  clientName: string;
  fromMs: number;
  toMs: number;
  posts: PortalPost[];
  pendingCount: number;
  th: string;
}

/** ข้อมูลดิบจากฝั่งระบบ — ตัวที่เรียกเป็นคนดึงมาจาก DB */
export interface CalendarSourceRow {
  postId: string;
  pageId: string;
  pageName: string;
  scheduledAtMs: number;
  body: string;
  pillarLabelTh: string;
  approval: ApprovalStatus;
  publishedAtMs?: number | null;
}

/**
 * ปฏิทินคอนเทนต์ของลูกค้า
 *
 * โพสต์ที่ขึ้นเพจไปแล้วยังแสดง แต่กดเปลี่ยนไม่ได้ — ลูกค้าต้องเห็นว่าเราทำอะไรไปบ้าง
 * ไม่ใช่เห็นเฉพาะของที่ยังไม่ทำ
 */
export function buildPortalCalendar(
  scope: PortalScope,
  rows: readonly CalendarSourceRow[],
  range: { fromMs: number; toMs: number },
): PortalCalendar {
  const inRange = onlyInScope(scope, rows).filter(
    (r) => r.scheduledAtMs >= range.fromMs && r.scheduledAtMs <= range.toMs,
  );

  const posts: PortalPost[] = inRange
    .sort((a, b) => a.scheduledAtMs - b.scheduledAtMs)
    .map((r) => {
      const published = r.publishedAtMs != null;
      const decidable =
        scope.permissions.approve && !published && r.approval === "pending";

      const lockedReason = published
        ? "โพสต์นี้ขึ้นเพจไปแล้ว"
        : !scope.permissions.approve
          ? "บัญชีของคุณดูได้อย่างเดียว"
          : r.approval === "none"
            ? "โพสต์นี้ไม่ต้องรออนุมัติ"
            : undefined;

      return {
        postId: r.postId,
        pageId: r.pageId,
        pageName: r.pageName,
        scheduledAtMs: r.scheduledAtMs,
        body: r.body,
        pillarLabelTh: r.pillarLabelTh,
        approval: r.approval,
        approvalTh: published ? "โพสต์แล้ว" : statusTh(r.approval),
        canDecide: decidable,
        ...(lockedReason !== undefined && !decidable
          ? { lockedReasonTh: lockedReason }
          : {}),
      };
    });

  const pendingCount = posts.filter((p) => p.canDecide).length;

  const view: PortalCalendar = {
    clientName: scope.clientName,
    fromMs: range.fromMs,
    toMs: range.toMs,
    posts,
    pendingCount,
    th:
      pendingCount === 0
        ? `มี ${posts.length} โพสต์ในช่วงนี้ ไม่มีอะไรรอคุณอนุมัติ`
        : `มี ${pendingCount} โพสต์รอให้คุณอนุมัติ จากทั้งหมด ${posts.length} โพสต์`,
  };

  assertNoLeak(view, scope);
  return view;
}

// ── รายงาน ─────────────────────────────────────────────────────────────────

export interface PortalReport {
  pageId: string;
  pageName: string;
  month: string;
  monthLabelTh: string;
  executiveSummary: string[];
  highlights: Array<{
    labelTh: string;
    currentText: string;
    changeText: string;
    improved: boolean;
  }>;
  topPosts: Array<{
    excerpt: string;
    publishedAtMs: number;
    engagement: number;
    permalink?: string;
  }>;
  inboxTh: string;
  nextMonthPlan: string[];
  warnings: string[];
}

/**
 * แปลงรายงานภายในเป็นรายงานสำหรับลูกค้า
 *
 * ตัด `allMetrics` ทิ้งโดยเจตนา เหลือเฉพาะ `highlights` — รายงานที่มีตัวเลข
 * สี่สิบตัวไม่ได้แปลว่าทำงานเยอะ แต่แปลว่าไม่มีใครอ่าน สิ่งที่รักษาลูกค้าไว้ได้
 * คือห้าตัวที่อธิบายได้ว่าเดือนนี้ดีขึ้นตรงไหน
 */
export function buildPortalReport(
  scope: PortalScope,
  report: MonthlyReport,
): PortalReport {
  assertCan(scope, "viewReports");

  const view: PortalReport = {
    pageId: report.pageId,
    pageName: report.pageName,
    month: report.month,
    monthLabelTh: report.monthLabelTh,
    executiveSummary: [...report.executiveSummary],
    highlights: report.highlights.map((h) => ({
      labelTh: h.labelTh,
      currentText: h.currentText,
      changeText: h.changeText,
      improved: h.improved,
    })),
    topPosts: report.topPosts.map((p) => ({
      excerpt: p.excerpt,
      publishedAtMs: p.publishedAtMs,
      engagement: p.engagement,
      ...(p.permalink !== undefined ? { permalink: p.permalink } : {}),
    })),
    inboxTh: report.inbox.th,
    nextMonthPlan: [...report.nextMonthPlan],
    warnings: [...report.warnings],
  };

  // ตรวจหลังแปลง ไม่ใช่ก่อน — เพจของรายงานต้องเป็นเพจของลูกค้ารายนี้จริง
  assertNoLeak(view, scope);
  return view;
}

// ── Lead ───────────────────────────────────────────────────────────────────

export interface LeadSourceRow {
  leadId: string;
  pageId: string;
  pageName: string;
  name: string;
  phone?: string;
  note?: string;
  capturedAtMs: number;
  tags?: string[];
}

export interface PortalLead {
  leadId: string;
  pageId: string;
  pageName: string;
  name: string;
  phone?: string;
  note?: string;
  capturedAtMs: number;
  tags: string[];
  /** ข้อมูลบางส่วนถูกปิดไว้เพราะเป็นข้อมูลที่ห้ามเก็บ */
  redacted: boolean;
}

/**
 * เลขบัตรประชาชนไทยถูกต้องตามหลักตรวจสอบหรือไม่
 *
 * ตรวจ checksum จริง ไม่ใช่แค่นับว่ามี 13 หลัก — เลขออเดอร์ 13 หลัก
 * มีอยู่จริงและเยอะ ถ้าเบลอทุกอย่างที่ยาว 13 หลัก ลูกค้าจะอ่านข้อมูลตัวเองไม่ได้
 */
export function isThaiNationalId(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return ((11 - (sum % 11)) % 10) === Number(digits[12]);
}

/**
 * ปิดข้อมูลที่สเปกห้ามเก็บ (M6: "ห้ามเก็บ เลขบัตรประชาชน, ข้อมูลสุขภาพ")
 *
 * บอทไม่ควรถามอยู่แล้ว แต่ลูกค้าพิมพ์เองมาในแชทได้ตลอด แล้วมันจะไหลมาอยู่ใน
 * ช่องบันทึกของ lead ตัวนี้จึงเป็นด่านตอนแสดงผล — ไม่ได้แก้ที่ต้นทาง
 * แต่อย่างน้อยเลขบัตรจะไม่ถูกโชว์ซ้ำและไม่ถูก export ออกไป
 */
export function scrubProhibitedPii(text: string): {
  text: string;
  redacted: boolean;
} {
  let redacted = false;
  const out = text.replace(/\d[\d\s-]{11,20}\d/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length === 13 && isThaiNationalId(digits)) {
      redacted = true;
      return "[ปิดไว้: เลขบัตรประชาชน]";
    }
    return m;
  });
  return { text: out, redacted };
}

export function buildPortalLeads(
  scope: PortalScope,
  rows: readonly LeadSourceRow[],
): { leads: PortalLead[]; redactedCount: number; th: string } {
  assertCan(scope, "viewLeads");

  const leads: PortalLead[] = onlyInScope(scope, rows)
    .sort((a, b) => b.capturedAtMs - a.capturedAtMs)
    .map((r) => {
      const name = scrubProhibitedPii(r.name);
      const note =
        r.note !== undefined ? scrubProhibitedPii(r.note) : undefined;
      return {
        leadId: r.leadId,
        pageId: r.pageId,
        pageName: r.pageName,
        name: name.text,
        ...(r.phone !== undefined ? { phone: r.phone } : {}),
        ...(note !== undefined ? { note: note.text } : {}),
        capturedAtMs: r.capturedAtMs,
        tags: [...(r.tags ?? [])],
        redacted: name.redacted || (note?.redacted ?? false),
      };
    });

  const redactedCount = leads.filter((l) => l.redacted).length;
  const result = {
    leads,
    redactedCount,
    th:
      redactedCount === 0
        ? `มีผู้สนใจ ${leads.length} รายในระบบ`
        : `มีผู้สนใจ ${leads.length} ราย (ปิดเลขบัตรประชาชนไว้ ${redactedCount} ราย ตามข้อกำหนดการคุ้มครองข้อมูล)`,
  };

  assertNoLeak(result, scope);
  return result;
}

/** ส่งออกเป็น CSV ให้ลูกค้า (สเปกข้อ M6 "Export CSV ให้ลูกค้าได้ทุกเมื่อ") */
export function leadsToCsv(leads: readonly PortalLead[]): string {
  const esc = (v: string): string => {
    // นำหน้าด้วยอัญประกาศเดี่ยวเมื่อขึ้นต้นด้วยอักขระที่ Excel ตีความเป็นสูตร
    // ไม่งั้นชื่อที่ขึ้นต้นด้วย "=" จะกลายเป็นสูตรที่รันตอนลูกค้าเปิดไฟล์
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = ["ชื่อ", "เบอร์โทร", "เพจ", "แท็ก", "บันทึก", "วันที่"];
  const lines = [head.map(esc).join(",")];
  for (const l of leads) {
    lines.push(
      [
        esc(l.name),
        esc(l.phone ?? ""),
        esc(l.pageName),
        esc(l.tags.join(" ")),
        esc(l.note ?? ""),
        esc(new Date(l.capturedAtMs).toISOString()),
      ].join(","),
    );
  }
  return lines.join("\n");
}
