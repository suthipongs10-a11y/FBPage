/**
 * จุดเริ่มของ worker
 *
 * สิ่งที่โปรเซสนี้รับผิดชอบ:
 *   - ยิงโพสต์ที่ถึงเวลาขึ้นเพจ
 *   - ตรวจปัญหาทุก 5 นาทีแล้วแจ้งเตือน
 *   - ตั้งตารางงานประจำใน Redis และเก็บกวาดตารางเก่าที่เลิกใช้แล้ว
 *
 * ถ้าโปรเซสนี้ไม่รัน อาการที่เห็นคือ "โพสต์ที่ตั้งเวลาไว้ไม่ขึ้น" โดยไม่มี error
 * ที่ไหนเลย เพราะทุกอย่างถูกบันทึกไว้ครบ แค่ไม่มีใครมาหยิบไปทำ
 */
import type { Worker } from "bullmq";
import { noopAlertSink } from "@page-os/ops";
import { noopPublishAlerts } from "@page-os/publish";
import {
  applyCronSchedule,
  closeQueues,
  CRON_JOBS,
  GracefulShutdown,
  QUEUE,
} from "@page-os/queue";
import { closePrisma } from "@page-os/store";
import { ConfigError, loadWorkerConfig } from "./config.js";
import { buildDeps } from "./deps.js";
import {
  alertsTickHandler,
  listeningSyncHandler,
  notWiredHandler,
  publishTickHandler,
  youtubeSyncHandler,
} from "./handlers/cron.js";
import { inboxHandler } from "./handlers/inbox.js";
import { publishHandler } from "./handlers/publish.js";
import { JobRouter } from "./router.js";
import { startQueueWorker } from "./runtime.js";
import { createLogger } from "@page-os/core";

const logger = createLogger({ bindings: { service: "worker" } });

/**
 * รอบที่ยังไม่ได้ต่อกับของจริง พร้อมบอกว่าขาดอะไร
 *
 * ประกาศไว้ตรงนี้ให้เห็นชัดเป็นรายการเดียว แทนที่จะกระจายเป็น TODO ในโค้ด —
 * เวลาถามว่า "ตอนนี้ระบบทำอะไรได้แล้วบ้าง" จะได้มีที่เดียวให้ดู
 */
const NOT_WIRED: Array<{ cron: string; missingTh: string }> = [
  {
    cron: "token-health",
    missingTh: "ตัวไล่เช็ค token ทุกเพจที่เขียนผลกลับลง DB",
  },
  {
    cron: "analytics-sync",
    missingTh: "ที่เก็บ Insights บน Prisma (InsightsRepository)",
  },
  {
    cron: "morning-digest",
    missingTh: "ปลายทางส่งข้อความ (LINE) ที่ต่อของจริงแล้ว",
  },
  {
    cron: "monthly-report",
    missingTh: "ตัวสร้าง PDF และปลายทางส่งให้ลูกค้า",
  },
  {
    cron: "purge-expired",
    missingTh: "การเรียก purgeExpired() ของ PrismaMagicLinkStore ในรอบนี้",
  },
];

/** คิวที่ยังไม่มีตัวทำงาน — งานจะกองอยู่จนกว่าจะเขียนตัวจัดการเสร็จ */
const UNSERVED_QUEUES = [QUEUE.moderation, QUEUE.analytics, QUEUE.tokenHealth];

async function main(): Promise<void> {
  const config = loadWorkerConfig(process.env);

  const deps = buildDeps({
    config,
    env: process.env,
    // ยังไม่ได้ต่อ LINE — ใช้ปลายทางที่ไม่ทำอะไรไปก่อน และบอกให้รู้ตัวใน log
    // ไม่ใช่เงียบๆ เพราะ "ระบบตรวจเจอปัญหาแต่ไม่มีใครได้รับข้อความ"
    // แย่กว่าไม่มีระบบตรวจเลย
    alertSink: noopAlertSink,
    publishAlerts: noopPublishAlerts,
    logger,
  });

  const cronRouter = new JobRouter([
    publishTickHandler(deps.publishScheduler),
    alertsTickHandler({
      center: deps.alertCenter,
      collect: deps.collectProblemsNow,
    }),
    listeningSyncHandler({
      sync: deps.listeningSync,
      // ดึงใหม่เมื่อข้อมูลเก่าเกิน 50 นาที — ต่ำกว่าคาบ 1 ชม. เล็กน้อย
      // ไม่งั้นรอบที่มาถึงตอน 59 นาที 59 วินาทีจะข้ามเพจนั้นไปทั้งรอบ
      staleAfterMs: 50 * 60_000,
      limit: 10,
    }),
    /**
     * ยังไม่ใส่ `YOUTUBE_API_KEY` → ลงทะเบียนตัวที่บอกว่าขาดอะไร
     *
     * ไม่ปล่อยว่าง เพราะงานจะกองในคิวโดยแยกไม่ออกจาก "ยังไม่ถึงคิว"
     * — แบบนี้มันจะไปกอง `failed` พร้อมข้อความบอกว่าต้องใส่อะไร
     */
    deps.youtubeSync === null
      ? notWiredHandler(
          "youtube-sync",
          "ค่า YOUTUBE_API_KEY ในไฟล์ .env — เอามาจาก Google Cloud Console " +
            "หลังเปิดใช้ YouTube Data API v3 (ถ้าไม่ได้ดูช่อง YouTube ก็ข้ามได้)",
        )
      : youtubeSyncHandler({
          sync: deps.youtubeSync,
          // ต่ำกว่าคาบ 3 ชม. เล็กน้อย ด้วยเหตุผลเดียวกับ listening-sync
          staleAfterMs: 170 * 60_000,
          /**
           * ─── เลขนี้มาจากไหน ───
           *
           * ช่องหนึ่งกิน 1 (channels) + 1 (playlistItems) + 1 (videos)
           * + n (คอมเมนต์ 1 call ต่อวิดีโอที่มีคอมเมนต์) ≈ 13 หน่วยตามปกติ
           * และไม่เกิน ~53 หน่วยเมื่อชนเพดาน 50 วิดีโอ
           *
           * 10 ช่อง × 8 รอบ/วัน = 1,040 หน่วยตามปกติ / 4,240 กรณีแย่สุด
           * — ยังห่างจากเพดานงานเบื้องหลัง 8,500 อยู่มาก
           *
           * ถ้าเฝ้าดู 20 ช่อง แต่ละช่องจะถูกดึงทุก 6 ชม. (คิวเรียงตัวที่ค้าง
           * นานสุดขึ้นก่อน จึงวนครบทุกช่องเสมอ ไม่มีช่องไหนถูกลืม)
           */
          limit: 10,
        }),
    ...NOT_WIRED.map((n) => notWiredHandler(n.cron, n.missingTh)),
  ]);

  const publishRouter = new JobRouter([
    publishHandler({
      worker: deps.publishWorker,
      scheduler: deps.publishScheduler,
    }),
  ]);

  const inboxRouter = new JobRouter([
    inboxHandler({ processor: deps.webhookProcessor }),
  ]);

  // ตารางงานอยู่ใน Redis ไม่ใช่ในโปรเซส — รัน worker กี่ตัวก็เกิดงานรอบละใบเดียว
  const plan = await applyCronSchedule({
    queue: deps.queues[QUEUE.cron],
    logger,
  });
  logger.info("ตั้งตารางงานเรียบร้อย", {
    ทั้งหมด: CRON_JOBS.length,
    เขียนใหม่: plan.toUpsert.length,
    ลบทิ้ง: plan.toRemove.length,
  });

  const workers: Worker[] = [
    startQueueWorker({
      queue: QUEUE.cron,
      router: cronRouter,
      connection: deps.redisBlocking,
      env: config.env,
      logger,
      clock: deps.clock,
    }),
    startQueueWorker({
      queue: QUEUE.publish,
      router: publishRouter,
      connection: deps.redisBlocking,
      env: config.env,
      logger,
      clock: deps.clock,
    }),
    startQueueWorker({
      queue: QUEUE.webhookEvents,
      router: inboxRouter,
      connection: deps.redisBlocking,
      env: config.env,
      logger,
      clock: deps.clock,
    }),
  ];

  logger.warn("คิวที่ยังไม่มีตัวทำงาน — งานจะกองอยู่จนกว่าจะเขียนตัวจัดการเสร็จ", {
    queues: UNSERVED_QUEUES,
  });

  const shutdown = new GracefulShutdown({
    logger,
    stepTimeoutMs: config.shutdownTimeoutMs,
    steps: [
      {
        name: "workers",
        th: "หยุดรับงานใหม่ แล้วรองานที่กำลังทำอยู่ให้จบ",
        // close() ของ BullMQ รองานที่ค้างอยู่ให้จบเองก่อน
        run: async () => {
          await Promise.all(workers.map((w) => w.close()));
        },
      },
      {
        name: "call-log",
        th: "เขียน log การเรียก Meta ที่ยังค้างอยู่ให้เสร็จ",
        // ตัวนี้เขียนแบบยิงแล้วไม่รอ ถ้าไม่ flush ก่อนปิด log ท้ายรอบจะหาย
        run: () => deps.callLog.flush(),
      },
      { name: "queues", th: "ปิดคิว", run: () => closeQueues(deps.queues) },
      {
        name: "redis",
        th: "ปิดการเชื่อมต่อ Redis",
        run: async () => {
          await Promise.allSettled([deps.redis.quit(), deps.redisBlocking.quit()]);
        },
      },
      { name: "db", th: "ปิดการเชื่อมต่อฐานข้อมูล", run: () => closePrisma() },
    ],
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shutdown.isShuttingDown) {
        logger.warn("ได้สัญญาณซ้ำระหว่างปิดระบบ — ออกทันที", { signal });
        process.exit(1);
        return;
      }
      void shutdown.run(signal).then((report) => {
        if (deps.callLog.droppedCount > 0) {
          logger.error("มี call log ที่เขียนไม่สำเร็จ", {
            dropped: deps.callLog.droppedCount,
          });
        }
        process.exit(report.degraded ? 1 : 0);
      });
    });
  }

  logger.info("worker พร้อมทำงาน", {
    env: config.env,
    queues: [QUEUE.cron, QUEUE.publish, QUEUE.webhookEvents],
  });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    logger.error(err.th);
  } else {
    logger.error("worker สตาร์ทไม่ขึ้น", { err });
  }
  process.exit(1);
});
