import { describe, expect, it } from "vitest";
import { FakeClock, nullLogger } from "@page-os/core";
import { MetaApiError, MetaGateway } from "@page-os/meta";
import { FakeFetch, FakeTokenStore, graphError } from "@page-os/meta/test-helpers";
import {
  contentHash,
  hashableFromPost,
  type DuplicateHit,
  type PublishedPostLookup,
} from "./content-hash.js";
import { PostPublisher } from "./publisher.js";
import { PublishWorker, type PostRepository, type PublishAlertSink } from "./worker.js";
import type { PostContent, PostTarget, ScheduledPost } from "./types.js";

const NOW = 1_700_000_000_000;

class MemRepo implements PostRepository {
  posts = new Map<string, ScheduledPost>();
  targets = new Map<string, PostTarget>();
  refreshed: string[] = [];

  key(postId: string, pageId: string): string {
    return `${postId}:${pageId}`;
  }
  async findPost(postId: string): Promise<ScheduledPost | null> {
    return this.posts.get(postId) ?? null;
  }
  async findTarget(postId: string, pageId: string): Promise<PostTarget | null> {
    return this.targets.get(this.key(postId, pageId)) ?? null;
  }
  async claimTarget(a: { postId: string; pageId: string }): Promise<boolean> {
    const t = this.targets.get(this.key(a.postId, a.pageId));
    if (!t) return false;
    if (t.status === "published" || t.status === "publishing") return false;
    t.status = "publishing";
    return true;
  }
  async releaseTarget(a: { postId: string; pageId: string }): Promise<void> {
    const t = this.targets.get(this.key(a.postId, a.pageId));
    if (t && t.status === "publishing") t.status = "scheduled";
  }
  async markTargetPublished(a: {
    postId: string;
    pageId: string;
    fbPostId: string;
  }): Promise<void> {
    const t = this.targets.get(this.key(a.postId, a.pageId));
    if (t) {
      t.fbPostId = a.fbPostId;
      t.status = "published";
    }
  }
  async markTargetFailed(a: {
    postId: string;
    pageId: string;
    error: string;
    attempts: number;
    terminal: boolean;
  }): Promise<void> {
    const t = this.targets.get(this.key(a.postId, a.pageId));
    if (t) {
      t.lastError = a.error;
      t.attempts = a.attempts;
      t.status = a.terminal ? "failed" : "scheduled";
    }
  }
  async refreshPostStatus(postId: string): Promise<void> {
    this.refreshed.push(postId);
  }
}

class MemLookup implements PublishedPostLookup {
  constructor(private readonly hits: Record<string, DuplicateHit> = {}) {}
  async findByHash(a: { pageId: string; hash: string }): Promise<DuplicateHit | null> {
    return this.hits[`${a.pageId}:${a.hash}`] ?? null;
  }
}

class MemAlerts implements PublishAlertSink {
  sent: Array<{ severity: string; body: string; pageId: string }> = [];
  async send(a: {
    severity: "warn" | "critical";
    title: string;
    body: string;
    pageId: string;
    postId: string;
  }): Promise<void> {
    this.sent.push({ severity: a.severity, body: a.body, pageId: a.pageId });
  }
}

const TEXT: PostContent = { type: "text", body: "โปรโมชั่นวันนี้ ลด 20%" };

function setup(opts: { dupHits?: Record<string, DuplicateHit> } = {}) {
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
      tokenStore: new FakeTokenStore({ p1: "T1", p2: "T2" }),
      clock,
      fetchImpl: fetchImpl.fn,
      random: () => 0,
    },
  );
  const repo = new MemRepo();
  const alerts = new MemAlerts();
  const worker = new PublishWorker({
    repo,
    publisher: new PostPublisher(gateway),
    duplicateLookup: new MemLookup(opts.dupHits ?? {}),
    alerts,
    clock,
    logger: nullLogger,
  });
  return { clock, fetch: fetchImpl, repo, alerts, worker };
}

function seed(
  repo: MemRepo,
  over: {
    post?: Partial<ScheduledPost>;
    target?: Partial<PostTarget>;
    pageIds?: string[];
  } = {},
): void {
  const post: ScheduledPost = {
    id: "post-1",
    pageId: "p1",
    content: TEXT,
    scheduledAtMs: NOW,
    status: "scheduled",
    contentHash: contentHash(hashableFromPost(TEXT)),
    approvalStatus: "approved",
    ...over.post,
  };
  repo.posts.set(post.id, post);
  for (const pageId of over.pageIds ?? ["p1"]) {
    repo.targets.set(`${post.id}:${pageId}`, {
      postId: post.id,
      pageId,
      status: "scheduled",
      attempts: 0,
      ...over.target,
    });
  }
}

describe("PublishWorker — เส้นทางปกติ", () => {
  it("โพสต์สำเร็จ บันทึก fb post id", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.push({ json: { id: "111_222" } });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    expect(out).toMatchObject({ kind: "published", fbPostId: "111_222" });
    expect(repo.targets.get("post-1:p1")!.status).toBe("published");
    expect(repo.refreshed).toContain("post-1");
  });

  it("ยิงไปที่ /{page-id}/feed พร้อมข้อความ", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.push({ json: { id: "1" } });
    await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    const call = fetch.lastCall!;
    expect(call.method).toBe("POST");
    expect(call.url).toContain("p1/feed");
    expect(new URLSearchParams(call.body!).get("message")).toBe(TEXT.body);
  });

  it("ไม่ส่ง scheduled_publish_time ให้ Meta (สเปกสั่งให้ใช้ scheduler ของเราเอง)", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.push({ json: { id: "1" } });
    await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    const body = fetch.lastCall!.body ?? "";
    expect(body).not.toContain("scheduled_publish_time");
    expect(body).not.toContain("published=false");
  });

  it("cross-post: แต่ละเพจใช้ข้อความของตัวเองได้", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo, { pageIds: ["p1", "p2"] });
    repo.targets.get("post-1:p2")!.overrideBody = "ข้อความเฉพาะเพจสอง";

    fetch.push({ json: { id: "a" } }, { json: { id: "b" } });
    await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
    await worker.process({ postId: "post-1", pageId: "p2", attempt: 1 });

    expect(new URLSearchParams(fetch.calls[0]!.body!).get("message")).toBe(
      TEXT.body,
    );
    expect(new URLSearchParams(fetch.calls[1]!.body!).get("message")).toBe(
      "ข้อความเฉพาะเพจสอง",
    );
  });
});

describe("PublishWorker — กันโพสต์ซ้ำ", () => {
  it("เป้าหมายที่โพสต์สำเร็จแล้ว ถูกข้าม (งานซ้ำจากคิว)", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo, { target: { fbPostId: "111_222", status: "published" } });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    expect(out).toMatchObject({ kind: "skipped", reason: "already_published" });
    expect(fetch.callCount).toBe(0);
  });

  it("ตอน retry ต้องเช็คก่อนว่ารอบก่อนโพสต์ขึ้นไปแล้วหรือยัง", async () => {
    // สถานการณ์จริง: ยิงสำเร็จแต่เน็ตขาดตอนรับ response → ถ้า retry ตรงๆ ลูกค้าเห็นซ้ำ
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.setHandler((call) =>
      call.method === "GET" && call.url.includes("p1/feed")
        ? { json: { data: [{ id: "111_999", message: TEXT.body }] } }
        : undefined,
    );

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 2 });

    expect(out).toMatchObject({ kind: "skipped", reason: "already_published" });
    expect(repo.targets.get("post-1:p1")!.fbPostId).toBe("111_999");
    // ต้องไม่มีการ POST ขึ้นเพจเลย
    expect(fetch.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("ตอน retry ถ้ายังไม่มีโพสต์บนเพจ ก็ยิงตามปกติ", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.setHandler((call) => {
      if (call.method === "GET" && call.url.includes("p1/feed")) {
        return { json: { data: [] } };
      }
      if (call.method === "POST") return { json: { id: "111_333" } };
      return undefined;
    });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 2 });
    expect(out).toMatchObject({ kind: "published", fbPostId: "111_333" });
  });

  it("เช็คไม่ได้ว่าโพสต์ไปแล้วหรือยัง → เลื่อนไปรอบหน้า ห้ามเดาแล้วยิง", async () => {
    // ถ้าปล่อยให้ "เช็คไม่ได้" = "ยังไม่ได้โพสต์" ระบบจะยิงซ้ำทั้งที่ความจริงไม่รู้
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.setFallback({ status: 400, json: graphError(32, "rate limited") });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 2 });

    expect(out.kind).toBe("retry");
    expect(out.th).toContain("กันโพสต์ซ้ำ");
    expect(fetch.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(repo.targets.get("post-1:p1")!.status).toBe("scheduled");
  });

  it("เช็คไม่ได้จนหมดรอบ → ให้คนไปเช็คเอง ไม่ยิงมั่ว", async () => {
    const { worker, repo, fetch, alerts } = setup();
    seed(repo);
    fetch.setFallback({ status: 400, json: graphError(32) });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 4 });

    expect(out.kind).toBe("failed");
    expect(out.th).toContain("เปิดเพจเช็คด้วยตัวเอง");
    expect(fetch.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(alerts.sent[0]!.severity).toBe("critical");
  });

  it("โพสต์ที่ไม่มีข้อความ (รูปล้วน) ตอน retry ก็ต้องไม่เดา", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo, {
      post: {
        content: {
          type: "photo",
          body: "",
          media: [{ url: "https://cdn/x.jpg" }],
        },
      },
    });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 2 });

    expect(out.kind).toBe("retry");
    expect(out.th).toContain("ไม่มีข้อความให้เทียบ");
    expect(fetch.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("รอบแรกไม่ต้องเสียเวลาเช็คว่าโพสต์ไปแล้วหรือยัง", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.push({ json: { id: "1" } });
    await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
    expect(fetch.calls.filter((c) => c.method === "GET")).toHaveLength(0);
  });

  it("เนื้อหาซ้ำใน 90 วัน → ไม่โพสต์ และแจ้งเตือน", async () => {
    const hash = contentHash(hashableFromPost(TEXT));
    const { worker, repo, fetch, alerts } = setup({
      dupHits: {
        [`p1:${hash}`]: { postId: "old", publishedAtMs: NOW, daysAgo: 12 },
      },
    });
    seed(repo);

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    expect(out).toMatchObject({ kind: "skipped", reason: "duplicate" });
    expect(fetch.callCount).toBe(0);
    expect(alerts.sent[0]!.severity).toBe("warn");
    expect(alerts.sent[0]!.body).toContain("12 วันก่อน");
  });

  it("ติ๊ก 'อนุญาตให้ซ้ำ' แล้วโพสต์ได้", async () => {
    const hash = contentHash(hashableFromPost(TEXT));
    const { worker, repo, fetch } = setup({
      dupHits: {
        [`p1:${hash}`]: { postId: "old", publishedAtMs: NOW, daysAgo: 12 },
      },
    });
    seed(repo, { post: { allowDuplicate: true } });
    fetch.push({ json: { id: "1" } });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
    expect(out.kind).toBe("published");
  });
});

describe("PublishWorker — กันโพสต์ผิดเพจ (สเปกข้อ 6.4)", () => {
  it("เพจที่ไม่ได้อยู่ในเป้าหมาย ต้องไม่ถูกโพสต์", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo, { pageIds: ["p1"] });

    const out = await worker.process({
      postId: "post-1",
      pageId: "p2", // ไม่ใช่เป้าหมาย
      attempt: 1,
    });

    expect(out).toMatchObject({ kind: "skipped", reason: "no_target" });
    expect(out.th).toContain("โพสต์ผิดเพจ");
    expect(fetch.callCount).toBe(0);
  });
});

describe("PublishWorker — สถานะโพสต์", () => {
  it("โพสต์ที่ถูกยกเลิกแล้วไม่ยิง", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo, { post: { status: "cancelled" } });
    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
    expect(out).toMatchObject({ kind: "skipped", reason: "cancelled" });
    expect(fetch.callCount).toBe(0);
  });

  it("โพสต์ที่ถูกลบไปแล้วไม่พัง", async () => {
    const { worker, fetch } = setup();
    const out = await worker.process({ postId: "ไม่มี", pageId: "p1", attempt: 1 });
    expect(out.kind).toBe("skipped");
    expect(fetch.callCount).toBe(0);
  });

  it("ลูกค้ายังไม่อนุมัติ → ไม่ยิง", async () => {
    for (const st of ["pending", "changes_requested"] as const) {
      const { worker, repo, fetch } = setup();
      seed(repo, { post: { approvalStatus: st } });
      const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
      expect(out, st).toMatchObject({ kind: "skipped", reason: "not_approved" });
      expect(fetch.callCount).toBe(0);
    }
  });

  it("โพสต์ที่ไม่ต้องอนุมัติ (approvalStatus=none) ยิงได้", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo, { post: { approvalStatus: "none" } });
    fetch.push({ json: { id: "1" } });
    expect((await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 })).kind).toBe(
      "published",
    );
  });
});

describe("PublishWorker — retry และ dead-letter", () => {
  it("โควตาเต็ม → สั่ง retry พร้อมบอกเวลา ไม่แจ้งเตือนทันที", async () => {
    const { worker, repo, fetch, alerts } = setup();
    seed(repo);
    fetch.setFallback({ status: 400, json: graphError(32, "rate limited") });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    expect(out).toMatchObject({ kind: "retry", delayMs: 60_000, nextAttempt: 2 });
    expect(alerts.sent).toHaveLength(0);
    // ยังไม่ถือว่า failed ถาวร
    expect(repo.targets.get("post-1:p1")!.status).toBe("scheduled");
  });

  it("ครบ 3 ครั้งแล้วยังไม่ได้ → failed + แจ้งเตือน", async () => {
    const { worker, repo, fetch, alerts } = setup();
    seed(repo);
    // การเช็ค "โพสต์ไปแล้วหรือยัง" ต้องตอบได้ว่ายังไม่ได้โพสต์ ไม่งั้นจะไปเข้าทาง defer
    fetch.setHandler((call) =>
      call.method === "GET" && call.url.includes("p1/feed")
        ? { json: { data: [] } }
        : { status: 400, json: graphError(32) },
    );

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 4 });

    expect(out).toMatchObject({ kind: "failed", needsAlert: true });
    expect(repo.targets.get("post-1:p1")!.status).toBe("failed");
    expect(alerts.sent[0]!.severity).toBe("critical");
  });

  it("token ตาย → เลิกลองทันที ไม่รอครบ 3 ครั้ง", async () => {
    const { worker, repo, fetch, alerts } = setup();
    seed(repo);
    fetch.setFallback({ status: 400, json: graphError(190) });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    expect(out.kind).toBe("failed");
    expect(out.th).toContain("เชื่อมเพจใหม่");
    expect(alerts.sent).toHaveLength(1);
  });

  it("ข้อมูลโพสต์ไม่ครบ → เลิกลองทันที ไม่เสียเวลา retry", async () => {
    const { worker, repo, fetch, alerts } = setup();
    seed(repo, { post: { content: { type: "photo", body: "x" } } }); // ไม่มี media

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    expect(out.kind).toBe("failed");
    expect(out.th).toContain("ต้องมีสื่ออย่างน้อย");
    expect(fetch.callCount).toBe(0);
    expect(alerts.sent).toHaveLength(1);
  });

  it("แจ้งเตือนไม่ได้ ต้องไม่ทำให้งานพัง", async () => {
    const { repo } = setup();
    seed(repo);
    const clock = new FakeClock(NOW);
    const fetchImpl = new FakeFetch();
    fetchImpl.setFallback({ status: 400, json: graphError(190) });
    const gateway = new MetaGateway(
      { appId: "A", appSecret: "S", graphVersion: "v25.0" },
      {
        tokenStore: new FakeTokenStore({ p1: "T1" }),
        clock,
        fetchImpl: fetchImpl.fn,
      },
    );
    const worker = new PublishWorker({
      repo,
      publisher: new PostPublisher(gateway),
      duplicateLookup: new MemLookup(),
      alerts: {
        send: async () => {
          throw new Error("LINE ล่ม");
        },
      },
      clock,
      logger: nullLogger,
    });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
    expect(out.kind).toBe("failed");
    expect(repo.targets.get("post-1:p1")!.status).toBe("failed");
  });

  it("error ที่ไม่ใช่ของ Meta ก็ต้องจบงานอย่างเรียบร้อย", async () => {
    const { repo } = setup();
    seed(repo);
    const clock = new FakeClock(NOW);
    const worker = new PublishWorker({
      repo,
      publisher: {
        publish: async () => {
          throw new TypeError("โค้ดพัง");
        },
        findRecentPostByMessage: async () => ({ status: "not_found" }),
      } as unknown as PostPublisher,
      duplicateLookup: new MemLookup(),
      clock,
      logger: nullLogger,
    });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
    expect(out.kind).toBe("failed");
    expect(out.th).toContain("ไม่คาดคิด");
  });
});

describe("PublishWorker — ผลลัพธ์ทุกแบบอ่านรู้เรื่อง", () => {
  it("ทุก outcome มีข้อความไทย", async () => {
    const cases: Array<() => Promise<{ th: string }>> = [
      async () => {
        const { worker, repo, fetch } = setup();
        seed(repo);
        fetch.push({ json: { id: "1" } });
        return worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
      },
      async () => {
        const { worker, repo } = setup();
        seed(repo, { post: { status: "cancelled" } });
        return worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
      },
      async () => {
        const { worker, repo, fetch } = setup();
        seed(repo);
        fetch.setFallback({ status: 400, json: graphError(32) });
        return worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
      },
    ];
    for (const c of cases) {
      expect((await c()).th).toMatch(/[ก-๙]/);
    }
  });
});

describe("MetaApiError ที่ใช้ตัดสินใจ", () => {
  it("worker ตัดสินจาก action ไม่ใช่เลข error", () => {
    // ยืนยันว่าความรู้เรื่องเลข error อยู่ที่ packages/meta ที่เดียว
    expect(new MetaApiError({ message: "x", code: 32 }).action).toBe("throttle");
    expect(new MetaApiError({ message: "x", code: 190 }).action).toBe("reconnect");
  });
});

describe("PublishWorker — กัน worker สองตัวยิงพร้อมกัน", () => {
  it("worker ตัวที่สองต้องถูกปฏิเสธ ไม่ยิงซ้ำ", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.setFallback({ json: { id: "1_1" } });

    // จำลองว่า worker ตัวแรกจองไปแล้วและกำลังยิงอยู่
    await repo.claimTarget({ postId: "post-1", pageId: "p1" });

    const out = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });

    expect(out).toMatchObject({ kind: "skipped", reason: "in_progress" });
    expect(fetch.callCount).toBe(0);
  });

  it("ยิงสองงานพร้อมกันจริงๆ ต้องขึ้นเพจแค่ครั้งเดียว", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.setFallback({ json: { id: "1_1" } });

    const [a, b] = await Promise.all([
      worker.process({ postId: "post-1", pageId: "p1", attempt: 1 }),
      worker.process({ postId: "post-1", pageId: "p1", attempt: 1 }),
    ]);

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["published", "skipped"]);
    expect(fetch.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("ล้มเหลวแล้วต้องคืนการจอง ไม่งั้นรอบ retry จะจองไม่ได้", async () => {
    const { worker, repo, fetch } = setup();
    seed(repo);
    fetch.setFallback({ status: 400, json: graphError(32) });

    const first = await worker.process({ postId: "post-1", pageId: "p1", attempt: 1 });
    expect(first.kind).toBe("retry");
    // สถานะต้องกลับมาจองได้อีก
    expect(await repo.claimTarget({ postId: "post-1", pageId: "p1" })).toBe(true);
  });
});
