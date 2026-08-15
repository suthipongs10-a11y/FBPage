import { FakeClock } from "@page-os/core";
import { YouTubeApiError } from "@page-os/youtube";
import { describe, expect, it } from "vitest";
import type {
  FetchedComment,
  FetchedPost,
  ListeningRepository,
  TrackedPageRef,
  TrackedPlatform,
} from "./ingest.js";
import { YouTubeListeningSync } from "./youtube-ingest.js";

const NOW = Date.UTC(2026, 7, 10, 7, 15);

const channel = (over: Partial<TrackedPageRef> = {}): TrackedPageRef => ({
  id: "tp-yt-1",
  externalId: "UCabc123",
  platform: "YOUTUBE",
  name: "ครัวคุณยาย",
  kind: "OWNED",
  source: "YOUTUBE_API",
  followers: null,
  lastFetchedAtMs: null,
  ...over,
});

class FakeRepo implements ListeningRepository {
  due: TrackedPageRef[] = [];
  followers: Array<{ trackedPageId: string; followers: number; dateKey: string }> = [];
  posts: FetchedPost[] = [];
  comments: Array<{ externalId: string; comments: FetchedComment[] }> = [];
  fetched: string[] = [];
  lastDueArgs: {
    nowMs: number;
    staleAfterMs: number;
    limit: number;
    platform: TrackedPlatform;
  } | null = null;

  async duePages(args: {
    nowMs: number;
    staleAfterMs: number;
    limit: number;
    platform: TrackedPlatform;
  }) {
    this.lastDueArgs = args;
    return this.due;
  }
  async saveFollowers(args: { trackedPageId: string; followers: number; dateKey: string }) {
    this.followers.push(args);
  }
  async savePosts(args: { trackedPageId: string; posts: FetchedPost[] }) {
    this.posts.push(...args.posts);
    return args.posts.length;
  }
  async saveComments(args: { externalId: string; comments: FetchedComment[] }) {
    this.comments.push({ externalId: args.externalId, comments: args.comments });
    return args.comments.length;
  }
  async markFetched(args: { trackedPageId: string }) {
    this.fetched.push(args.trackedPageId);
  }
}

interface Call {
  endpoint: string;
  params: Record<string, unknown>;
}

/**
 * Gateway ปลอมที่ตอบตาม endpoint — จดทุก call ไว้ให้ตรวจว่ายิงอะไรไปบ้าง
 * ค่าใน array คือคำตอบของแต่ละหน้า (จำลอง paging ตามลำดับ)
 */
function fakeGateway(
  routes: Record<string, unknown[] | ((n: number) => unknown)>,
) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();

  const gateway = {
    async call(opts: { endpoint: string; params?: Record<string, unknown> }) {
      const params = opts.params ?? {};
      calls.push({ endpoint: opts.endpoint, params });

      const route = routes[opts.endpoint];
      if (route === undefined) throw new Error(`ไม่ได้เตรียมคำตอบของ ${opts.endpoint}`);

      const n = seen.get(opts.endpoint) ?? 0;
      seen.set(opts.endpoint, n + 1);
      if (typeof route === "function") return { data: route(n), quota: null };
      return { data: route[n] ?? { items: [] }, quota: null };
    },
  };
  return { gateway: gateway as never, calls };
}

const channelInfo = (over: Record<string, unknown> = {}) => ({
  items: [
    {
      id: "UCabc123",
      snippet: { title: "ครัวคุณยาย" },
      statistics: { subscriberCount: "18420" },
      contentDetails: { relatedPlaylists: { uploads: "UUabc123" } },
      ...over,
    },
  ],
});

const playlistItem = (id: string, publishedAt: string) => ({
  contentDetails: { videoId: id, videoPublishedAt: publishedAt },
});

const videoStat = (over: Record<string, unknown> = {}) => ({
  id: "v1",
  snippet: {
    title: "ข้าวกล่องวันนี้",
    description: "สั่งได้ทางไลน์",
    publishedAt: "2026-08-07T08:57:00Z",
  },
  statistics: { viewCount: "9000", likeCount: "120", commentCount: "2" },
  ...over,
});

const thread = (id: string, text: string, author = "UCfan1") => ({
  snippet: {
    topLevelComment: {
      id,
      snippet: {
        textOriginal: text,
        publishedAt: "2026-08-07T09:00:00Z",
        authorDisplayName: "สุณี ปะสาวะถา",
        authorChannelId: { value: author },
      },
    },
  },
});

const happyRoutes = () => ({
  "channels.list": [channelInfo()],
  "playlistItems.list": [{ items: [playlistItem("v1", "2026-08-07T08:57:00Z")] }],
  "videos.list": [{ items: [videoStat()] }],
  "commentThreads.list": [{ items: [thread("c1", "อร่อยมาก")] }],
});

describe("ดึงข้อมูลช่องเดียว", () => {
  it("เก็บวิดีโอ ผู้ติดตาม และคอมเมนต์ครบ", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway(happyRoutes());

    const sync = new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) });
    const result = await sync.syncChannel(channel());

    expect(result.errors).toEqual([]);
    expect(result.followers).toBe(18_420);
    expect(repo.followers).toEqual([
      { trackedPageId: "tp-yt-1", followers: 18_420, dateKey: "2026-08-10" },
    ]);
    expect(repo.posts).toHaveLength(1);
    expect(repo.posts[0]).toMatchObject({
      externalId: "v1",
      reactions: 120,
      commentCount: 2,
      permalink: "https://www.youtube.com/watch?v=v1",
    });
    expect(repo.comments[0]?.comments[0]).toMatchObject({
      externalId: "c1",
      authorId: "UCfan1",
      message: "อร่อยมาก",
    });
    expect(repo.fetched).toEqual(["tp-yt-1"]);
  });

  /**
   * `search.list` ราคา 100 หน่วย เรียกแค่ 100 ครั้งโควตาหมดทั้งวัน
   * ตัวอย่างในเน็ตส่วนมากใช้มันเพราะเขียนง่ายกว่า — ข้อนี้กันไม่ให้หลุดเข้ามา
   */
  it("ไม่แตะ search.list เลยแม้แต่ครั้งเดียว", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway(happyRoutes());

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncChannel(
      channel(),
    );

    expect(calls.map((c) => c.endpoint)).not.toContain("search.list");
    expect(calls.map((c) => c.endpoint)).toEqual([
      "channels.list",
      "playlistItems.list",
      "videos.list",
      "commentThreads.list",
    ]);
  });

  it("ขอ id เพลย์ลิสต์อัปโหลดมาพร้อมข้อมูลช่อง ไม่ยิงซ้ำ", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway(happyRoutes());

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncChannel(
      channel(),
    );

    const ch = calls.find((c) => c.endpoint === "channels.list");
    expect(String(ch?.params.part)).toContain("contentDetails");
    expect(calls.filter((c) => c.endpoint === "channels.list")).toHaveLength(1);
    expect(calls.find((c) => c.endpoint === "playlistItems.list")?.params.playlistId).toBe(
      "UUabc123",
    );
  });

  it("ยอดแชร์เป็น 0 เพราะ YouTube ไม่มีตัวเลขนั้นให้", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway(happyRoutes());

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncChannel(
      channel(),
    );

    expect(repo.posts[0]?.shares).toBe(0);
  });

  it("เอาชื่อเรื่องมาไว้หน้าคำบรรยาย", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway(happyRoutes());

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncChannel(
      channel(),
    );

    expect(repo.posts[0]?.message).toBe("ข้าวกล่องวันนี้\n\nสั่งได้ทางไลน์");
  });

  /**
   * ช่องที่ตั้งค่าซ่อนยอดผู้ติดตามไม่ส่ง `subscriberCount` มา ถ้าบันทึกเป็น 0
   * กราฟจะดิ่งลงศูนย์ทั้งที่ช่องยังมีคนตามเท่าเดิม
   */
  it("ช่องที่ซ่อนยอดผู้ติดตาม → ไม่บันทึกเป็น 0", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      ...happyRoutes(),
      "channels.list": [
        channelInfo({ statistics: { hiddenSubscriberCount: true, subscriberCount: "0" } }),
      ],
    });

    const result = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncChannel(channel());

    expect(repo.followers).toEqual([]);
    expect(result.followers).toBeNull();
  });

  it("เอาคอมเมนต์ตอบกลับมาเก็บด้วย ไม่ใช่แค่ระดับบนสุด", async () => {
    const repo = new FakeRepo();
    const withReply = {
      ...thread("c1", "อร่อยมาก"),
      replies: {
        comments: [
          {
            id: "c1r1",
            snippet: {
              textOriginal: "จริงด้วย",
              publishedAt: "2026-08-07T09:05:00Z",
              authorDisplayName: "วิชัย",
              authorChannelId: { value: "UCfan2" },
            },
          },
        ],
      },
    };
    const { gateway } = fakeGateway({
      ...happyRoutes(),
      "commentThreads.list": [{ items: [withReply] }],
    });

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncChannel(
      channel(),
    );

    expect(repo.comments[0]?.comments.map((c) => c.externalId)).toEqual(["c1", "c1r1"]);
  });

  it("ขอข้อความดิบ ไม่เอา HTML", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway(happyRoutes());

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncChannel(
      channel(),
    );

    expect(calls.find((c) => c.endpoint === "commentThreads.list")?.params.textFormat).toBe(
      "plainText",
    );
  });

  it("วิดีโอที่ไม่มีคอมเมนต์เลย ไม่เสียโควตาไปถาม", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({
      ...happyRoutes(),
      "videos.list": [{ items: [videoStat({ statistics: { commentCount: "0" } })] }],
    });

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncChannel(
      channel(),
    );

    expect(calls.filter((c) => c.endpoint === "commentThreads.list")).toHaveLength(0);
  });

  it("วิดีโอที่ไม่มี id หรือไม่มีเวลา ถูกทิ้ง ไม่เก็บของเสียลง DB", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      ...happyRoutes(),
      "videos.list": [
        {
          items: [
            videoStat(),
            videoStat({ id: undefined }),
            videoStat({ id: "v3", snippet: { title: "ไม่มีเวลา" } }),
          ],
        },
      ],
    });

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncChannel(
      channel(),
    );

    expect(repo.posts.map((p) => p.externalId)).toEqual(["v1"]);
  });
});

describe("เจอของที่ผิดปกติ", () => {
  /**
   * รหัสช่องผิด → API ตอบ 200 พร้อม `items: []` ไม่ใช่ 404
   * ถ้าไม่ดัก จะกลายเป็น "ดึงเรียบร้อย 0 วิดีโอ" ทุกชั่วโมงตลอดไป
   */
  it("ไม่พบช่อง → บอกว่ารหัสอาจผิด ไม่ใช่เงียบว่าสำเร็จ", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({ "channels.list": [{ items: [] }] });

    const result = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncChannel(channel());

    expect(result.errors[0]).toContain("ไม่พบช่องรหัส UCabc123");
    expect(result.errors[0]).toContain("UC");
    expect(result.th).toContain("ไม่พบช่องนี้");
    expect(calls.map((c) => c.endpoint)).toEqual(["channels.list"]);
    // ยังจดว่าดึงแล้ว ไม่งั้นช่องที่รหัสผิดจะค้างหัวคิวตลอดกาล
    expect(repo.fetched).toEqual(["tp-yt-1"]);
  });

  /**
   * ปิดคอมเมนต์เป็นสถานะปกติของวิดีโอ ไม่ใช่ความผิดพลาด — ถ้านับเป็น error
   * ช่องที่ปิดคอมเมนต์ทุกวิดีโอจะขึ้นเตือนสีแดงตลอดกาลทั้งที่ไม่มีอะไรต้องแก้
   */
  it("วิดีโอที่ปิดคอมเมนต์ → ข้ามเงียบๆ ไม่นับเป็นปัญหา", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      ...happyRoutes(),
      "commentThreads.list": () => {
        throw new YouTubeApiError({
          message: "The video identified by the request is disabled comments.",
          reason: "commentsDisabled",
          httpStatus: 403,
        });
      },
    });

    const result = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncChannel(channel());

    expect(result.errors).toEqual([]);
    expect(result.th).toContain("เรียบร้อย");
    expect(repo.comments[0]?.comments).toEqual([]);
  });

  it("ช่องที่ไม่มีเพลย์ลิสต์อัปโหลด → บอกว่ายังไม่เคยลงวิดีโอ", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      "channels.list": [channelInfo({ contentDetails: {} })],
    });

    const result = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncChannel(channel());

    expect(result.errors[0]).toContain("ยังไม่เคยลงวิดีโอ");
  });

  it("ดึงคอมเมนต์วิดีโอหนึ่งพัง วิดีโออื่นยังดึงต่อ", async () => {
    const repo = new FakeRepo();
    let n = 0;
    const { gateway } = fakeGateway({
      "channels.list": [channelInfo()],
      "playlistItems.list": [
        {
          items: [
            playlistItem("v1", "2026-08-07T08:57:00Z"),
            playlistItem("v2", "2026-08-06T08:57:00Z"),
          ],
        },
      ],
      "videos.list": [
        { items: [videoStat(), videoStat({ id: "v2" })] },
      ],
      "commentThreads.list": () => {
        n += 1;
        if (n === 1) throw new YouTubeApiError({ message: "boom", httpStatus: 500 });
        return { items: [thread("c2", "ดีมาก")] };
      },
    });

    const result = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncChannel(channel());

    expect(result.errors).toHaveLength(1);
    expect(result.commentsWritten).toBe(1);
    expect(repo.comments.map((c) => c.externalId)).toEqual(["v2"]);
  });

  it("ช่องที่ไม่ใช่ YouTube ถูกปฏิเสธก่อนยิง call ใดๆ", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway(happyRoutes());

    const result = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncChannel(channel({ platform: "FACEBOOK", source: "META_API" }));

    expect(calls).toEqual([]);
    expect(result.th).toContain("ไม่ใช่ช่อง YouTube");
    // ยังต้องจดว่าดูแล้ว ไม่งั้นยึดหัวคิวไว้ตลอดกาล (ดู ListeningSync.skip)
    expect(repo.fetched).toEqual(["tp-yt-1"]);
  });

  it("ช่องที่ตั้งเป็นแหล่งข้อมูลภายนอก ไม่ถูกยิงผ่าน API", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway(happyRoutes());

    const result = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncChannel(channel({ source: "EXTERNAL" }));

    expect(calls).toEqual([]);
    expect(result.th).toContain("แหล่งภายนอก");
    expect(repo.fetched).toEqual(["tp-yt-1"]);
  });
});

describe("โควตารายวัน", () => {
  /**
   * call ที่โดนปฏิเสธเพราะโควตาหมด **ยังกินโควตา** — ไล่ยิงต่อให้ครบทุกช่อง
   * คือการเผาโควตาของวันพรุ่งนี้ทิ้ง ต้องหยุดทั้งรอบทันที
   */
  it("โควตาหมด → หยุดทั้งรอบ ไม่ไล่ต่อช่องที่เหลือ", async () => {
    const repo = new FakeRepo();
    repo.due = [
      channel({ id: "a", externalId: "UCa" }),
      channel({ id: "b", externalId: "UCb" }),
      channel({ id: "c", externalId: "UCc" }),
    ];
    const { gateway, calls } = fakeGateway({
      "channels.list": (n: number) => {
        if (n === 0) return channelInfo();
        throw new YouTubeApiError({
          message: "quota",
          reason: "quotaExceeded",
          httpStatus: 403,
        });
      },
      "playlistItems.list": [{ items: [] }],
    });

    const out = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncDue({ staleAfterMs: 3_600_000, limit: 10 });

    expect(out).toHaveLength(2);
    expect(out[1]?.quotaExhausted).toBe(true);
    expect(calls.filter((c) => c.endpoint === "channels.list")).toHaveLength(2);
  });

  /**
   * ไม่ `markFetched` ตอนหยุดเพราะโควตา — ไม่งั้นช่องนี้จะไปต่อท้ายแถว
   * แล้วไม่ถูกหยิบอีกจนครบรอบถัดไป ทั้งที่ยังไม่ได้ข้อมูลเลย
   */
  it("หยุดเพราะโควตา → ไม่จดว่าดึงแล้ว ช่องยังค้างคิวอยู่", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway({
      "channels.list": () => {
        throw new YouTubeApiError({
          message: "quota",
          reason: "quotaExceeded",
          httpStatus: 403,
        });
      },
    });

    const result = await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
    }).syncChannel(channel());

    expect(result.quotaExhausted).toBe(true);
    expect(repo.fetched).toEqual([]);
    expect(result.th).toContain("โควตา");
  });

  it("ขอเฉพาะช่อง YouTube จากคิว ไม่ปนเพจ Facebook", async () => {
    const repo = new FakeRepo();
    const { gateway } = fakeGateway(happyRoutes());

    await new YouTubeListeningSync({ gateway, repo, clock: new FakeClock(NOW) }).syncDue({
      staleAfterMs: 3_600_000,
      limit: 5,
    });

    expect(repo.lastDueArgs?.platform).toBe("YOUTUBE");
  });
});

describe("กรอบเวลาและเพดาน", () => {
  /**
   * `playlistItems` เรียงใหม่→เก่าเสมอ จึงหยุดได้ทันทีที่เจอตัวแรกที่เก่าเกิน
   * ช่องที่ลงมา 10 ปีมีหลายพันวิดีโอ ไล่หมดคือ 100+ call ทั้งที่ต้องการแค่ 30 วัน
   */
  it("เจอวิดีโอที่เก่ากว่ากรอบ → เลิกไล่หน้าถัดไปทันที", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({
      "channels.list": [channelInfo()],
      "playlistItems.list": [
        {
          items: [
            playlistItem("v1", "2026-08-09T00:00:00Z"),
            playlistItem("เก่าเกิน", "2020-01-01T00:00:00Z"),
          ],
          nextPageToken: "หน้า2",
        },
      ],
      "videos.list": [{ items: [videoStat({ statistics: { commentCount: "0" } })] }],
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      lookbackDays: 30,
    }).syncChannel(channel());

    expect(calls.filter((c) => c.endpoint === "playlistItems.list")).toHaveLength(1);
    expect(String(calls.find((c) => c.endpoint === "videos.list")?.params.id)).toBe("v1");
  });

  /**
   * ลำดับในเพลย์ลิสต์เรียงตาม**วันอัปโหลด** แต่เราเทียบด้วยวันที่**เผยแพร่**
   * — วิดีโอที่อัปไว้เป็นส่วนตัวก่อนแล้วค่อยเปิดทีหลังจะสลับลำดับได้
   *
   * ถ้าหยุดที่ตัวแรกที่เก่า วิดีโอสลับลำดับตัวเดียวที่บังเอิญอยู่หัวรายการ
   * จะทำให้ทั้งช่องไม่ถูกดึงเลย และเงียบสนิทไม่มี error ให้เห็น
   */
  it("วิดีโอเก่าสลับมาอยู่หัวรายการ → ข้ามตัวนั้น ไม่ตัดทิ้งทั้งช่อง", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({
      "channels.list": [channelInfo()],
      "playlistItems.list": [
        {
          items: [
            playlistItem("เก่าสลับมา", "2019-01-01T00:00:00Z"),
            playlistItem("v1", "2026-08-09T00:00:00Z"),
            playlistItem("v2", "2026-08-08T00:00:00Z"),
          ],
        },
      ],
      "videos.list": [{ items: [] }],
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      lookbackDays: 30,
    }).syncChannel(channel());

    const asked = String(calls.find((c) => c.endpoint === "videos.list")?.params.id);
    expect(asked.split(",")).toEqual(["v1", "v2"]);
  });

  it("ถามยอดวิดีโอทีละก้อน 50 id ไม่ใช่ทีละตัว", async () => {
    const repo = new FakeRepo();
    const items = Array.from({ length: 60 }, (_, i) =>
      playlistItem(`v${i}`, "2026-08-09T00:00:00Z"),
    );
    const { gateway, calls } = fakeGateway({
      "channels.list": [channelInfo()],
      "playlistItems.list": [{ items }],
      "videos.list": [{ items: [] }, { items: [] }],
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      maxVideosPerChannel: 60,
    }).syncChannel(channel());

    const videoCalls = calls.filter((c) => c.endpoint === "videos.list");
    expect(videoCalls).toHaveLength(2);
    expect(String(videoCalls[0]?.params.id).split(",")).toHaveLength(50);
    expect(String(videoCalls[1]?.params.id).split(",")).toHaveLength(10);
  });

  it("ไม่ดึงเกินเพดานวิดีโอต่อช่อง", async () => {
    const repo = new FakeRepo();
    const items = Array.from({ length: 50 }, (_, i) =>
      playlistItem(`v${i}`, "2026-08-09T00:00:00Z"),
    );
    const { gateway, calls } = fakeGateway({
      "channels.list": [channelInfo()],
      "playlistItems.list": [{ items, nextPageToken: "อีก" }, { items, nextPageToken: "อีก" }],
      "videos.list": [{ items: [] }],
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      maxVideosPerChannel: 5,
    }).syncChannel(channel());

    expect(calls.filter((c) => c.endpoint === "playlistItems.list")).toHaveLength(1);
    expect(String(calls.find((c) => c.endpoint === "videos.list")?.params.id).split(","))
      .toHaveLength(5);
  });

  it("ไม่ดึงคอมเมนต์เกินเพดานต่อวิดีโอ", async () => {
    const repo = new FakeRepo();
    const many = Array.from({ length: 50 }, (_, i) => thread(`c${i}`, "ดี"));
    const { gateway, calls } = fakeGateway({
      ...happyRoutes(),
      "commentThreads.list": [
        { items: many, nextPageToken: "อีก" },
        { items: many, nextPageToken: "อีก" },
        { items: many, nextPageToken: "อีก" },
      ],
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      maxCommentsPerVideo: 60,
    }).syncChannel(channel());

    expect(calls.filter((c) => c.endpoint === "commentThreads.list")).toHaveLength(2);
    // เพดานคือเพดานจริง ไม่ใช่ "ประมาณนั้น" — หน้าที่สองต้องถูกตัดที่ 60 พอดี
    expect(repo.comments[0]?.comments).toHaveLength(60);
  });

  /**
   * หนึ่งเธรดพ่วง reply มาได้อีก 5 อัน — หน้าละ 50 เธรดจึงเป็นได้ถึง 300
   * คอมเมนต์ ถ้าเช็คเพดานแค่ตอนขึ้นหน้าใหม่ จะทะลุไปหลายเท่า
   */
  it("นับ reply รวมในเพดานด้วย ไม่ใช่นับแค่คอมเมนต์ระดับบน", async () => {
    const repo = new FakeRepo();
    const withReplies = Array.from({ length: 10 }, (_, i) => ({
      ...thread(`c${i}`, "ดี"),
      replies: {
        comments: Array.from({ length: 5 }, (_, j) => ({
          id: `c${i}r${j}`,
          snippet: {
            textOriginal: "จริง",
            publishedAt: "2026-08-07T09:05:00Z",
            authorDisplayName: "คนดู",
            authorChannelId: { value: `UCfan${j}` },
          },
        })),
      },
    }));
    const { gateway } = fakeGateway({
      ...happyRoutes(),
      "commentThreads.list": [{ items: withReplies, nextPageToken: "อีก" }],
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      maxCommentsPerVideo: 12,
    }).syncChannel(channel());

    expect(repo.comments[0]?.comments).toHaveLength(12);
  });

  /**
   * เงื่อนไข "หน้านี้ว่าง" อย่างเดียวไม่พอ — API ที่ตอบมา 50 รายการที่ไม่มี
   * `videoId` เลยพร้อม `nextPageToken` จะทำให้ตัวนับเพดานไม่มีวันถึง
   * แล้ววนขอไปเรื่อยๆ (วัดได้เกิน 2,000 call = โควตาทั้งวันหมดในไม่กี่วินาที)
   */
  it("หน้าที่ใช้อะไรไม่ได้เลย + มีหน้าถัดไป → หยุด ไม่วนไม่รู้จบ", async () => {
    const repo = new FakeRepo();
    const junk = Array.from({ length: 50 }, () => ({ contentDetails: {} }));
    const { gateway, calls } = fakeGateway({
      "channels.list": [channelInfo()],
      "playlistItems.list": () => ({ items: junk, nextPageToken: "ยังมีอีกเรื่อยๆ" }),
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      maxVideosPerChannel: 500,
    }).syncChannel(channel());

    expect(calls.filter((c) => c.endpoint === "playlistItems.list")).toHaveLength(1);
  });

  it("หน้าคอมเมนต์ที่ใช้อะไรไม่ได้เลย → หยุดเช่นกัน", async () => {
    const repo = new FakeRepo();
    const junk = Array.from({ length: 50 }, () => ({ snippet: {} }));
    const { gateway, calls } = fakeGateway({
      ...happyRoutes(),
      "commentThreads.list": () => ({ items: junk, nextPageToken: "ยังมีอีก" }),
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      maxCommentsPerVideo: 500,
    }).syncChannel(channel());

    expect(calls.filter((c) => c.endpoint === "commentThreads.list")).toHaveLength(1);
  });

  it("ไม่มีหน้าถัดไป → หยุด ไม่วนไม่รู้จบ", async () => {
    const repo = new FakeRepo();
    const { gateway, calls } = fakeGateway({
      ...happyRoutes(),
      "commentThreads.list": [{ items: [thread("c1", "ดี")] }],
    });

    await new YouTubeListeningSync({
      gateway,
      repo,
      clock: new FakeClock(NOW),
      maxCommentsPerVideo: 5_000,
    }).syncChannel(channel());

    expect(calls.filter((c) => c.endpoint === "commentThreads.list")).toHaveLength(1);
  });
});
