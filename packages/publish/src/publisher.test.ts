import { describe, expect, it } from "vitest";
import { MetaGateway } from "@page-os/meta";
import { FakeClock } from "@page-os/core";
import { FakeFetch, FakeTokenStore, graphError } from "@page-os/meta/test-helpers";
import { PostPublisher, PublishError } from "./publisher.js";
import type { PostContent } from "./types.js";

function setup() {
  const clock = new FakeClock(1_700_000_000_000);
  const fetchImpl = new FakeFetch();
  const gateway = new MetaGateway(
    {
      appId: "APP",
      appSecret: "SECRET",
      graphVersion: "v25.0",
      rateLimit: { burst: 100, refillPerSec: 100 },
    },
    {
      tokenStore: new FakeTokenStore({ p1: "T1" }),
      clock,
      fetchImpl: fetchImpl.fn,
      random: () => 0,
    },
  );
  return { clock, fetch: fetchImpl, publisher: new PostPublisher(gateway) };
}


/**
 * เช็คข้อความไทยใน `.th` — ตัวที่ผู้ใช้เห็นจริง
 * `rejects.toThrow(/…/)` เทียบกับ `.message` ซึ่งเป็นอังกฤษไว้ debug
 */
async function expectThaiReject(
  p: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).th).toMatch(pattern);
    return;
  }
  expect.unreachable("ควรจะโยน PublishError");
}

const pub = (content: PostContent, body = content.body) => ({
  pageId: "p1",
  content,
  body,
});

describe("PostPublisher — ข้อความและลิงก์", () => {
  it("โพสต์ข้อความไปที่ /feed", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { id: "1_2" } });
    const id = await publisher.publish(pub({ type: "text", body: "สวัสดีครับ" }));
    expect(id).toBe("1_2");
    expect(fetch.lastCall!.url).toContain("p1/feed");
  });

  it("โพสต์ลิงก์แนบ URL ไปด้วย", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { id: "1_2" } });
    await publisher.publish(
      pub({ type: "link", body: "อ่านต่อ", link: "https://example.com/a" }),
    );
    const body = new URLSearchParams(fetch.lastCall!.body!);
    expect(body.get("link")).toBe("https://example.com/a");
    expect(body.get("message")).toBe("อ่านต่อ");
  });

  it("โพสต์ลิงก์ที่ไม่มี URL → error ที่บอกวิธีแก้ ไม่ยิงออกไป", async () => {
    const { publisher, fetch } = setup();
    await expect(publisher.publish(pub({ type: "link", body: "x" }))).rejects.toThrow(
      PublishError,
    );
    expect(fetch.callCount).toBe(0);
  });

  it("รับ post_id หรือ id อย่างใดอย่างหนึ่ง", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { post_id: "999_888" } });
    expect(await publisher.publish(pub({ type: "text", body: "x" }))).toBe("999_888");
  });

  it("Facebook ไม่ส่ง id กลับ → เตือนให้เช็คก่อนลองใหม่ (กันโพสต์ซ้ำ)", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { success: true } });
    await expectThaiReject(
      publisher.publish(pub({ type: "text", body: "x" })),
      /เช็คในเพจ/,
    );
  });
});

describe("PostPublisher — รูปและอัลบั้ม", () => {
  it("รูปเดี่ยวไปที่ /photos พร้อม caption", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { id: "p_1" } });
    await publisher.publish(
      pub({ type: "photo", body: "แคปชั่น", media: [{ url: "https://cdn/a.jpg" }] }),
    );
    const body = new URLSearchParams(fetch.lastCall!.body!);
    expect(fetch.lastCall!.url).toContain("p1/photos");
    expect(body.get("url")).toBe("https://cdn/a.jpg");
    expect(body.get("caption")).toBe("แคปชั่น");
    expect(body.get("published")).toBe("true");
  });

  it("อัลบั้ม: อัปรูปแบบ unpublished ก่อน แล้วแนบเข้าโพสต์เดียว", async () => {
    const { publisher, fetch } = setup();
    fetch.push(
      { json: { id: "ph1" } },
      { json: { id: "ph2" } },
      { json: { id: "post_1" } },
    );

    const id = await publisher.publish(
      pub({
        type: "album",
        body: "อัลบั้มวันนี้",
        media: [{ url: "https://cdn/a.jpg" }, { url: "https://cdn/b.jpg" }],
      }),
    );

    expect(id).toBe("post_1");
    expect(fetch.callCount).toBe(3);
    // สองครั้งแรกต้องเป็น unpublished ไม่งั้นรูปจะโผล่แยกใบในเพจ
    for (const c of fetch.calls.slice(0, 2)) {
      expect(new URLSearchParams(c.body!).get("published")).toBe("false");
    }
    const attached = new URLSearchParams(fetch.calls[2]!.body!).get(
      "attached_media",
    );
    expect(JSON.parse(attached!)).toEqual([
      { media_fbid: "ph1" },
      { media_fbid: "ph2" },
    ]);
  });

  it("อัลบั้มต้องมีอย่างน้อย 2 รูป", async () => {
    const { publisher, fetch } = setup();
    await expectThaiReject(
      publisher.publish(
        pub({ type: "album", body: "x", media: [{ url: "https://cdn/a.jpg" }] }),
      ),
      /อย่างน้อย 2/,
    );
    expect(fetch.callCount).toBe(0);
  });

  it("อัปรูปกลางอัลบั้มพัง → error ที่บอกให้เช็ค URL", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { id: "ph1" } }, { json: {} });
    await expectThaiReject(
      publisher.publish(
        pub({
          type: "album",
          body: "x",
          media: [{ url: "https://cdn/a.jpg" }, { url: "https://cdn/b.jpg" }],
        }),
      ),
      /เปิดสาธารณะ/,
    );
  });

  it("โพสต์รูปที่ไม่มี media → error ก่อนยิง", async () => {
    const { publisher, fetch } = setup();
    await expectThaiReject(
      publisher.publish(pub({ type: "photo", body: "x" })),
      /ต้องมีสื่ออย่างน้อย/,
    );
    expect(fetch.callCount).toBe(0);
  });
});

describe("PostPublisher — วิดีโอและ Reels", () => {
  it("วิดีโอใช้ file_url ให้ Meta ไปดึงเอง", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { id: "v1" } });
    await publisher.publish(
      pub({ type: "video", body: "คำบรรยาย", media: [{ url: "https://cdn/v.mp4" }] }),
    );
    const body = new URLSearchParams(fetch.lastCall!.body!);
    expect(fetch.lastCall!.url).toContain("p1/videos");
    expect(body.get("file_url")).toBe("https://cdn/v.mp4");
    expect(body.get("description")).toBe("คำบรรยาย");
  });

  it("Reels ทำครบ 3 เฟส และเฟสอัปยิงไปคนละโฮสต์", async () => {
    const { publisher, fetch } = setup();
    fetch.push(
      { json: { video_id: "vid_1", upload_url: "https://rupload.facebook.com/x" } },
      { json: { success: true } },
      { json: { success: true } },
    );

    const id = await publisher.publish(
      pub({ type: "reel", body: "รีลวันนี้", media: [{ url: "https://cdn/r.mp4" }] }),
    );

    expect(id).toBe("vid_1");
    expect(fetch.callCount).toBe(3);
    expect(new URLSearchParams(fetch.calls[0]!.body!).get("upload_phase")).toBe(
      "start",
    );
    // เฟสอัปไปที่ rupload พร้อม header file_url และใช้ OAuth ไม่ใช่ Bearer
    expect(fetch.calls[1]!.url).toContain("rupload.facebook.com");
    expect(fetch.calls[1]!.headers["file_url"]).toBe("https://cdn/r.mp4");
    expect(fetch.calls[1]!.headers["authorization"]).toBe("OAuth T1");
    expect(new URLSearchParams(fetch.calls[2]!.body!).get("upload_phase")).toBe(
      "finish",
    );
    expect(new URLSearchParams(fetch.calls[2]!.body!).get("video_state")).toBe(
      "PUBLISHED",
    );
  });

  it("Reels เฟสแรกไม่คืน video_id → หยุดทันที ไม่อัปต่อ", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: {} });
    await expectThaiReject(
      publisher.publish(
        pub({ type: "reel", body: "x", media: [{ url: "https://cdn/r.mp4" }] }),
      ),
      /video_id/,
    );
    expect(fetch.callCount).toBe(1);
  });
});

describe("PostPublisher — Story", () => {
  it("อัปรูปแบบ unpublished แล้วสร้าง story", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { id: "ph1" } }, { json: { id: "story_1" } });
    const id = await publisher.publish(
      pub({ type: "story", body: "", media: [{ url: "https://cdn/s.jpg" }] }),
    );
    expect(id).toBe("story_1");
    expect(new URLSearchParams(fetch.calls[0]!.body!).get("published")).toBe("false");
    expect(fetch.calls[1]!.url).toContain("photo_stories");
  });
});

describe("PostPublisher — ห้าม retry ระดับ HTTP", () => {
  it("โพสต์ที่ล้มเหลวต้องยิงครั้งเดียว (ยิงซ้ำ = โพสต์ซ้ำ)", async () => {
    const { publisher, fetch } = setup();
    fetch.setFallback({ status: 500, text: "" });
    await expect(publisher.publish(pub({ type: "text", body: "x" }))).rejects.toThrow();
    expect(fetch.callCount).toBe(1);
  });
});

describe("findRecentPostByMessage", () => {
  it("เจอโพสต์ที่ข้อความตรงกัน", async () => {
    const { publisher, fetch } = setup();
    fetch.push({
      json: { data: [{ id: "1_9", message: "ข้อความเดิม" }] },
    });
    const r = await publisher.findRecentPostByMessage({
      pageId: "p1",
      message: "ข้อความเดิม",
      sinceMs: 1_700_000_000_000,
    });
    expect(r).toEqual({ status: "found", fbPostId: "1_9" });
  });

  it("ไม่เจอ → not_found", async () => {
    const { publisher, fetch } = setup();
    fetch.push({ json: { data: [{ id: "1_9", message: "อย่างอื่น" }] } });
    expect(
      await publisher.findRecentPostByMessage({
        pageId: "p1",
        message: "ข้อความเดิม",
        sinceMs: 0,
      }),
    ).toEqual({ status: "not_found" });
  });

  it("ยิงไม่ผ่าน → unknown ไม่ใช่ not_found (สำคัญมาก กันโพสต์ซ้ำ)", async () => {
    const { publisher, fetch } = setup();
    fetch.setFallback({ status: 400, json: graphError(32) });
    const r = await publisher.findRecentPostByMessage({
      pageId: "p1",
      message: "ข้อความเดิม",
      sinceMs: 0,
    });
    expect(r.status).toBe("unknown");
  });

  it("โพสต์ที่ไม่มีข้อความ → unknown เพราะเทียบด้วยข้อความไม่ได้", async () => {
    const { publisher, fetch } = setup();
    const r = await publisher.findRecentPostByMessage({
      pageId: "p1",
      message: "   ",
      sinceMs: 0,
    });
    expect(r.status).toBe("unknown");
    expect(fetch.callCount).toBe(0);
  });

  it("ไม่ retry ตอนเช็ค — ตอบ 'ไม่รู้' เร็วๆ ดีกว่ารอนาน", async () => {
    const { publisher, fetch } = setup();
    fetch.setFallback({ status: 500, text: "" });
    await publisher.findRecentPostByMessage({
      pageId: "p1",
      message: "x",
      sinceMs: 0,
    });
    expect(fetch.callCount).toBe(1);
  });
});
