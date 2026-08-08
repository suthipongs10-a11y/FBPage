import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FakeClock } from "@page-os/core";
import { InMemoryWebhookEventSink } from "@page-os/inbox";
import { buildApp } from "./app.js";

const APP_SECRET = "s3cr3t-app-secret";
const VERIFY_TOKEN = "my-verify-token";
const NOW = 1_700_000_000_000;

function sign(body: string | Buffer): string {
  return (
    "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex")
  );
}

interface Harness {
  app: FastifyInstance;
  sink: InMemoryWebhookEventSink;
  clock: FakeClock;
}

let h: Harness;
let idCounter = 0;

beforeEach(() => {
  idCounter = 0;
  const sink = new InMemoryWebhookEventSink();
  const clock = new FakeClock(NOW);
  const app = buildApp({
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    sink,
    clock,
    newId: () => `d${++idCounter}`,
  });
  h = { app, sink, clock };
});

afterEach(async () => {
  await h.app.close();
});

/**
 * ค่าบอกว่า "ไม่ต้องใส่ header ลายเซ็นเลย"
 *
 * ใช้ค่าพิเศษแทน `undefined` เพราะการส่ง `undefined` ให้พารามิเตอร์ที่มีค่า default
 * จะไปเรียก default แทน — เทสต์ "ไม่มีลายเซ็น" จะกลายเป็นส่งลายเซ็นที่ถูกต้องไป
 * แล้วผ่านฉลุยโดยที่ไม่ได้ทดสอบอะไรเลย
 */
const NO_SIGNATURE = Symbol("no-signature");

/** ยิง POST พร้อมลายเซ็นที่ถูกต้องของ body นั้นๆ */
async function post(
  bodyText: string,
  signature: string | typeof NO_SIGNATURE = sign(bodyText),
) {
  return h.app.inject({
    method: "POST",
    url: "/webhook",
    headers: {
      "content-type": "application/json",
      ...(signature === NO_SIGNATURE
        ? {}
        : { "x-hub-signature-256": signature }),
    },
    payload: bodyText,
  });
}

const messagePayload = (mid: string, text: string): string =>
  JSON.stringify({
    object: "page",
    entry: [
      {
        id: "p1",
        time: NOW,
        messaging: [
          {
            sender: { id: "u1" },
            recipient: { id: "p1" },
            timestamp: 1_700_000_000,
            message: { mid, text },
          },
        ],
      },
    ],
  });

// ---------------------------------------------------------------------------

describe("GET /webhook — ตอน Meta มายืนยัน", () => {
  it("token ถูกต้อง → ตอบ challenge เป็นข้อความเปล่า", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
    });
    expect(res.statusCode).toBe(200);
    // ต้องเป็นตัวเลขเปล่า ไม่ใช่ JSON — Meta เทียบ body ทั้งก้อนกับ challenge
    expect(res.body).toBe("1158201444");
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  it("token ผิด → 403 และไม่บอกว่าค่าที่ถูกคืออะไร", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123",
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(VERIFY_TOKEN);
  });

  it("mode ไม่ใช่ subscribe → 403", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/webhook?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=123`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("ไม่มี challenge → 403", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}`,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /webhook — ลายเซ็น", () => {
  it("ลายเซ็นถูก → รับไว้แล้วส่งต่อเข้าคิว", async () => {
    const res = await post(messagePayload("m_1", "สนใจสินค้าค่ะ"));
    expect(res.statusCode).toBe(200);
    expect(h.sink.delivered).toHaveLength(1);
    expect(h.sink.delivered[0]?.key).toBe("msg:m_1");
    expect(h.sink.delivered[0]?.receivedAtMs).toBe(NOW);
    expect(h.sink.delivered[0]?.deliveryId).toBe("d1");
  });

  it("ไม่มี header ลายเซ็น → 401 และไม่ส่งอะไรเข้าคิว", async () => {
    const res = await post(messagePayload("m_1", "hi"), NO_SIGNATURE);
    expect(res.statusCode).toBe(401);
    expect(h.sink.delivered).toHaveLength(0);
  });

  it("ลายเซ็นผิด → 401", async () => {
    const res = await post(messagePayload("m_1", "hi"), "sha256=" + "0".repeat(64));
    expect(res.statusCode).toBe(401);
    expect(h.sink.delivered).toHaveLength(0);
  });

  it("ลายเซ็นแบบอื่นที่ไม่ใช่ sha256 → 401", async () => {
    const res = await post(messagePayload("m_1", "hi"), "sha1=abcdef");
    expect(res.statusCode).toBe(401);
  });

  it("ส่ง header ลายเซ็นมาสองอัน → 401", async () => {
    const body = messagePayload("m_1", "hi");
    const res = await h.app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": [sign(body), "sha256=" + "0".repeat(64)],
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(h.sink.delivered).toHaveLength(0);
  });

  /**
   * เทสต์ที่สำคัญที่สุดในไฟล์นี้
   *
   * ถ้าโค้ดเผลอ parse JSON แล้ว stringify ใหม่ก่อนตรวจลายเซ็น เทสต์อื่นทั้งหมด
   * จะยังเขียว (เพราะ body ที่เราสร้างมาจาก JSON.stringify อยู่แล้ว) เทสต์นี้
   * จงใจส่ง body ที่มีช่องว่างและลำดับคีย์ต่างจากผลของ stringify เพื่อบังคับให้
   * ลายเซ็นตรงได้ทางเดียวคือคำนวณจากไบต์ดิบ
   */
  it("ตรวจลายเซ็นจากไบต์ดิบ ไม่ใช่จาก JSON ที่แปลงกลับ", async () => {
    const pretty = `{\n  "object": "page",\n  "entry": [ { "time": ${NOW}, "id": "p1", "messaging": [] } ]\n}`;
    const res = await post(pretty, sign(pretty));
    expect(res.statusCode).toBe(200);

    // และลายเซ็นของรูปที่ stringify ใหม่ต้องใช้ไม่ได้
    const restringified = JSON.stringify(JSON.parse(pretty));
    expect(restringified).not.toBe(pretty);
    const res2 = await post(pretty, sign(restringified));
    expect(res2.statusCode).toBe(401);
  });

  /**
   * ข้อความไทยกินหลายไบต์ต่อหนึ่งตัวอักษร ถ้าที่ไหนเผลอวัดความยาวเป็นตัวอักษร
   * แทนไบต์ ลายเซ็นจะเพี้ยนเฉพาะกับข้อความไทย — ซึ่งคือข้อความเกือบทั้งหมดของเรา
   */
  it("ข้อความไทยเซ็นแล้วยังตรง", async () => {
    const body = messagePayload("m_th", "สั่งกาแฟเย็นสองแก้วค่ะ ที่ร้านเปิดกี่โมงคะ");
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(h.sink.delivered).toHaveLength(1);
  });
});

describe("POST /webhook — รหัสตอบกลับตามสาเหตุ", () => {
  it("ลายเซ็นถูกแต่ JSON พัง → ตอบ 200 (ยิงซ้ำก็ไม่หาย และ error จะทำให้ Meta ปิด subscription)", async () => {
    const broken = '{"object":"page","entry":[';
    const res = await post(broken, sign(broken));
    expect(res.statusCode).toBe(200);
    expect(h.sink.delivered).toHaveLength(0);
  });

  it("payload ที่ไม่มี event ที่รู้จัก → 200 แต่ไม่มีอะไรเข้าคิว", async () => {
    const body = JSON.stringify({
      object: "page",
      entry: [{ id: "p1", time: NOW, changes: [{ field: "ยังไม่รองรับ", value: {} }] }],
    });
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: 0 });
    expect(h.sink.delivered).toHaveLength(0);
  });

  it("คิวล่ม → ตอบ 500 เพื่อให้ Meta ส่งมาใหม่", async () => {
    h.sink.failWith = new Error("redis down");
    const res = await post(messagePayload("m_1", "hi"));
    expect(res.statusCode).toBe(500);
  });

  it("body ใหญ่เกินเพดาน → ปฏิเสธโดยไม่ล้ม", async () => {
    const small = buildApp({
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      sink: h.sink,
      bodyLimitBytes: 128,
    });
    const body = messagePayload("m_1", "ก".repeat(500));
    const res = await small.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(413);
    expect(h.sink.delivered).toHaveLength(0);
    await small.close();
  });
});

describe("POST /webhook — สิ่งที่ส่งต่อเข้าคิว", () => {
  it("event หลายใบใน request เดียวได้ deliveryId เดียวกัน", async () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          messaging: [
            { sender: { id: "u1" }, message: { mid: "m_1", text: "a" } },
            { sender: { id: "u2" }, message: { mid: "m_2", text: "b" } },
          ],
        },
      ],
    });
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(h.sink.delivered.map((d) => d.deliveryId)).toEqual(["d1", "d1"]);
    expect(h.sink.delivered.map((d) => d.key)).toEqual(["msg:m_1", "msg:m_2"]);
  });

  it("คอมเมนต์ได้คีย์กันซ้ำที่มี verb ติดมาด้วย", async () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "c_1",
                post_id: "p_1",
                from: { id: "u1", name: "สมชาย" },
                message: "ราคาเท่าไหร่ครับ",
              },
            },
          ],
        },
      ],
    });
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(h.sink.delivered[0]?.key).toBe("comment:c_1:add");
  });

  /**
   * echo คือข้อความที่เพจเราส่งเองแล้วเด้งกลับมา ตัวรับ webhook **ต้องส่งต่อ**
   * ไม่ใช่กรองทิ้งเอง เพราะ echo ที่คนพิมพ์ในแอป FB เป็นสัญญาณให้พักบอท
   * (สเปกข้อ 6.7) การตัดสินนั้นอยู่ที่ WebhookProcessor ไม่ใช่ที่นี่
   */
  it("ข้อความ echo ก็ส่งต่อ ไม่กรองทิ้งที่ชั้นนี้", async () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          messaging: [
            {
              sender: { id: "p1" },
              recipient: { id: "u1" },
              message: { mid: "m_echo", text: "สวัสดีค่ะ", is_echo: true },
            },
          ],
        },
      ],
    });
    await post(body);
    expect(h.sink.delivered).toHaveLength(1);
    expect(h.sink.delivered[0]?.key).toBe("msg:m_echo");
  });

  it("เวลาที่ติดไปกับงานคือเวลาที่ request มาถึง ไม่ใช่เวลาใน event", async () => {
    h.clock.advance(60_000);
    await post(messagePayload("m_1", "hi"));
    expect(h.sink.delivered[0]?.receivedAtMs).toBe(NOW + 60_000);
  });
});

describe("healthz / readyz", () => {
  it("healthz ตอบ 200 เสมอ", async () => {
    const res = await h.app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });

  it("readyz ตอบ 200 เมื่อคิวตอบ", async () => {
    const res = await h.app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
  });

  it("readyz ตอบ 503 เมื่อคิวไม่ตอบ", async () => {
    h.sink.failWith = new Error("redis down");
    const res = await h.app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
  });
});
