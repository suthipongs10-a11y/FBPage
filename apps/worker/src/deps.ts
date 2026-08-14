/**
 * ประกอบของจริงทั้งหมดที่ worker ต้องใช้
 *
 * ไฟล์นี้เป็นที่เดียวที่ "โลกจริง" (Postgres, Redis, Meta) มาเจอกับโดเมน
 * ทุกอย่างที่นี่ถูกฉีดเข้าไปในโดเมนผ่าน constructor เสมอ — โดเมนจึงยังเทสต์ได้
 * โดยไม่ต้องมีอะไรพวกนี้เลย
 */
import { createLogger, Keyring, systemClock, type Clock, type Logger } from "@page-os/core";
import { EncryptedTokenStore } from "@page-os/db";
import { WebhookProcessor } from "@page-os/inbox";
import { ListeningSync } from "@page-os/listening";
import { MetaGateway } from "@page-os/meta";
import {
  AlertCenter,
  collectProblems,
  type AlertSink,
  type PageHealthSnapshot,
} from "@page-os/ops";
import {
  PostPublisher,
  PublishScheduler,
  PublishWorker,
  type PublishAlertSink,
} from "@page-os/publish";
import {
  BullPublishQueue,
  createQueues,
  createRedisConnection,
  QUEUE,
  queuePrefix,
  type QueueSet,
  type RedisConnection,
} from "@page-os/queue";
import {
  getPrisma,
  PrismaAlertStore,
  PrismaAuditStore,
  PrismaCallLog,
  PrismaDuePostSource,
  PrismaInboxStore,
  PrismaListeningRepository,
  PrismaPageTokenRepository,
  PrismaPostRepository,
  PrismaPublishedPostLookup,
  type PrismaClient,
} from "@page-os/store";
import type { WorkerConfig } from "./config.js";

export interface WorkerDeps {
  config: WorkerConfig;
  logger: Logger;
  clock: Clock;
  prisma: PrismaClient;
  /** connection สำหรับ Queue (ไม่ block) */
  redis: RedisConnection;
  /** connection แยกสำหรับ Worker (คำสั่ง blocking ยึดเส้นไว้ทั้งเส้น) */
  redisBlocking: RedisConnection;
  queues: QueueSet;
  gateway: MetaGateway;
  callLog: PrismaCallLog;
  publishWorker: PublishWorker;
  publishScheduler: PublishScheduler;
  alertCenter: AlertCenter;
  auditStore: PrismaAuditStore;
  inboxStore: PrismaInboxStore;
  webhookProcessor: WebhookProcessor;
  listeningSync: ListeningSync;
  collectProblemsNow: (nowMs: number) => Promise<ReturnType<typeof collectProblems>>;
}

export interface BuildDepsOptions {
  config: WorkerConfig;
  env: NodeJS.ProcessEnv;
  /** ปลายทางแจ้งเตือน — LINE ในโปรดักชัน */
  alertSink: AlertSink;
  publishAlerts: PublishAlertSink;
  logger?: Logger;
  clock?: Clock;
}

export function buildDeps(opts: BuildDepsOptions): WorkerDeps {
  const logger = opts.logger ?? createLogger({ bindings: { service: "worker" } });
  const clock = opts.clock ?? systemClock;
  const { config } = opts;

  const prisma = getPrisma();

  const redis = createRedisConnection({
    url: config.redisUrl,
    forBlockingUse: false,
    name: "worker-queue",
  });
  // ต้องเป็นคนละเส้นกับข้างบน — ดูเหตุผลใน packages/queue/src/connection.ts
  const redisBlocking = createRedisConnection({
    url: config.redisUrl,
    forBlockingUse: true,
    name: "worker-consume",
  });

  const queues = createQueues({ connection: redis, env: config.env });

  const tokenStore = new EncryptedTokenStore({
    repo: new PrismaPageTokenRepository(prisma),
    keyring: Keyring.fromEnv(opts.env["TOKEN_ENC_KEYS"]),
    clock,
    logger,
  });

  const callLog = new PrismaCallLog({ prisma, logger });

  const gateway = new MetaGateway(
    {
      appId: config.appId,
      appSecret: config.appSecret,
      // กฎข้อ 2: เวอร์ชันมาจาก env ที่เดียว — ไม่ส่ง graphVersion มาที่นี่
    },
    { tokenStore, clock, logger, callLog },
  );

  const postRepo = new PrismaPostRepository(prisma);
  const publishQueue = new BullPublishQueue({
    queue: queues[QUEUE.publish],
    redis,
    prefix: queuePrefix(config.env),
    logger,
  });

  const publishScheduler = new PublishScheduler({
    queue: publishQueue,
    source: new PrismaDuePostSource({ prisma }),
    clock,
    logger,
  });

  const publishWorker = new PublishWorker({
    repo: postRepo,
    publisher: new PostPublisher(gateway),
    duplicateLookup: new PrismaPublishedPostLookup({ prisma, clock }),
    alerts: opts.publishAlerts,
    clock,
    logger,
  });

  const inboxStore = new PrismaInboxStore({ prisma });
  const webhookProcessor = new WebhookProcessor({
    store: inboxStore,
    clock,
    logger,
  });

  const alertCenter = new AlertCenter({
    store: new PrismaAlertStore(prisma),
    sink: opts.alertSink,
    clock,
    quietHours: { fromHour: 22, toHour: 7, timeZone: config.timeZone },
  });

  const listeningSync = new ListeningSync({
    gateway,
    repo: new PrismaListeningRepository(prisma),
    clock,
    logger,
  });

  return {
    config,
    logger,
    clock,
    prisma,
    redis,
    redisBlocking,
    queues,
    gateway,
    callLog,
    publishWorker,
    publishScheduler,
    alertCenter,
    auditStore: new PrismaAuditStore(prisma),
    inboxStore,
    webhookProcessor,
    listeningSync,
    collectProblemsNow: (nowMs) => collectProblemsFromDb(prisma, nowMs),
  };
}

/**
 * รวบรวมสถานะสดของทุกเพจแล้วส่งให้ตัวตรวจปัญหา
 *
 * `collectProblems()` เป็นฟังก์ชันบริสุทธิ์ที่ไม่รู้จัก DB เลย ตรงนี้จึงเป็นคน
 * แปลงข้อมูลใน DB ให้อยู่ในรูปที่มันรับ — และเป็นที่เดียวที่ต้องแก้ถ้าเพิ่ม
 * ชนิดปัญหาใหม่
 */
async function collectProblemsFromDb(
  prisma: PrismaClient,
  nowMs: number,
): Promise<ReturnType<typeof collectProblems>> {
  const pages = await prisma.page.findMany({
    include: {
      workspace: { select: { clientName: true } },
      // token ของเพจมีได้หลายชนิด (page / system_user) เอาตัวที่อัปเดตล่าสุด
      tokens: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });

  const failedTargets = await prisma.postTarget.findMany({
    where: { status: "failed" },
    include: { page: { select: { fbPageId: true } } },
    // ถ้าพังพร้อมกันเป็นร้อย การอ่านมาทั้งหมดไม่ได้ช่วยอะไร —
    // ตัวรวมแจ้งเตือนจะรวบเป็นข้อความเดียวอยู่แล้ว
    take: 200,
  });

  return collectProblems({
    nowMs,
    pages: pages.map((p) => {
      const token = p.tokens[0];
      const expiresAtMs = token?.expiresAt?.getTime();
      return {
        pageId: p.fbPageId,
        pageName: p.name,
        clientName: p.workspace.clientName,
        // คำนวณจากรหัสเพจ ไม่ใช่ลำดับในผลลัพธ์ — ไม่งั้นสีของแต่ละเพจจะสลับกัน
        // ทุกครั้งที่เพิ่มหรือลบเพจ ซึ่งทำให้คนที่จำสีไว้อ่านผิด
        colorIndex: colorIndexOf(p.fbPageId),
        connectionState: toConnectionState(token?.status),
        ...(expiresAtMs !== undefined
          ? { hoursUntilExpiry: Math.floor((expiresAtMs - nowMs) / 3_600_000) }
          : {}),
        lastWebhookAtMs: p.lastWebhookAt?.getTime() ?? null,
      };
    }),
    failedPosts: failedTargets.map((t) => ({
      postId: t.postId,
      pageId: t.page.fbPageId,
      failedAttempts: t.attempts,
      ...(t.error !== null ? { lastErrorTh: t.error } : {}),
    })),
    incidents: [],
  });
}

/** จำนวนสีที่หน้าจอมีให้ — ต้องตรงกับชุดสีใน apps/web */
const COLOR_COUNT = 8;

/** สีประจำเพจที่คงที่ตลอด ไม่ขึ้นกับว่าเพจนี้อยู่ลำดับที่เท่าไหร่ในผลลัพธ์ */
function colorIndexOf(fbPageId: string): number {
  let h = 0;
  for (const ch of fbPageId) h = (h * 31 + ch.charCodeAt(0)) % 100_000;
  return h % COLOR_COUNT;
}

/**
 * แปลงสถานะ token ในฐานข้อมูล → สถานะการเชื่อมต่อที่โดเมนใช้
 *
 * สองชุดนี้ตั้งชื่อไม่ตรงกันด้วยเหตุผลคนละเรื่อง: ฝั่ง DB บอก "สถานะของ token"
 * ส่วนฝั่งโดเมนบอก "เพจนี้ใช้งานได้ไหม" — ต่างกันตรงกรณีไม่มี token เลย
 * ซึ่งฝั่ง DB ไม่มีค่าให้ใช้ (ไม่มีแถว) แต่โดเมนต้องแยกออกจาก "unknown"
 * เพราะข้อความที่บอกผู้ใช้ต่างกันคนละเรื่อง
 */
function toConnectionState(
  status: string | undefined,
): PageHealthSnapshot["connectionState"] {
  if (status === undefined) return "no_token";
  switch (status) {
    case "active":
      return "ok";
    case "expiring_soon":
    case "expired":
    case "revoked":
    case "missing_permissions":
      return status;
    default:
      return "unknown";
  }
}
