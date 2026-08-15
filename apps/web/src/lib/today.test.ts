import { describe, expect, it } from "vitest";
import {
  APPROVAL_URGENT_MS,
  WEBHOOK_SILENT_MS,
  buildApprovalTasks,
  buildInboxTasks,
  buildTodayView,
  collectProblems,
  describeGap,
  describeFollowerDelta,
  followerTrend,
} from "./today.js";
import type {
  ClientPage,
  ConversationRow,
  ScheduledPostRow,
  Workspace,
} from "./workspace.js";

const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);
const MIN = 60_000;
const HOUR = 3_600_000;

function page(over: Partial<ClientPage> = {}): ClientPage {
  return {
    pageId: "p1",
    fbPageId: "10012345678",
    pageName: "เพจทดสอบ",
    clientName: "ลูกค้า ก",
    colorIndex: 0,
    plan: "FULL",
    timeZone: "Asia/Bangkok",
    connection: { state: "ok" },
    lastWebhookAtMs: NOW - MIN,
    followers: 1000,
    ...over,
  };
}

function conv(over: Partial<ConversationRow> = {}): ConversationRow {
  return {
    conversationId: "c1",
    pageId: "p1",
    contactName: "คุณเอ",
    preview: "สนใจสั่งของค่ะ",
    awaitingSinceMs: NOW - 10 * MIN,
    unread: 1,
    handledByBot: false,
    ...over,
  };
}

function post(over: Partial<ScheduledPostRow> = {}): ScheduledPostRow {
  return {
    postId: "s1",
    pageId: "p1",
    scheduledAtMs: NOW + 2 * 86_400_000,
    type: "text",
    preview: "โพสต์ทดสอบ",
    pillarLabelTh: "ให้ความรู้",
    approval: "approved",
    failedAttempts: 0,
    ...over,
  };
}

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    nowMs: NOW,
    followerSeries: [],
    pages: [page()],
    conversations: [],
    scheduled: [],
    incidents: [],
    ...over,
  };
}

describe("collectProblems", () => {
  it("token หมดอายุ = เรื่องรุนแรง เพราะเพจหยุดทำงานทั้งหมด", () => {
    const p = collectProblems(
      ws({ pages: [page({ connection: { state: "expired" } })] }),
    );
    expect(p[0]!.severity).toBe("critical");
    expect(p[0]!.kind).toBe("token");
    expect(p[0]!.th).toMatch(/ให้ลูกค้ากดเชื่อมใหม่/);
  });

  it("token ใกล้หมดอายุ = เตือน ไม่ใช่รุนแรง และบอกว่าเหลือกี่วัน", () => {
    const p = collectProblems(
      ws({
        pages: [
          page({
            connection: { state: "expiring_soon", hoursUntilExpiry: 96 },
          }),
        ],
      }),
    );
    expect(p[0]!.severity).toBe("warning");
    expect(p[0]!.th).toMatch(/เหลือ 4 วัน/);
  });

  it("เพจปกติและ webhook มาสม่ำเสมอ → ไม่มีปัญหา", () => {
    expect(collectProblems(ws())).toEqual([]);
  });

  it("webhook เงียบเกินเกณฑ์ → เตือน พร้อมบอกผลที่กำลังเกิด", () => {
    const p = collectProblems(
      ws({ pages: [page({ lastWebhookAtMs: NOW - WEBHOOK_SILENT_MS - MIN })] }),
    );
    expect(p[0]!.kind).toBe("webhook");
    expect(p[0]!.th).toMatch(/ตกหล่น/);
  });

  it("webhook เงียบนานมาก → ยกระดับเป็นรุนแรง", () => {
    const p = collectProblems(
      ws({ pages: [page({ lastWebhookAtMs: NOW - 5 * HOUR })] }),
    );
    expect(p[0]!.severity).toBe("critical");
  });

  it("ไม่เคยได้รับ webhook เลย → บอกให้ไปตรวจ subscribe", () => {
    const p = collectProblems(ws({ pages: [page({ lastWebhookAtMs: null })] }));
    expect(p[0]!.th).toMatch(/subscribe/);
  });

  it("token ตายแล้ว ไม่ต้องรายงาน webhook เงียบซ้ำ — เป็นผลของเรื่องเดียวกัน", () => {
    const p = collectProblems(
      ws({
        pages: [
          page({
            connection: { state: "expired" },
            lastWebhookAtMs: NOW - 10 * HOUR,
          }),
        ],
      }),
    );
    expect(p).toHaveLength(1);
    expect(p[0]!.kind).toBe("token");
  });

  it("โพสต์ล้มเหลวหลายอันของเพจเดียวกัน รวมเป็นบรรทัดเดียว", () => {
    // token เพจหนึ่งหมด = โพสต์ของเพจนั้นล้มพร้อมกันหมด
    // แตกเป็นบรรทัดละโพสต์จะกลบเรื่องอื่นที่คนละสาเหตุ
    const p = collectProblems(
      ws({
        scheduled: [
          post({ postId: "a", failedAttempts: 1, lastErrorTh: "เน็ตหลุด" }),
          post({ postId: "b", failedAttempts: 1, lastErrorTh: "เน็ตหลุด" }),
          post({ postId: "c", failedAttempts: 1, lastErrorTh: "เน็ตหลุด" }),
        ],
      }),
    );
    const publish = p.filter((x) => x.kind === "publish");
    expect(publish).toHaveLength(1);
    expect(publish[0]!.th).toMatch(/3 โพสต์/);
  });

  it("โพสต์ล้มครบ 3 ครั้ง = รุนแรง และบอกว่าหยุด retry แล้ว", () => {
    const p = collectProblems(
      ws({ scheduled: [post({ failedAttempts: 3, lastErrorTh: "รูปใหญ่ไป" })] }),
    );
    expect(p[0]!.severity).toBe("critical");
    expect(p[0]!.th).toMatch(/หยุด retry/);
    expect(p[0]!.th).toMatch(/รูปใหญ่ไป/);
  });

  it("แยกบรรทัดตามเพจ ไม่ยุบข้ามเพจ", () => {
    const p = collectProblems(
      ws({
        pages: [page(), page({ pageId: "p2", pageName: "เพจสอง" })],
        scheduled: [
          post({ postId: "a", pageId: "p1", failedAttempts: 1 }),
          post({ postId: "b", pageId: "p2", failedAttempts: 1 }),
        ],
      }),
    );
    expect(p.filter((x) => x.kind === "publish")).toHaveLength(2);
  });

  it("เรียงเรื่องรุนแรงขึ้นก่อนเสมอ", () => {
    const p = collectProblems(
      ws({
        pages: [
          page({
            pageId: "p1",
            connection: { state: "expiring_soon", hoursUntilExpiry: 48 },
          }),
          page({
            pageId: "p2",
            clientName: "ลูกค้า ข",
            connection: { state: "revoked" },
          }),
        ],
      }),
    );
    expect(p[0]!.severity).toBe("critical");
    expect(p[0]!.pageId).toBe("p2");
  });

  it("ติดชื่อเพจและสีลูกค้าไปกับทุกปัญหา — ไม่งั้นคนไม่รู้ว่าเพจไหน", () => {
    const p = collectProblems(
      ws({
        pages: [
          page({ connection: { state: "expired" }, colorIndex: 4, clientName: "ร้านหนึ่ง" }),
        ],
      }),
    );
    expect(p[0]!.pageName).toBe("เพจทดสอบ");
    expect(p[0]!.clientName).toBe("ร้านหนึ่ง");
    expect(p[0]!.colorIndex).toBe(4);
  });
});

describe("buildInboxTasks", () => {
  it("บทสนทนาที่บอทดูแลอยู่ ไม่ขึ้นคิวคน", () => {
    const tasks = buildInboxTasks(
      ws({
        conversations: [
          conv({ conversationId: "bot", handledByBot: true }),
          conv({ conversationId: "human", handledByBot: false }),
        ],
      }),
    );
    expect(tasks.map((t) => t.conversationId)).toEqual(["human"]);
  });

  it("ลูกค้าแพ็กเกจแพงที่ทักทีหลัง ได้ตอบก่อนแพ็กเกจถูกที่ทักก่อน", () => {
    // นี่คือเหตุผลทั้งหมดที่ต้องมีคิว ไม่ใช่เรียงตามเวลาที่เข้ามา
    const tasks = buildInboxTasks(
      ws({
        pages: [
          page({ pageId: "starter", plan: "STARTER" }),
          page({ pageId: "full", plan: "FULL" }),
        ],
        conversations: [
          conv({
            conversationId: "เก่า-แพ็กถูก",
            pageId: "starter",
            awaitingSinceMs: NOW - 90 * MIN,
          }),
          conv({
            conversationId: "ใหม่-แพ็กแพง",
            pageId: "full",
            awaitingSinceMs: NOW - 25 * MIN,
          }),
        ],
      }),
    );
    expect(tasks[0]!.conversationId).toBe("ใหม่-แพ็กแพง");
  });

  it("เติมชื่อคน ชื่อเพจ และสีลูกค้ากลับเข้าไปในคิว", () => {
    const tasks = buildInboxTasks(
      ws({
        pages: [page({ colorIndex: 3, pageName: "เพจ ก" })],
        conversations: [conv({ contactName: "คุณบี", preview: "ทักมาถามราคา" })],
      }),
    );
    expect(tasks[0]!.contactName).toBe("คุณบี");
    expect(tasks[0]!.preview).toBe("ทักมาถามราคา");
    expect(tasks[0]!.pageName).toBe("เพจ ก");
    expect(tasks[0]!.colorIndex).toBe(3);
  });

  it("บทสนทนาที่ตอบครบแล้ว ไม่อยู่ในคิว", () => {
    const tasks = buildInboxTasks(
      ws({ conversations: [conv({ awaitingSinceMs: null })] }),
    );
    expect(tasks).toEqual([]);
  });
});

describe("buildApprovalTasks", () => {
  it("เอาเฉพาะที่รออนุมัติ ไม่เอาที่อนุมัติแล้วหรือขอแก้", () => {
    const tasks = buildApprovalTasks(
      ws({
        scheduled: [
          post({ postId: "a", approval: "pending" }),
          post({ postId: "b", approval: "approved" }),
          post({ postId: "c", approval: "changes_requested" }),
        ],
      }),
    );
    expect(tasks.map((t) => t.postId)).toEqual(["a"]);
  });

  it("อันที่เลยเวลาโพสต์แล้วขึ้นก่อนสุด — ลูกค้าคิดว่าขึ้นไปแล้ว", () => {
    const tasks = buildApprovalTasks(
      ws({
        scheduled: [
          post({ postId: "อนาคต", approval: "pending", scheduledAtMs: NOW + 5 * HOUR }),
          post({ postId: "เลยแล้ว", approval: "pending", scheduledAtMs: NOW - HOUR }),
        ],
      }),
    );
    expect(tasks[0]!.postId).toBe("เลยแล้ว");
    expect(tasks[0]!.remainingMs).toBeLessThan(0);
    expect(tasks[0]!.th).toMatch(/ยังไม่ขึ้น/);
  });

  it("ใกล้ถึงเวลาโพสต์ → ทำเครื่องหมายว่าด่วน ต้องตามลูกค้า", () => {
    const tasks = buildApprovalTasks(
      ws({
        scheduled: [
          post({
            approval: "pending",
            scheduledAtMs: NOW + APPROVAL_URGENT_MS - HOUR,
          }),
        ],
      }),
    );
    expect(tasks[0]!.urgent).toBe(true);
  });

  it("ยังอีกไกล → ไม่ด่วน", () => {
    const tasks = buildApprovalTasks(
      ws({
        scheduled: [
          post({
            approval: "pending",
            scheduledAtMs: NOW + APPROVAL_URGENT_MS + HOUR,
          }),
        ],
      }),
    );
    expect(tasks[0]!.urgent).toBe(false);
  });
});

describe("buildTodayView", () => {
  it("ไม่มีอะไรค้าง → บอกตรงๆ ว่าเรียบร้อย", () => {
    const v = buildTodayView(ws());
    expect(v.headlineTh).toMatch(/ทุกเพจเรียบร้อย/);
    expect(v.actionCount).toBe(0);
  });

  it("ของพังมาก่อนเรื่องอื่นเสมอ แม้จะมีข้อความค้างด้วย", () => {
    const v = buildTodayView(
      ws({
        pages: [page({ connection: { state: "expired" } })],
        conversations: [conv({ pageId: "p1", awaitingSinceMs: NOW - 5 * HOUR })],
      }),
    );
    expect(v.headlineTh).toMatch(/พังอยู่ตอนนี้/);
  });

  it("ไม่มีของพังแต่เลย SLA → พาดหัวบอกให้ตอบเดี๋ยวนี้", () => {
    const v = buildTodayView(
      ws({ conversations: [conv({ awaitingSinceMs: NOW - 5 * HOUR })] }),
    );
    expect(v.headlineTh).toMatch(/เลยเวลาที่สัญญา/);
  });

  it("ทุกอย่างอยู่ในเวลา → พาดหัวไม่ปลุกให้ตกใจ", () => {
    const v = buildTodayView(
      ws({ conversations: [conv({ awaitingSinceMs: NOW - 2 * MIN })] }),
    );
    expect(v.headlineTh).toMatch(/ยังอยู่ในเวลา/);
  });

  it("โพสต์ที่รออนุมัติ ไม่นับเป็น 'จะขึ้นเอง' — มันจะไม่ขึ้นถ้าไม่มีคนกด", () => {
    const v = buildTodayView(
      ws({
        scheduled: [
          post({ postId: "รอ", approval: "pending", scheduledAtMs: NOW + 2 * HOUR }),
          post({ postId: "ผ่าน", approval: "approved", scheduledAtMs: NOW + 3 * HOUR }),
        ],
      }),
    );
    expect(v.goingOut.map((g) => g.postId)).toEqual(["ผ่าน"]);
  });

  it("'จะขึ้นเอง' นับเฉพาะ 24 ชม. ข้างหน้า", () => {
    const v = buildTodayView(
      ws({
        scheduled: [
          post({ postId: "วันนี้", scheduledAtMs: NOW + 5 * HOUR }),
          post({ postId: "อาทิตย์หน้า", scheduledAtMs: NOW + 7 * 86_400_000 }),
        ],
      }),
    );
    expect(v.goingOut.map((g) => g.postId)).toEqual(["วันนี้"]);
  });

  it("actionCount รวมทุกอย่างที่ต้องแตะ", () => {
    const v = buildTodayView(
      ws({
        pages: [page({ connection: { state: "expired" } })],
        conversations: [conv({ pageId: "p1" })],
        scheduled: [post({ approval: "pending" })],
      }),
    );
    expect(v.actionCount).toBe(
      v.inbox.summary.total + v.approvals.length + v.problems.length,
    );
    expect(v.actionCount).toBeGreaterThan(0);
  });
});

describe("describeGap", () => {
  it("แปลงช่วงเวลาเป็นหน่วยที่คนอ่านเข้าใจ", () => {
    expect(describeGap(30 * MIN)).toBe("30 นาที");
    expect(describeGap(3 * HOUR)).toBe("3 ชม.");
    expect(describeGap(2 * 86_400_000)).toBe("2 วัน");
  });

  it("ค่าติดลบใช้ขนาดของมัน ไม่ใช่เครื่องหมาย", () => {
    expect(describeGap(-30 * MIN)).toBe("30 นาที");
  });
});

/**
 * ─── ทำไมเทียบกับ "จุดแรกที่มีข้อมูล" ไม่ใช่ "7 วันที่แล้ว" ตายตัว ───
 *
 * เพจที่เพิ่งเชื่อมเมื่อวานมีข้อมูลแค่ 2 วัน ถ้าไปหาค่าของ 7 วันที่แล้วจะไม่เจอ
 * แล้วต้องเดา — เทียบกับจุดแรกที่มีจริงแล้วบอกตรงๆ ว่ากี่วัน ถูกต้องเสมอ
 */
describe("แนวโน้มผู้ติดตาม", () => {
  const series = (...v: number[]) =>
    v.map((followers, i) => ({ dateKey: `2026-08-${10 + i}`, followers }));

  it("เอายอดล่าสุดกับส่วนต่างจากจุดแรก", () => {
    const t = followerTrend(ws({ followerSeries: series(100, 120, 150) }));
    expect(t.latest).toBe(150);
    expect(t.changeFromStart).toBe(50);
    // 3 จุด = ห่างกัน 2 วัน ไม่ใช่ 3
    expect(t.spanDays).toBe(2);
  });

  it("ยังไม่เคย sync เลย → ไม่มีอะไรให้วาดและไม่เดาตัวเลข", () => {
    const t = followerTrend(ws({ followerSeries: [] }));
    expect(t.latest).toBeNull();
    expect(t.changeFromStart).toBeNull();
    expect(t.series).toEqual([]);
  });

  it("มีข้อมูลวันเดียว → บอกยอดได้ แต่บอกส่วนต่างไม่ได้", () => {
    const t = followerTrend(ws({ followerSeries: series(2_000) }));
    expect(t.latest).toBe(2_000);
    expect(t.changeFromStart).toBeNull();
  });

  it("ลดลงก็รายงานตามจริง ไม่ปัดเป็นศูนย์", () => {
    const t = followerTrend(ws({ followerSeries: series(500, 460) }));
    expect(t.changeFromStart).toBe(-40);
  });
});

describe("ข้อความส่วนต่างผู้ติดตาม", () => {
  const trend = (change: number | null, spanDays = 13) => ({
    latest: 100,
    series: [1, 2],
    changeFromStart: change,
    spanDays,
  });

  /** ลูกศรทำให้ทิศทางอ่านออกโดยไม่ต้องพึ่งสีอย่างเดียว */
  it("เพิ่มขึ้น → ลูกศรขึ้น และนับว่าเป็นเรื่องดี", () => {
    const d = describeFollowerDelta(trend(1_338));
    expect(d?.text).toContain("↑");
    expect(d?.text).toContain("13 วัน");
    expect(d?.good).toBe(true);
  });

  it("ลดลง → ลูกศรลง และนับว่าไม่ดี", () => {
    const d = describeFollowerDelta(trend(-40));
    expect(d?.text).toContain("↓");
    expect(d?.good).toBe(false);
  });

  /** เท่าเดิมไม่ใช่ทั้งดีและแย่ — ระบายสีเขียวหรือแดงล้วนตีความผิด */
  it("เท่าเดิม → ไม่ตัดสินว่าดีหรือแย่", () => {
    const d = describeFollowerDelta(trend(0));
    expect(d?.good).toBeNull();
    expect(d?.text).toContain("เท่าเดิม");
  });

  it("ไม่มีข้อมูลพอ → ไม่แสดงอะไรเลย", () => {
    expect(describeFollowerDelta(trend(null))).toBeNull();
  });
});
