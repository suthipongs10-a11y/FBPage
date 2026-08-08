/**
 * ตัวรับ webhook จาก Meta
 *
 * แยก `buildApp()` ออกจากการ listen จริง เพื่อให้เทสต์ยิง request เข้าไปได้
 * ด้วย `app.inject()` โดยไม่ต้องเปิดพอร์ตและไม่ต้องมี Redis
 *
 * ─── กติกาเรื่องรหัสตอบกลับ ที่คิดมาแล้วและห้ามเปลี่ยนโดยไม่อ่านเหตุผลก่อน ───
 *
 * Meta ตีความรหัสตอบกลับแบบนี้: ไม่ใช่ 200 = ส่งไม่สำเร็จ → ยิงซ้ำ → ถ้าพลาดถี่พอ
 * มันจะ **ปิด subscription ของเพจนั้นทิ้ง** แล้วเราจะไม่ได้รับอะไรอีกเลยจนกว่าจะ
 * ไปกดเปิดใหม่เอง คำถามทุกครั้งจึงเป็น "ยิงซ้ำแล้วมีโอกาสสำเร็จไหม"
 *
 *   401  ลายเซ็นไม่ผ่าน — ไม่ใช่ Meta ตั้งแต่แรก ยิงซ้ำก็ไม่ผ่าน และเราไม่อยาก
 *        ให้คนที่ยิงมั่วรู้ด้วยว่าเดาถูกหรือผิดตรงไหน
 *   200  ลายเซ็นผ่านแต่ body แปลง JSON ไม่ได้ / ไม่มี event ที่เรารู้จัก
 *        ← จุดที่คนพลาดกันบ่อย: ของพังแบบนี้ยิงซ้ำอีกร้อยรอบก็พังเหมือนเดิม
 *          ตอบ error ไปมีแต่จะทำให้ subscription ถูกปิด เก็บเข้า log แล้วตอบ 200
 *   500  ยัดเข้าคิวไม่สำเร็จ ← อันนี้ยิงซ้ำแล้วมีโอกาสสำเร็จ และการกลืนไว้เฉยๆ
 *        แปลว่าแชทลูกค้าหายไปเงียบๆ จึงต้องขอให้ Meta ส่งมาใหม่
 */
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  nullLogger,
  systemClock,
  type Clock,
  type Logger,
} from "@page-os/core";
import {
  handleVerification,
  idempotencyKey,
  parseWebhookPayload,
  verifyWebhookSignature,
  WebhookSignatureError,
  type QueuedWebhookEvent,
  type WebhookEventSink,
} from "@page-os/inbox";

/**
 * ใบรับรองสำหรับ mTLS
 *
 * Meta บังคับตั้งแต่ 31 มี.ค. 2026 ว่า endpoint ต้องขอ client certificate
 * และ trust CA ภายในของ Meta — ถ้าไม่ทำ webhook จะหยุดส่งทั้งหมด
 */
export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
  /** CA ภายในของ Meta */
  ca: Buffer;
}

export interface BuildAppOptions {
  appSecret: string;
  verifyToken: string;
  sink: WebhookEventSink;
  bodyLimitBytes?: number;
  clock?: Clock;
  logger?: Logger;
  /** ฉีดเข้ามาได้เพื่อให้เทสต์เดา deliveryId ได้ */
  newId?: () => string;
  /** ไม่ใส่ = ให้ load balancer เป็นคน terminate TLS */
  tls?: TlsMaterial;
}

const SIGNATURE_HEADER = "x-hub-signature-256";

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const clock = opts.clock ?? systemClock;
  const log = opts.logger ?? nullLogger;
  const newId = opts.newId ?? (() => randomUUID());

  const base = {
    // ปิด logger ของ Fastify แล้วใช้ของเราแทน — ของเรา redact token ให้อัตโนมัติ
    // (กฎข้อ 3) ส่วนของ Fastify จะพ่น header ดิบออกมาซึ่งมี signature ติดไปด้วย
    logger: false as const,
    bodyLimit: opts.bodyLimitBytes ?? 5 * 1024 * 1024,
    // Meta ยิงมาจากหลาย IP และเราอยู่หลัง proxy เกือบตลอด
    trustProxy: true,
  };

  const app: FastifyInstance =
    opts.tls !== undefined
      ? (Fastify({
          ...base,
          https: {
            key: opts.tls.key,
            cert: opts.tls.cert,
            ca: opts.tls.ca,
            // สองบรรทัดนี้คือหัวใจของ mTLS: ขอใบรับรองจากฝั่งที่ยิงเข้ามา
            // และปฏิเสธถ้าใบนั้นไม่ได้เซ็นโดย CA ข้างบน
            requestCert: true,
            rejectUnauthorized: true,
          },
        }) as unknown as FastifyInstance)
      : Fastify(base);

  /**
   * เก็บ body ไว้เป็น Buffer ดิบ **ห้าม parse ตรงนี้**
   *
   * ลายเซ็นของ Meta คำนวณจากไบต์ที่ส่งมาเป๊ะๆ ถ้าเรา JSON.parse แล้ว stringify
   * กลับไปคำนวณ ลำดับคีย์กับช่องว่างจะเปลี่ยน ลายเซ็นจะไม่มีวันตรง — และอาการที่ได้
   * คือ "ปฏิเสธทุก request" ซึ่งดูเหมือน secret ผิด ทำให้ไล่ผิดทางอยู่หลายชั่วโมง
   */
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (_req, reply) => {
    try {
      await opts.sink.ping?.();
      return { ok: true };
    } catch (err) {
      log.error("คิวยังต่อไม่ได้", { err });
      return reply
        .code(503)
        .send({ ok: false, th: "ต่อคิวงานไม่ได้ — ยังรับ webhook ไม่ได้" });
    }
  });

  /** Meta เรียกตอนกด Verify ในหน้า App Dashboard */
  app.get("/webhook", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      const challenge = handleVerification({
        mode: q["hub.mode"],
        token: q["hub.verify_token"],
        challenge: q["hub.challenge"],
        expectedToken: opts.verifyToken,
      });
      log.info("Meta ยืนยัน webhook สำเร็จ");
      // ต้องตอบเป็นข้อความเปล่าๆ ไม่ใช่ JSON — Meta เทียบ body ทั้งก้อนกับ challenge
      // ถ้าห่อเป็น JSON จะมีเครื่องหมายคำพูดติดไปด้วยแล้วไม่ผ่าน
      return reply.type("text/plain; charset=utf-8").send(challenge);
    } catch (err) {
      const th =
        err instanceof WebhookSignatureError
          ? err.th
          : "ยืนยัน webhook ไม่สำเร็จ";
      log.warn("ยืนยัน webhook ไม่ผ่าน", { th });
      return reply.code(403).send({ ok: false, th });
    }
  });

  app.post("/webhook", async (req, reply) => {
    const receivedAtMs = clock.now();
    const deliveryId = newId();
    const raw = req.body;

    if (!Buffer.isBuffer(raw)) {
      // ถึงตรงนี้ได้แปลว่า content-type parser ไม่ถูกเรียก (เช่นส่ง body ว่าง)
      // ลายเซ็นยืนยันไม่ได้จึงถือว่าไม่น่าเชื่อถือ
      log.warn("request ไม่มี body ให้ตรวจลายเซ็น", { deliveryId });
      return reply
        .code(401)
        .send({ ok: false, th: "ไม่มีเนื้อหาให้ตรวจลายเซ็น — ปฏิเสธ" });
    }

    const header = req.headers[SIGNATURE_HEADER];
    if (Array.isArray(header)) {
      // ส่ง header ซ้ำสองอันมาเป็นลูกเล่นเก่าแก่ของการหลอก proxy ให้เลือกคนละอัน
      log.warn("มี header ลายเซ็นซ้ำ", { deliveryId });
      return reply
        .code(401)
        .send({ ok: false, th: "มีลายเซ็นมามากกว่าหนึ่งอัน — ปฏิเสธ" });
    }

    try {
      verifyWebhookSignature({
        rawBody: raw,
        signatureHeader: header,
        appSecret: opts.appSecret,
      });
    } catch (err) {
      const th =
        err instanceof WebhookSignatureError
          ? err.th
          : "ตรวจลายเซ็นไม่ผ่าน — ปฏิเสธ request นี้";
      log.warn("ลายเซ็น webhook ไม่ผ่าน", { deliveryId, th });
      return reply.code(401).send({ ok: false, th });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      // ลายเซ็นผ่านแต่ JSON พัง = ของพังจริง ยิงซ้ำก็พังเหมือนเดิม → ตอบ 200
      log.error("body ลายเซ็นถูกแต่แปลง JSON ไม่ได้", {
        deliveryId,
        bytes: raw.byteLength,
      });
      return reply.code(200).send({ ok: true, accepted: 0 });
    }

    const { events, unknown } = parseWebhookPayload(body, receivedAtMs);

    for (const u of unknown) {
      // ระดับ warn เพราะแปลว่า Meta ส่งอะไรใหม่มาแล้วเรายังไม่รองรับ — ต้องมีคนเห็น
      // แต่ raw ไปอยู่ระดับ debug เพราะข้างในมีข้อความลูกค้า ไม่ควรค้างใน log ปกติ
      log.warn("เจอ field ที่ยังไม่รองรับใน webhook", {
        deliveryId,
        page_id: u.pageId,
        field: u.field,
      });
      log.debug("เนื้อหาของ field ที่ยังไม่รองรับ", {
        deliveryId,
        raw: u.raw,
      });
    }

    if (events.length === 0) {
      return reply.code(200).send({ ok: true, accepted: 0 });
    }

    const queued: QueuedWebhookEvent[] = events.map((event) => ({
      key: idempotencyKey(event),
      event,
      receivedAtMs,
      deliveryId,
    }));

    try {
      await opts.sink.enqueue(queued);
    } catch (err) {
      // ยิงซ้ำแล้วมีโอกาสสำเร็จ → ขอให้ Meta ส่งใหม่
      // ถ้ารอบก่อนยัดเข้าไปได้บางส่วนแล้ว ไม่เป็นไร — jobId เป็น idempotency key
      // และปลายทางยังเช็ค hasSeen อีกชั้น (กฎข้อ 6)
      log.error("ยัด event เข้าคิวไม่สำเร็จ", {
        deliveryId,
        count: queued.length,
        err,
      });
      return reply.code(500).send({
        ok: false,
        th: "รับไว้ไม่ได้ตอนนี้ — ขอให้ส่งมาใหม่",
      });
    }

    log.info("รับ event จาก Meta แล้ว", {
      deliveryId,
      accepted: queued.length,
    });
    return reply.code(200).send({ ok: true, accepted: queued.length });
  });

  return app;
}
