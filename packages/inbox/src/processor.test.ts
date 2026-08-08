import { describe, expect, it } from "vitest";
import { FakeClock, nullLogger } from "@page-os/core";
import { HANDOVER_PAUSE_MS } from "./handover.js";
import { parseWebhookPayload, type CommentEvent, type RatingEvent } from "./events.js";
import {
  WebhookProcessor,
  type ConversationState,
  type InboxStore,
} from "./processor.js";

const NOW = 1_700_000_000_000;

class MemStore implements InboxStore {
  seen = new Set<string>();
  conversations = new Map<string, ConversationState>();
  messages: Array<{
    conversationId: string;
    mid: string;
    direction: string;
    sentBy: string;
    body?: string;
  }> = [];
  botEnabled = true;

  async hasSeen(key: string): Promise<boolean> {
    return this.seen.has(key);
  }
  async markSeen(key: string): Promise<void> {
    this.seen.add(key);
  }
  async upsertConversation(a: {
    pageId: string;
    contactId: string;
    channel: string;
  }): Promise<ConversationState> {
    const id = `${a.pageId}:${a.contactId}`;
    let c = this.conversations.get(id);
    if (!c) {
      c = {
        conversationId: id,
        pageId: a.pageId,
        contactId: a.contactId,
        lastCustomerMessageAtMs: null,
        awaitingSinceMs: null,
        botPausedUntilMs: null,
        assignedTo: null,
        unread: 0,
      };
      this.conversations.set(id, c);
    }
    return c;
  }
  async appendMessage(a: {
    conversationId: string;
    mid: string;
    direction: "inbound" | "outbound";
    sentBy: "human" | "bot" | "system";
    body?: string;
  }): Promise<void> {
    this.messages.push({
      conversationId: a.conversationId,
      mid: a.mid,
      direction: a.direction,
      sentBy: a.sentBy,
      ...(a.body !== undefined ? { body: a.body } : {}),
    });
  }
  async updateConversation(
    id: string,
    patch: Partial<ConversationState>,
  ): Promise<void> {
    const c = this.conversations.get(id);
    if (c) Object.assign(c, patch);
  }
  async isBotEnabled(): Promise<boolean> {
    return this.botEnabled;
  }
}

function setup(
  over: {
    onComment?: (e: CommentEvent) => Promise<void>;
    onRating?: (e: RatingEvent) => Promise<void>;
  } = {},
) {
  const clock = new FakeClock(NOW);
  const store = new MemStore();
  const processor = new WebhookProcessor({
    store,
    clock,
    logger: nullLogger,
    ...over,
  });
  return { clock, store, processor };
}

/**
 * ข้อความ DM หนึ่งอัน — `mid` ต้องไม่ซ้ำกันในเทสต์เดียว
 * ไม่งั้นจะโดน idempotency ตัดทิ้ง (ของจริง echo ของเพจก็มี mid คนละอันกับของลูกค้า)
 */
function dm(over: Record<string, unknown> = {}): unknown {
  return {
    object: "page",
    entry: [
      {
        id: "p1",
        time: NOW,
        messaging: [
          {
            sender: { id: "u1" },
            recipient: { id: "p1" },
            timestamp: NOW,
            message: { mid: "m1", text: "สนใจค่ะ", ...over },
          },
        ],
      },
    ],
  };
}

/**
 * echo ของข้อความที่เพจส่งออกไป — **ผู้ส่งคือเพจ ผู้รับคือลูกค้า**
 * (ตรงข้ามกับข้อความขาเข้า) ถ้าเขียนสลับกันเทสต์จะผ่านทั้งที่โค้ดผิด
 */
function echo(
  over: Record<string, unknown> = {},
  atMs = NOW,
): unknown {
  return {
    object: "page",
    entry: [
      {
        id: "p1",
        time: atMs,
        messaging: [
          {
            sender: { id: "p1" },
            recipient: { id: "u1" },
            timestamp: atMs,
            message: {
              mid: "m_echo",
              text: "เดี๋ยวเช็คให้นะครับ",
              is_echo: true,
              ...over,
            },
          },
        ],
      },
    ],
  };
}

async function run(
  processor: WebhookProcessor,
  payload: unknown,
): Promise<ReturnType<WebhookProcessor["processAll"]>> {
  const { events } = parseWebhookPayload(payload, NOW);
  return processor.processAll(events);
}

describe("WebhookProcessor — idempotency (กฎข้อ 6)", () => {
  it("Meta ส่งซ้ำ → ประมวลผลครั้งเดียว", async () => {
    const { processor, store } = setup();
    await run(processor, dm());
    const before = store.messages.length;

    const second = await run(processor, dm());

    expect(second[0]!.skipped).toBe("duplicate");
    expect(store.messages).toHaveLength(before);
  });

  it("บันทึกว่าเห็นแล้วหลังประมวลผลสำเร็จ", async () => {
    const { processor, store } = setup();
    await run(processor, dm());
    expect(store.seen.has("msg:m1")).toBe(true);
  });
});

describe("WebhookProcessor — echo (สเปกข้อ 6.2 และ 6.7)", () => {
  it("echo ที่ระบบเราส่งเอง ถูกข้าม", async () => {
    const { processor, store } = setup();
    const r = await run(processor, echo({ app_id: 999 }));
    expect(r[0]!.skipped).toBe("own_echo");
    expect(store.messages).toHaveLength(0);
  });

  it("คนพิมพ์ตอบในแอป FB → พักบอท 30 นาที ไม่ใช่ข้ามเฉยๆ", async () => {
    const { processor, store } = setup();

    const r = await run(processor, echo());

    expect(r[0]!.skipped).toBeUndefined();
    expect(r[0]!.botShouldRespond).toBe(false);
    const conv = store.conversations.get("p1:u1")!;
    expect(conv.botPausedUntilMs).toBe(NOW + HANDOVER_PAUSE_MS);
    // บันทึกเป็นข้อความขาออกที่คนพิมพ์
    expect(store.messages[0]).toMatchObject({
      direction: "outbound",
      sentBy: "human",
    });
  });

  it("คนตอบแล้ว SLA จบ (ไม่ค้างเป็นข้อความรอตอบ)", async () => {
    const { processor, store } = setup();
    await run(processor, dm());
    expect(store.conversations.get("p1:u1")!.awaitingSinceMs).toBe(NOW);

    await run(processor, echo({ text: "ตอบแล้วครับ" }));
    expect(store.conversations.get("p1:u1")!.awaitingSinceMs).toBeNull();
  });

  it("บอทที่ถูกพักแล้ว ไม่ตอบข้อความถัดไปของลูกค้า", async () => {
    const { processor, store } = setup();
    await run(processor, echo({ text: "คนตอบ" }));

    const r = await run(processor, {
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          messaging: [
            {
              sender: { id: "u1" },
              timestamp: NOW,
              message: { mid: "m2", text: "แล้วมีสีอื่นไหมคะ" },
            },
          ],
        },
      ],
    });

    expect(r[0]!.botShouldRespond).toBe(false);
    expect(r[0]!.th).toContain("บอทหยุดชั่วคราว");
    void store;
  });

  it("พ้น 30 นาทีแล้วบอทกลับมาตอบได้", async () => {
    const { processor, store, clock } = setup();
    await run(processor, echo({ text: "คนตอบ" }));

    await clock.advance(HANDOVER_PAUSE_MS + 1000);
    const { events } = parseWebhookPayload(
      {
        object: "page",
        entry: [
          {
            id: "p1",
            time: clock.now(),
            messaging: [
              {
                sender: { id: "u1" },
                timestamp: clock.now(),
                message: { mid: "m3", text: "ยังอยู่ไหมคะ" },
              },
            ],
          },
        ],
      },
      clock.now(),
    );
    const r = await processor.processAll(events);

    expect(r[0]!.botShouldRespond).toBe(true);
    void store;
  });
});

describe("WebhookProcessor — ข้อความจากลูกค้า", () => {
  it("บันทึกข้อความและเปิดหน้าต่าง 24 ชม.", async () => {
    const { processor, store } = setup();
    const r = await run(processor, dm());

    expect(r[0]!.botShouldRespond).toBe(true);
    expect(r[0]!.th).toContain("⏰");
    const conv = store.conversations.get("p1:u1")!;
    expect(conv.lastCustomerMessageAtMs).toBe(NOW);
    expect(conv.unread).toBe(1);
    expect(store.messages[0]).toMatchObject({ direction: "inbound", mid: "m1" });
  });

  it("ลูกค้าพิมพ์รัว SLA ต้องนับจากข้อความแรก ไม่ถูกรีเซ็ต", async () => {
    // ถ้ารีเซ็ตทุกครั้ง ลูกค้าที่พิมพ์รัวจะไม่มีวันเกิน SLA
    const { processor, store, clock } = setup();
    await run(processor, dm());
    const firstAwaiting = store.conversations.get("p1:u1")!.awaitingSinceMs;

    await clock.advance(10 * 60_000);
    const { events } = parseWebhookPayload(
      {
        object: "page",
        entry: [
          {
            id: "p1",
            time: clock.now(),
            messaging: [
              {
                sender: { id: "u1" },
                timestamp: clock.now(),
                message: { mid: "m2", text: "ยังอยู่ไหมคะ" },
              },
            ],
          },
        ],
      },
      clock.now(),
    );
    await processor.processAll(events);

    const conv = store.conversations.get("p1:u1")!;
    expect(conv.awaitingSinceMs).toBe(firstAwaiting);
    // แต่หน้าต่าง 24 ชม. ต้องขยับตามข้อความล่าสุด
    expect(conv.lastCustomerMessageAtMs).toBe(clock.now());
  });

  it("บอทถูกปิดทั้งเพจ (Kill Switch) → ไม่ตอบ", async () => {
    const { processor, store } = setup();
    store.botEnabled = false;
    const r = await run(processor, dm());
    expect(r[0]!.botShouldRespond).toBe(false);
    expect(r[0]!.th).toContain("Kill Switch");
  });

  it("บทสนทนาที่มอบหมายให้คนแล้ว → บอทไม่ตอบ", async () => {
    const { processor, store } = setup();
    await store.upsertConversation({ pageId: "p1", contactId: "u1", channel: "messenger" });
    store.conversations.get("p1:u1")!.assignedTo = "admin1";

    const r = await run(processor, dm());
    expect(r[0]!.botShouldRespond).toBe(false);
    expect(r[0]!.th).toContain("มอบหมายให้คน");
  });
});

describe("WebhookProcessor — postback", () => {
  it("การกดปุ่มเปิดหน้าต่าง 24 ชม. เหมือนพิมพ์ข้อความ", async () => {
    const { processor, store } = setup();
    const r = await run(processor, {
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          messaging: [
            {
              sender: { id: "u1" },
              timestamp: NOW,
              postback: { mid: "pb1", payload: "MENU_PRICE", title: "ดูราคา" },
            },
          ],
        },
      ],
    });

    expect(r[0]!.botShouldRespond).toBe(true);
    expect(r[0]!.th).toContain("ดูราคา");
    expect(store.conversations.get("p1:u1")!.lastCustomerMessageAtMs).toBe(NOW);
  });
});

describe("WebhookProcessor — คอมเมนต์และรีวิว", () => {
  function comment(over: Record<string, unknown> = {}): unknown {
    return {
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
                comment_id: "c1",
                from: { id: "u1", name: "สมชาย" },
                message: "สนใจค่ะ",
                ...over,
              },
            },
          ],
        },
      ],
    };
  }

  it("ส่งคอมเมนต์ต่อให้ระบบดูแลคอมเมนต์", async () => {
    const seen: CommentEvent[] = [];
    const { processor } = setup({
      onComment: async (e) => {
        seen.push(e);
      },
    });
    await run(processor, comment());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.commentId).toBe("c1");
  });

  it("คอมเมนต์ที่เพจเขียนเองไม่ส่งต่อ (กันวนลูป)", async () => {
    const seen: CommentEvent[] = [];
    const { processor } = setup({
      onComment: async (e) => {
        seen.push(e);
      },
    });
    const r = await run(processor, comment({ from: { id: "p1" } }));
    expect(r[0]!.skipped).toBe("own_comment");
    expect(seen).toHaveLength(0);
  });

  it("คอมเมนต์ที่ถูกลบ/แก้ ไม่ส่งต่อ", async () => {
    for (const verb of ["remove", "edited"]) {
      const seen: CommentEvent[] = [];
      const { processor } = setup({
        onComment: async (e) => {
          seen.push(e);
        },
      });
      const r = await run(processor, comment({ verb }));
      expect(r[0]!.skipped, verb).toContain("verb_");
      expect(seen, verb).toHaveLength(0);
    }
  });

  it("รีวิวเชิงลบถูกส่งต่อไปแจ้งเตือน", async () => {
    const seen: RatingEvent[] = [];
    const { processor } = setup({
      onRating: async (e) => {
        seen.push(e);
      },
    });
    const r = await run(processor, {
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          changes: [
            {
              field: "ratings",
              value: {
                verb: "add",
                recommendation_type: "negative",
                reviewer: { id: "u1" },
                review_text: "แย่มาก",
              },
            },
          ],
        },
      ],
    });
    expect(seen).toHaveLength(1);
    expect(r[0]!.th).toContain("เชิงลบ");
  });
});

describe("WebhookProcessor — ทนต่อความผิดพลาด", () => {
  it("event เดียวพังต้องไม่ทำให้ event ที่เหลือไม่ได้ทำ", async () => {
    const { processor } = setup({
      onComment: async () => {
        throw new Error("moderation ล่ม");
      },
    });

    const { events } = parseWebhookPayload(
      {
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
                  comment_id: "c1",
                  from: { id: "u1" },
                  message: "x",
                },
              },
            ],
            messaging: [
              {
                sender: { id: "u1" },
                timestamp: NOW,
                message: { mid: "m1", text: "สนใจค่ะ" },
              },
            ],
          },
        ],
      },
      NOW,
    );
    const r = await processor.processAll(events);

    expect(r).toHaveLength(2);
    // ข้อความยังถูกประมวลผลแม้คอมเมนต์จะพัง
    expect(r.some((x) => x.type === "message" && x.skipped === undefined)).toBe(
      true,
    );
    expect(r.some((x) => x.skipped === "error")).toBe(true);
  });

  it("event ที่พังไม่ถูกบันทึกว่าเห็นแล้ว (Meta ส่งซ้ำมาจะได้ลองใหม่)", async () => {
    const { processor, store } = setup({
      onComment: async () => {
        throw new Error("ล่ม");
      },
    });
    await run(processor, {
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
                comment_id: "c1",
                from: { id: "u1" },
                message: "x",
              },
            },
          ],
        },
      ],
    });
    expect(store.seen.has("comment:c1:add")).toBe(false);
  });

  it("ทุกผลลัพธ์มีข้อความไทย", async () => {
    const { processor } = setup();
    const r = await run(processor, dm());
    for (const x of r) expect(x.th).toMatch(/[ก-๙]/);
  });
});

describe("Audit: echo ต้องผูกกับบทสนทนาของลูกค้า ไม่ใช่ของเพจ", () => {
  it("คนพิมพ์ในแอป FB → พักบอทในบทสนทนาของลูกค้าคนนั้น", async () => {
    const { processor, store } = setup();
    // ลูกค้าทักมาก่อน
    await run(processor, dm());
    expect(store.conversations.has("p1:u1")).toBe(true);

    // เจ้าของเพจพิมพ์ตอบในแอป FB — ตอน echo ผู้ส่งคือ "เพจ" ผู้รับคือ "ลูกค้า"
    await run(processor, {
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          messaging: [
            {
              sender: { id: "p1" },
              recipient: { id: "u1" },
              timestamp: NOW,
              message: { mid: "m_echo", text: "เดี๋ยวเช็คให้นะครับ", is_echo: true },
            },
          ],
        },
      ],
    });

    // ต้องพักบอทในบทสนทนาของลูกค้า ไม่ใช่สร้างบทสนทนาปลอมกับตัวเอง
    expect(store.conversations.get("p1:u1")!.botPausedUntilMs).toBe(
      NOW + HANDOVER_PAUSE_MS,
    );
    expect(store.conversations.has("p1:p1")).toBe(false);
  });

  it("บอทต้องไม่ตอบข้อความถัดไปของลูกค้าคนที่คนกำลังคุยอยู่", async () => {
    const { processor, store } = setup();
    await run(processor, dm());
    await run(processor, {
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          messaging: [
            {
              sender: { id: "p1" },
              recipient: { id: "u1" },
              timestamp: NOW,
              message: { mid: "m_echo", text: "คนตอบ", is_echo: true },
            },
          ],
        },
      ],
    });

    const r = await run(processor, {
      object: "page",
      entry: [
        {
          id: "p1",
          time: NOW,
          messaging: [
            {
              sender: { id: "u1" },
              recipient: { id: "p1" },
              timestamp: NOW,
              message: { mid: "m_next", text: "แล้วมีสีอื่นไหมคะ" },
            },
          ],
        },
      ],
    });

    expect(r[0]!.botShouldRespond).toBe(false);
    void store;
  });
});
