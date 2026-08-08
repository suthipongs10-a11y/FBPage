import { describe, expect, it } from "vitest";
import { expectThaiThrow } from "@page-os/core/testing";
import type { MonthlyReport } from "@page-os/analytics";
import {
  buildPortalCalendar,
  buildPortalLeads,
  buildPortalReport,
  isThaiNationalId,
  leadsToCsv,
  scrubProhibitedPii,
  type CalendarSourceRow,
  type LeadSourceRow,
} from "./views.js";
import { DEFAULT_PERMISSIONS, type PortalScope } from "./scope.js";

const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);
const DAY = 86_400_000;

function scope(over: Partial<PortalScope> = {}): PortalScope {
  return {
    workspaceId: "ws-a",
    clientName: "ครัวคุณยาย",
    pageIds: ["p1", "p2"],
    permissions: DEFAULT_PERMISSIONS,
    email: "owner@krua.example",
    ...over,
  };
}

function row(over: Partial<CalendarSourceRow> = {}): CalendarSourceRow {
  return {
    postId: "s1",
    pageId: "p1",
    pageName: "ครัวคุณยาย — ข้าวกล่อง",
    scheduledAtMs: NOW + DAY,
    body: "พรุ่งนี้มีแกงส้มชะอมกุ้งค่ะ",
    pillarLabelTh: "ขาย",
    approval: "pending",
    ...over,
  };
}

const RANGE = { fromMs: NOW, toMs: NOW + 30 * DAY };

describe("buildPortalCalendar", () => {
  it("แสดงเฉพาะโพสต์ของเพจที่ลูกค้ารายนี้ดูแล", () => {
    const cal = buildPortalCalendar(
      scope(),
      [
        row({ postId: "ของเรา", pageId: "p1" }),
        row({ postId: "ของคนอื่น", pageId: "p-อื่น" }),
      ],
      RANGE,
    );
    expect(cal.posts.map((p) => p.postId)).toEqual(["ของเรา"]);
  });

  it("กรองตามช่วงเวลาที่ขอ", () => {
    const cal = buildPortalCalendar(
      scope(),
      [
        row({ postId: "ในช่วง", scheduledAtMs: NOW + DAY }),
        row({ postId: "นอกช่วง", scheduledAtMs: NOW + 60 * DAY }),
      ],
      RANGE,
    );
    expect(cal.posts.map((p) => p.postId)).toEqual(["ในช่วง"]);
  });

  it("เรียงตามเวลาโพสต์", () => {
    const cal = buildPortalCalendar(
      scope(),
      [
        row({ postId: "b", scheduledAtMs: NOW + 3 * DAY }),
        row({ postId: "a", scheduledAtMs: NOW + DAY }),
      ],
      RANGE,
    );
    expect(cal.posts.map((p) => p.postId)).toEqual(["a", "b"]);
  });

  it("โพสต์ที่รออนุมัติ → กดได้", () => {
    const cal = buildPortalCalendar(scope(), [row()], RANGE);
    expect(cal.posts[0]!.canDecide).toBe(true);
    expect(cal.pendingCount).toBe(1);
    expect(cal.th).toMatch(/รอให้คุณอนุมัติ/);
  });

  it("โพสต์ที่ขึ้นเพจแล้ว → ยังเห็นแต่กดไม่ได้", () => {
    // ลูกค้าต้องเห็นว่าเราทำอะไรไปบ้าง ไม่ใช่เห็นเฉพาะของที่ยังไม่ทำ
    const cal = buildPortalCalendar(
      scope(),
      [row({ approval: "approved", publishedAtMs: NOW - DAY })],
      RANGE,
    );
    expect(cal.posts[0]!.canDecide).toBe(false);
    expect(cal.posts[0]!.approvalTh).toBe("โพสต์แล้ว");
    expect(cal.posts[0]!.lockedReasonTh).toMatch(/ขึ้นเพจไปแล้ว/);
  });

  it("บัญชีที่ดูได้อย่างเดียว → กดไม่ได้ พร้อมบอกเหตุผล", () => {
    const cal = buildPortalCalendar(
      scope({ permissions: { ...DEFAULT_PERMISSIONS, approve: false } }),
      [row()],
      RANGE,
    );
    expect(cal.posts[0]!.canDecide).toBe(false);
    expect(cal.posts[0]!.lockedReasonTh).toMatch(/ดูได้อย่างเดียว/);
    expect(cal.pendingCount).toBe(0);
  });

  it("ไม่มีอะไรรออนุมัติ → บอกให้สบายใจ", () => {
    const cal = buildPortalCalendar(
      scope(),
      [row({ approval: "approved" })],
      RANGE,
    );
    expect(cal.th).toMatch(/ไม่มีอะไรรอคุณอนุมัติ/);
  });

  it("ผลลัพธ์ไม่มีฟิลด์ภายในติดไปเลย", () => {
    const cal = buildPortalCalendar(scope(), [row()], RANGE);
    const json = JSON.stringify(cal);
    for (const secret of ["cost", "botConfig", "Token", "workspaceId"]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("buildPortalReport", () => {
  const report: MonthlyReport = {
    pageId: "p1",
    pageName: "ครัวคุณยาย",
    month: "2026-07",
    monthLabelTh: "กรกฎาคม 2569",
    periodFrom: "2026-07-01",
    periodTo: "2026-07-31",
    executiveSummary: ["ยอดเข้าถึงเพิ่มขึ้น 12% จากเดือนก่อน"],
    highlights: [
      {
        key: "followers",
        labelTh: "ผู้ติดตาม",
        group: "reach",
        current: 1204,
        previous: 1100,
        changePct: 9.5,
        direction: "up",
        improved: true,
        currentText: "1,204",
        previousText: "1,100",
        changeText: "+9.5%",
      },
    ],
    allMetrics: Array.from({ length: 40 }, (_, i) => ({
      key: `m${i}`,
      labelTh: `เมตริก ${i}`,
      group: "reach" as const,
      current: i,
      previous: i,
      changePct: 0,
      direction: "flat" as const,
      improved: false,
      currentText: `${i}`,
      previousText: `${i}`,
      changeText: "0%",
    })),
    topPosts: [
      {
        postId: "x1",
        excerpt: "เมนูใหม่สัปดาห์นี้",
        publishedAtMs: NOW - 5 * DAY,
        engagement: 320,
        permalink: "https://facebook.com/x1",
      },
    ],
    inbox: {
      conversations: 84,
      newContacts: 31,
      avgResponseSeconds: 420,
      slaBreaches: 2,
      botContainmentRate: 0.62,
      botEscalations: 12,
      th: "ตอบเฉลี่ย 7 นาที บอทจัดการเองได้ 62%",
    },
    nextMonthPlan: ["เพิ่มคอนเทนต์รีวิวลูกค้า"],
    warnings: [],
    generatedAtMs: NOW,
  };

  it("แปลงเป็นรายงานที่ลูกค้าอ่านได้", () => {
    const r = buildPortalReport(scope(), report);
    expect(r.monthLabelTh).toBe("กรกฎาคม 2569");
    expect(r.highlights).toHaveLength(1);
    expect(r.topPosts[0]!.excerpt).toBe("เมนูใหม่สัปดาห์นี้");
    expect(r.inboxTh).toMatch(/62%/);
  });

  it("ตัดเมตริกดิบ 40 ตัวทิ้ง เหลือเฉพาะที่อธิบายได้", () => {
    // รายงานที่มีตัวเลขสี่สิบตัวไม่ได้แปลว่าทำงานเยอะ แต่แปลว่าไม่มีใครอ่าน
    const r = buildPortalReport(scope(), report) as unknown as Record<
      string,
      unknown
    >;
    expect(r.allMetrics).toBeUndefined();
  });

  it("รายงานของเพจที่ไม่ใช่ของลูกค้ารายนี้ → ปฏิเสธ", () => {
    const err = expectThaiThrow(() =>
      buildPortalReport(scope(), { ...report, pageId: "p-อื่น" }),
    );
    expect(err.th).toMatch(/หยุดไว้ก่อน/);
  });

  it("ไม่มีสิทธิ์ดูรายงาน → ปฏิเสธ", () => {
    expect(() =>
      buildPortalReport(
        scope({ permissions: { ...DEFAULT_PERMISSIONS, viewReports: false } }),
        report,
      ),
    ).toThrow();
  });

  it("คัดลอกอาเรย์ ไม่ส่ง reference ของต้นฉบับออกไป", () => {
    const r = buildPortalReport(scope(), report);
    r.executiveSummary.push("แก้จากข้างนอก");
    expect(report.executiveSummary).toHaveLength(1);
  });
});

describe("isThaiNationalId", () => {
  it("เลขที่ผ่าน checksum จริง", () => {
    // เลขทดสอบที่คำนวณ checksum ให้ถูกต้อง
    expect(isThaiNationalId("1101700207102")).toBe(true);
  });

  it("เลข 13 หลักที่ checksum ไม่ผ่าน → ไม่ใช่เลขบัตร", () => {
    // เลขออเดอร์ 13 หลักมีอยู่จริงและเยอะ ห้ามเบลอมั่ว
    expect(isThaiNationalId("1234567890123")).toBe(false);
  });

  it("ความยาวไม่ใช่ 13 → ไม่ใช่", () => {
    expect(isThaiNationalId("110170020710")).toBe(false);
    expect(isThaiNationalId("")).toBe(false);
  });
});

describe("scrubProhibitedPii", () => {
  it("ปิดเลขบัตรประชาชนที่ลูกค้าพิมพ์มาในแชท", () => {
    const r = scrubProhibitedPii("เลขบัตร 1101700207102 ค่ะ");
    expect(r.redacted).toBe(true);
    expect(r.text).not.toContain("1101700207102");
    expect(r.text).toMatch(/ปิดไว้/);
  });

  it("จับได้แม้เขียนคั่นด้วยขีดตามรูปแบบบนบัตร", () => {
    const r = scrubProhibitedPii("1-1017-00207-10-2");
    expect(r.redacted).toBe(true);
  });

  it("เบอร์โทรและเลขออเดอร์ไม่โดนเบลอ", () => {
    // ลูกค้าต้องอ่านข้อมูลของตัวเองได้ การเบลอเกินคือทำให้ฟีเจอร์ใช้ไม่ได้
    for (const keep of ["โทร 0812345678", "ออเดอร์ 1234567890123", "ราคา 1,290"]) {
      expect(scrubProhibitedPii(keep).redacted, keep).toBe(false);
    }
  });

  it("ข้อความปกติผ่านไปเหมือนเดิม", () => {
    const r = scrubProhibitedPii("คุณสมชาย สนใจข้าวกล่อง 30 กล่อง");
    expect(r.text).toBe("คุณสมชาย สนใจข้าวกล่อง 30 กล่อง");
    expect(r.redacted).toBe(false);
  });
});

describe("buildPortalLeads", () => {
  function lead(over: Partial<LeadSourceRow> = {}): LeadSourceRow {
    return {
      leadId: "l1",
      pageId: "p1",
      pageName: "ครัวคุณยาย",
      name: "คุณสมชาย",
      phone: "0812345678",
      capturedAtMs: NOW - DAY,
      tags: ["สนใจข้าวกล่อง"],
      ...over,
    };
  }

  it("เห็นเฉพาะ lead ของเพจตัวเอง", () => {
    const r = buildPortalLeads(scope(), [
      lead({ leadId: "ของเรา" }),
      lead({ leadId: "ของคนอื่น", pageId: "p-อื่น" }),
    ]);
    expect(r.leads.map((l) => l.leadId)).toEqual(["ของเรา"]);
  });

  it("เรียงจากใหม่ไปเก่า", () => {
    const r = buildPortalLeads(scope(), [
      lead({ leadId: "เก่า", capturedAtMs: NOW - 10 * DAY }),
      lead({ leadId: "ใหม่", capturedAtMs: NOW }),
    ]);
    expect(r.leads.map((l) => l.leadId)).toEqual(["ใหม่", "เก่า"]);
  });

  it("เบอร์โทรของ lead ยังเห็นได้ — เป็นข้อมูลของลูกค้าเอง", () => {
    const r = buildPortalLeads(scope(), [lead()]);
    expect(r.leads[0]!.phone).toBe("0812345678");
  });

  it("เลขบัตรประชาชนในช่องบันทึก → ถูกปิด และนับจำนวนไว้", () => {
    const r = buildPortalLeads(scope(), [
      lead({ note: "ส่งเลขบัตร 1101700207102 มาให้" }),
    ]);
    expect(r.leads[0]!.redacted).toBe(true);
    expect(r.leads[0]!.note).not.toContain("1101700207102");
    expect(r.redactedCount).toBe(1);
    expect(r.th).toMatch(/คุ้มครองข้อมูล/);
  });

  it("ไม่มีสิทธิ์ดู lead → ปฏิเสธ", () => {
    expect(() =>
      buildPortalLeads(
        scope({ permissions: { ...DEFAULT_PERMISSIONS, viewLeads: false } }),
        [lead()],
      ),
    ).toThrow();
  });
});

describe("leadsToCsv", () => {
  const leads = [
    {
      leadId: "l1",
      pageId: "p1",
      pageName: "ครัวคุณยาย",
      name: "คุณสมชาย",
      phone: "0812345678",
      capturedAtMs: Date.UTC(2026, 7, 1),
      tags: ["สนใจ"],
      redacted: false,
    },
  ];

  it("มีหัวตารางภาษาไทยและข้อมูลครบ", () => {
    const csv = leadsToCsv(leads);
    expect(csv.split("\n")[0]).toContain("ชื่อ");
    expect(csv).toContain("คุณสมชาย");
    expect(csv).toContain("0812345678");
  });

  it("อัญประกาศในข้อมูลถูก escape", () => {
    const csv = leadsToCsv([{ ...leads[0]!, name: 'คุณ "เอ"' }]);
    expect(csv).toContain('"คุณ ""เอ"""');
  });

  it("ชื่อที่ขึ้นต้นด้วย = ไม่กลายเป็นสูตรตอนเปิดใน Excel", () => {
    // ชื่อที่ขึ้นต้นด้วย = + - @ ถูก Excel ตีความเป็นสูตรและรันทันทีที่เปิดไฟล์
    const csv = leadsToCsv([{ ...leads[0]!, name: "=1+1" }]);
    expect(csv).toContain("\"'=1+1\"");
    expect(csv).not.toMatch(/,"=1\+1"/);
  });

  it("รายการว่าง → ได้แค่หัวตาราง", () => {
    expect(leadsToCsv([]).split("\n")).toHaveLength(1);
  });
});
