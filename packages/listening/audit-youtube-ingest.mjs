/**
 * Audit เฟส 2 ฝั่ง YouTube — ตัวดึงวิดีโอ + คอมเมนต์
 *
 * เทสต์หน่วยตรวจว่าแต่ละชิ้นทำงานถูกตามที่**เราเขียนไว้** — audit นี้ตรวจว่า
 * ระบบอยู่รอดใน**วันทำงานจริงที่ทุกอย่างพร้อมใจกันไม่เป็นไปตามคาด**
 * ซึ่งเป็นคนละคำถามกัน
 *
 * สามเรื่องที่ถ้าพลาดแล้วเจ็บที่สุด และเป็นแกนของ audit นี้:
 *   1. **เผาโควตา** — ใช้หมดตอนเช้าแล้วตาบอดทั้งวัน กู้ไม่ได้จนเที่ยงคืนแปซิฟิก
 *   2. **ข้อมูลปนแพลตฟอร์ม** — ยิงผิด API เงียบๆ ทุกชั่วโมงโดยไม่มีอะไรฟ้อง
 *   3. **ข้อมูลเสียลง DB** — NaN/undefined ที่ทำให้ทุกช่วงเวลากรองพลาดทั้งตาราง
 *
 *   pnpm build && node packages/listening/audit-youtube-ingest.mjs
 */
import { FakeClock } from "@page-os/core";
import { YouTubeApiError } from "@page-os/youtube";
import { YouTubeListeningSync } from "./dist/index.js";

let fail = 0;
const say = (ok, label, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
};
const section = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 62 - t.length))}`);

const NOW = Date.UTC(2026, 7, 10, 7, 15);

/** ราคาโควตาจริงต่อ endpoint — audit ใช้คำนวณว่าหนึ่งรอบกินไปเท่าไร */
const COST = {
  "channels.list": 1,
  "playlistItems.list": 1,
  "videos.list": 1,
  "commentThreads.list": 1,
  "search.list": 100,
};

const channel = (over = {}) => ({
  id: "tp-1",
  externalId: "UCabc123",
  platform: "YOUTUBE",
  name: "ครัวคุณยาย",
  kind: "OWNED",
  source: "YOUTUBE_API",
  followers: null,
  lastFetchedAtMs: null,
  ...over,
});

class Repo {
  constructor(due = []) {
    this.due = due;
    this.followers = [];
    this.posts = [];
    this.comments = [];
    this.fetched = [];
    this.dueArgs = null;
  }
  async duePages(args) {
    this.dueArgs = args;
    return this.due;
  }
  async saveFollowers(a) {
    this.followers.push(a);
  }
  async savePosts(a) {
    this.posts.push(...a.posts);
    return a.posts.length;
  }
  async saveComments(a) {
    this.comments.push({ externalId: a.externalId, comments: a.comments });
    return a.comments.length;
  }
  async markFetched(a) {
    this.fetched.push(a.trackedPageId);
  }
}

/** gateway ปลอมที่นับโควตาที่ใช้ไปจริงตามราคาของแต่ละ endpoint */
function gw(routes) {
  const calls = [];
  let spent = 0;
  const seen = new Map();
  return {
    calls,
    spent: () => spent,
    gateway: {
      async call(opts) {
        calls.push({ endpoint: opts.endpoint, params: opts.params ?? {} });
        spent += COST[opts.endpoint] ?? 1;
        const r = routes[opts.endpoint];
        if (r === undefined) throw new Error(`ไม่ได้เตรียมคำตอบของ ${opts.endpoint}`);
        const n = seen.get(opts.endpoint) ?? 0;
        seen.set(opts.endpoint, n + 1);
        if (typeof r === "function") return { data: r(n), quota: null };
        return { data: r[n] ?? { items: [] }, quota: null };
      },
    },
  };
}

const chInfo = (over = {}) => ({
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
const plItem = (id, at) => ({ contentDetails: { videoId: id, videoPublishedAt: at } });
const vid = (id, over = {}) => ({
  id,
  snippet: { title: `เรื่อง ${id}`, description: "", publishedAt: "2026-08-09T00:00:00Z" },
  statistics: { viewCount: "9000", likeCount: "10", commentCount: "3" },
  ...over,
});
const thr = (id, over = {}) => ({
  snippet: {
    topLevelComment: {
      id,
      snippet: {
        textOriginal: "ดีมาก",
        publishedAt: "2026-08-09T01:00:00Z",
        authorDisplayName: "คนดู",
        authorChannelId: { value: "UCfan" },
      },
    },
  },
  ...over,
});

const run = (routes, chan = channel(), opts = {}) => {
  const repo = new Repo();
  const g = gw(routes);
  const sync = new YouTubeListeningSync({
    gateway: g.gateway,
    repo,
    clock: new FakeClock(NOW),
    ...opts,
  });
  return { repo, g, go: () => sync.syncChannel(chan), sync };
};

// ═══════════════════════════════════════════════════════════════════════════
section("1. โควตา — ทรัพยากรที่ใช้หมดแล้วหมดเลยจนเที่ยงคืนแปซิฟิก");

{
  // ช่องปกติ: 10 วิดีโอ วิดีโอละ 1 หน้าคอมเมนต์
  const items = Array.from({ length: 10 }, (_, i) => plItem(`v${i}`, "2026-08-09T00:00:00Z"));
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items }],
    "videos.list": [{ items: items.map((_, i) => vid(`v${i}`)) }],
    "commentThreads.list": () => ({ items: [thr("c")] }),
  });
  await r.go();

  const spent = r.g.spent();
  say(spent === 13, "ช่อง 10 วิดีโอกินโควตา 13 หน่วย", `(1+1+1+10 = ${spent})`);

  /**
   * ตัวเลขนี้คือสิ่งที่กำหนดว่า cron เดินได้ถี่แค่ไหน
   * 20 ช่อง × 13 หน่วย × 8 รอบ/วัน = 2,080 — เหลือที่ให้งานที่คนกดเองเยอะ
   * ถ้าเดินทุกชั่วโมง (24 รอบ) = 6,240 ซึ่งเกินครึ่งโควตาไปกับการถามซ้ำ
   */
  const perDay8 = spent * 20 * 8;
  const perDay24 = spent * 20 * 24;
  say(perDay8 < 8_500, "20 ช่อง ทุก 3 ชม. อยู่ในโควตา", `${perDay8}/10000 หน่วย`);
  say(perDay24 > 5_000, "…ถ้าเดินทุกชั่วโมงจะกินเกินครึ่ง", `${perDay24}/10000 — จึงตั้ง 3 ชม. ถูกแล้ว`);
}

{
  const items = Array.from({ length: 10 }, (_, i) => plItem(`v${i}`, "2026-08-09T00:00:00Z"));
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items }],
    "videos.list": [{ items: items.map((_, i) => vid(`v${i}`, { statistics: { commentCount: "0" } })) }],
  });
  await r.go();
  say(r.g.spent() === 3, "วิดีโอที่ไม่มีคอมเมนต์เลย ไม่เสียโควตาไปถาม", `${r.g.spent()} หน่วย`);
}

{
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items: [plItem("v1", "2026-08-09T00:00:00Z")] }],
    "videos.list": [{ items: [vid("v1")] }],
    "commentThreads.list": [{ items: [thr("c1")] }],
  });
  await r.go();
  const used = new Set(r.g.calls.map((c) => c.endpoint));
  say(!used.has("search.list"), "ไม่แตะ search.list (ราคา 100 = โควตาหมดใน 100 ครั้ง)");
  say(
    [...used].every((e) => COST[e] === 1),
    "ทุก endpoint ที่ใช้ราคา 1 หน่วย",
    [...used].join(", "),
  );
}

{
  // โควตาหมดที่ช่องที่ 2 — ช่องที่ 3–5 ต้องไม่ถูกยิงเลย
  const repo = new Repo([
    channel({ id: "a", externalId: "UCa" }),
    channel({ id: "b", externalId: "UCb" }),
    channel({ id: "c", externalId: "UCc" }),
    channel({ id: "d", externalId: "UCd" }),
    channel({ id: "e", externalId: "UCe" }),
  ]);
  const g = gw({
    "channels.list": (n) => {
      if (n === 0) return chInfo();
      throw new YouTubeApiError({ message: "q", reason: "quotaExceeded", httpStatus: 403 });
    },
    "playlistItems.list": [{ items: [] }],
  });
  const out = await new YouTubeListeningSync({
    gateway: g.gateway,
    repo,
    clock: new FakeClock(NOW),
  }).syncDue({ staleAfterMs: 1, limit: 10 });

  say(out.length === 2, "โควตาหมด → หยุดทั้งรอบทันที", `ดึงไป ${out.length}/5 ช่อง`);
  say(
    g.calls.filter((c) => c.endpoint === "channels.list").length === 2,
    "ไม่ยิงต่อให้ครบทุกช่อง (call ที่โดนปฏิเสธยังกินโควตา)",
  );
  say(repo.fetched.length === 1, "ช่องที่หยุดกลางคันไม่ถูกจดว่าดึงแล้ว", `จดไป ${repo.fetched.length}`);
  say(
    !repo.fetched.includes("b"),
    "…ช่อง b ยังค้างคิว รอโควตากลับมาแล้วถูกหยิบก่อนใคร",
  );
}

{
  // โควตาหมดตอนดึงคอมเมนต์วิดีโอที่ 3 จาก 10 → ต้องหยุด ไม่ไล่ต่ออีก 7
  const items = Array.from({ length: 10 }, (_, i) => plItem(`v${i}`, "2026-08-09T00:00:00Z"));
  let n = 0;
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items }],
    "videos.list": [{ items: items.map((_, i) => vid(`v${i}`)) }],
    "commentThreads.list": () => {
      n += 1;
      if (n >= 3) {
        throw new YouTubeApiError({ message: "q", reason: "quotaExceeded", httpStatus: 403 });
      }
      return { items: [thr(`c${n}`)] };
    },
  });
  const res = await r.go();
  const asked = r.g.calls.filter((c) => c.endpoint === "commentThreads.list").length;
  say(res.quotaExhausted === true, "โควตาหมดกลางการดึงคอมเมนต์ → ตั้งธงบอกตัวเรียก");
  say(asked === 3, "หยุดที่วิดีโอที่ 3 ไม่ไล่ต่ออีก 7 ตัว", `ยิงไป ${asked}/10`);
  say(res.commentsWritten === 2, "ของที่ดึงมาได้ก่อนหยุด ถูกเก็บไว้ ไม่ทิ้ง", `${res.commentsWritten} คอมเมนต์`);
}

// ═══════════════════════════════════════════════════════════════════════════
section("2. ข้อมูลปนแพลตฟอร์ม — ยิงผิด API เงียบๆ ทุกชั่วโมง");

{
  const r = run({}, channel({ platform: "FACEBOOK", source: "META_API" }));
  const res = await r.go();
  say(r.g.calls.length === 0, "เพจ Facebook หลุดเข้ามา → ไม่ยิง YouTube API เลยสักครั้ง");
  say(res.th.includes("ไม่ใช่ช่อง YouTube"), "…และบอกสาเหตุที่ถูก ไม่ใช่ 'มาจากแหล่งภายนอก'");
}

{
  const repo = new Repo();
  const g = gw({ "channels.list": [chInfo()], "playlistItems.list": [{ items: [] }] });
  await new YouTubeListeningSync({
    gateway: g.gateway,
    repo,
    clock: new FakeClock(NOW),
  }).syncDue({ staleAfterMs: 1, limit: 5 });
  say(repo.dueArgs?.platform === "YOUTUBE", "ขอคิวเฉพาะแพลตฟอร์ม YOUTUBE", `ขอ ${repo.dueArgs?.platform}`);
}

{
  const r = run({}, channel({ source: "EXTERNAL" }));
  const res = await r.go();
  say(r.g.calls.length === 0, "ช่องที่ตั้งเป็นแหล่งภายนอก ไม่ถูกยิงผ่าน API");
  say(res.th.includes("แหล่งภายนอก"), "…และบอกว่าเพราะตั้งค่าไว้แบบนั้น");
}

// ═══════════════════════════════════════════════════════════════════════════
section("3. ข้อมูลเสียลง DB — NaN / undefined ที่ทำให้กรองเวลาพลาดทั้งตาราง");

{
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [
      {
        items: [
          plItem("ดี", "2026-08-09T00:00:00Z"),
          plItem(undefined, "2026-08-09T00:00:00Z"),
          plItem("ไม่มีเวลา", undefined),
          plItem("เวลาเพี้ยน", "เมื่อวานตอนบ่าย"),
        ],
      },
    ],
    "videos.list": [{ items: [vid("ดี", { statistics: { commentCount: "0" } })] }],
  });
  await r.go();
  const askedIds = String(r.g.calls.find((c) => c.endpoint === "videos.list")?.params.id);
  say(askedIds === "ดี", "วิดีโอที่ไม่มี id / ไม่มีเวลา / เวลาเพี้ยน ถูกทิ้งตั้งแต่ต้นทาง", askedIds);
}

{
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items: [plItem("v1", "2026-08-09T00:00:00Z")] }],
    "videos.list": [
      {
        items: [
          vid("v1", { statistics: { likeCount: undefined, commentCount: undefined } }),
        ],
      },
    ],
  });
  await r.go();
  const p = r.repo.posts[0];
  const clean =
    Number.isFinite(p.reactions) &&
    Number.isFinite(p.commentCount) &&
    Number.isFinite(p.publishedAtMs) &&
    p.shares === 0;
  say(clean, "สถิติที่หายไป → 0 ไม่ใช่ NaN", JSON.stringify({ r: p.reactions, c: p.commentCount }));
}

{
  const r = run({
    "channels.list": [chInfo({ statistics: { hiddenSubscriberCount: true, subscriberCount: "0" } })],
    "playlistItems.list": [{ items: [] }],
  });
  const res = await r.go();
  say(r.repo.followers.length === 0, "ช่องที่ซ่อนยอดผู้ติดตาม → ไม่บันทึกเป็น 0 (กราฟไม่ดิ่ง)");
  say(res.followers === null, "…และรายงานกลับเป็น null (ไม่รู้) ไม่ใช่ศูนย์");
}

{
  const r = run({
    "channels.list": [chInfo({ statistics: { subscriberCount: "" } })],
    "playlistItems.list": [{ items: [] }],
  });
  await r.go();
  say(r.repo.followers.length === 0, 'subscriberCount เป็นสตริงว่าง → ไม่บันทึก (ไม่ใช่ Number("")=0)');
}

{
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items: [plItem("v1", "2026-08-09T00:00:00Z")] }],
    "videos.list": [{ items: [vid("v1")] }],
    "commentThreads.list": [
      {
        items: [
          thr("c1"),
          { snippet: { topLevelComment: { id: undefined, snippet: {} } } },
          { snippet: {} },
          {},
        ],
      },
    ],
  });
  await r.go();
  const got = r.repo.comments[0].comments;
  say(got.length === 1, "คอมเมนต์ที่โครงสร้างพัง ถูกทิ้ง ไม่ทำให้ทั้งวิดีโอล้ม", `เก็บ ${got.length}/4`);
  say(Number.isFinite(got[0].createdAtMs), "…และตัวที่เก็บมีเวลาที่ใช้ได้จริง");
}

// ═══════════════════════════════════════════════════════════════════════════
section("4. ของที่ผิดปกติแต่เกิดขึ้นจริงทุกวัน");

{
  const r = run({ "channels.list": [{ items: [] }] });
  const res = await r.go();
  say(res.errors.length === 1, "รหัสช่องผิด (API ตอบ 200 + items ว่าง) → ขึ้นเป็นปัญหา");
  say(res.errors[0].includes("UC"), "…พร้อมบอกว่ารหัสช่องต้องขึ้นต้นด้วย UC");
  say(r.repo.fetched.length === 1, "…แต่ยังจดว่าดึงแล้ว ไม่ค้างหัวคิวตลอดกาล");
  say(r.g.calls.length === 1, "…และไม่ยิงต่อไปที่ playlistItems ทั้งที่ยังไม่รู้ playlist id");
}

{
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items: [plItem("v1", "2026-08-09T00:00:00Z")] }],
    "videos.list": [{ items: [vid("v1")] }],
    "commentThreads.list": () => {
      throw new YouTubeApiError({
        message: "disabled",
        reason: "commentsDisabled",
        httpStatus: 403,
      });
    },
  });
  const res = await r.go();
  say(res.errors.length === 0, "วิดีโอที่ปิดคอมเมนต์ → ไม่นับเป็นปัญหา (ไม่ใช่ความผิดเรา)");
  say(res.th.includes("เรียบร้อย"), "…และสรุปว่าดึงเรียบร้อย ไม่ขึ้นเตือนสีแดงตลอดกาล");
}

{
  // วิดีโอตัวแรกคอมเมนต์พัง (500) ตัวที่สองต้องยังดึงได้
  let n = 0;
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [
      { items: [plItem("v1", "2026-08-09T00:00:00Z"), plItem("v2", "2026-08-08T00:00:00Z")] },
    ],
    "videos.list": [{ items: [vid("v1"), vid("v2")] }],
    "commentThreads.list": () => {
      n += 1;
      if (n === 1) throw new YouTubeApiError({ message: "boom", httpStatus: 500 });
      return { items: [thr("c2")] };
    },
  });
  const res = await r.go();
  say(res.commentsWritten === 1, "วิดีโอหนึ่งพัง วิดีโออื่นยังดึงต่อ", `ได้ ${res.commentsWritten} คอมเมนต์`);
  say(res.errors.length === 1, "…และรายงานว่ามี 1 เรื่องที่พลาด ไม่กลบ");
  say(r.repo.fetched.length === 1, "…และยังจดว่าดึงรอบนี้แล้ว");
}

{
  const r = run({ "channels.list": [chInfo({ contentDetails: {} })] });
  const res = await r.go();
  say(res.errors[0]?.includes("ยังไม่เคยลงวิดีโอ"), "ช่องที่ไม่มีเพลย์ลิสต์อัปโหลด → บอกสาเหตุที่คนเข้าใจ");
}

// ═══════════════════════════════════════════════════════════════════════════
section("5. เพดาน — กันช่องเดียวกินโควตาของทั้งระบบ");

{
  // ช่องที่ลงมา 10 ปี: หน้าละ 50 ไม่มีวันจบ ถ้าไม่มีเพดานจะวนไม่รู้จบ
  const page = Array.from({ length: 50 }, (_, i) => plItem(`v${i}`, "2026-08-09T00:00:00Z"));
  const r = run(
    {
      "channels.list": [chInfo()],
      "playlistItems.list": () => ({ items: page, nextPageToken: "ต่อไปเรื่อยๆ" }),
      "videos.list": () => ({ items: [] }),
    },
    channel(),
    { maxVideosPerChannel: 20 },
  );
  await r.go();
  const pl = r.g.calls.filter((c) => c.endpoint === "playlistItems.list").length;
  const ids = String(r.g.calls.find((c) => c.endpoint === "videos.list")?.params.id).split(",");
  say(pl === 1, "เพลย์ลิสต์ที่ไม่มีวันจบ → หยุดที่เพดาน ไม่วนไม่รู้จบ", `${pl} call`);
  say(ids.length === 20, "…และไม่เกินเพดานแม้ API ส่งมาเกินที่ขอ", `${ids.length}/20`);
}

{
  // API ส่งมา 50 ทั้งที่ขอ 5 — เกินหลัก 50 จะกลายเป็น videos.list เพิ่มอีก call
  const page = Array.from({ length: 50 }, (_, i) => plItem(`v${i}`, "2026-08-09T00:00:00Z"));
  const r = run(
    {
      "channels.list": [chInfo()],
      "playlistItems.list": [{ items: page }],
      "videos.list": [{ items: [] }],
    },
    channel(),
    { maxVideosPerChannel: 5 },
  );
  await r.go();
  const ids = String(r.g.calls.find((c) => c.endpoint === "videos.list")?.params.id).split(",");
  say(ids.length === 5, "maxResults เป็นแค่คำขอ ไม่ใช่สัญญา → ตัดเองที่ฝั่งเรา", `${ids.length}/5`);
}

{
  const many = Array.from({ length: 10 }, (_, i) => ({
    ...thr(`c${i}`),
    replies: {
      comments: Array.from({ length: 5 }, (_, j) => ({
        id: `c${i}r${j}`,
        snippet: {
          textOriginal: "จริง",
          publishedAt: "2026-08-09T02:00:00Z",
          authorDisplayName: "คนดู",
          authorChannelId: { value: `UCf${j}` },
        },
      })),
    },
  }));
  const r = run(
    {
      "channels.list": [chInfo()],
      "playlistItems.list": [{ items: [plItem("v1", "2026-08-09T00:00:00Z")] }],
      "videos.list": [{ items: [vid("v1")] }],
      "commentThreads.list": [{ items: many, nextPageToken: "อีก" }],
    },
    channel(),
    { maxCommentsPerVideo: 12 },
  );
  await r.go();
  const got = r.repo.comments[0].comments.length;
  say(got === 12, "หนึ่งเธรดพ่วง reply 5 อัน → ยังไม่ทะลุเพดาน", `${got}/12 (ถ้าไม่กันจะได้ 60)`);
}

{
  // เจอวิดีโอเก่ากว่ากรอบ → เลิกไล่หน้าถัดไป (ช่องเก่า 10 ปี = 100+ call ถ้าไล่หมด)
  const r = run(
    {
      "channels.list": [chInfo()],
      "playlistItems.list": [
        {
          items: [plItem("ใหม่", "2026-08-09T00:00:00Z"), plItem("เก่า", "2019-01-01T00:00:00Z")],
          nextPageToken: "ยังมีอีก",
        },
      ],
      "videos.list": [{ items: [] }],
    },
    channel(),
    { lookbackDays: 30 },
  );
  await r.go();
  const pl = r.g.calls.filter((c) => c.endpoint === "playlistItems.list").length;
  say(pl === 1, "เจอวิดีโอเก่ากว่ากรอบ → เลิกไล่หน้าถัดไปทันที", `${pl} call`);
}

// ═══════════════════════════════════════════════════════════════════════════
section("6. บั๊กที่รอบตรวจซ้ำจับได้ — ต้องไม่กลับมาอีก");

{
  /**
   * 🔴 ช่องที่ข้ามแล้วไม่จด `markFetched` จะยึดหัวคิวไว้ตลอดกาล
   * (คิวเรียง lastFetchedAt เก่าสุดก่อน + null มาก่อนเพื่อน)
   * มีช่องแบบนี้ครบเท่า limit เมื่อไหร่ ช่องจริงจะไม่ถูกดึงเลยสักครั้ง
   */
  const db = [
    ...Array.from({ length: 3 }, (_, i) => channel({ id: `ext${i}`, source: "EXTERNAL" })),
    channel({ id: "จริง", source: "YOUTUBE_API" }),
  ];
  const repo = {
    async duePages({ limit }) {
      return [...db]
        .sort((a, b) => (a.lastFetchedAtMs ?? -1) - (b.lastFetchedAtMs ?? -1))
        .slice(0, limit);
    },
    async saveFollowers() {},
    async savePosts(a) {
      return a.posts.length;
    },
    async saveComments(a) {
      return a.comments.length;
    },
    async markFetched({ trackedPageId, atMs }) {
      const row = db.find((p) => p.id === trackedPageId);
      if (row !== undefined) row.lastFetchedAtMs = atMs;
    },
  };
  const g = gw({ "channels.list": [chInfo()], "playlistItems.list": [{ items: [] }] });
  const sync = new YouTubeListeningSync({
    gateway: g.gateway,
    repo,
    clock: new FakeClock(NOW),
  });

  const r1 = await sync.syncDue({ staleAfterMs: 1, limit: 3 });
  const r2 = await sync.syncDue({ staleAfterMs: 1, limit: 3 });
  say(
    r1.every((r) => r.trackedPageId.startsWith("ext")),
    "รอบแรกเต็มไปด้วยช่องที่ต้องข้าม (ตามคิว)",
  );
  say(
    r2.some((r) => r.trackedPageId === "จริง"),
    "รอบถัดไปช่องจริงได้คิว — ช่องที่ข้ามไม่ยึดหัวคิวไว้ตลอดกาล",
    r2.map((r) => r.trackedPageId).join(", "),
  );
}

{
  /**
   * 🟠 หน้าที่มีแต่ของเสีย + nextPageToken → ตัวนับเพดานไม่มีวันถึง
   * เคยวนได้เกิน 2,000 call = โควตาทั้งวันหมดในไม่กี่วินาที
   */
  const junk = Array.from({ length: 50 }, () => ({ contentDetails: {} }));
  const r = run(
    {
      "channels.list": [chInfo()],
      "playlistItems.list": () => ({ items: junk, nextPageToken: "ยังมีอีกเรื่อยๆ" }),
    },
    channel(),
    { maxVideosPerChannel: 500 },
  );
  await r.go();
  const n = r.g.calls.filter((c) => c.endpoint === "playlistItems.list").length;
  say(n === 1, "หน้าที่ใช้อะไรไม่ได้เลย → หยุด ไม่วนไม่รู้จบ", `${n} call (เคยวนเกิน 2000)`);
}

{
  const junk = Array.from({ length: 50 }, () => ({ snippet: {} }));
  const r = run(
    {
      "channels.list": [chInfo()],
      "playlistItems.list": [{ items: [plItem("v1", "2026-08-09T00:00:00Z")] }],
      "videos.list": [{ items: [vid("v1")] }],
      "commentThreads.list": () => ({ items: junk, nextPageToken: "อีก" }),
    },
    channel(),
    { maxCommentsPerVideo: 500 },
  );
  await r.go();
  const n = r.g.calls.filter((c) => c.endpoint === "commentThreads.list").length;
  say(n === 1, "…หน้าคอมเมนต์ก็เหมือนกัน", `${n} call`);
}

{
  /**
   * 🟠 ลำดับในเพลย์ลิสต์เรียงตามวันอัปโหลด แต่เราเทียบด้วยวันที่เผยแพร่
   * วิดีโอที่อัปไว้เป็นส่วนตัวก่อนแล้วค่อยเปิดทีหลังจะสลับลำดับได้
   * ถ้าหยุดที่ตัวแรกที่เก่า ช่องนั้นจะไม่ถูกดึงเลยและเงียบสนิท
   */
  const r = run(
    {
      "channels.list": [chInfo()],
      "playlistItems.list": [
        {
          items: [
            plItem("เก่าสลับมาอยู่หัว", "2019-01-01T00:00:00Z"),
            plItem("v1", "2026-08-09T00:00:00Z"),
            plItem("v2", "2026-08-08T00:00:00Z"),
          ],
        },
      ],
      "videos.list": [{ items: [] }],
    },
    channel(),
    { lookbackDays: 30 },
  );
  await r.go();
  const asked = String(r.g.calls.find((c) => c.endpoint === "videos.list")?.params.id);
  say(asked === "v1,v2", "วิดีโอเก่าสลับมาหัวรายการ → ข้ามตัวนั้น ไม่ตัดทิ้งทั้งช่อง", asked);
}

// ═══════════════════════════════════════════════════════════════════════════
section("7. ความลับต้องไม่หลุด และเวลาต้องมาจาก Clock");

{
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items: [plItem("v1", "2026-08-09T00:00:00Z")] }],
    "videos.list": [{ items: [vid("v1", { statistics: { commentCount: "0" } })] }],
  });
  await r.go();
  const dump = JSON.stringify(r.g.calls);
  const leaked = ["key", "access_token", "apiKey"].filter((k) => dump.includes(`"${k}"`));
  say(leaked.length === 0, "ตัวดึงไม่ส่งคีย์/โทเคนลงพารามิเตอร์เอง (gateway จัดการที่เดียว)", leaked.join(", "));
}

{
  const r = run({
    "channels.list": [chInfo()],
    "playlistItems.list": [{ items: [] }],
  });
  await r.go();
  say(
    r.repo.followers[0]?.dateKey === "2026-08-10",
    "วันที่ของ snapshot มาจาก Clock ที่ฉีดเข้ามา ไม่ใช่เวลาจริงของเครื่อง",
    r.repo.followers[0]?.dateKey,
  );
}

{
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./src/youtube-ingest.ts", import.meta.url), "utf8"),
  );
  const bare = /new Date\(\s*\)/.test(src);
  const nowCall = /Date\.now\(\)/.test(src);
  say(!bare && !nowCall, "ไม่มี new Date() / Date.now() ในโค้ดจริง (เทสต์ล็อกเวลาได้)");
  say(!/search\.list/.test(src.replace(/^[\s\S]*?\*\//, "")), "ไม่มีสตริง search.list นอกคอมเมนต์อธิบาย");
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(
  fail === 0
    ? `\n✓ ผ่านทั้งหมด — ตัวดึง YouTube พร้อมใช้\n`
    : `\n✗ มี ${fail} ข้อที่ไม่ผ่าน — ต้องแก้ก่อนไปเฟสถัดไป\n`,
);
process.exit(fail === 0 ? 0 : 1);
