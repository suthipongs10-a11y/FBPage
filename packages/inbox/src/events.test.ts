import { describe, expect, it } from "vitest";
import {
  idempotencyKey,
  normalizeTimestamp,
  parseWebhookPayload,
  type CommentEvent,
  type IncomingMessageEvent,
  type RatingEvent,
} from "./events.js";

const NOW = 1_700_000_000_000;

function messengerPayload(messaging: unknown[]): unknown {
  return {
    object: "page",
    entry: [{ id: "p1", time: NOW, messaging }],
  };
}

function changesPayload(changes: unknown[], object = "page"): unknown {
  return { object, entry: [{ id: "p1", time: NOW, changes }] };
}

describe("normalizeTimestamp", () => {
  it("แปลงวินาทีเป็นมิลลิวินาที", () => {
    expect(normalizeTimestamp(1_700_000_000, NOW)).toBe(1_700_000_000_000);
  });
  it("มิลลิวินาทีอยู่แล้วไม่แปลง", () => {
    expect(normalizeTimestamp(1_700_000_000_000, NOW)).toBe(1_700_000_000_000);
  });
  it("ค่าที่ใช้ไม่ได้ใช้ fallback", () => {
    for (const v of [undefined, null, 0, -1, "abc", {}]) {
      expect(normalizeTimestamp(v, NOW), String(v)).toBe(NOW);
    }
  });
});

describe("parseWebhookPayload — ข้อความ", () => {
  it("แปลงข้อความจากลูกค้า", () => {
    const { events } = parseWebhookPayload(
      messengerPayload([
        {
          sender: { id: "u1" },
          recipient: { id: "p1" },
          timestamp: 1_700_000_000,
          message: { mid: "m_abc", text: "สนใจสินค้าค่ะ" },
        },
      ]),
      NOW,
    );

    expect(events).toHaveLength(1);
    const ev = events[0] as IncomingMessageEvent;
    expect(ev.type).toBe("message");
    expect(ev.mid).toBe("m_abc");
    expect(ev.senderId).toBe("u1");
    expect(ev.text).toBe("สนใจสินค้าค่ะ");
    expect(ev.channel).toBe("messenger");
    expect(ev.isEcho).toBe(false);
  });

  it("Instagram DM ถูกจัดเป็นช่องทาง instagram", () => {
    const { events } = parseWebhookPayload(
      {
        object: "instagram",
        entry: [
          {
            id: "p1",
            time: NOW,
            messaging: [
              { sender: { id: "ig1" }, message: { mid: "m1", text: "hi" } },
            ],
          },
        ],
      },
      NOW,
    );
    expect((events[0] as IncomingMessageEvent).channel).toBe("instagram");
  });

  it("แปลงไฟล์แนบ", () => {
    const { events } = parseWebhookPayload(
      messengerPayload([
        {
          sender: { id: "u1" },
          message: {
            mid: "m1",
            attachments: [
              { type: "image", payload: { url: "https://cdn/a.jpg" } },
              { type: "audio", payload: {} },
            ],
          },
        },
      ]),
      NOW,
    );
    const ev = events[0] as IncomingMessageEvent;
    expect(ev.attachments).toEqual([
      { type: "image", url: "https://cdn/a.jpg" },
      { type: "audio" },
    ]);
  });

  it("อ่าน quick reply payload", () => {
    const { events } = parseWebhookPayload(
      messengerPayload([
        {
          sender: { id: "u1" },
          message: {
            mid: "m1",
            text: "ดูสินค้า",
            quick_reply: { payload: "SHOW_PRODUCTS" },
          },
        },
      ]),
      NOW,
    );
    expect((events[0] as IncomingMessageEvent).quickReplyPayload).toBe(
      "SHOW_PRODUCTS",
    );
  });

  it("ข้อความที่ไม่มี mid ถูกเก็บเป็น unknown ไม่ทำให้พัง", () => {
    const { events, unknown } = parseWebhookPayload(
      messengerPayload([{ sender: { id: "u1" }, message: { text: "hi" } }]),
      NOW,
    );
    expect(events).toHaveLength(0);
    expect(unknown).toHaveLength(1);
  });
});

describe("parseWebhookPayload — echo (สเปกข้อ 6.2 และ 6.7)", () => {
  it("echo ที่ระบบเราส่ง มี app_id", () => {
    const { events } = parseWebhookPayload(
      messengerPayload([
        {
          sender: { id: "p1" },
          message: { mid: "m1", text: "สวัสดีค่ะ", is_echo: true, app_id: 12345 },
        },
      ]),
      NOW,
    );
    const ev = events[0] as IncomingMessageEvent;
    expect(ev.isEcho).toBe(true);
    expect(ev.isFromOtherApp).toBe(false);
  });

  it("echo ที่คนพิมพ์ในแอป FB ไม่มี app_id", () => {
    const { events } = parseWebhookPayload(
      messengerPayload([
        {
          sender: { id: "p1" },
          message: { mid: "m1", text: "เดี๋ยวเช็คให้นะครับ", is_echo: true },
        },
      ]),
      NOW,
    );
    const ev = events[0] as IncomingMessageEvent;
    expect(ev.isEcho).toBe(true);
    expect(ev.isFromOtherApp).toBe(true);
  });
});

describe("parseWebhookPayload — postback และ reaction", () => {
  it("แปลง postback", () => {
    const { events } = parseWebhookPayload(
      messengerPayload([
        {
          sender: { id: "u1" },
          timestamp: 1_700_000_000,
          postback: { mid: "m_pb", payload: "MENU_PRICE", title: "ดูราคา" },
        },
      ]),
      NOW,
    );
    expect(events[0]).toMatchObject({
      type: "postback",
      payload: "MENU_PRICE",
      title: "ดูราคา",
    });
  });

  it("postback ที่ไม่มี mid ยังมีคีย์กันซ้ำที่คาดเดาได้", () => {
    const payload = messengerPayload([
      {
        sender: { id: "u1" },
        timestamp: 1_700_000_000,
        postback: { payload: "X" },
      },
    ]);
    const a = parseWebhookPayload(payload, NOW).events[0]!;
    const b = parseWebhookPayload(payload, NOW).events[0]!;
    expect(idempotencyKey(a)).toBe(idempotencyKey(b));
  });

  it("แปลง reaction", () => {
    const { events } = parseWebhookPayload(
      messengerPayload([
        {
          sender: { id: "u1" },
          reaction: { mid: "m_target", action: "react", emoji: "❤️" },
        },
      ]),
      NOW,
    );
    expect(events[0]).toMatchObject({
      type: "reaction",
      targetMid: "m_target",
      action: "react",
      emoji: "❤️",
    });
  });
});

describe("parseWebhookPayload — คอมเมนต์", () => {
  it("แปลงคอมเมนต์ใหม่", () => {
    const { events } = parseWebhookPayload(
      changesPayload([
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "c1",
            post_id: "p1_post1",
            parent_id: "p1_post1",
            created_time: 1_700_000_000,
            from: { id: "u1", name: "สมชาย" },
            message: "สนใจค่ะ",
          },
        },
      ]),
      NOW,
    );
    const ev = events[0] as CommentEvent;
    expect(ev.type).toBe("comment");
    expect(ev.commentId).toBe("c1");
    expect(ev.authorName).toBe("สมชาย");
    expect(ev.isFromPage).toBe(false);
    // parent_id เท่ากับ post_id แปลว่าเป็นคอมเมนต์ระดับบนสุด
    expect(ev.parentCommentId).toBeUndefined();
  });

  it("การตอบใต้คอมเมนต์มี parentCommentId", () => {
    const { events } = parseWebhookPayload(
      changesPayload([
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "c2",
            post_id: "p1_post1",
            parent_id: "c1",
            from: { id: "u1" },
            message: "ตอบครับ",
          },
        },
      ]),
      NOW,
    );
    expect((events[0] as CommentEvent).parentCommentId).toBe("c1");
  });

  it("คอมเมนต์ที่เพจเขียนเองถูกทำเครื่องหมายไว้ (กันวนลูป)", () => {
    const { events } = parseWebhookPayload(
      changesPayload([
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "c1",
            from: { id: "p1" },
            message: "ขอบคุณค่ะ",
          },
        },
      ]),
      NOW,
    );
    expect((events[0] as CommentEvent).isFromPage).toBe(true);
  });

  it("แยก verb add / edit / remove", () => {
    for (const [raw, expected] of [
      ["add", "add"],
      ["edited", "edit"],
      ["remove", "remove"],
      ["removed", "remove"],
    ] as const) {
      const { events } = parseWebhookPayload(
        changesPayload([
          {
            field: "feed",
            value: {
              item: "comment",
              verb: raw,
              comment_id: "c1",
              from: { id: "u1" },
              message: "x",
            },
          },
        ]),
        NOW,
      );
      expect((events[0] as CommentEvent).verb, raw).toBe(expected);
    }
  });

  it("feed ที่ไม่ใช่คอมเมนต์ (เช่นโพสต์ใหม่) เก็บเป็น unknown", () => {
    const { events, unknown } = parseWebhookPayload(
      changesPayload([
        { field: "feed", value: { item: "status", verb: "add" } },
      ]),
      NOW,
    );
    expect(events).toHaveLength(0);
    expect(unknown).toHaveLength(1);
  });
});

describe("parseWebhookPayload — รีวิว", () => {
  it("แปลงรีวิวเชิงลบ", () => {
    const { events } = parseWebhookPayload(
      changesPayload([
        {
          field: "ratings",
          value: {
            verb: "add",
            recommendation_type: "negative",
            reviewer: { id: "u1", name: "สมหญิง" },
            review_text: "บริการแย่มาก",
            open_graph_story_id: "story_1",
            created_time: 1_700_000_000,
          },
        },
      ]),
      NOW,
    );
    const ev = events[0] as RatingEvent;
    expect(ev.type).toBe("rating");
    expect(ev.recommendation).toBe("negative");
    expect(ev.reviewText).toBe("บริการแย่มาก");
    expect(ev.reviewerName).toBe("สมหญิง");
  });

  it("รีวิวเชิงบวก", () => {
    const { events } = parseWebhookPayload(
      changesPayload([
        {
          field: "ratings",
          value: {
            verb: "add",
            recommendation_type: "positive",
            reviewer: { id: "u1" },
          },
        },
      ]),
      NOW,
    );
    expect((events[0] as RatingEvent).recommendation).toBe("positive");
  });
});

describe("parseWebhookPayload — ทนต่อข้อมูลแปลกๆ", () => {
  it("payload ที่ไม่ใช่ object ไม่ทำให้พัง", () => {
    for (const bad of [null, undefined, "string", 123, []]) {
      expect(() => parseWebhookPayload(bad, NOW), String(bad)).not.toThrow();
    }
  });

  it("entry ที่ไม่มี id ถูกข้าม", () => {
    const { events } = parseWebhookPayload(
      { object: "page", entry: [{ time: NOW, messaging: [] }] },
      NOW,
    );
    expect(events).toEqual([]);
  });

  it("หลาย entry และหลาย event ในคำขอเดียว", () => {
    const { events } = parseWebhookPayload(
      {
        object: "page",
        entry: [
          {
            id: "p1",
            time: NOW,
            messaging: [
              { sender: { id: "u1" }, message: { mid: "m1", text: "a" } },
              { sender: { id: "u2" }, message: { mid: "m2", text: "b" } },
            ],
          },
          {
            id: "p2",
            time: NOW,
            messaging: [
              { sender: { id: "u3" }, message: { mid: "m3", text: "c" } },
            ],
          },
        ],
      },
      NOW,
    );
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.pageId)).toEqual(["p1", "p1", "p2"]);
  });

  it("field ที่ไม่รู้จักเก็บไว้ดูว่า Meta ส่งอะไรมาใหม่", () => {
    const { unknown } = parseWebhookPayload(
      changesPayload([{ field: "mention", value: {} }]),
      NOW,
    );
    expect(unknown[0]!.field).toBe("mention");
  });
});

describe("idempotencyKey (กฎข้อ 6)", () => {
  it("ข้อความเดียวกันได้คีย์เดียวกัน", () => {
    const payload = messengerPayload([
      { sender: { id: "u1" }, message: { mid: "m_abc", text: "hi" } },
    ]);
    const a = parseWebhookPayload(payload, NOW).events[0]!;
    const b = parseWebhookPayload(payload, NOW + 5000).events[0]!;
    expect(idempotencyKey(a)).toBe(idempotencyKey(b));
  });

  it("ข้อความคนละอันได้คีย์คนละอัน", () => {
    const mk = (mid: string) =>
      parseWebhookPayload(
        messengerPayload([{ sender: { id: "u1" }, message: { mid, text: "x" } }]),
        NOW,
      ).events[0]!;
    expect(idempotencyKey(mk("m1"))).not.toBe(idempotencyKey(mk("m2")));
  });

  it("คอมเมนต์เดียวกันคนละ verb ได้คีย์คนละอัน (แก้ไขต้องประมวลผลใหม่ได้)", () => {
    const mk = (verb: string) =>
      parseWebhookPayload(
        changesPayload([
          {
            field: "feed",
            value: {
              item: "comment",
              verb,
              comment_id: "c1",
              from: { id: "u1" },
              message: "x",
            },
          },
        ]),
        NOW,
      ).events[0]!;
    expect(idempotencyKey(mk("add"))).not.toBe(idempotencyKey(mk("edited")));
  });

  it("ทุกชนิด event มีคีย์", () => {
    const all = [
      ...parseWebhookPayload(
        messengerPayload([
          { sender: { id: "u1" }, message: { mid: "m1", text: "x" } },
          { sender: { id: "u1" }, postback: { mid: "pb1", payload: "P" } },
          { sender: { id: "u1" }, reaction: { mid: "m1", action: "react" } },
        ]),
        NOW,
      ).events,
      ...parseWebhookPayload(
        changesPayload([
          {
            field: "ratings",
            value: { verb: "add", recommendation_type: "positive", reviewer: { id: "u" } },
          },
        ]),
        NOW,
      ).events,
    ];
    expect(all.length).toBeGreaterThanOrEqual(4);
    const keys = all.map(idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).not.toBe("");
  });
});
