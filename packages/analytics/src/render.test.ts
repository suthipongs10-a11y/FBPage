import { describe, expect, it } from "vitest";
import { buildMonthlyReport, type TopPost } from "./report.js";
import { escapeHtml, renderReportHtml } from "./render.js";
import type { DailyMetric } from "./sync.js";

const GENERATED_AT = Date.parse("2026-09-01T03:00:00+07:00");

function rows(month: string, spec: Record<string, number[]>): DailyMetric[] {
  const out: DailyMetric[] = [];
  for (const [metricKey, values] of Object.entries(spec)) {
    values.forEach((value, i) => {
      out.push({
        pageId: "p1",
        date: `${month}-${String(i + 1).padStart(2, "0")}`,
        metricKey,
        value,
      });
    });
  }
  return out;
}

function makeReport(over: { pageName?: string; topPosts?: TopPost[] } = {}) {
  return buildMonthlyReport({
    pageId: "p1",
    pageName: over.pageName ?? "ร้านกาแฟดีดี",
    month: "2026-08",
    currentRows: rows("2026-08", {
      viewers: Array(31).fill(100),
      engagements: Array(31).fill(20),
      inbox_conversations: Array(31).fill(5),
    }),
    previousRows: rows("2026-07", {
      viewers: Array(31).fill(80),
      engagements: Array(31).fill(25),
    }),
    topPosts: over.topPosts ?? [
      {
        postId: "a",
        excerpt: "โปรโมชั่นเดือนสิงหา",
        publishedAtMs: Date.parse("2026-08-05T10:00:00+07:00"),
        engagement: 120,
        mediaViews: 3000,
        permalink: "https://facebook.com/post/1",
      },
    ],
    generatedAtMs: GENERATED_AT,
  });
}

describe("escapeHtml", () => {
  it("หนีอักขระที่มีความหมายใน HTML", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("A & B")).toBe("A &amp; B");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("ข้อความไทยไม่ถูกแตะ", () => {
    expect(escapeHtml("สวัสดีครับ")).toBe("สวัสดีครับ");
  });
});

describe("renderReportHtml — ความปลอดภัย", () => {
  it("ชื่อเพจที่มี HTML ต้องถูก escape ไม่ใช่ฝังเป็นแท็ก", () => {
    const html = renderReportHtml(
      makeReport({ pageName: '<img src=x onerror="alert(1)">' }),
      { agencyName: "เอเจนซี่" },
    );
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img src=x");
  });

  it("เนื้อหาโพสต์ที่มี HTML ถูก escape", () => {
    const html = renderReportHtml(
      makeReport({
        topPosts: [
          {
            postId: "x",
            excerpt: "<b>ตัวหนา</b><script>bad()</script>",
            publishedAtMs: GENERATED_AT,
            engagement: 1,
          },
        ],
      }),
      { agencyName: "เอเจนซี่" },
    );
    expect(html).not.toContain("<script>bad()</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("ชื่อเอเจนซี่และ footer ก็ถูก escape", () => {
    const html = renderReportHtml(makeReport(), {
      agencyName: "<b>เอเจนซี่</b>",
      footerNote: "<i>หมายเหตุ</i>",
    });
    expect(html).not.toContain("<b>เอเจนซี่</b>");
    expect(html).not.toContain("<i>หมายเหตุ</i>");
  });

  it("สีแบรนด์ที่พยายามแทรก CSS ถูก escape", () => {
    const html = renderReportHtml(makeReport(), {
      agencyName: "ก",
      primaryColor: '#fff"><script>x()</script>',
    });
    expect(html).not.toContain("<script>x()</script>");
  });
});

describe("renderReportHtml — เนื้อหาครบตามที่สเปกสั่ง", () => {
  const html = renderReportHtml(makeReport(), {
    agencyName: "เอเจนซี่ของผม",
    primaryColor: "#0066cc",
  });

  it("เป็น HTML ที่สมบูรณ์และระบุภาษาไทย", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('lang="th"');
    expect(html).toContain('charset="utf-8"');
  });

  it("หน้า 1 สรุปผู้บริหาร", () => {
    expect(html).toContain("สรุปผู้บริหาร");
    expect(html).toContain("ร้านกาแฟดีดี");
    expect(html).toContain("สิงหาคม 2569");
  });

  it("หน้า 2 กราฟเทียบเดือนก่อน", () => {
    expect(html).toContain("เทียบกับเดือนก่อน");
    expect(html).toContain("<svg");
    expect(html).toContain("เดือนก่อน");
  });

  it("หน้า 3 โพสต์ที่ดีที่สุด และสรุป inbox", () => {
    expect(html).toContain("5 โพสต์ที่ทำผลงานดีที่สุด");
    expect(html).toContain("โปรโมชั่นเดือนสิงหา");
    expect(html).toContain("สรุปงานตอบข้อความ");
  });

  it("หน้า 4 สิ่งที่จะทำเดือนหน้า", () => {
    expect(html).toContain("สิ่งที่จะทำเดือนหน้า");
  });

  it("ใส่แบรนด์ของเอเจนซี่", () => {
    expect(html).toContain("เอเจนซี่ของผม");
    expect(html).toContain("#0066cc");
  });

  it("ตั้งค่าหน้ากระดาษ A4 สำหรับแปลงเป็น PDF", () => {
    expect(html).toContain("@page");
    expect(html).toContain("A4");
    expect(html).toContain("page-break-after");
  });

  it("ใช้ฟอนต์ที่รองรับภาษาไทย", () => {
    expect(html).toMatch(/Sarabun|Noto Sans Thai|Leelawadee/);
  });
});

describe("renderReportHtml — กรณีข้อมูลว่าง", () => {
  it("ไม่มีโพสต์ → แสดงข้อความแทนตารางว่าง", () => {
    const report = buildMonthlyReport({
      pageId: "p1",
      pageName: "เพจใหม่",
      month: "2026-08",
      currentRows: [],
      previousRows: [],
      topPosts: [],
      generatedAtMs: GENERATED_AT,
    });
    const html = renderReportHtml(report, { agencyName: "ก" });
    expect(html).toContain("ยังไม่มีโพสต์");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("คำเตือนถูกแสดงให้ลูกค้าเห็น", () => {
    const report = buildMonthlyReport({
      pageId: "p1",
      pageName: "เพจ",
      month: "2026-08",
      currentRows: [],
      previousRows: [],
      topPosts: [],
      generatedAtMs: GENERATED_AT,
    });
    const html = renderReportHtml(report, { agencyName: "ก" });
    expect(html).toContain("หมายเหตุ");
    expect(html).toContain("ไม่มีข้อมูลของเดือนนี้");
  });

  it("โพสต์ที่ไม่มี permalink หรือยอดดู ไม่แสดง undefined", () => {
    const report = buildMonthlyReport({
      pageId: "p1",
      pageName: "เพจ",
      month: "2026-08",
      currentRows: rows("2026-08", { viewers: Array(31).fill(10) }),
      previousRows: [],
      topPosts: [
        {
          postId: "x",
          excerpt: "โพสต์ไม่มีลิงก์",
          publishedAtMs: GENERATED_AT,
          engagement: 5,
        },
      ],
      generatedAtMs: GENERATED_AT,
    });
    const html = renderReportHtml(report, { agencyName: "ก" });
    expect(html).not.toContain("undefined");
    expect(html).toContain("โพสต์ไม่มีลิงก์");
  });
});
