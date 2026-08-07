/**
 * Sync Insights รายวัน (M7 — cron 03:00)
 *
 * ทำไมต้องเก็บลง DB เอง (สเปกข้อ M7):
 *   - ดูย้อนหลังได้ไม่จำกัด (Meta เก็บให้แค่ช่วงหนึ่ง)
 *   - เปิดหน้ารายงานแล้วไม่โดน rate limit เพราะอ่านจาก DB ของเรา
 *
 * ทุก call ผ่าน gateway ด้วย priority "low" — งาน sync ต้องไม่ไปเบียด
 * งานตอบ inbox หรือโพสต์ตามเวลาที่ลูกค้ารออยู่
 */
import { nullLogger, systemClock, type Clock, type Logger } from "@page-os/core";
import { MetaApiError, type MetaGateway } from "@page-os/meta";
import { assertNotDeprecated, keyForMetaName, metaMetricNames } from "./metrics.js";

/** 1 แถวใน insights_daily */
export interface DailyMetric {
  pageId: string;
  /** YYYY-MM-DD ตาม timezone ของเพจ */
  date: string;
  metricKey: string;
  value: number;
}

export interface InsightsRepository {
  /** upsert — รันซ้ำวันเดิมต้องไม่เกิดข้อมูลซ้ำ (PK = page_id,date,metric_key) */
  upsertMany(rows: DailyMetric[]): Promise<void>;
  /** วันล่าสุดที่มีข้อมูลของเพจนี้ ใช้หาว่าต้อง backfill ถึงไหน */
  latestDate(pageId: string): Promise<string | null>;
  range(args: {
    pageId: string;
    fromDate: string;
    toDate: string;
    metricKeys?: string[];
  }): Promise<DailyMetric[]>;
}

/** ตัวเลข inbox/บอท ที่คำนวณจาก DB ของเราเอง ไม่ได้มาจาก Meta */
export interface InternalStatsSource {
  dailyStats(args: {
    pageId: string;
    date: string;
    timeZone: string;
  }): Promise<Record<string, number>>;
}

export interface InsightsSyncOptions {
  gateway: MetaGateway;
  repo: InsightsRepository;
  internal?: InternalStatsSource;
  clock?: Clock;
  logger?: Logger;
}

/** แปลง epoch ms → YYYY-MM-DD ตาม timezone ที่กำหนด (กฎข้อ 4) */
export function dateKeyInZone(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** บวก/ลบวันจาก YYYY-MM-DD โดยไม่แตะ timezone */
export function shiftDate(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** จำนวนวันระหว่างสองวันที่ */
export function daysBetween(from: string, to: string): number {
  const p = (s: string): number => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(to) - p(from)) / 86_400_000);
}

export interface SyncResult {
  pageId: string;
  /** จำนวนแถวที่เขียนลง DB */
  written: number;
  daysSynced: string[];
  errors: string[];
  th: string;
}

/** ดึงย้อนหลังได้มากสุดกี่วันต่อรอบ กัน backfill ยาวจนกิน quota หมด */
export const MAX_BACKFILL_DAYS = 90;

export class InsightsSync {
  private readonly gateway: MetaGateway;
  private readonly repo: InsightsRepository;
  private readonly internal: InternalStatsSource | undefined;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(opts: InsightsSyncOptions) {
    this.gateway = opts.gateway;
    this.repo = opts.repo;
    this.internal = opts.internal;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
  }

  /**
   * sync เพจเดียว
   *
   * ดึงตั้งแต่วันถัดจากข้อมูลล่าสุดที่มี ถึงเมื่อวาน
   * (ไม่ดึงของวันนี้เพราะยังไม่จบวัน ตัวเลขจะเปลี่ยนอีก)
   */
  async syncPage(args: {
    pageId: string;
    timeZone: string;
    /** บังคับเริ่มจากวันนี้ (ใช้ตอน backfill ครั้งแรก) */
    sinceDate?: string;
  }): Promise<SyncResult> {
    const today = dateKeyInZone(this.clock.now(), args.timeZone);
    const yesterday = shiftDate(today, -1);

    const latest = args.sinceDate ?? (await this.repo.latestDate(args.pageId));
    let from = latest ? shiftDate(latest, 1) : shiftDate(yesterday, -29);

    if (daysBetween(from, yesterday) > MAX_BACKFILL_DAYS) {
      const capped = shiftDate(yesterday, -MAX_BACKFILL_DAYS);
      this.logger.warn("ช่วงที่ต้อง sync ยาวเกินกำหนด ตัดให้สั้นลง", {
        page_id: args.pageId,
        requestedFrom: from,
        cappedFrom: capped,
      });
      from = capped;
    }

    if (daysBetween(from, yesterday) < 0) {
      return {
        pageId: args.pageId,
        written: 0,
        daysSynced: [],
        errors: [],
        th: "ข้อมูลเป็นปัจจุบันแล้ว ไม่มีอะไรต้อง sync",
      };
    }

    const errors: string[] = [];
    const rows: DailyMetric[] = [];

    // ---- เมตริกจาก Meta ----
    try {
      rows.push(
        ...(await this.fetchMetaInsights({
          pageId: args.pageId,
          fromDate: from,
          toDate: yesterday,
          timeZone: args.timeZone,
        })),
      );
    } catch (err) {
      const th = err instanceof MetaApiError ? err.th : String(err);
      errors.push(`ดึง insights จาก Facebook ไม่สำเร็จ: ${th}`);
      this.logger.error("ดึง insights ไม่สำเร็จ", {
        page_id: args.pageId,
        err,
      });
    }

    // ---- เมตริกที่เราคำนวณเอง (inbox / บอท) ----
    const days: string[] = [];
    for (let d = from; daysBetween(d, yesterday) >= 0; d = shiftDate(d, 1)) {
      days.push(d);
    }

    if (this.internal) {
      for (const date of days) {
        try {
          const stats = await this.internal.dailyStats({
            pageId: args.pageId,
            date,
            timeZone: args.timeZone,
          });
          for (const [metricKey, value] of Object.entries(stats)) {
            if (Number.isFinite(value)) {
              rows.push({ pageId: args.pageId, date, metricKey, value });
            }
          }
        } catch (err) {
          errors.push(`คำนวณสถิติ inbox ของวันที่ ${date} ไม่สำเร็จ`);
          this.logger.error("คำนวณสถิติภายในไม่สำเร็จ", {
            page_id: args.pageId,
            date,
            err,
          });
        }
      }
    }

    if (rows.length > 0) await this.repo.upsertMany(rows);

    return {
      pageId: args.pageId,
      written: rows.length,
      daysSynced: days,
      errors,
      th:
        errors.length === 0
          ? `sync สำเร็จ ${days.length} วัน (${rows.length} ค่า)`
          : `sync เสร็จแบบมีปัญหา ${errors.length} จุด — ${errors[0]}`,
    };
  }

  /**
   * ดึง insights จาก Meta
   *
   * ใช้ period=day + since/until เพื่อได้ค่ารายวันย้อนหลังในครั้งเดียว
   * ขอเฉพาะเมตริกที่ยังไม่ปลดระวาง (assertNotDeprecated กันไว้อีกชั้น)
   */
  private async fetchMetaInsights(args: {
    pageId: string;
    fromDate: string;
    toDate: string;
    timeZone: string;
  }): Promise<DailyMetric[]> {
    const names = metaMetricNames();
    for (const n of names) assertNotDeprecated(n);

    const res = await this.gateway.call<{
      data?: Array<{
        name?: string;
        period?: string;
        values?: Array<{ value?: unknown; end_time?: string }>;
      }>;
    }>({
      pageId: args.pageId,
      path: `${args.pageId}/insights`,
      // งาน sync ต้องไม่ไปเบียดงานที่ลูกค้ารออยู่
      priority: "low",
      params: {
        metric: names.join(","),
        period: "day",
        since: args.fromDate,
        // Meta ตีความ until เป็น exclusive จึงต้องบวกอีกวัน
        until: shiftDate(args.toDate, 1),
      },
    });

    const rows: DailyMetric[] = [];
    for (const entry of res.data?.data ?? []) {
      const key = entry.name ? keyForMetaName(entry.name) : undefined;
      if (!key) continue;
      for (const v of entry.values ?? []) {
        if (!v.end_time) continue;
        // end_time คือ "ปลายช่วง" = เที่ยงคืนของวันถัดไปตาม timezone เพจ
        // ต้องถอยกลับ 1 วันถึงจะเป็นวันที่ข้อมูลนั้นเป็นตัวแทน
        const endMs = Date.parse(v.end_time);
        if (!Number.isFinite(endMs)) continue;
        const date = shiftDate(dateKeyInZone(endMs, args.timeZone), -1);

        const value = coerceNumber(v.value);
        if (value === null) continue;
        rows.push({ pageId: args.pageId, date, metricKey: key, value });
      }
    }
    return rows;
  }

  /** sync ทุกเพจ — ตัวที่ cron เรียก */
  async syncAll(
    pages: Array<{ pageId: string; timeZone: string }>,
  ): Promise<SyncResult[]> {
    const out: SyncResult[] = [];
    for (const p of pages) {
      try {
        out.push(await this.syncPage(p));
      } catch (err) {
        // เพจเดียวพังต้องไม่ทำให้เพจที่เหลือไม่ได้ sync
        this.logger.error("sync เพจไม่สำเร็จ", { page_id: p.pageId, err });
        out.push({
          pageId: p.pageId,
          written: 0,
          daysSynced: [],
          errors: [String(err)],
          th: "sync เพจนี้ไม่สำเร็จ — ดู log ประกอบ",
        });
      }
    }
    return out;
  }
}

/**
 * Meta คืนค่าได้หลายแบบ: ตัวเลขตรงๆ หรือ object ที่แยกตามประเภท
 * (เช่น page_consumptions_by_consumption_type คืน {"link clicks": 12, ...})
 */
function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (value !== null && typeof value === "object") {
    let sum = 0;
    let found = false;
    for (const v of Object.values(value as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) {
        sum += n;
        found = true;
      }
    }
    return found ? sum : null;
  }
  return null;
}
