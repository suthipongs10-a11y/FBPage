import { describe, expect, it } from "vitest";
import { FakeClock, nullLogger } from "@page-os/core";
import { MetaGateway } from "@page-os/meta";
import { FakeFetch, FakeTokenStore, graphError } from "@page-os/meta/test-helpers";
import { CommentActions, PRIVATE_REPLY_WINDOW_MS } from "./actions.js";
import {
  CommentProcessor,
  type CommentStore,
  type ModerationAlertSink,
} from "./processor.js";
import { defaultRules } from "./rules.js";
import type { AutomationRule, IncomingComment } from "./types.js";

const NOW = 1_700_000_000_000;
const PAGE = "p1";

class MemStore implements CommentStore {
  processed = new Set<string>();
  privateReplied = new Set<string>();
  blocked = new Set<string>();
  readonly records: Array<{ commentId: string; actionsTaken: string[] }> = [];

  async hasProcessed(id: string): Promise<boolean> {
    return this.processed.has(id);
  }
  async markProcessed(a: {
    commentId: string;
    pageId: string;
    sentiment: string;
    actionsTaken: string[];
  }): Promise<void> {
    this.processed.add(a.commentId);
    this.records.push({ commentId: a.commentId, actionsTaken: a.actionsTaken });
  }
  async hasPrivateReplied(id: string): Promise<boolean> {
    return this.privateReplied.has(id);
  }
  async markPrivateReplied(id: string): Promise<void> {
    this.privateReplied.add(id);
  }
  async isBlocked(pageId: string, userId: string): Promise<boolean> {
    return this.blocked.has(`${pageId}:${userId}`);
  }
}

class MemAlerts implements ModerationAlertSink {
  readonly sent: Array<{ severity: string; reason: string; commentId: string }> =
    [];
  async send(a: {
    severity: "warn" | "critical";
    pageId: string;
    commentId: string;
    message: string;
    reason: string;
  }): Promise<void> {
    this.sent.push({
      severity: a.severity,
      reason: a.reason,
      commentId: a.commentId,
    });
  }
}

function setup() {
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
      tokenStore: new FakeTokenStore({ [PAGE]: "T1" }),
      clock,
      fetchImpl: fetchImpl.fn,
      random: () => 0,
    },
  );
  const store = new MemStore();
  const alerts = new MemAlerts();
  const processor = new CommentProcessor({
    actions: new CommentActions(gateway),
    store,
    alerts,
    clock,
    logger: nullLogger,
  });
  return { clock, fetch: fetchImpl, store, alerts, processor };
}

function comment(over: Partial<IncomingComment> = {}): IncomingComment {
  return {
    commentId: "c1",
    pageId: PAGE,
    postId: "post1",
    authorId: "u1",
    authorName: "สมชาย",
    message: "สนใจค่ะ",
    createdAtMs: NOW,
    isFromPage: false,
    ...over,
  };
}

const RULES = defaultRules(PAGE);

/** ให้ทุก endpoint ตอบสำเร็จ */
function allOk(fetch: FakeFetch): void {
  fetch.setFallback({ json: { id: "ok", success: true } });
}

describe("CommentProcessor — กันวนลูปและกันทำซ้ำ", () => {
  it("ข้ามคอมเมนต์ที่เพจเราเขียนเอง (สเปกข้อ 6.2 echo loop)", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ isFromPage: true, message: "สนใจทักแชทได้เลยค่ะ" }),
      rules: RULES,
    });
    expect(r.skippedReason).toBe("from_page");
    expect(fetch.callCount).toBe(0);
  });

  it("webhook ส่งซ้ำ → ประมวลผลครั้งเดียว (กฎข้อ 6)", async () => {
    const { processor, fetch, store } = setup();
    allOk(fetch);

    await processor.process({ comment: comment(), rules: RULES });
    const callsAfterFirst = fetch.callCount;

    const second = await processor.process({ comment: comment(), rules: RULES });

    expect(second.skippedReason).toBe("already_processed");
    expect(fetch.callCount).toBe(callsAfterFirst);
    expect(store.records).toHaveLength(1);
  });
});

describe("CommentProcessor — blocklist", () => {
  it("ผู้ใช้ใน blocklist ถูกซ่อนทันทีโดยไม่ต้องดูกฎ", async () => {
    const { processor, fetch, store } = setup();
    allOk(fetch);
    store.blocked.add(`${PAGE}:u1`);

    const r = await processor.process({
      comment: comment({ message: "สวัสดีครับ" }),
      rules: RULES,
    });

    expect(r.skippedReason).toBe("blocked_user");
    expect(r.executed).toEqual(["hide"]);
    expect(fetch.lastCall!.url).toContain("c1");
    expect(new URLSearchParams(fetch.lastCall!.body!).get("is_hidden")).toBe(
      "true",
    );
  });
});

describe("CommentProcessor — auto-hide", () => {
  it("คำหยาบถูกซ่อน", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "เหี้ยอะไรวะ" }),
      rules: RULES,
    });
    expect(r.executed).toContain("hide");
  });

  it("เบอร์โทรคู่แข่งถูกซ่อน", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "สนใจโทร 0812345678 ถูกกว่า" }),
      rules: RULES,
    });
    expect(r.executed).toContain("hide");
  });

  it("ลิงก์สแปมถูกซ่อน", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "สั่งที่ https://shopee.co.th/xyz ถูกกว่า" }),
      rules: RULES,
    });
    expect(r.executed).toContain("hide");
  });

  it("ซ่อนแล้วต้องไม่ทักเข้า inbox หรือกดไลก์ (action ที่ขัดกัน)", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    // ข้อความมีทั้งคำหยาบและคำว่าสนใจ
    const r = await processor.process({
      comment: comment({ message: "สนใจเหี้ยอะไร โทร 0812345678" }),
      rules: RULES,
    });
    expect(r.executed).toContain("hide");
    expect(r.executed).not.toContain("private_reply");
    expect(r.executed).not.toContain("like");
  });

  it("เลขที่มั่นใจต่ำถูกปักธงแทนที่จะซ่อน (กัน false positive)", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "เลขพัสดุ 123456789012 ค่ะ" }),
      rules: RULES,
    });
    expect(r.executed).not.toContain("hide");
    expect(r.actions.some((a) => a.kind === "flag")).toBe(true);
  });

  it("คอมเมนต์ลูกค้าปกติไม่ถูกแตะ", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "ของสวยมากค่ะ ขอบคุณนะคะ" }),
      rules: RULES,
    });
    expect(r.executed).not.toContain("hide");
    expect(r.executed).not.toContain("delete");
  });
});

describe("CommentProcessor — Comment → Inbox (Private Reply)", () => {
  it("ลูกค้าพิมพ์ว่าสนใจ → ทักเข้า inbox อัตโนมัติ", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "สนใจค่ะ ราคาเท่าไหร่" }),
      rules: RULES,
      vars: { ชื่อลูกค้า: "คุณสมชาย", ชื่อร้าน: "ร้านกาแฟดีดี" },
    });

    expect(r.executed).toContain("private_reply");
    const call = fetch.calls.find((c) => c.url.includes("private_replies"))!;
    const msg = new URLSearchParams(call.body!).get("message")!;
    expect(msg).toContain("คุณสมชาย");
    expect(msg).toContain("ร้านกาแฟดีดี");
  });

  it("ทักได้ครั้งเดียวต่อคอมเมนต์ (ข้อจำกัดของ Meta)", async () => {
    const { processor, fetch, store } = setup();
    allOk(fetch);
    store.privateReplied.add("c1");

    const r = await processor.process({
      comment: comment({ message: "สนใจค่ะ" }),
      rules: RULES,
    });

    expect(r.executed).not.toContain("private_reply");
    expect(r.failed.some((f) => f.th.includes("ครั้งเดียว"))).toBe(true);
    expect(
      fetch.calls.filter((c) => c.url.includes("private_replies")),
    ).toHaveLength(0);
  });

  it("คอมเมนต์เก่าเกิน 7 วัน ทักไม่ได้ และไม่เปลืองโควตายิงไปให้โดนปฏิเสธ", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({
        message: "สนใจค่ะ",
        createdAtMs: NOW - PRIVATE_REPLY_WINDOW_MS - 1000,
      }),
      rules: RULES,
    });

    expect(r.executed).not.toContain("private_reply");
    expect(r.failed.some((f) => f.th.includes("7 วัน"))).toBe(true);
    expect(
      fetch.calls.filter((c) => c.url.includes("private_replies")),
    ).toHaveLength(0);
  });

  it("คอมเมนต์อายุ 6 วันยังทักได้", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({
        message: "สนใจค่ะ",
        createdAtMs: NOW - 6 * 86_400_000,
      }),
      rules: RULES,
    });
    expect(r.executed).toContain("private_reply");
  });

  it("ยิงไม่สำเร็จต้องไม่บันทึกว่าทักแล้ว (ไม่งั้นจะทักไม่ได้อีกเลย)", async () => {
    const { processor, fetch, store } = setup();
    fetch.setHandler((call) =>
      call.url.includes("private_replies")
        ? { status: 400, json: graphError(2, "ชั่วคราว") }
        : undefined,
    );
    fetch.setFallback({ json: { id: "ok" } });

    const r = await processor.process({
      comment: comment({ message: "สนใจค่ะ" }),
      rules: RULES,
    });

    expect(r.executed).not.toContain("private_reply");
    expect(store.privateReplied.has("c1")).toBe(false);
  });
});

describe("CommentProcessor — auto-like", () => {
  it("คอมเมนต์ชมถูกกดไลก์", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "ของดีมากค่ะ ประทับใจสุดๆ" }),
      rules: RULES,
    });
    expect(r.executed).toContain("like");
    expect(fetch.calls.some((c) => c.url.includes("/likes"))).toBe(true);
  });

  it("คอมเมนต์ด่าไม่ถูกกดไลก์", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "บริการแย่มาก ไม่ประทับใจ" }),
      rules: RULES,
    });
    expect(r.executed).not.toContain("like");
  });
});

describe("CommentProcessor — Negative Sentiment Alert", () => {
  it("คอมเมนต์ร้องเรียนยิง alert", async () => {
    const { processor, fetch, alerts } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "ของไม่ตรงปก บริการแย่มาก ขอคืนเงิน" }),
      rules: RULES,
      permalink: "https://facebook.com/c1",
    });

    expect(r.executed).toContain("alert");
    expect(alerts.sent).toHaveLength(1);
    expect(alerts.sent[0]!.commentId).toBe("c1");
    expect(alerts.sent[0]!.reason).toMatch(/[ก-๙]/);
  });

  it("คอมเมนต์ปกติไม่ยิง alert (กันแอดมินเลิกอ่าน)", async () => {
    const { processor, fetch, alerts } = setup();
    allOk(fetch);
    await processor.process({
      comment: comment({ message: "สอบถามราคาหน่อยค่ะ" }),
      rules: RULES,
    });
    expect(alerts.sent).toHaveLength(0);
  });

  it("ส่ง alert ไม่ได้ ต้องไม่ทำให้ action อื่นไม่ทำงาน", async () => {
    const { store, clock } = setup();
    const fetchImpl = new FakeFetch();
    allOk(fetchImpl);
    const gateway = new MetaGateway(
      { appId: "A", appSecret: "S", graphVersion: "v25.0" },
      {
        tokenStore: new FakeTokenStore({ [PAGE]: "T1" }),
        clock,
        fetchImpl: fetchImpl.fn,
      },
    );
    const processor = new CommentProcessor({
      actions: new CommentActions(gateway),
      store,
      alerts: {
        send: async () => {
          throw new Error("LINE ล่ม");
        },
      },
      clock,
      logger: nullLogger,
    });

    const r = await processor.process({
      comment: comment({ message: "เหี้ย ของไม่ตรงปก ขอคืนเงิน" }),
      rules: RULES,
    });

    // alert พังแต่ hide ยังต้องทำงาน
    expect(r.executed).toContain("hide");
    expect(r.failed.some((f) => f.kind === "alert")).toBe(true);
  });
});

describe("CommentProcessor — action ที่ยิงไม่ผ่าน", () => {
  it("hide ไม่ผ่านต้องบันทึกเหตุผลไทย ไม่ throw", async () => {
    const { processor, fetch } = setup();
    fetch.setFallback({ status: 403, json: graphError(200, "no permission") });

    const r = await processor.process({
      comment: comment({ message: "เหี้ย" }),
      rules: RULES,
    });

    expect(r.executed).not.toContain("hide");
    expect(r.failed[0]!.th).toMatch(/[ก-๙]/);
  });

  it("action หนึ่งพังต้องไม่ทำให้ action ที่เหลือไม่ได้ทำ", async () => {
    const { processor, fetch, alerts } = setup();
    // like พัง แต่ alert ต้องยังส่ง
    fetch.setHandler((call) =>
      call.url.includes("/likes")
        ? { status: 400, json: graphError(100) }
        : undefined,
    );
    fetch.setFallback({ json: { id: "ok" } });

    const rules: AutomationRule[] = [
      {
        id: "r1",
        pageId: PAGE,
        name: "ไลก์",
        trigger: { type: "positive_sentiment" },
        actions: [{ kind: "like" }],
        priority: 10,
        isActive: true,
      },
      {
        id: "r2",
        pageId: PAGE,
        name: "แจ้ง",
        trigger: { type: "positive_sentiment" },
        actions: [{ kind: "alert" }],
        priority: 20,
        isActive: true,
      },
    ];

    const r = await processor.process({
      comment: comment({ message: "ดีมากค่ะ ประทับใจ" }),
      rules,
    });

    expect(r.failed.some((f) => f.kind === "like")).toBe(true);
    expect(r.executed).toContain("alert");
    expect(alerts.sent).toHaveLength(1);
  });

  it("บันทึกว่าประมวลผลแล้วแม้บาง action จะพัง (ไม่งั้น webhook ซ้ำจะทำใหม่ทั้งชุด)", async () => {
    const { processor, fetch, store } = setup();
    fetch.setFallback({ status: 403, json: graphError(200) });
    await processor.process({
      comment: comment({ message: "เหี้ย" }),
      rules: RULES,
    });
    expect(store.processed.has("c1")).toBe(true);
  });
});

describe("CommentProcessor — ไม่มีกฎเข้าเงื่อนไข", () => {
  it("ปล่อยคอมเมนต์ไว้ตามเดิม", async () => {
    const { processor, fetch } = setup();
    allOk(fetch);
    const r = await processor.process({
      comment: comment({ message: "โพสต์นี้ลงเมื่อไหร่คะ" }),
      rules: RULES,
    });
    expect(r.executed).toEqual([]);
    expect(r.th).toContain("ปล่อยคอมเมนต์ไว้ตามเดิม");
  });
});
