import { describe, expect, it } from "vitest";
import { nullLogger } from "@page-os/core";
import type { ListeningSync, YouTubeListeningSync } from "@page-os/listening";
import type { AlertCenter, Problem } from "@page-os/ops";
import type { PublishScheduler } from "@page-os/publish";
import { CRON_JOBS, encodeSweepJob, JobPayloadError } from "@page-os/queue";
import { JobRouter, NotWiredError, type JobContext } from "../router.js";
import {
  alertsTickHandler,
  cronJobName,
  listeningSyncHandler,
  notWiredHandler,
  publishTickHandler,
  youtubeSyncHandler,
} from "./cron.js";

const ctx: JobContext = {
  nowMs: 1_700_000_000_000,
  logger: nullLogger,
  jobId: "j1",
  attemptsMade: 0,
};

const sweep = encodeSweepJob();

describe("publish-tick", () => {
  it("เรียก tick แล้วรายงานจำนวนที่ยัดเข้าคิว", async () => {
    const scheduler = {
      tick: async () => ({ enqueued: 3, posts: 2 }),
    } as unknown as PublishScheduler;
    const out = await publishTickHandler(scheduler).run(sweep, ctx);
    expect(out.details).toMatchObject({ enqueued: 3, posts: 2 });
    expect(out.th).toContain("3");
  });

  it("ไม่มีโพสต์ถึงเวลา → บอกให้ชัด ไม่ใช่รายงานเลข 0 เฉยๆ", async () => {
    const scheduler = {
      tick: async () => ({ enqueued: 0, posts: 0 }),
    } as unknown as PublishScheduler;
    const out = await publishTickHandler(scheduler).run(sweep, ctx);
    expect(out.th).toContain("ยังไม่มี");
  });

  it("payload รูปร่างผิด → ล้ม ไม่ใช่ทำงานต่อไปเงียบๆ", async () => {
    const scheduler = { tick: async () => ({ enqueued: 0, posts: 0 }) } as unknown as PublishScheduler;
    await expect(publishTickHandler(scheduler).run({ v: 99 }, ctx)).rejects.toThrow(
      JobPayloadError,
    );
  });
});

describe("alerts-tick", () => {
  const problem: Problem = {
    id: "token:p1",
    severity: "critical",
    kind: "token",
    pageId: "p1",
    pageName: "ร้านกาแฟ",
    clientName: "ลูกค้า ก",
    colorIndex: 0,
    th: "token หมดอายุ",
  };

  /**
   * เวลาต้องมาจาก ctx ที่ runtime ใส่มาให้ (ซึ่งมาจาก Clock ที่ฉีดเข้าไป)
   * ไม่ใช่ Date.now() ในตัวจัดการ ไม่งั้นเทสต์ที่คุมเวลาจะคุมไม่ได้จริง
   */
  it("ส่งเวลาจาก ctx ไปให้ตัวเก็บข้อมูล", async () => {
    let seen = 0;
    const center = {
      run: async () => ({ sent: [], heldBack: 0, resolved: [], th: "ไม่มีอะไร" }),
    } as unknown as AlertCenter;
    await alertsTickHandler({
      center,
      collect: async (nowMs) => {
        seen = nowMs;
        return [];
      },
    }).run(sweep, ctx);
    expect(seen).toBe(ctx.nowMs);
  });

  it("รายงานจำนวนที่ส่ง/กลั้นไว้/หายแล้ว", async () => {
    const center = {
      run: async () => ({
        sent: [{ severity: "critical", problemIds: ["token:p1"], th: "x" }],
        heldBack: 2,
        resolved: ["webhook:p2"],
        th: "ส่ง 1 เรื่อง",
      }),
    } as unknown as AlertCenter;
    const out = await alertsTickHandler({
      center,
      collect: async () => [problem],
    }).run(sweep, ctx);
    expect(out.details).toMatchObject({
      problems: 1,
      sent: 1,
      heldBack: 2,
      resolved: 1,
    });
  });
});

describe("youtube-sync", () => {
  const fakeSync = (results: unknown[]): YouTubeListeningSync =>
    ({ syncDue: async () => results }) as unknown as YouTubeListeningSync;

  const channelResult = (over: Record<string, unknown> = {}) => ({
    trackedPageId: "tp-1",
    externalId: "UCa",
    postsWritten: 2,
    commentsWritten: 7,
    followers: 100,
    th: "",
    errors: [],
    ...over,
  });

  it("รายงานจำนวนช่อง/วิดีโอ/คอมเมนต์", async () => {
    const out = await youtubeSyncHandler({
      sync: fakeSync([channelResult(), channelResult({ trackedPageId: "tp-2" })]),
      staleAfterMs: 1,
      limit: 5,
    }).run(sweep, ctx);

    expect(out.details).toMatchObject({ channels: 2, videos: 4, comments: 14, failed: 0 });
  });

  it("ยังไม่มีช่องถึงเวลา → บอกให้ชัด ไม่ใช่รายงานเลข 0 เฉยๆ", async () => {
    const out = await youtubeSyncHandler({
      sync: fakeSync([]),
      staleAfterMs: 1,
      limit: 5,
    }).run(sweep, ctx);

    expect(out.th).toContain("ยังไม่มี");
  });

  /**
   * โควตาหมดต้องขึ้นให้เห็นชัด เพราะแปลว่ารอบถัดๆ ไป **ของทั้งวัน** จะไม่ได้
   * อะไรกลับมาเลย ต่างจากฝั่ง Meta ที่รอชั่วโมงเดียวก็หาย
   */
  it("โควตาหมด → ขึ้นในข้อความสรุป ไม่ใช่ซ่อนไว้ใน details", async () => {
    const out = await youtubeSyncHandler({
      sync: fakeSync([channelResult({ quotaExhausted: true, errors: ["โควตาหมด"] })]),
      staleAfterMs: 1,
      limit: 5,
    }).run(sweep, ctx);

    expect(out.th).toContain("โควตา");
    expect(out.details).toMatchObject({ quotaOut: true, failed: 1 });
  });

  it("payload รูปร่างผิด → ล้ม ไม่ใช่ทำงานต่อไปเงียบๆ", async () => {
    await expect(
      youtubeSyncHandler({ sync: fakeSync([]), staleAfterMs: 1, limit: 5 }).run(
        { v: 99 },
        ctx,
      ),
    ).rejects.toThrow(JobPayloadError);
  });
});

describe("รอบที่ยังไม่ได้ต่อของจริง", () => {
  /**
   * ต้อง **ลงทะเบียนไว้** แล้วโยน error ไม่ใช่ปล่อยว่าง — งานที่ไม่มีคนรับ
   * จะกองอยู่ในคิวโดยดูไม่ออกว่าต่างจาก "ยังไม่ถึงคิว" ส่วนแบบนี้จะไปกอง
   * รายการที่ล้มเหลวพร้อมข้อความบอกว่าต้องเขียนอะไรเพิ่ม
   */
  it("โยน NotWiredError พร้อมบอกว่าขาดอะไร", async () => {
    const h = notWiredHandler("analytics-sync", "ที่เก็บ Insights บน Prisma");
    await expect(h.run({}, ctx)).rejects.toThrow(NotWiredError);
    try {
      await h.run({}, ctx);
    } catch (err) {
      expect((err as NotWiredError).th).toContain("ที่เก็บ Insights บน Prisma");
    }
  });
});

/**
 * เทสต์ที่กันไม่ให้มีตารางงานที่ยิงแล้วไม่มีใครรับ
 *
 * ถ้าเพิ่มตารางใน CRON_JOBS แล้วลืมเขียนตัวจัดการ งานจะยิงทุกรอบแล้วล้มทุกรอบ
 * — เทสต์นี้จะจับได้ตั้งแต่ตอนเขียน แทนที่จะไปเห็นใน log ของโปรดักชัน
 */
describe("ทุกตารางงานต้องมีตัวจัดการ", () => {
  it("ชื่อใน CRON_JOBS ทุกตัวมีคนรับ", () => {
    const scheduler = { tick: async () => ({ enqueued: 0, posts: 0 }) } as unknown as PublishScheduler;
    const center = {
      run: async () => ({ sent: [], heldBack: 0, resolved: [], th: "" }),
    } as unknown as AlertCenter;

    const sync = { syncDue: async () => [] } as unknown as ListeningSync;

    const router = new JobRouter([
      publishTickHandler(scheduler),
      alertsTickHandler({ center, collect: async () => [] }),
      listeningSyncHandler({ sync, staleAfterMs: 1, limit: 1 }),
      youtubeSyncHandler({
        sync: sync as unknown as YouTubeListeningSync,
        staleAfterMs: 1,
        limit: 1,
      }),
      notWiredHandler("token-health", "x"),
      notWiredHandler("analytics-sync", "x"),
      notWiredHandler("morning-digest", "x"),
      notWiredHandler("monthly-report", "x"),
      notWiredHandler("purge-expired", "x"),
    ]);

    const missing = CRON_JOBS.filter((j) => !router.has(cronJobName(j.name)));
    expect(missing.map((j) => j.name)).toEqual([]);
  });
});
