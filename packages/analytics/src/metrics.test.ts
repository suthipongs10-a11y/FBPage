import { describe, expect, it } from "vitest";
import {
  DEPRECATED_METRICS,
  DeprecatedMetricError,
  METRICS,
  assertNotDeprecated,
  isDeprecatedMetric,
  formatMetric,
  keyForMetaName,
  metaMetricNames,
  metricDef,
} from "./metrics.js";

describe("เมตริกที่ปลดระวาง (สเปกข้อ 0)", () => {
  it("ปฏิเสธ page_impressions และ reach ที่ปลดระวาง มิ.ย. 2026", () => {
    for (const m of [
      "page_impressions",
      "page_impressions_unique",
      "page_reach",
      "post_impressions",
      "post_reach",
    ]) {
      expect(() => assertNotDeprecated(m), m).toThrow(DeprecatedMetricError);
    }
  });

  it("บอกว่าให้ใช้อะไรแทน เป็นภาษาไทย", () => {
    try {
      assertNotDeprecated("page_impressions");
      expect.unreachable("ควรจะโยน error");
    } catch (err) {
      expect(err).toBeInstanceOf(DeprecatedMetricError);
      expect((err as DeprecatedMetricError).th).toMatch(/[ก-๙]/);
      expect((err as DeprecatedMetricError).th).toContain("page_views_total");
    }
  });

  it("จับตระกูลเมตริกที่ปลดระวาง ไม่ใช่แค่ชื่อที่ตรงเป๊ะ", () => {
    // Meta มีตัวแปรย่อยเยอะ ถ้าเทียบตรงตัวจะหลุด แล้วรายงานลูกค้าขึ้นเลข 0
    // โดยไม่มี error ให้เห็น ซึ่งแย่กว่าพังเสียอีก
    for (const m of [
      "page_impressions_by_story_type",
      "page_consumptions_by_consumption_type",
      "page_reach_by_age_gender",
      "post_impressions_by_paid_non_paid",
      "page_negative_feedback_by_type",
    ]) {
      expect(() => assertNotDeprecated(m), m).toThrow(DeprecatedMetricError);
      expect(isDeprecatedMetric(m), m).toBe(true);
    }
  });

  it("ไม่มีเมตริกในตระกูลที่ปลดระวางหลงอยู่ในรายการที่ระบบใช้", () => {
    for (const m of METRICS) {
      if (m.metaName) {
        expect(isDeprecatedMetric(m.metaName), `${m.key} → ${m.metaName}`).toBe(
          false,
        );
      }
    }
  });

  it("เมตริกใหม่ผ่านได้", () => {
    for (const m of ["page_views_total", "page_viewer_metric", "page_follows"]) {
      expect(() => assertNotDeprecated(m), m).not.toThrow();
    }
  });

  it("ไม่มีเมตริกที่ปลดระวางหลงอยู่ในรายการที่ระบบใช้", () => {
    const deprecated = new Set<string>(DEPRECATED_METRICS);
    for (const m of METRICS) {
      if (m.metaName) {
        expect(deprecated.has(m.metaName), `${m.key} → ${m.metaName}`).toBe(
          false,
        );
      }
    }
  });

  it("รายการเมตริกที่จะยิงไป Meta สะอาดทั้งหมด", () => {
    for (const n of metaMetricNames()) {
      expect(() => assertNotDeprecated(n), n).not.toThrow();
    }
  });
});

describe("รายการเมตริกครอบคลุมสิ่งที่สเปกข้อ M7 สั่ง", () => {
  it("มีเมตริกใหม่แทน reach/impressions", () => {
    const keys = METRICS.map((m) => m.key);
    expect(keys).toContain("viewers");
    expect(keys).toContain("page_views");
    expect(keys).toContain("media_views");
  });

  it("มี followers, engagement, link clicks", () => {
    const keys = METRICS.map((m) => m.key);
    expect(keys).toContain("followers");
    expect(keys).toContain("engagements");
    expect(keys).toContain("link_clicks");
  });

  it("มียอด inbox, เวลาตอบเฉลี่ย, อัตราบอทตอบเอง", () => {
    const keys = METRICS.map((m) => m.key);
    expect(keys).toContain("inbox_conversations");
    expect(keys).toContain("avg_response_seconds");
    expect(keys).toContain("bot_containment_rate");
  });

  it("ทุกเมตริกมีชื่อไทยสำหรับแสดงในรายงานลูกค้า", () => {
    for (const m of METRICS) {
      expect(m.labelTh, m.key).toMatch(/[ก-๙]/);
    }
  });

  it("คีย์ไม่ซ้ำกัน", () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("แมป metaName กลับเป็นคีย์ของเราได้", () => {
    expect(keyForMetaName("page_follows")).toBe("followers");
    expect(keyForMetaName("ไม่มีเมตริกนี้")).toBeUndefined();
  });

  it("เมตริกที่เราคำนวณเองไม่มี metaName", () => {
    expect(metricDef("bot_containment_rate")!.metaName).toBeUndefined();
    expect(metricDef("inbox_conversations")!.metaName).toBeUndefined();
  });

  it("เวลาตอบเฉลี่ย ยิ่งน้อยยิ่งดี", () => {
    expect(metricDef("avg_response_seconds")!.higherIsBetter).toBe(false);
    expect(metricDef("sla_breaches")!.higherIsBetter).toBe(false);
    expect(metricDef("viewers")!.higherIsBetter).toBe(true);
  });
});

describe("formatMetric — จัดรูปให้ลูกค้าอ่านง่าย", () => {
  it("จำนวนนับใส่ตัวคั่นหลักพัน", () => {
    expect(formatMetric("viewers", 12345)).toBe("12,345");
  });

  it("เปอร์เซ็นต์", () => {
    expect(formatMetric("bot_containment_rate", 0.678)).toBe("67.8%");
  });

  it("เวลาแปลงเป็นหน่วยที่อ่านง่าย", () => {
    expect(formatMetric("avg_response_seconds", 45)).toBe("45 วินาที");
    expect(formatMetric("avg_response_seconds", 300)).toBe("5 นาที");
    expect(formatMetric("avg_response_seconds", 3600)).toBe("1 ชั่วโมง");
    expect(formatMetric("avg_response_seconds", 5400)).toBe("1 ชม. 30 นาที");
  });

  it("คีย์ที่ไม่รู้จักไม่พัง", () => {
    expect(formatMetric("ไม่มีคีย์นี้", 5)).toBe("5");
  });
});
