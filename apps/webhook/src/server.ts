/**
 * จุดเริ่มของ service รับ webhook
 *
 * แยกจาก `app.ts` เพราะไฟล์นี้แตะของจริงทั้งหมด — env, Redis, พอร์ต, สัญญาณ OS
 * ส่วน `app.ts` เทสต์ได้ล้วนๆ ด้วย `app.inject()`
 */
import { readFileSync } from "node:fs";
import { createLogger } from "@page-os/core";
import {
  BullWebhookEventSink,
  createQueues,
  createRedisConnection,
  GracefulShutdown,
  QUEUE,
} from "@page-os/queue";
import { buildApp, type TlsMaterial } from "./app.js";
import { ConfigError, loadWebhookConfig, type MtlsConfig } from "./config.js";

const logger = createLogger({ bindings: { service: "webhook" } });

/**
 * อ่านใบรับรองตั้งแต่ตอนสตาร์ท ไม่ใช่ตอน handshake
 *
 * ถ้าอ่านตอน handshake อาการที่ได้คือ service ขึ้นเขียวปกติ แล้ว Meta ต่อไม่ได้
 * โดยไม่มีอะไรใน log ของเราเลย — ล้มตั้งแต่สตาร์ทพร้อมบอกว่าไฟล์ไหนอ่านไม่ได้
 * หาเจอเร็วกว่ากันมาก
 */
function readTls(m: MtlsConfig): TlsMaterial {
  const read = (path: string, whatTh: string): Buffer => {
    try {
      return readFileSync(path);
    } catch {
      throw new ConfigError(
        `cannot read ${path}`,
        `อ่าน${whatTh}ที่ "${path}" ไม่ได้ — เช็คว่ามีไฟล์อยู่จริงและโปรเซสมีสิทธิ์อ่าน`,
      );
    }
  };
  return {
    key: read(m.keyPath, "ไฟล์ private key"),
    cert: read(m.certPath, "ไฟล์ certificate"),
    ca: read(m.caPath, "ไฟล์ CA ของ Meta"),
  };
}

async function main(): Promise<void> {
  const config = loadWebhookConfig(process.env);
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl === undefined || redisUrl.trim() === "") {
    throw new ConfigError(
      "REDIS_URL is not set",
      "ยังไม่ได้ตั้งค่า REDIS_URL — ตัวรับ webhook ต้องมีคิวไว้ส่งงานต่อ (กฎข้อ 5)",
    );
  }

  const env = process.env["APP_ENV"]?.trim() || "dev";
  const redis = createRedisConnection({
    url: redisUrl,
    forBlockingUse: false,
    name: "webhook",
  });
  const queues = createQueues({ connection: redis, env });
  const sink = new BullWebhookEventSink({
    queue: queues[QUEUE.webhookEvents],
    redis,
  });

  const app = buildApp({
    appSecret: config.appSecret,
    verifyToken: config.verifyToken,
    sink,
    bodyLimitBytes: config.bodyLimitBytes,
    logger,
    ...(config.mtls !== null ? { tls: readTls(config.mtls) } : {}),
  });

  const shutdown = new GracefulShutdown({
    logger,
    steps: [
      {
        name: "http",
        th: "หยุดรับ request ใหม่ แล้วรอ request ที่ค้างอยู่ให้จบ",
        run: () => app.close(),
      },
      { name: "queue", th: "ปิดคิว", run: () => sink.close() },
      {
        name: "redis",
        th: "ปิดการเชื่อมต่อ Redis",
        run: async () => {
          await redis.quit();
        },
      },
    ],
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shutdown.isShuttingDown) {
        // สัญญาณที่สองระหว่างกำลังปิด = คนกำลังรีบ ออกเลย
        logger.warn("ได้สัญญาณซ้ำระหว่างปิดระบบ — ออกทันที", { signal });
        process.exit(1);
        return;
      }
      void shutdown.run(signal).then((report) => {
        process.exit(report.degraded ? 1 : 0);
      });
    });
  }

  await app.listen({ host: config.host, port: config.port });
  logger.info("ตัวรับ webhook พร้อมทำงาน", {
    host: config.host,
    port: config.port,
    env,
    tls: config.mtls !== null ? "mtls" : "ปล่อยให้ load balancer จัดการ",
  });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    // ข้อความไทยพร้อมบอกว่าต้องทำอะไรต่อ — ไม่ต้องมี stack ให้รก
    logger.error(err.th);
  } else {
    logger.error("ตัวรับ webhook สตาร์ทไม่ขึ้น", { err });
  }
  process.exit(1);
});
