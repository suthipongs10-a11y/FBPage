import { describe, expect, it } from "vitest";
import {
  buildMonthlyReport,
  compareMetric,
  monthLabelTh,
  monthRange,
  previousMonth,
} from "./report.js";
import type { DailyMetric } from "./sync.js";
import type { TopPost } from "./report.js";

const GENERATED_AT = Date.parse("2026-09-01T03:00:00+07:00");

function rows(
  month: string,
  spec: Record<string, number[]>,
): DailyMetric[] {
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

const POSTS: TopPost[] = [
  {
    postId: "a",
    excerpt: "โปรโมชั่นเดือนสิงหา",
    publishedAtMs: Date.parse("2026-08-05T10:00:00+07:00"),
    engagement: 120,
    mediaViews: 3000,
  },
  {
    postId: "b",
    excerpt: "รีวิวจากลูกค้า",
    publishedAtMs: Date.parse("2026-08-12T10:00:00+07:00"),
    engagement: 450,
    mediaViews: 8000,
  },
  {
    postId: "c",
    excerpt: "เบื้องหลังการทำงาน",
    publishedAtMs: Date.parse("2026-08-20T10:00:00+07:00"),
    engagement: 80,
  },
];

describe("ฟังก์ชันเดือน", () => {
  it("แปลงเป็นชื่อเดือนไทยพร้อม พ.ศ.", () => {
    expect(monthLabelTh("2026-08")).toBe("สิงหาคม 2569");
    expect(monthLabelTh("2026-01")).toBe("มกราคม 2569");
    expect(monthLabelTh("2026-12")).toBe("ธันวาคม 2569");
  });

  it("หาช่วงวันของเดือน รวมเดือนที่มี 28/29/30/31 วัน", () => {
    expect(monthRange("2026-08")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(monthRange("2026-02").to).toBe("2026-02-28");
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(monthRange("2026-04").to).toBe("2026-04-30");
  });

  it("หาเดือนก่อนหน้า รวมข้ามปี", () => {
    expect(previousMonth("2026-08")).toBe("2026-07");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("compareMetric", () => {
  it("คำนวณเปอร์เซ็นต์การเปลี่ยนแปลง", () => {
    const m = compareMetric("viewers", 150, 100);
    expect(m.changePct).toBe(50);
    expect(m.direction).toBe("up");
    expect(m.improved).toBe(true);
    expect(m.changeText).toBe("+50.0%");
  });

  it("เมตริกที่ยิ่งน้อยยิ่งดี ลดลง = ดีขึ้น", () => {
    const m = compareMetric("avg_response_seconds", 60, 300);
    expect(m.direction).toBe("down");
    expect(m.improved).toBe(true);
  });

  it("เมตริกที่ยิ่งน้อยยิ่งดี เพิ่มขึ้น = แย่ลง", () => {
    expect(compareMetric("sla_breaches", 10, 2).improved).toBe(false);
  });

  it("เดือนก่อนเป็น 0 → บอกตรงๆ ว่าเทียบไม่ได้", () => {
    const started = compareMetric("viewers", 100, 0);
    expect(started.changePct).toBeNull();
    expect(started.changeText).toContain("เริ่มมีข้อมูล");

    const none = compareMetric("viewers", 0, 0);
    expect(none.changeText).toContain("ไม่มีข้อมูลเดือนก่อน");
  });

  it("เท่าเดิมถือว่าไม่แย่ลง", () => {
    const m = compareMetric("viewers", 100, 100);
    expect(m.direction).toBe("flat");
    expect(m.improved).toBe(true);
  });

  it("จัดรูปตัวเลขให้อ่านง่ายทั้งเดือนนี้และเดือนก่อน", () => {
    const m = compareMetric("avg_response_seconds", 90, 3600);
    expect(m.currentText).toBe("2 นาที");
    expect(m.previousText).toBe("1 ชั่วโมง");
  });
});

describe("buildMonthlyReport — โครงสร้างตามที่สเปกสั่ง", () => {
  const report = buildMonthlyReport({
    pageId: "p1",
    pageName: "ร้านกาแฟดีดี",
    month: "2026-08",
    currentRows: rows("2026-08", {
      viewers: Array(31).fill(100),
      engagements: Array(31).fill(20),
      followers: Array(31).fill(3),
      inbox_conversations: Array(31).fill(5),
      avg_response_seconds: Array(31).fill(120),
      bot_containment_rate: Array(31).fill(0.6),
      sla_breaches: Array(31).fill(0),
      bot_escalations: Array(31).fill(1),
      inbox_new_contacts: Array(31).fill(2),
    }),
    previousRows: rows("2026-07", {
      viewers: Array(31).fill(80),
      engagements: Array(31).fill(25),
      followers: Array(31).fill(2),
      inbox_conversations: Array(31).fill(4),
      bot_containment_rate: Array(31).fill(0.5),
    }),
    topPosts: POSTS,
    generatedAtMs: GENERATED_AT,
  });

  it("มีสรุปผู้บริหารเป็นประโยคเต็ม ไม่ใช่ตัวเลขลอยๆ", () => {
    expect(report.executiveSummary.length).toBeGreaterThanOrEqual(3);
    for (const line of report.executiveSummary) {
      expect(line).toMatch(/[ก-๙]/);
    }
    expect(report.executiveSummary[0]).toContain("ร้านกาแฟดีดี");
    expect(report.executiveSummary[0]).toContain("สิงหาคม 2569");
  });

  it("มีตัวเลขเทียบเดือนก่อน", () => {
    const viewers = report.highlights.find((h) => h.key === "viewers")!;
    expect(viewers.current).toBe(3100);
    expect(viewers.previous).toBe(2480);
    expect(viewers.improved).toBe(true);
  });

  it("เอา 5 โพสต์ที่ดีที่สุด เรียงตาม engagement", () => {
    expect(report.topPosts).toHaveLength(3);
    expect(report.topPosts[0]!.postId).toBe("b");
    expect(report.topPosts[0]!.engagement).toBe(450);
  });

  it("มีสรุปงาน inbox เป็นประโยคที่อ่านรู้เรื่อง", () => {
    expect(report.inbox.conversations).toBe(155);
    expect(report.inbox.th).toContain("บทสนทนา");
    expect(report.inbox.th).toMatch(/[ก-๙]/);
  });

  it("มีสิ่งที่จะทำเดือนหน้า", () => {
    expect(report.nextMonthPlan.length).toBeGreaterThan(0);
    for (const p of report.nextMonthPlan) expect(p).toMatch(/[ก-๙]/);
  });

  it("เมตริกที่เป็นอัตราส่วนใช้ค่าเฉลี่ย ไม่ใช่ผลรวม", () => {
    const rate = report.allMetrics.find((m) => m.key === "bot_containment_rate")!;
    expect(rate.current).toBeCloseTo(0.6, 5);
    expect(rate.currentText).toBe("60.0%");

    const resp = report.allMetrics.find((m) => m.key === "avg_response_seconds")!;
    expect(resp.current).toBe(120);
  });

  it("เมตริกที่เป็นจำนวนนับใช้ผลรวม", () => {
    expect(
      report.allMetrics.find((m) => m.key === "engagements")!.current,
    ).toBe(620);
  });

  it("แนะนำเดือนหน้าจากจุดที่แย่ลงจริง", () => {
    // engagements ลดลง (620 vs 775) → ควรมีคำแนะนำเรื่องนี้
    expect(report.nextMonthPlan.join(" ")).toMatch(/มีส่วนร่วม/);
  });
});

describe("buildMonthlyReport — กรณีข้อมูลไม่ครบ", () => {
  it("ไม่มีข้อมูลเลย → เตือน ไม่ใช่แสดงเลข 0 เฉยๆ ให้ลูกค้าเข้าใจผิด", () => {
    const r = buildMonthlyReport({
      pageId: "p1",
      pageName: "เพจใหม่",
      month: "2026-08",
      currentRows: [],
      previousRows: [],
      topPosts: [],
      generatedAtMs: GENERATED_AT,
    });
    expect(r.warnings.some((w) => w.includes("ไม่มีข้อมูล"))).toBe(true);
    expect(r.topPosts).toEqual([]);
  });

  it("ข้อมูลไม่ครบเดือน → เตือนว่าตัวเลขอาจต่ำกว่าความจริง", () => {
    const r = buildMonthlyReport({
      pageId: "p1",
      pageName: "เพจ",
      month: "2026-08",
      currentRows: rows("2026-08", { viewers: Array(10).fill(50) }),
      previousRows: rows("2026-07", { viewers: Array(31).fill(50) }),
      topPosts: [],
      generatedAtMs: GENERATED_AT,
    });
    expect(r.warnings.some((w) => w.includes("10 จาก 31"))).toBe(true);
  });

  it("เดือนแรกที่ยังไม่มีของเดือนก่อน → เตือนว่าเทียบไม่ได้", () => {
    const r = buildMonthlyReport({
      pageId: "p1",
      pageName: "เพจ",
      month: "2026-08",
      currentRows: rows("2026-08", { viewers: Array(31).fill(50) }),
      previousRows: [],
      topPosts: [],
      generatedAtMs: GENERATED_AT,
    });
    expect(r.warnings.some((w) => w.includes("เดือนก่อน"))).toBe(true);
  });

  it("มีโพสต์เกิน 5 อัน → เอาแค่ 5", () => {
    const many: TopPost[] = Array.from({ length: 12 }, (_, i) => ({
      postId: `p${i}`,
      excerpt: `โพสต์ ${i}`,
      publishedAtMs: GENERATED_AT,
      engagement: i * 10,
    }));
    const r = buildMonthlyReport({
      pageId: "p1",
      pageName: "เพจ",
      month: "2026-08",
      currentRows: [],
      previousRows: [],
      topPosts: many,
      generatedAtMs: GENERATED_AT,
    });
    expect(r.topPosts).toHaveLength(5);
    expect(r.topPosts[0]!.engagement).toBe(110);
  });

  it("กรอกแผนเดือนหน้าเองได้ ทับค่าที่ระบบเสนอ", () => {
    const r = buildMonthlyReport({
      pageId: "p1",
      pageName: "เพจ",
      month: "2026-08",
      currentRows: [],
      previousRows: [],
      topPosts: [],
      nextMonthPlan: ["ยิงแอดเพิ่ม 5,000 บาท"],
      generatedAtMs: GENERATED_AT,
    });
    expect(r.nextMonthPlan).toEqual(["ยิงแอดเพิ่ม 5,000 บาท"]);
  });
});
