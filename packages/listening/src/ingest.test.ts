import { FakeClock } from "@page-os/core";
import { MetaApiError } from "@page-os/meta";
import { describe, expect, it } from "vitest";
import {
  ListeningSync,
  dateKeyUtc,
  type FetchedComment,
  type FetchedPost,
  type ListeningRepository,
  type TrackedPageRef,
} from "./ingest.js";

const NOW = Date.UTC(2026, 7, 10, 7, 15);

const page = (over: Partial<TrackedPageRef> = {}): TrackedPageRef => ({
  id: "tp-1",
  fbPageId: "1013",
  name: "ครัวคุณยาย",
  kind: "OWNED",
  source: "META_API",
  followers: null,
  lastFetchedAtMs: null,
  ...over,
});

/** ที่เก็บข้อมูลปลอมที่จำทุกอย่างไว้ให้ตรวจได้ */
class FakeRepo implements ListeningRepository {
  due: TrackedPageRef[] = [];
  followers: Array<{ trackedPageId: string; followers: number; dateKey: string }> = [];
  posts: FetchedPost[] = [];
  comments: Array<{ fbPostId: string; comments: FetchedComment[] }> = [];
  fetched: string[] = [];
  lastDueArgs: { nowMs: number; staleAfterMs: number; limit: number } | null = null;

  async duePages(args: { nowMs: number; staleAfterMs: number; limit: number }) {
    this.lastDueArgs = args;
    return this.due;
  }
  async saveFollowers(args: { trackedPageId: string; followers: number; dateKey: string }) {
    this.followers.push(args);
  }
  savePostsAt: number | null = null;
  async savePosts(args: { trackedPageId: string; posts: FetchedPost[]; fetchedAtMs: number }) {
    this.posts.push(...args.posts);
    this.savePostsAt = args.fetchedAtMs;
    return args.posts.length;
  }
  async saveComments(args: { fbPostId: string; comments: FetchedComment[] }) {
    this.comments.push({ fbPostId: args.fbPostId, comments: args.comments });
    return args.comments.length;
  }
  async markFetched(args: { trackedPageId: string }) {
    this.fetched.push(args.trackedPageId);
  }
}

interface Call {
  path: string;
  params: Record<string, unknown>;
  priority: string | undefined;
}

/**
 * Gateway ปลอมที่ตอบตาม path — คืน `data` ที่ห่อเหมือน `GatewayResult` จริง
 * และจดทุก call ไว้ให้ตรวจว่ายิงอะไรไปบ้าง ด้วย priority อะไร
 */
function fakeGateway(routes: Record<string, unknown[] | (() => never)>) {
  const calls: Call[] = [];
  const cursors = new Map<string, number>();

  const gateway = {
    async call(opts: { path: string; params?: Record<string, unknown>; priority?: string }) {
      const params = opts.params ?? {};
      calls.push({ path: opts.path, params, priority: opts.priority });

      const route = routes[opts.path];
      if (route === undefined) throw new Error(`ไม่ได้เตรียมคำตอบของ ${opts.path}`);
      if (typeof route === "function") return route();

      // จำลอง paging: แต่ละ path คืนของทีละก้อนตามลำดับที่เตรียมไว้
      const idx = cursors.get(opts.path) ?? 0;
      cursors.set(opts.path, idx + 1);
      return { data: route[idx] ?? { data: [] }, httpStatus: 200, attempts: 1 };
    },
  };
  return { gateway: gateway as never, calls };
}

const rawPost = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  created_time: "2026-08-07T08:57:00+0000",
  message: "ข้าวกล่องวันนี้",
  permalink_url: "https://facebook.com/p1",
  shares: { count: 4 },
  reactions: { summary: { total_count: 120 } },
  comments: { summary: { total_count: 2 } },
  ...over,
});

describe("ดึงข้อมูลเพจเดียว", () => {
  it("เก็บโพสต์ ผู้ติดตาม และคอมเมนต์ครบ", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({
      "/1013": [{ id: "1013", name: "ครัวคุณยาย", followers_count: 18_420 }],
      "/1013/posts": [{ data: [rawPost()] }],
      "/p1/comments": [
        {
          data: [
            {
              id: "c1",
              message: "อร่อยมาก",
              created_time: "2026-08-07T09:00:00+0000",
              from: { id: "u1", name: "สุณี ปะสาวะถา" },
            },
          ],
        },
      ],
    });

    const sync = new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) });
    const result = await sync.syncPage(page());

    expect(result.errors).toEqual([]);
    expect(result.followers).toBe(18_420);
    expect(repo.followers[0]).toMatchObject({ followers: 18_420, dateKey: "2026-08-10" });
    expect(repo.posts[0]).toMatchObject({
      fbPostId: "p1",
      reactions: 120,
      shares: 4,
      commentCount: 2,
      publishedAtMs: Date.parse("2026-08-07T08:57:00+0000"),
    });
    expect(repo.comments[0]?.comments[0]).toMatchObject({
      fbCommentId: "c1",
      authorName: "สุณี ปะสาวะถา",
    });
    expect(repo.fetched).toEqual(["tp-1"]);
    expect(result.th).toContain("เรียบร้อย");
    void calls;
  });

  /** งานฟังเสียงไม่มีใครนั่งรอ — ห้ามไปเบียดคิวของงานที่ลูกค้ารออยู่จริง */
  it("ทุก call ใช้ priority ต่ำ", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({
      "/1013": [{ followers_count: 1 }],
      "/1013/posts": [{ data: [rawPost()] }],
      "/p1/comments": [{ data: [] }],
    });
    await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncPage(page());

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.priority, c.path).toBe("low");
  });

  it("โพสต์ที่ไม่มีคอมเมนต์เลย ไม่เสีย call ไปถาม", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({
      "/1013": [{ followers_count: 1 }],
      "/1013/posts": [
        { data: [rawPost({ id: "p1", comments: { summary: { total_count: 0 } } })] },
      ],
    });
    await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncPage(page());

    expect(calls.some((c) => c.path.includes("/comments"))).toBe(false);
    expect(repo.comments).toEqual([]);
  });

  /**
   * ถ้าปล่อยแถวที่ไม่มีเวลาผ่านไป จะได้ `publishedAt` เป็น Invalid Date ลง DB
   * แล้วทุกการกรองตามช่วงเวลาจะพลาดแบบเงียบๆ
   */
  it("ทิ้งโพสต์ที่ไม่มีรหัสหรือเวลาอ่านไม่ออก แทนที่จะเก็บของเสียลง DB", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      "/1013": [{ followers_count: 1 }],
      "/1013/posts": [
        {
          data: [
            rawPost({ id: "ok", comments: { summary: { total_count: 0 } } }),
            rawPost({ id: undefined }),
            rawPost({ id: "no-time", created_time: undefined }),
            rawPost({ id: "bad-time", created_time: "เมื่อวาน" }),
          ],
        },
      ],
    });
    await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncPage(page());

    expect(repo.posts.map((p) => p.fbPostId)).toEqual(["ok"]);
  });

  it("ฟิลด์ที่ Meta ไม่ส่งมา นับเป็น 0 ไม่ใช่ undefined", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      "/1013": [{}],
      "/1013/posts": [
        { data: [{ id: "p1", created_time: "2026-08-01T00:00:00+0000" }] },
      ],
    });
    await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncPage(page());

    expect(repo.posts[0]).toMatchObject({ reactions: 0, shares: 0, commentCount: 0 });
  });

  /** คนคอมเมนต์ที่ไม่ได้ให้สิทธิ์แอปเรา จะไม่มี `from` มาให้ — เรื่องปกติ ไม่ใช่ error */
  it("คอมเมนต์ที่ไม่รู้ว่าใครพูด ยังเก็บไว้", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      "/1013": [{ followers_count: 1 }],
      "/1013/posts": [{ data: [rawPost()] }],
      "/p1/comments": [
        { data: [{ id: "c1", message: "แพงจัง", created_time: "2026-08-07T09:00:00+0000" }] },
      ],
    });
    await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncPage(page());

    expect(repo.comments[0]?.comments[0]).toMatchObject({
      fbCommentId: "c1",
      authorId: null,
      authorName: null,
      message: "แพงจัง",
    });
  });

  it("ขอโพสต์ย้อนหลังตามจำนวนวันที่ตั้งไว้", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({
      "/1013": [{ followers_count: 1 }],
      "/1013/posts": [{ data: [] }],
    });
    await new ListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      lookbackDays: 7,
    }).syncPage(page());

    const postCall = calls.find((c) => c.path.endsWith("/posts"));
    expect(postCall?.params["since"]).toBe(Math.floor((NOW - 7 * 86_400_000) / 1000));
  });
});

describe("เมื่อ Meta ตอบ error", () => {
  it("ดึงผู้ติดตามไม่ได้ ก็ยังดึงโพสต์ต่อ — ไม่ใช่ล้มทั้งเพจ", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      "/1013": () => {
        throw new MetaApiError({
          th: "เพจนี้ไม่ให้ดูข้อมูลสาธารณะ",
          message: "not visible",
        });
      },
      "/1013/posts": [
        { data: [rawPost({ comments: { summary: { total_count: 0 } } })] },
      ],
    });
    const r = await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncPage(page());

    expect(repo.posts).toHaveLength(1);
    expect(r.errors).toEqual(["เพจนี้ไม่ให้ดูข้อมูลสาธารณะ"]);
    expect(r.th).toContain("ได้บางส่วน");
  });

  /** ล้มตอนดึงคอมเมนต์ของโพสต์ใบเดียว ไม่ควรทำให้โพสต์ที่เหลือไม่ถูกดึง */
  it("คอมเมนต์โพสต์หนึ่งใบพัง ใบอื่นยังดึงต่อ", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      "/1013": [{ followers_count: 1 }],
      "/1013/posts": [{ data: [rawPost({ id: "p1" }), rawPost({ id: "p2" })] }],
      "/p1/comments": () => {
        throw new Error("พังกลางทาง");
      },
      "/p2/comments": [
        { data: [{ id: "c9", created_time: "2026-08-07T09:00:00+0000" }] },
      ],
    });
    const r = await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncPage(page());

    expect(r.commentsWritten).toBe(1);
    expect(r.errors).toHaveLength(1);
    // ยังต้องจดว่าดึงแล้ว ไม่งั้นจะวนกลับมาดึงซ้ำทันทีทุกนาที
    expect(repo.fetched).toEqual(["tp-1"]);
  });
});

describe("เพจที่ข้อมูลมาจากแหล่งอื่น", () => {
  it("ไม่ยิงไป Meta เลย และบอกเหตุผลไว้", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({});
    const r = await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncPage(
      page({ source: "EXTERNAL", kind: "COMPETITOR" }),
    );

    expect(calls).toEqual([]);
    expect(r.th).toContain("แหล่งภายนอก");
    expect(r.errors).toEqual([]);
  });
});

describe("ดึงทั้งชุดที่ถึงเวลา", () => {
  it("ส่งเวลาปัจจุบันจาก clock ที่ inject เข้ามา ไม่ใช่เวลาจริงของเครื่อง", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({});
    await new ListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncDue({
      staleAfterMs: 3_600_000,
      limit: 5,
    });

    expect(repo.lastDueArgs).toEqual({ nowMs: NOW, staleAfterMs: 3_600_000, limit: 5 });
  });

  it("ดึงทีละเพจตามลำดับ ไม่ขนานกัน", async () => {
    const repo = new FakeRepo();
    repo.due = [page({ id: "a", fbPageId: "1" }), page({ id: "b", fbPageId: "2" })];
    const { gateway } = fakeGateway({
      "/1": [{ followers_count: 1 }],
      "/1/posts": [{ data: [] }],
      "/2": [{ followers_count: 2 }],
      "/2/posts": [{ data: [] }],
    });

    const results = await new ListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncDue({ staleAfterMs: 1, limit: 10 });

    expect(results.map((r) => r.trackedPageId)).toEqual(["a", "b"]);
    expect(repo.fetched).toEqual(["a", "b"]);
  });
});

describe("dateKeyUtc", () => {
  it("ให้ YYYY-MM-DD ตาม UTC", () => {
    expect(dateKeyUtc(Date.UTC(2026, 7, 10, 23, 59))).toBe("2026-08-10");
  });
});
