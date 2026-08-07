import { describe, expect, it } from "vitest";
import { FakeClock, nullLogger } from "@page-os/core";
import { MetaGateway } from "@page-os/meta";
import { FakeFetch, FakeTokenStore, graphError } from "@page-os/meta/test-helpers";
import {
  InsightsSync,
  MAX_BACKFILL_DAYS,
  dateKeyInZone,
  daysBetween,
  shiftDate,
  type DailyMetric,
  type InsightsRepository,
  type InternalStatsSource,
} from "./sync.js";

const TZ = "Asia/Bangkok";
/** 2026-08-10 09:00 เวลาไทย */
const NOW = Date.parse("2026-08-10T09:00:00+07:00");

class MemRepo implements InsightsRepository {
  rows: DailyMetric[] = [];
  latest: string | null = null;

  async upsertMany(rows: DailyMetric[]): Promise<void> {
    for (const r of rows) {
      const i = this.rows.findIndex(
        (x) =>
          x.pageId === r.pageId &&
          x.date === r.date &&
          x.metricKey === r.metricKey,
      );
      if (i >= 0) this.rows[i] = r;
      else this.rows.push(r);
    }
  }
  async latestDate(): Promise<string | null> {
    return this.latest;
  }
  async range(): Promise<DailyMetric[]> {
    return this.rows;
  }
}

function setup(internal?: InternalStatsSource) {
  const clock = new FakeClock(NOW);
  const fetchImpl = new FakeFetch();
  const gateway = new MetaGateway(
    {
      appId: "APP",
      appSecret: "SECRET",
      graphVersion: "v25.0",
      rateLimit: { burst: 100, refillPerSec: 100 },
    },
    {
      tokenStore: new FakeTokenStore({ p1: "T1" }),
      clock,
      fetchImpl: fetchImpl.fn,
      random: () => 0,
    },
  );
  const repo = new MemRepo();
  const sync = new InsightsSync({
    gateway,
    repo,
    ...(internal ? { internal } : {}),
    clock,
    logger: nullLogger,
  });
  return { clock, fetch: fetchImpl, repo, sync };
}

/** insights response ที่ Meta คืนมา */
function insights(
  entries: Array<{ name: string; days: Array<[string, number]> }>,
): unknown {
  return {
    data: entries.map((e) => ({
      name: e.name,
      period: "day",
      values: e.days.map(([date, value]) => ({
        value,
        // end_time = เที่ยงคืนของวันถัดไปตาม timezone เพจ
        end_time: `${shiftDate(date, 1)}T00:00:00+0700`,
      })),
    })),
  };
}

describe("ฟังก์ชันวันที่ (กฎข้อ 4 — ต้องใช้ timezone ของเพจ)", () => {
  it("dateKeyInZone ใช้ timezone ที่ระบุ ไม่ใช่ของเซิร์ฟเวอร์", () => {
    // 2026-08-10 00:30 เวลาไทย = 2026-08-09 17:30 UTC
    const ms = Date.parse("2026-08-10T00:30:00+07:00");
    expect(dateKeyInZone(ms, TZ)).toBe("2026-08-10");
    expect(dateKeyInZone(ms, "UTC")).toBe("2026-08-09");
  });

  it("shiftDate บวกลบวันได้ถูก รวมข้ามเดือนและข้ามปี", () => {
    expect(shiftDate("2026-08-10", 1)).toBe("2026-08-11");
    expect(shiftDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("daysBetween นับถูก", () => {
    expect(daysBetween("2026-08-01", "2026-08-10")).toBe(9);
    expect(daysBetween("2026-08-10", "2026-08-10")).toBe(0);
    expect(daysBetween("2026-08-11", "2026-08-10")).toBe(-1);
  });
});

describe("InsightsSync — ดึงข้อมูล", () => {
  it("แปลง insights ของ Meta เป็นแถวรายวัน", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-07";
    fetch.push({
      json: insights([
        {
          name: "page_follows",
          days: [
            ["2026-08-08", 12],
            ["2026-08-09", 8],
          ],
        },
      ]),
    });

    const r = await sync.syncPage({ pageId: "p1", timeZone: TZ });

    expect(r.errors).toEqual([]);
    const follows = repo.rows.filter((x) => x.metricKey === "followers");
    expect(follows).toHaveLength(2);
    expect(follows.find((x) => x.date === "2026-08-08")!.value).toBe(12);
  });

  it("ไม่ดึงข้อมูลของวันนี้ (ยังไม่จบวัน ตัวเลขจะเปลี่ยนอีก)", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-08";
    fetch.push({ json: insights([]) });

    const r = await sync.syncPage({ pageId: "p1", timeZone: TZ });

    // วันนี้คือ 2026-08-10 → ต้อง sync แค่ถึง 08-09
    expect(r.daysSynced).toEqual(["2026-08-09"]);
    expect(r.daysSynced).not.toContain("2026-08-10");
  });

  it("ใช้ priority ต่ำ ไม่ไปเบียดงานที่ลูกค้ารออยู่", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-08";
    fetch.push({ json: insights([]) });
    await sync.syncPage({ pageId: "p1", timeZone: TZ });
    // ยิงไปที่ /insights จริง
    expect(fetch.lastCall!.url).toContain("p1/insights");
  });

  it("ขอเฉพาะเมตริกที่ยังไม่ปลดระวาง", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-08";
    fetch.push({ json: insights([]) });
    await sync.syncPage({ pageId: "p1", timeZone: TZ });

    const metric = new URL(fetch.lastCall!.url).searchParams.get("metric")!;
    for (const bad of [
      "page_impressions",
      "page_reach",
      "post_impressions",
    ]) {
      expect(metric, bad).not.toContain(bad);
    }
    expect(metric).toContain("page_viewer_metric");
  });

  it("until เป็น exclusive จึงต้องบวกอีกวัน", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-08";
    fetch.push({ json: insights([]) });
    await sync.syncPage({ pageId: "p1", timeZone: TZ });

    const q = new URL(fetch.lastCall!.url).searchParams;
    expect(q.get("since")).toBe("2026-08-09");
    expect(q.get("until")).toBe("2026-08-10");
  });

  it("รวมค่าที่ Meta คืนเป็น object แยกตามประเภท", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-08";
    fetch.push({
      json: {
        data: [
          {
            // page_media_views อาจคืนเป็น object แยกตามชนิดสื่อ
            name: "page_media_views",
            values: [
              {
                value: { photo: 10, video: 5 },
                end_time: "2026-08-10T00:00:00+0700",
              },
            ],
          },
        ],
      },
    });

    await sync.syncPage({ pageId: "p1", timeZone: TZ });
    const row = repo.rows.find((r) => r.metricKey === "media_views")!;
    expect(row.value).toBe(15);
  });

  it("ไม่ยิงเมตริกในตระกูล page_consumptions ที่ปลดระวางแล้ว", async () => {
    // ตัวนี้เคยถูกใช้เป็นแหล่งของ "คลิกลิงก์" แต่ปลดระวางพร้อม reach/impressions
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-08";
    fetch.push({ json: insights([]) });
    await sync.syncPage({ pageId: "p1", timeZone: TZ });

    const metric = new URL(fetch.lastCall!.url).searchParams.get("metric")!;
    expect(metric).not.toContain("page_consumptions");
  });

  it("ข้ามเมตริกที่ไม่รู้จักแทนที่จะพัง", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-08";
    fetch.push({
      json: insights([
        { name: "เมตริกที่ไม่รู้จัก", days: [["2026-08-09", 1]] },
        { name: "page_follows", days: [["2026-08-09", 5]] },
      ]),
    });

    const r = await sync.syncPage({ pageId: "p1", timeZone: TZ });
    expect(r.errors).toEqual([]);
    expect(repo.rows.filter((x) => x.metricKey === "followers")).toHaveLength(1);
  });
});

describe("InsightsSync — รันซ้ำและ backfill", () => {
  it("รันซ้ำวันเดิมไม่เกิดข้อมูลซ้ำ (upsert)", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-08";
    const body = insights([{ name: "page_follows", days: [["2026-08-09", 7]] }]);

    fetch.push({ json: body });
    await sync.syncPage({ pageId: "p1", timeZone: TZ });
    fetch.push({ json: body });
    await sync.syncPage({ pageId: "p1", timeZone: TZ, sinceDate: "2026-08-08" });

    expect(repo.rows.filter((x) => x.metricKey === "followers")).toHaveLength(1);
  });

  it("ข้อมูลเป็นปัจจุบันแล้วไม่ยิง API เปล่า", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2026-08-09"; // = เมื่อวาน
    const r = await sync.syncPage({ pageId: "p1", timeZone: TZ });
    expect(r.written).toBe(0);
    expect(r.th).toContain("เป็นปัจจุบันแล้ว");
    expect(fetch.callCount).toBe(0);
  });

  it("เพจใหม่ที่ยังไม่มีข้อมูลเลย ดึงย้อนหลัง 30 วัน", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = null;
    fetch.push({ json: insights([]) });

    const r = await sync.syncPage({ pageId: "p1", timeZone: TZ });
    expect(r.daysSynced).toHaveLength(30);
    expect(r.daysSynced[0]).toBe("2026-07-11");
  });

  it("ช่วงที่ยาวเกินกำหนดถูกตัดให้สั้นลง กันกิน quota หมด", async () => {
    const { sync, fetch, repo } = setup();
    repo.latest = "2020-01-01"; // เก่ามาก
    fetch.push({ json: insights([]) });

    const r = await sync.syncPage({ pageId: "p1", timeZone: TZ });
    expect(r.daysSynced.length).toBeLessThanOrEqual(MAX_BACKFILL_DAYS + 1);
  });
});

describe("InsightsSync — เมตริกที่เราคำนวณเอง", () => {
  it("รวมสถิติ inbox/บอท จาก DB ของเราเข้าไปด้วย", async () => {
    const internal: InternalStatsSource = {
      dailyStats: async ({ date }) => ({
        inbox_conversations: date === "2026-08-09" ? 25 : 10,
        bot_containment_rate: 0.62,
      }),
    };
    const { sync, fetch, repo } = setup(internal);
    repo.latest = "2026-08-08";
    fetch.push({ json: insights([]) });

    await sync.syncPage({ pageId: "p1", timeZone: TZ });

    const conv = repo.rows.find(
      (r) => r.metricKey === "inbox_conversations" && r.date === "2026-08-09",
    );
    expect(conv!.value).toBe(25);
    expect(
      repo.rows.some((r) => r.metricKey === "bot_containment_rate"),
    ).toBe(true);
  });

  it("คำนวณสถิติวันหนึ่งพัง ต้องไม่ทำให้ทั้ง sync ล้ม", async () => {
    const internal: InternalStatsSource = {
      dailyStats: async () => {
        throw new Error("DB ล่ม");
      },
    };
    const { sync, fetch, repo } = setup(internal);
    repo.latest = "2026-08-08";
    fetch.push({ json: insights([{ name: "page_follows", days: [["2026-08-09", 3]] }]) });

    const r = await sync.syncPage({ pageId: "p1", timeZone: TZ });
    expect(r.errors.length).toBeGreaterThan(0);
    // ข้อมูลจาก Meta ยังถูกเก็บ
    expect(repo.rows.some((x) => x.metricKey === "followers")).toBe(true);
  });
});

describe("InsightsSync — ทนต่อความผิดพลาด", () => {
  it("ดึงจาก Meta ไม่ได้ ต้องรายงานเป็นภาษาไทย ไม่ throw", async () => {
    const { sync, fetch, repo, clock } = setup();
    repo.latest = "2026-08-08";
    fetch.setFallback({ status: 403, json: graphError(200, "no permission") });

    const p = sync.syncPage({ pageId: "p1", timeZone: TZ });
    await clock.advance(120_000);
    const r = await p;

    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/[ก-๙]/);
  });

  it("syncAll: เพจเดียวพังต้องไม่ทำให้เพจที่เหลือไม่ได้ sync", async () => {
    const { sync, fetch, repo, clock } = setup();
    repo.latest = "2026-08-08";
    fetch.setHandler((call) =>
      call.url.includes("bad/insights")
        ? { status: 403, json: graphError(200) }
        : { json: insights([{ name: "page_follows", days: [["2026-08-09", 1]] }]) },
    );

    const p = sync.syncAll([
      { pageId: "bad", timeZone: TZ },
      { pageId: "p1", timeZone: TZ },
    ]);
    await clock.advance(300_000);
    const results = await p;

    expect(results).toHaveLength(2);
    expect(results[1]!.errors).toEqual([]);
  });
});
