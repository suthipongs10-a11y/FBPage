/**
 * Audit เฟส 4 — ซ่อน/ลบคอมเมนต์ YouTube
 *
 * เฟสนี้ต่างจากสามเฟสก่อนตรงที่ **ทำผิดแล้วกู้คืนไม่ได้** และ **แพง**:
 * หนึ่ง call ราคา 50 หน่วยจากโควตาวันละ 10,000 — ยิงผิด 200 ครั้งก็หมดวัน
 * และคอมเมนต์ที่ลบไปแล้วไม่มีทางเอากลับมา
 *
 * สามเรื่องที่ audit นี้ตรวจเป็นหลัก:
 *   1. **ราคา** — ยิงเป็นก้อนจริงไหม หรือแอบยิงทีละอันจนโควตาหมด
 *   2. **หยุดเป็น** — โควตาหมดแล้วยังไล่ยิงต่ออีกไหม
 *   3. **ความลับ** — client secret / refresh token หลุดเข้า error หรือ log ไหม
 *
 *   pnpm build && node packages/youtube/audit-moderation.mjs
 */
import { FakeClock } from "@page-os/core";
import {
  GoogleOAuth,
  MODERATION_BATCH,
  YouTubeApiError,
  YouTubeCommentActions,
} from "./dist/index.js";

let fail = 0;
const say = (ok, label, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
};
const section = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`);

const COST = 50;
const ids = (n, p = "c") => Array.from({ length: n }, (_, i) => `${p}${i}`);

function actionsWith(throwOn) {
  const calls = [];
  let n = 0;
  const gateway = {
    async call(o) {
      n += 1;
      calls.push({ ...o, params: o.params ?? {} });
      const e = throwOn?.(n);
      if (e !== undefined) throw e;
      return { data: {}, quota: null };
    },
  };
  return {
    calls,
    actions: new YouTubeCommentActions({ gateway, accessToken: async () => "tok" }),
  };
}

const ours = { id: "UCours", owned: true };

const quotaErr = () =>
  new YouTubeApiError({ message: "q", reason: "quotaExceeded", httpStatus: 403 });

// ═══════════════════════════════════════════════════════════════════════════
section("1. ราคา — 50 หน่วยต่อ call จากโควตาวันละ 10,000");

{
  const { actions, calls } = actionsWith();
  const r = await actions.hide({ commentIds: ids(50), channel: ours });
  say(calls.length === 1, "ซ่อน 50 อัน = ยิงครั้งเดียว", `${calls.length} call`);
  say(r.quotaSpent === 50, "…ราคา 50 หน่วย ไม่ใช่ 2,500", `${r.quotaSpent} หน่วย`);
  say(
    r.th.includes("2500"),
    "…และบอกในสรุปว่าถ้ายิงทีละอันจะแพงกว่าเท่าไร",
  );
}

{
  const { actions, calls } = actionsWith();
  const r = await actions.hide({ commentIds: ids(500), channel: ours });
  const expected = Math.ceil(500 / MODERATION_BATCH);
  say(calls.length === expected, `ซ่อน 500 อัน = ${expected} call`, `${calls.length} call`);
  say(r.quotaSpent === expected * COST, "…รวม 500 หน่วย", `${r.quotaSpent} หน่วย`);
  // ยิงทีละอันจะเป็น 25,000 หน่วย = เกินโควตาทั้งวันสองเท่าครึ่ง
  say(r.quotaSpent < 10_000, "…ยังอยู่ในโควตาวันเดียว (ทีละอันจะใช้ 25,000)");
}

{
  const { actions, calls } = actionsWith();
  const r = await actions.hide({ commentIds: [...ids(50), ...ids(50), ...ids(50)], channel: ours });
  say(calls.length === 1, "id ซ้ำสามชุด → ยังยิงครั้งเดียว", `${calls.length} call`);
  say(r.quotaSpent === 50, "…ไม่จ่ายโควตาเกินเพราะของซ้ำ", `${r.quotaSpent} หน่วย`);
}

{
  const { actions, calls } = actionsWith();
  const r = await actions.hide({ commentIds: [], channel: ours });
  say(calls.length === 0 && r.quotaSpent === 0, "ไม่มีอะไรให้ทำ → ไม่เสียโควตาเลย");
}

// ═══════════════════════════════════════════════════════════════════════════
section("2. หยุดเป็น — ยิงต่อตอนโควตาหมดคือเผาของพรุ่งนี้ทิ้ง");

{
  const { actions, calls } = actionsWith((n) => (n === 2 ? quotaErr() : undefined));
  const r = await actions.hide({ commentIds: ids(500), channel: ours });
  say(calls.length === 2, "โควตาหมดที่ก้อน 2 → หยุดทันที ไม่ยิงอีก 8 ก้อน", `${calls.length}/10`);
  say(r.done === 50, "…ของที่ทำสำเร็จแล้วยังนับให้", `${r.done} อัน`);
  say(r.th.includes("โควตาหมด") && r.th.includes("แปซิฟิก"), "…และบอกว่าต้องรอถึงเมื่อไหร่");
}

{
  const { actions, calls } = actionsWith((n) =>
    n === 2 ? new YouTubeApiError({ message: "boom", httpStatus: 500 }) : undefined,
  );
  const r = await actions.hide({ commentIds: ids(150), channel: ours });
  say(calls.length === 3, "ก้อนเดียวพังเพราะเซิร์ฟเวอร์ → ก้อนอื่นยังทำต่อ", `${calls.length}/3`);
  say(r.done === 100, "…ได้ 100 จาก 150 ไม่ใช่ 0", `${r.done}`);
  say(r.errors.length === 1, "…และรายงานว่าพลาดไปกี่ก้อน ไม่กลบ");
}

{
  const { actions, calls } = actionsWith((n) => (n === 3 ? quotaErr() : undefined));
  const r = await actions.remove({ commentIds: ids(10), channel: ours });
  say(calls.length === 3, "ลบทีละอัน โควตาหมดกลางทาง → หยุด", `${calls.length}/10`);
  say(r.done === 2, "…ลบไปได้ 2 อันก่อนหยุด", `${r.done}`);
}

// ═══════════════════════════════════════════════════════════════════════════
section("3. การลบ — กู้คืนไม่ได้ และแพงกว่าการซ่อน 50 เท่า");

{
  const { actions, calls } = actionsWith();
  const r = await actions.remove({ commentIds: ids(100), channel: ours });
  say(calls.length === 0, "ขอลบ 100 อัน → ไม่ยิงเลย (เกินเพดานกันมือลั่น)");
  say(r.th.includes("5000"), "…บอกราคาที่จะเสียเป็นตัวเลข", "5,000 หน่วย = ครึ่งวัน");
  say(r.th.includes("ซ่อน"), "…และเสนอทางเลือกที่ถูกกว่าและกู้คืนได้");
}

{
  const { actions, calls } = actionsWith();
  await actions.remove({ commentIds: ids(3), channel: ours });
  say(
    calls.every((c) => c.method === "DELETE"),
    "ลบใช้ method DELETE",
  );
  say(
    calls.every((c) => String(c.params.id).indexOf(",") < 0),
    "…และส่งทีละ id เพราะ API ไม่รับเป็นก้อน (ต่างจากการซ่อน)",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
section("4. สถานะและสิทธิ์ที่ส่งไปต้องถูก");

{
  const { actions, calls } = actionsWith();
  await actions.hide({ commentIds: ["c1"], channel: ours });
  await actions.unhide({ commentIds: ["c2"], channel: ours });
  await actions.holdForReview({ commentIds: ["c3"], channel: ours });
  const got = calls.map((c) => c.params.moderationStatus);
  say(
    JSON.stringify(got) === JSON.stringify(["rejected", "published", "heldForReview"]),
    "ซ่อน/ปล่อย/พักรอตรวจ ส่งสถานะถูกทั้งสามแบบ",
    got.join(", "),
  );
  say(
    calls.every((c) => c.endpoint === "comments.setModerationStatus"),
    "…ผ่าน endpoint เดียวกันทั้งหมด",
  );
}

{
  const { actions, calls } = actionsWith();
  await actions.unhide({ commentIds: ["c1"], channel: ours });
  await actions.holdForReview({ commentIds: ["c2"], channel: ours });
  say(
    calls.every((c) => !("banAuthor" in c.params)),
    "banAuthor ไม่หลุดไปกับสถานะที่ไม่ใช่ rejected (Google จะปฏิเสธทั้ง call)",
  );
}

{
  const { actions, calls } = actionsWith();
  await actions.hide({ commentIds: ids(120), channel: ours });
  say(
    calls.every((c) => c.accessToken === "tok"),
    "แนบโทเคน OAuth ทุกก้อน — API key เขียนอะไรไม่ได้",
  );
  say(
    calls.every((c) => c.background === false),
    "ไม่ใช่งานเบื้องหลัง จึงไม่โดนเบรกด้วยโควตาสำรอง (คนกดปุ่มรออยู่)",
  );
}

{
  // gateway ตัวจริง ต้องปฏิเสธการเขียนที่ไม่มีโทเคนก่อนจะเสียโควตา
  const { YouTubeGateway } = await import("./dist/index.js");
  let fetched = 0;
  const gw = new YouTubeGateway(
    { apiKey: "k", apiBase: "https://x.test/v3" },
    {
      clock: new FakeClock(0),
      fetchImpl: async () => {
        fetched += 1;
        return { ok: true, status: 200, json: async () => ({}) };
      },
    },
  );
  let threw = null;
  try {
    await gw.call({
      endpoint: "comments.setModerationStatus",
      method: "POST",
      params: { id: "c1", moderationStatus: "rejected" },
    });
  } catch (e) {
    threw = e;
  }
  say(threw !== null, "เขียนโดยไม่มีโทเคน → ถูกปฏิเสธ");
  say(fetched === 0, "…และไม่ยิงออกไปเลย จึงไม่เสียโควตา 50 หน่วยไปฟรีๆ");
  say(threw?.action === "reconnect", "…พร้อมบอกว่าต้องไปเชื่อมบัญชี", threw?.action);
}

{
  // ชื่อ endpoint ที่มี action ต่อท้าย ต้องกลายเป็น path ที่ถูก
  const { YouTubeGateway } = await import("./dist/index.js");
  let seen = "";
  const gw = new YouTubeGateway(
    { apiKey: "k", apiBase: "https://x.test/v3" },
    {
      clock: new FakeClock(0),
      fetchImpl: async (url) => {
        seen = String(url);
        return { ok: true, status: 200, json: async () => ({}) };
      },
    },
  );
  await gw.call({
    endpoint: "comments.setModerationStatus",
    method: "POST",
    accessToken: "t",
    params: { id: "c1" },
  });
  say(
    seen.includes("/comments/setModerationStatus"),
    "comments.setModerationStatus → path /comments/setModerationStatus",
    seen.split("?")[0],
  );
  say(
    !seen.endsWith("/comments"),
    "…ไม่ใช่ POST /comments เฉยๆ (ซึ่งแปลว่า 'สร้างคอมเมนต์ใหม่')",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
section("5. ช่องที่ไม่ใช่ของเรา — ยิงไปก็เสียโควตาเปล่า");

{
  const theirs = { id: "UCtheirs", owned: false };
  const { actions, calls } = actionsWith();
  const r = await actions.hide({ commentIds: ids(200), channel: theirs });
  say(calls.length === 0, "ซ่อน 200 อันบนช่องคนอื่น → ไม่ยิงเลยสักครั้ง", `${calls.length} call`);
  say(r.quotaSpent === 0, "…ไม่เสียโควตา (ถ้ายิงจะหายไป 200 หน่วย)", `${r.quotaSpent} หน่วย`);
  say(r.th.includes("เจ้าของ"), "…และบอกเหตุผลที่คนอ่านเข้าใจ");

  const { actions: a2, calls: c2 } = actionsWith();
  await a2.unhide({ commentIds: ["c1"], channel: theirs });
  await a2.holdForReview({ commentIds: ["c1"], channel: theirs });
  await a2.remove({ commentIds: ["c1"], channel: theirs });
  say(c2.length === 0, "…ทุกวิธีดักเหมือนกัน ไม่ใช่แค่การซ่อน");
}

// ═══════════════════════════════════════════════════════════════════════════
section("6. ความลับต้องไม่หลุด (กฎข้อ 3)");

{
  const clock = new FakeClock(0);
  const oauth = new GoogleOAuth(
    { clientId: "CID_LAB", clientSecret: "SECRET_LAB", refreshToken: "REFRESH_LAB" },
    {
      clock,
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_client",
          error_description: "bad SECRET_LAB / REFRESH_LAB",
        }),
      }),
    },
  );

  let err = null;
  try {
    await oauth.token();
  } catch (e) {
    err = e;
  }
  const dump = `${err?.message} ${err?.th} ${JSON.stringify(err?.toJSON?.() ?? {})}`;
  const leaked = ["SECRET_LAB", "REFRESH_LAB"].filter((s) => dump.includes(s));
  say(leaked.length === 0, "client secret / refresh token ไม่หลุดเข้า error", leaked.join(", "));
}

{
  const clock = new FakeClock(0);
  let hits = 0;
  const oauth = new GoogleOAuth(
    { clientId: "c", clientSecret: "s", refreshToken: "r" },
    {
      clock,
      fetchImpl: async () => {
        hits += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: `at-${hits}`, expires_in: 3600 }),
        };
      },
    },
  );

  await Promise.all([oauth.token(), oauth.token(), oauth.token()]);
  say(hits === 1, "ขอโทเคนพร้อมกันหลายงาน → แลกครั้งเดียว", `${hits} ครั้ง`);

  await clock.advance(3_500_000);
  await oauth.token();
  say(hits === 1, "…ยังไม่ถึงเวลาต่ออายุ ก็ยังไม่แลกใหม่", `${hits} ครั้ง`);

  await clock.advance(100_000);
  await oauth.token();
  say(hits === 2, "…ใกล้หมดอายุแล้วค่อยแลกใหม่ให้เอง", `${hits} ครั้ง`);
}

{
  const clock = new FakeClock(0);
  const oauth = new GoogleOAuth(
    { clientId: "c", clientSecret: "s", refreshToken: "r" },
    {
      clock,
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_grant" }),
      }),
    },
  );
  let err = null;
  try {
    await oauth.token();
  } catch (e) {
    err = e;
  }
  say(err?.action === "reconnect", "refresh token ถูกเพิกถอน → บอกให้เชื่อมใหม่", err?.action);
  say(err?.retryable === false, "…และไม่ลองใหม่ให้เอง (ลองกี่ครั้งก็ไม่หาย)");
}

// ═══════════════════════════════════════════════════════════════════════════
section("7. เวลาต้องมาจาก Clock ที่ฉีดเข้ามา");

{
  const fs = await import("node:fs");
  for (const f of ["moderation.ts", "oauth.ts"]) {
    const src = fs.readFileSync(new URL(`./src/${f}`, import.meta.url), "utf8");
    const bad = /new Date\(\s*\)/.test(src) || /Date\.now\(\)/.test(src);
    say(!bad, `${f} ไม่มี new Date() / Date.now() ในโค้ดจริง`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(
  fail === 0
    ? `\n✓ ผ่านทั้งหมด — งานซ่อน/ลบคอมเมนต์พร้อมใช้\n`
    : `\n✗ มี ${fail} ข้อที่ไม่ผ่าน — ต้องแก้ก่อนใช้งานจริง\n`,
);
process.exit(fail === 0 ? 0 : 1);
