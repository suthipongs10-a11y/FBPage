/**
 * เทสต์ตัวแปลงแถวฐานข้อมูล → รูปร่างที่หน้าจอใช้
 *
 * ชั้นนี้เป็นชั้นที่ผิดแล้ว**ไม่มี error ให้เห็น** — หน้าจอยังเรนเดอร์ได้ปกติ
 * แค่ตัวเลขผิด เช่นเพจที่ token หมดอายุขึ้นเป็น "เชื่อมต่อปกติ" หรือบทสนทนา
 * ที่คนกำลังคุยอยู่หายจากคิวเพราะถูกนับว่าบอทดูแล
 */
import { describe, expect, it } from "vitest";
import type {
  WorkspaceConversationRow,
  WorkspacePageRow,
  WorkspaceScheduledRow,
  WorkspaceSnapshot,
} from "@page-os/store";
import { assembleWorkspace } from "./workspace-mapping.js";

const NOW = Date.UTC(2026, 7, 14, 9);

function page(over: Partial<WorkspacePageRow> = {}): WorkspacePageRow {
  return {
    id: "uuid-1",
    fbPageId: "1013",
    name: "ครัวคุณยาย",
    timeZone: "Asia/Bangkok",
    botEnabled: true,
    lastWebhookAtMs: NOW - 60_000,
    clientName: "ครัวคุณยาย",
    plan: "FULL",
    followers: 18_420,
    token: { status: "active", expiresAtMs: null, statusReasonTh: null },
    ...over,
  };
}

function conversation(
  over: Partial<WorkspaceConversationRow> = {},
): WorkspaceConversationRow {
  return {
    id: "c1",
    pageId: "uuid-1",
    contactName: "สุณี",
    preview: "ค่าส่งกี่บาทคะ",
    awaitingSinceMs: NOW - 600_000,
    unread: 1,
    botPausedUntilMs: null,
    ...over,
  };
}

function scheduledPost(
  over: Partial<WorkspaceScheduledRow> = {},
): WorkspaceScheduledRow {
  return {
    id: "p1",
    pageId: "uuid-1",
    scheduledAtMs: NOW + 3_600_000,
    type: "photo",
    body: "เมนูใหม่วันนี้",
    approvalStatus: "pending",
    status: "scheduled",
    attempts: 0,
    lastErrorTh: null,
    ...over,
  };
}

function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return { pages: [], conversations: [], scheduled: [], incidents: [], ...over };
}

describe("แปลงสถานะ token เป็นสถานะการเชื่อมต่อ", () => {
  it.each([
    ["active", "ok"],
    ["expiring_soon", "expiring_soon"],
    ["expired", "expired"],
    ["revoked", "revoked"],
    ["missing_permissions", "missing_permissions"],
    ["unknown", "unknown"],
  ] as const)("%s → %s", (stored, expected) => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [page({ token: { status: stored, expiresAtMs: null, statusReasonTh: null } })],
      }),
      NOW,
    );
    expect(ws.pages[0]?.connection.state).toBe(expected);
  });

  /**
   * "ยังไม่ได้เชื่อม" กับ "เชื่อมแล้วพัง" ต้องแยกกัน — คนละปุ่มที่ต้องกด
   * ถ้ายุบเป็นอันเดียว คนที่เพิ่งติดตั้งจะเห็นคำว่า "หมดอายุ" ทั้งที่ไม่เคยเชื่อม
   */
  it("ไม่มี token เลย → no_token ไม่ใช่ expired", () => {
    const ws = assembleWorkspace(snapshot({ pages: [page({ token: null })] }), NOW);
    expect(ws.pages[0]?.connection.state).toBe("no_token");
    expect(ws.pages[0]?.connection.hoursUntilExpiry).toBeUndefined();
  });

  it("คำนวณชั่วโมงที่เหลือจากเวลาที่ส่งเข้ามา ไม่ใช่นาฬิกาเครื่อง", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [
          page({
            token: {
              status: "expiring_soon",
              expiresAtMs: NOW + 48 * 3_600_000,
              statusReasonTh: null,
            },
          }),
        ],
      }),
      NOW,
    );
    expect(ws.pages[0]?.connection.hoursUntilExpiry).toBeCloseTo(48, 6);
  });

  /** token ที่หมดอายุไปแล้วต้องไม่ได้ค่าติดลบ ไม่งั้นหน้าจอโชว์ "เหลือ -3 วัน" */
  it("token ที่เลยกำหนดไปแล้ว → 0 ชั่วโมง ไม่ใช่ค่าติดลบ", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [
          page({
            token: {
              status: "expired",
              expiresAtMs: NOW - 5 * 86_400_000,
              statusReasonTh: null,
            },
          }),
        ],
      }),
      NOW,
    );
    expect(ws.pages[0]?.connection.hoursUntilExpiry).toBe(0);
  });
});

describe("สีประจำลูกค้า", () => {
  it("เพจของลูกค้าเดียวกันได้สีเดียวกัน คนละลูกค้าได้คนละสี", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [
          page({ id: "a", clientName: "ครัวคุณยาย" }),
          page({ id: "b", clientName: "ร้านกาแฟ" }),
          page({ id: "c", clientName: "ครัวคุณยาย" }),
        ],
      }),
      NOW,
    );
    expect(ws.pages[0]?.colorIndex).toBe(ws.pages[2]?.colorIndex);
    expect(ws.pages[0]?.colorIndex).not.toBe(ws.pages[1]?.colorIndex);
  });

  /** ลูกค้าเยอะกว่าสีที่มี → สีซ้ำได้ แต่ห้ามหลุดออกนอกช่วง */
  it("ลูกค้า 25 รายยังได้ index ที่อยู่ในช่วงสีเสมอ", () => {
    const pages = Array.from({ length: 25 }, (_, i) =>
      page({ id: `p${i}`, clientName: `ลูกค้า ${i}` }),
    );
    const ws = assembleWorkspace(snapshot({ pages }), NOW);
    for (const p of ws.pages) {
      expect(p.colorIndex).toBeGreaterThanOrEqual(0);
      expect(p.colorIndex).toBeLessThan(10);
    }
  });
});

describe("บทสนทนา", () => {
  it("บอทเปิดและไม่ถูกสั่งหยุด → นับว่าบอทดูแลอยู่", () => {
    const ws = assembleWorkspace(
      snapshot({ pages: [page({ botEnabled: true })], conversations: [conversation()] }),
      NOW,
    );
    expect(ws.conversations[0]?.handledByBot).toBe(true);
  });

  /**
   * `botPausedUntil` ถูกเซ็ตทุกครั้งที่คนพิมพ์เอง — ถ้ายังนับว่าบอทดูแล
   * บทสนทนาที่คนกำลังคุยค้างไว้จะหายจากคิว แล้วลูกค้าไม่ได้รับคำตอบ
   */
  it("คนเพิ่งพิมพ์เอง (บอทถูกสั่งหยุด) → กลับเข้าคิวคน", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [page({ botEnabled: true })],
        conversations: [conversation({ botPausedUntilMs: NOW + 600_000 })],
      }),
      NOW,
    );
    expect(ws.conversations[0]?.handledByBot).toBe(false);
  });

  it("เวลาหยุดบอทผ่านไปแล้ว → บอทกลับมาดูแลได้", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [page({ botEnabled: true })],
        conversations: [conversation({ botPausedUntilMs: NOW - 1 })],
      }),
      NOW,
    );
    expect(ws.conversations[0]?.handledByBot).toBe(true);
  });

  /** ปุ่มปิดบอทฉุกเฉินต่อเพจต้องชนะทุกอย่าง */
  it("เพจปิดบอทไว้ → ทุกบทสนทนาเข้าคิวคน แม้ไม่มีการสั่งหยุดรายตัว", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [page({ botEnabled: false })],
        conversations: [conversation({ botPausedUntilMs: null })],
      }),
      NOW,
    );
    expect(ws.conversations[0]?.handledByBot).toBe(false);
  });

  it("ไม่รู้ชื่อคนทัก → แสดงว่าไม่ทราบชื่อ ไม่ใช่ช่องว่างหรือคำว่า null", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [page()],
        conversations: [conversation({ contactName: null, preview: null })],
      }),
      NOW,
    );
    expect(ws.conversations[0]?.contactName).toBe("ไม่ทราบชื่อ");
    expect(ws.conversations[0]?.preview).toBe("");
  });

  it("ข้อความยาวถูกตัด และขึ้นบรรทัดใหม่ถูกยุบเป็นช่องว่าง", () => {
    const long = "ก".repeat(200);
    const ws = assembleWorkspace(
      snapshot({
        pages: [page()],
        conversations: [conversation({ preview: `บรรทัดแรก\n\nบรรทัดสอง ${long}` })],
      }),
      NOW,
    );
    const p = ws.conversations[0]?.preview ?? "";
    expect(p).not.toContain("\n");
    expect(p.length).toBeLessThanOrEqual(80);
    expect(p.endsWith("…")).toBe(true);
  });
});

describe("โพสต์ที่ตั้งเวลาไว้", () => {
  it("แปลงชนิดและสถานะอนุมัติตามค่าที่เก็บไว้", () => {
    const ws = assembleWorkspace(
      snapshot({ pages: [page()], scheduled: [scheduledPost()] }),
      NOW,
    );
    expect(ws.scheduled[0]).toMatchObject({ type: "photo", approval: "pending" });
  });

  /**
   * ค่าที่ไม่รู้จักต้องตกลงมาเป็นค่าที่ปลอดภัยที่สุด ไม่ใช่ปล่อยผ่านไปให้ UI
   * ไป index ตารางป้ายแล้วได้ `undefined` โผล่บนหน้าจอ
   */
  it("ชนิด/สถานะที่ไม่รู้จัก → ตกลงมาเป็นค่าปลอดภัย", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [page()],
        scheduled: [scheduledPost({ type: "carousel", approvalStatus: "weird" })],
      }),
      NOW,
    );
    expect(ws.scheduled[0]).toMatchObject({ type: "text", approval: "none" });
  });

  /**
   * `failedAttempts > 0` คือตัวที่ `today.ts` ใช้ตัดสินว่าโพสต์นี้ต้องมีคนไปแก้
   * โพสต์ที่ยังไม่ถึงคิวแต่มี attempts ค้างอยู่ต้องไม่ถูกนับว่าล้มเหลว
   */
  it("โพสต์ที่ยังไม่ล้ม → failedAttempts เป็น 0 แม้ attempts จะไม่ใช่ 0", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [page()],
        scheduled: [scheduledPost({ status: "scheduled", attempts: 2 })],
      }),
      NOW,
    );
    expect(ws.scheduled[0]?.failedAttempts).toBe(0);
  });

  /** โพสต์ที่ล้มแล้วแต่ไม่มีใครนับ attempts ให้ ต้องยังนับว่าล้มอย่างน้อย 1 ครั้ง */
  it("โพสต์ที่ล้มแต่ attempts เป็น 0 → ยังต้องนับว่าล้ม", () => {
    const ws = assembleWorkspace(
      snapshot({
        pages: [page()],
        scheduled: [scheduledPost({ status: "failed", attempts: 0 })],
      }),
      NOW,
    );
    expect(ws.scheduled[0]?.failedAttempts).toBe(1);
  });

  it("ไม่มีสาเหตุที่ล้ม → ไม่ใส่ฟิลด์นั้นเลย ไม่ใช่ใส่ค่าว่าง", () => {
    const ws = assembleWorkspace(
      snapshot({ pages: [page()], scheduled: [scheduledPost({ lastErrorTh: null })] }),
      NOW,
    );
    expect(ws.scheduled[0]).not.toHaveProperty("lastErrorTh");
  });
});

describe("แพ็กเกจและผู้ติดตาม", () => {
  it.each([
    ["FULL", "FULL"],
    ["growth", "GROWTH"],
    ["ไม่รู้จัก", "STARTER"],
  ] as const)("แพ็กเกจ %s → %s", (raw, expected) => {
    const ws = assembleWorkspace(snapshot({ pages: [page({ plan: raw })] }), NOW);
    expect(ws.pages[0]?.plan).toBe(expected);
  });

  /**
   * ยังไม่เคย sync insights (null) ต่างจากรู้แล้วว่าไม่มีคนตาม (0) —
   * แต่ตอนรวมยอดต้องบวกได้ ไม่ใช่ได้ NaN ทั้งแถว
   */
  it("ยังไม่เคย sync ผู้ติดตาม → นับเป็น 0 ไม่ใช่ NaN", () => {
    const ws = assembleWorkspace(
      snapshot({ pages: [page({ followers: null }), page({ id: "b", followers: 100 })] }),
      NOW,
    );
    const total = ws.pages.reduce((s, p) => s + p.followers, 0);
    expect(total).toBe(100);
    expect(Number.isNaN(total)).toBe(false);
  });
});

describe("เวิร์กสเปซว่าง", () => {
  it("ไม่มีเพจเลย → ทุกชุดว่าง และเวลายังเป็นค่าที่ส่งเข้ามา", () => {
    const ws = assembleWorkspace(snapshot(), NOW);
    expect(ws).toEqual({
      nowMs: NOW,
      pages: [],
      conversations: [],
      scheduled: [],
      incidents: [],
    });
  });
});
