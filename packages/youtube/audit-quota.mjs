/**
 * Audit รากฐานฝั่ง YouTube
 *
 * เทสต์หน่วยตรวจว่าแต่ละชิ้นทำงานถูก — audit นี้ตรวจว่า**ทั้งระบบอยู่รอด
 * ในหนึ่งวันทำงานจริง** ซึ่งเป็นคนละคำถามกัน
 *
 * โควตาคือทรัพยากรที่ใช้หมดแล้วหมดเลยจนถึงเที่ยงคืนแปซิฟิก ความผิดพลาด
 * ที่แพงที่สุดคือ **ใช้หมดตอนเช้าแล้วตาบอดทั้งวัน** — ตรวจเรื่องนั้นเป็นหลัก
 *
 *   pnpm build && node packages/youtube/audit-quota.mjs
 */
import {
  DEFAULT_DAILY_QUOTA,
  QUOTA_COST,
  QuotaBucket,
  quotaDayKey,
  RESERVED_FOR_INTERACTIVE,
  YouTubeApiError,
  YouTubeGateway,
} from "./dist/index.js";

let fail = 0;
const say = (ok, label, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
};

/** นาฬิกาปลอมที่เดินเองได้ — gateway ต้องการ now() กับ sleep() */
function fakeClock(startMs) {
  let now = startMs;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

function gatewayWith({ nowMs, reply, dailyQuota = DEFAULT_DAILY_QUOTA }) {
  const clock = fakeClock(nowMs);
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    const r = typeof reply === "function" ? reply(calls) : reply;
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
    };
  };
  const gw = new YouTubeGateway(
    { apiKey: "k", apiBase: "https://x.test/v3", dailyQuota },
    { clock, fetchImpl, random: () => 0.5 },
  );
  return { gw, clock, calls: () => calls };
}

const T0 = Date.UTC(2026, 7, 14, 12);

// ── 1. หนึ่งวันทำงานจริง — cron ทุกชั่วโมง 10 ช่อง ─────────────────────
console.log("=== หนึ่งวันทำงานจริง ===");
{
  /**
   * แผนการดึงต่อช่องต่อรอบ (ตามที่ออกแบบไว้ให้เลี่ยง search.list):
   *   channels.list 1 → playlistItems.list 1 → videos.list 1
   *   → commentThreads.list × จำนวนหน้า
   */
  const CHANNELS = 10;
  const PAGES_OF_COMMENTS = 2;
  const perChannel =
    QUOTA_COST["channels.list"] +
    QUOTA_COST["playlistItems.list"] +
    QUOTA_COST["videos.list"] +
    PAGES_OF_COMMENTS * QUOTA_COST["commentThreads.list"];

  /**
   * ⚠️ ต้องเริ่มนับที่**เที่ยงคืนแปซิฟิก** ไม่ใช่เวลาใดก็ได้
   *
   * รอบแรกที่เขียน audit นี้เริ่มที่บ่ายโมงไทย แล้ววน 24 ชั่วโมง — ซึ่ง
   * **ข้ามเที่ยงคืนแปซิฟิกกลางทาง** ถังจึงรีเซ็ตตัวเองแล้วรายงานว่า
   * "ใช้ไป 0 หน่วย" ทั้งที่ยิงไป 24 รอบ กลายเป็น audit ที่ผ่านเพราะวัดผิดจุด
   *
   * บทเรียน: "หนึ่งวันของโควตา" ไม่ใช่ "24 ชั่วโมงนับจากตอนนี้" และไม่ตรงกับ
   * วันตามปฏิทินไทยด้วย — วันโควตาเริ่มราวบ่าย 2 โมงบ้านเรา
   */
  const DAY_START = Date.UTC(2026, 7, 14, 7); // 00:00 แปซิฟิก (ฤดูร้อน)
  const bucket = new QuotaBucket(DEFAULT_DAILY_QUOTA, DAY_START);
  let rounds = 0;
  let blockedAt = null;
  const need = perChannel * CHANNELS;
  // 23 รอบ = อยู่ในวันโควตาเดียวกันทั้งหมด (รอบที่ 24 คือรีเซ็ตพอดี)
  for (let hour = 0; hour < 24; hour++) {
    const at = DAY_START + hour * 3_600_000;
    if (quotaDayKey(at) !== quotaDayKey(DAY_START)) break;
    if (!bucket.canSpend({ cost: need, nowMs: at, background: true }).ok) {
      blockedAt = hour;
      break;
    }
    bucket.spend(need, at);
    rounds++;
  }

  const readAt = DAY_START + 23 * 3_600_000; // ยังวันโควตาเดิม
  const snap = bucket.snapshot(readAt);
  say(
    blockedAt === null && rounds === 24,
    `cron ทุกชั่วโมงตลอดหนึ่งวันโควตา × ${CHANNELS} ช่อง ไม่ชนเพดาน`,
    blockedAt === null
      ? `${rounds} รอบ · ใช้ ${snap.used}/${DEFAULT_DAILY_QUOTA} หน่วย (${((snap.used / DEFAULT_DAILY_QUOTA) * 100).toFixed(0)}%)`
      : `ตันตั้งแต่ชั่วโมงที่ ${blockedAt}`,
  );
  say(
    snap.used > 0,
    "ตัวเลขที่วัดได้ไม่ใช่ศูนย์ (ไม่ได้ข้ามวันแล้วรีเซ็ตกลางทาง)",
    `ใช้จริง ${snap.used} หน่วย`,
  );
  say(
    snap.remainingForBackground > 0,
    "ยังเหลือโควตาให้งานที่คนกดเองครบทั้งวัน",
    `เหลือ ${snap.remainingForBackground} หน่วยสำหรับงานเบื้องหลัง`,
  );

  // ถ้าเผลอใช้ search.list แทน playlistItems.list จะเป็นยังไง
  const withSearch = (100 + 1 + 2) * CHANNELS;
  say(
    withSearch * 24 > DEFAULT_DAILY_QUOTA,
    "ยืนยันว่าถ้าใช้ search.list จะตันจริง (เหตุผลที่ไม่มีมันในตาราง)",
    `จะใช้ ${withSearch}/รอบ → ตันในรอบที่ ${Math.ceil(DEFAULT_DAILY_QUOTA / withSearch)}`,
  );
}

// ── 2. โควตาที่นับไว้ตรงกับที่ยิงจริงไหม ────────────────────────────────
console.log("\n=== ความแม่นของการนับ ===");
{
  const { gw, calls } = gatewayWith({ nowMs: T0, reply: { body: { items: [] } } });
  const N = 40;
  for (let i = 0; i < N; i++) {
    await gw.call({ endpoint: "commentThreads.list", params: {} });
  }
  say(
    gw.quotaSnapshot().used === N * QUOTA_COST["commentThreads.list"],
    "ยิง 40 ครั้ง นับได้ตรงเป๊ะ",
    `นับได้ ${gw.quotaSnapshot().used} ยิงจริง ${calls()}`,
  );
}

// ── 3. ยิงพร้อมกันหลายตัว — ตัวกันโควตายังกันอยู่ไหม ───────────────────
console.log("\n=== ยิงพร้อมกัน ===");
{
  /**
   * จุดที่น่ากลัวที่สุดของตัวนับแบบ "เช็คแล้วค่อยจ่าย": ถ้ามีช่องว่างระหว่าง
   * สองขั้นตอน คำขอที่ยิงพร้อมกันจะผ่านด่านพร้อมกันหมดแล้วใช้เกินเพดาน
   */
  const LIMIT = 20;
  const { gw, calls } = gatewayWith({
    nowMs: T0,
    reply: { body: {} },
    dailyQuota: LIMIT + RESERVED_FOR_INTERACTIVE,
  });

  const results = await Promise.all(
    Array.from({ length: 100 }, () =>
      gw
        .call({ endpoint: "commentThreads.list", params: {}, background: true })
        .then(() => "ok")
        .catch((e) => (e instanceof YouTubeApiError ? e.action : "อื่นๆ")),
    ),
  );

  const ok = results.filter((r) => r === "ok").length;
  say(
    ok === LIMIT,
    `ยิงพร้อมกัน 100 ครั้งบนเพดาน ${LIMIT} → ผ่านได้ ${LIMIT} ครั้งเป๊ะ`,
    `ผ่าน ${ok} · ยิงออกไปจริง ${calls()}`,
  );
  say(
    calls() === LIMIT,
    "คำขอที่เกินเพดานไม่ถูกยิงออกไปเลย (ไม่เผาโควตาทิ้ง)",
    `ยิงจริง ${calls()}`,
  );
  say(
    results.every((r) => r === "ok" || r === "wait_quota"),
    "ตัวที่ถูกปฏิเสธได้เหตุผลที่ถูกต้อง",
  );
}

// ── 4. retry ใช้โควตาเกินที่ตรวจไว้ตอนแรกไหม ───────────────────────────
console.log("\n=== retry กับโควตา ===");
{
  const { gw, clock } = gatewayWith({
    nowMs: T0,
    reply: { status: 503, body: { error: { message: "down" } } },
  });
  const pending = gw
    .call({ endpoint: "commentThreads.list", params: {} })
    .catch(() => undefined);
  // นาฬิกาปลอมเดินเองตอน sleep จึงไม่ต้องดันเวลาเพิ่ม
  await pending;

  const used = gw.quotaSnapshot().used;
  say(
    used === 3,
    "ลองใหม่ 3 ครั้ง = ใช้ 3 หน่วย (ตรวจครั้งเดียวแต่จ่ายทุกครั้ง)",
    `ใช้ ${used} หน่วย`,
  );
  say(
    clock.now() > T0,
    "มีการถอยเวลาจริงระหว่างลองใหม่ ไม่ได้ยิงรัว",
    `เวลาเดินไป ${clock.now() - T0} ms`,
  );
}

// ── 5. ข้ามวันแล้วโควตาคืนมาจริงไหม ────────────────────────────────────
console.log("\n=== ข้ามวัน ===");
{
  const bucket = new QuotaBucket(100, T0);
  bucket.spend(100, T0);
  say(bucket.snapshot(T0).remaining === 0, "ใช้จนหมดแล้วเหลือศูนย์");

  // หาเวลาที่ข้ามเที่ยงคืนแปซิฟิกพอดี
  const before = Date.UTC(2026, 7, 15, 6, 59);
  const after = Date.UTC(2026, 7, 15, 7, 0);
  say(
    quotaDayKey(before) !== quotaDayKey(after),
    "เส้นแบ่งวันอยู่ที่ 07:00 UTC ในฤดูร้อน",
    `${quotaDayKey(before)} → ${quotaDayKey(after)}`,
  );

  const b2 = new QuotaBucket(100, before);
  b2.spend(100, before);
  say(
    b2.snapshot(after).remaining === 100,
    "ข้ามเที่ยงคืนแปซิฟิก → โควตาคืนมาเต็ม",
    `เหลือ ${b2.snapshot(after).remaining}`,
  );

  // ฤดูหนาวเส้นแบ่งขยับไปหนึ่งชั่วโมง
  say(
    quotaDayKey(Date.UTC(2026, 0, 15, 7)) === "2026-01-14" &&
      quotaDayKey(Date.UTC(2026, 0, 15, 8)) === "2026-01-15",
    "ฤดูหนาวเส้นแบ่งขยับเป็น 08:00 UTC ตาม DST",
  );
}

// ── 6. ความลับหลุดไหม ในทุกรูปแบบของ error ────────────────────────────
console.log("\n=== ความลับ ===");
{
  const SECRET = "AIzaSyLONG-SECRET-KEY-12345";
  const shapes = [
    { label: "403 forbidden", status: 403, body: { error: { message: "no", errors: [{ reason: "forbidden" }] } } },
    { label: "401 auth", status: 401, body: { error: { message: "bad token" } } },
    { label: "500 server", status: 500, body: { error: { message: "boom" } } },
    { label: "body ว่าง", status: 400, body: {} },
    { label: "error ที่ไม่รู้จัก", status: 418, body: { error: { message: "teapot", errors: [{ reason: "weird" }] } } },
  ];

  for (const s of shapes) {
    const clock = fakeClock(T0);
    const gw = new YouTubeGateway(
      { apiKey: SECRET, apiBase: "https://x.test/v3", maxAttempts: 1 },
      {
        clock,
        fetchImpl: async () => ({
          ok: false,
          status: s.status,
          json: async () => s.body,
        }),
        random: () => 0.5,
      },
    );
    const err = await gw
      .call({ endpoint: "channels.list", params: { id: "UC1" } })
      .catch((e) => e);

    const dump = JSON.stringify(err.toJSON()) + String(err.message) + String(err.stack ?? "");
    say(!dump.includes(SECRET), `ไม่มี API key หลุดใน error: ${s.label}`);
    say(typeof err.th === "string" && err.th.length > 10, `  มีข้อความไทยที่อ่านรู้เรื่อง: ${s.label}`, err.th.slice(0, 45));
  }
}

// ── 7. error ทุกแบบมี action ที่ทำต่อได้ ───────────────────────────────
console.log("\n=== action ของ error ===");
{
  const cases = [
    ["quotaExceeded", "wait_quota"],
    ["rateLimitExceeded", "retry"],
    ["commentsDisabled", "skip"],
    ["videoNotFound", "skip"],
    ["authError", "reconnect"],
    ["keyInvalid", "manual"],
    ["accessNotConfigured", "manual"],
  ];
  for (const [reason, want] of cases) {
    const err = new YouTubeApiError({ message: "x", reason, httpStatus: 403 });
    say(err.action === want, `${reason} → ${want}`, err.action === want ? "" : `ได้ ${err.action}`);
  }

  // ตัวที่ต้อง retry ต้องตั้ง retryable ให้ตรงกันด้วย
  const r = new YouTubeApiError({ message: "x", reason: "rateLimitExceeded" });
  const q = new YouTubeApiError({ message: "x", reason: "quotaExceeded" });
  say(r.retryable === true && q.retryable === false, "retryable สอดคล้องกับ action");
}

console.log(fail === 0 ? "\nผ่านทั้งหมด" : `\nไม่ผ่าน ${fail} ข้อ`);
process.exit(fail === 0 ? 0 : 1);
