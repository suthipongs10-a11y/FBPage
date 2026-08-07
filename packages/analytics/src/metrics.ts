/**
 * นิยามเมตริกที่ระบบใช้ (M7)
 *
 * ⚠️ ข้อสำคัญที่สุดของโมดูลนี้ (สเปกข้อ 0):
 *   Page Reach / Impressions **ปลดระวาง มิ.ย. 2026**
 *   ต้องใช้ Page Viewer Metric / Media Views แทน
 *   "รายงานลูกค้าต้องใช้เมตริกใหม่ อย่าอิงของเก่า"
 *
 * ไฟล์นี้จึงเป็นที่เดียวที่รู้จักชื่อเมตริกของ Meta และมีรายการเมตริกที่
 * ปลดระวางไว้ให้ระบบปฏิเสธตั้งแต่ตอนตั้งค่า ไม่ใช่ไปพังตอนสร้างรายงานให้ลูกค้า
 */

/** เมตริกที่ Meta ปลดระวางแล้ว — ห้ามใช้เด็ดขาด */
export const DEPRECATED_METRICS = [
  "page_impressions",
  "page_impressions_unique",
  "page_impressions_paid",
  "page_impressions_organic",
  "page_impressions_organic_unique",
  "page_impressions_viral",
  "page_reach",
  "page_engaged_users",
  "page_consumptions",
  "page_negative_feedback",
  "post_impressions",
  "post_impressions_unique",
  "post_impressions_organic",
  "post_reach",
] as const;

const DEPRECATED_SET: ReadonlySet<string> = new Set(DEPRECATED_METRICS);

/**
 * ตระกูลเมตริกที่ปลดระวางทั้งตระกูล รวมถึงตัวที่มี suffix ต่อท้าย
 *
 * จำเป็นเพราะ Meta มีตัวแปรย่อยเยอะมาก เช่น `page_consumptions_by_consumption_type`
 * ถ้าเทียบแบบตรงตัวจะหลุด แล้วรายงานลูกค้าจะขึ้นเลข 0 โดยไม่มี error ให้เห็น
 * — ซึ่งแย่กว่าพังเสียอีก เพราะเราจะส่งรายงานผิดให้ลูกค้าทุกเดือนโดยไม่รู้ตัว
 */
const DEPRECATED_PREFIXES = [
  "page_impressions",
  "page_reach",
  "page_engaged_users",
  "page_consumptions",
  "page_negative_feedback",
  "post_impressions",
  "post_reach",
  "post_consumptions",
] as const;

export class DeprecatedMetricError extends Error {
  override readonly name = "DeprecatedMetricError";
  readonly th: string;
  constructor(metric: string, replacement: string) {
    super(`metric "${metric}" is deprecated`);
    this.th = `เมตริก "${metric}" ถูก Meta ปลดระวางไปแล้ว (มิ.ย. 2026) — ใช้ "${replacement}" แทน`;
  }
}

/** เมตริกเก่า → เมตริกใหม่ที่ใช้แทน */
export const METRIC_REPLACEMENTS: Record<string, string> = {
  page_impressions: "page_views_total",
  page_impressions_unique: "page_viewer_metric",
  page_reach: "page_viewer_metric",
  page_engaged_users: "page_post_engagements",
  post_impressions: "post_media_views",
  post_reach: "post_media_views",
};

/** เมตริกนี้อยู่ในตระกูลที่ปลดระวางหรือไม่ */
export function isDeprecatedMetric(metric: string): boolean {
  if (DEPRECATED_SET.has(metric)) return true;
  return DEPRECATED_PREFIXES.some((p) => metric.startsWith(p));
}

/** โยน error ทันทีถ้ามีคนพยายามใช้เมตริกที่ปลดระวาง */
export function assertNotDeprecated(metric: string): void {
  if (isDeprecatedMetric(metric)) {
    throw new DeprecatedMetricError(
      metric,
      METRIC_REPLACEMENTS[metric] ?? "Page Viewer Metric / Media Views",
    );
  }
}

/** กลุ่มของเมตริก ใช้จัดหมวดในรายงาน */
export type MetricGroup =
  | "audience"
  | "reach"
  | "engagement"
  | "traffic"
  | "inbox"
  | "bot";

export interface MetricDef {
  /** คีย์ที่เราใช้ภายใน (เก็บลง insights_daily.metric_key) */
  key: string;
  /** ชื่อเมตริกฝั่ง Meta — undefined = เราคำนวณเอง ไม่ได้ดึงจาก Meta */
  metaName?: string;
  /** ชื่อที่แสดงในรายงานลูกค้า */
  labelTh: string;
  group: MetricGroup;
  /** ค่าที่ Meta คืนเป็นยอดสะสม ต้องเก็บเป็นค่ารายวันเอง */
  unit: "count" | "percent" | "seconds";
  /** มากกว่า = ดีกว่า (ใช้ตัดสินสีลูกศรในรายงาน) */
  higherIsBetter: boolean;
}

/**
 * เมตริกทั้งหมดที่ระบบเก็บ — ทั้งหมดเป็นของใหม่หลังปลดระวาง มิ.ย. 2026
 * ที่มา: สเปกข้อ M7 "Page Viewer Metric / Media Views (ของใหม่), followers,
 * engagement, link clicks, ยอด inbox, เวลาตอบเฉลี่ย, อัตราบอทตอบเอง"
 */
export const METRICS: readonly MetricDef[] = [
  // ---- ผู้ติดตาม ----
  {
    key: "followers",
    metaName: "page_follows",
    labelTh: "ผู้ติดตามใหม่",
    group: "audience",
    unit: "count",
    higherIsBetter: true,
  },
  {
    key: "followers_total",
    labelTh: "ผู้ติดตามทั้งหมด",
    group: "audience",
    unit: "count",
    higherIsBetter: true,
  },
  // ---- คนเห็นเพจ (ของใหม่แทน reach/impressions) ----
  {
    key: "page_views",
    metaName: "page_views_total",
    labelTh: "จำนวนครั้งที่เพจถูกเปิดดู",
    group: "reach",
    unit: "count",
    higherIsBetter: true,
  },
  {
    key: "viewers",
    metaName: "page_viewer_metric",
    labelTh: "จำนวนคนที่เห็นเพจ",
    group: "reach",
    unit: "count",
    higherIsBetter: true,
  },
  {
    key: "media_views",
    metaName: "page_media_views",
    labelTh: "ยอดดูรูป/วิดีโอ",
    group: "reach",
    unit: "count",
    higherIsBetter: true,
  },
  // ---- การมีส่วนร่วม ----
  {
    key: "engagements",
    metaName: "page_post_engagements",
    labelTh: "การมีส่วนร่วมกับโพสต์",
    group: "engagement",
    unit: "count",
    higherIsBetter: true,
  },
  {
    key: "reactions",
    metaName: "page_actions_post_reactions_total",
    labelTh: "จำนวนรีแอ็กชัน",
    group: "engagement",
    unit: "count",
    higherIsBetter: true,
  },
  // ---- ทราฟฟิก ----
  {
    key: "link_clicks",
    // ไม่มี metaName โดยตั้งใจ: ตัวเดิมที่ใช้กันคือ
    // `page_consumptions_by_consumption_type` ซึ่งอยู่ในตระกูล page_consumptions
    // ที่ปลดระวางไปพร้อม reach/impressions เดือน มิ.ย. 2026
    //
    // จึงรวมยอดคลิกจากระดับโพสต์ที่เราเก็บเองแทน (เรารู้ว่าโพสต์ไหนเป็นของเรา)
    // ต้องยืนยันชื่อเมตริกใหม่กับเอกสาร Graph API ก่อนเปลี่ยนกลับไปดึงจาก Meta
    labelTh: "คลิกลิงก์",
    group: "traffic",
    unit: "count",
    higherIsBetter: true,
  },
  // ---- inbox (เราคำนวณเองจาก DB ไม่ได้ดึงจาก Meta) ----
  {
    key: "inbox_conversations",
    labelTh: "จำนวนบทสนทนา",
    group: "inbox",
    unit: "count",
    higherIsBetter: true,
  },
  {
    key: "inbox_new_contacts",
    labelTh: "ลูกค้าใหม่ที่ทักเข้ามา",
    group: "inbox",
    unit: "count",
    higherIsBetter: true,
  },
  {
    key: "avg_response_seconds",
    labelTh: "เวลาตอบเฉลี่ย",
    group: "inbox",
    unit: "seconds",
    higherIsBetter: false,
  },
  {
    key: "sla_breaches",
    labelTh: "จำนวนครั้งที่ตอบเกิน SLA",
    group: "inbox",
    unit: "count",
    higherIsBetter: false,
  },
  // ---- บอท ----
  {
    key: "bot_containment_rate",
    labelTh: "อัตราที่บอทจบงานได้เอง",
    group: "bot",
    unit: "percent",
    higherIsBetter: true,
  },
  {
    key: "bot_escalations",
    labelTh: "จำนวนครั้งที่บอทส่งต่อให้คน",
    group: "bot",
    unit: "count",
    higherIsBetter: false,
  },
];

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export function metricDef(key: string): MetricDef | undefined {
  return BY_KEY.get(key);
}

/** เมตริกที่ต้องไปดึงจาก Meta (ที่เหลือเราคำนวณเอง) */
export function metaMetricNames(): string[] {
  return METRICS.filter((m) => m.metaName !== undefined).map(
    (m) => m.metaName!,
  );
}

/** metaName → key ภายในของเรา */
export function keyForMetaName(metaName: string): string | undefined {
  return METRICS.find((m) => m.metaName === metaName)?.key;
}

/** จัดรูปค่าให้อ่านง่ายในรายงานไทย */
export function formatMetric(key: string, value: number): string {
  const def = BY_KEY.get(key);
  if (!def) return String(value);
  switch (def.unit) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "seconds": {
      if (value < 60) return `${Math.round(value)} วินาที`;
      if (value < 3600) return `${Math.round(value / 60)} นาที`;
      const h = Math.floor(value / 3600);
      const m = Math.round((value % 3600) / 60);
      return m === 0 ? `${h} ชั่วโมง` : `${h} ชม. ${m} นาที`;
    }
    case "count":
      return value.toLocaleString("th-TH");
  }
}
