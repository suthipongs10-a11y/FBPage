import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import {
  AuditLog,
  InMemoryAuditStore,
  describeChanges,
  diffSettings,
  type Actor,
  type AuditEntry,
  type AuditStore,
} from "./audit-log.js";

const START = Date.UTC(2026, 7, 8, 3, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

const ME: Actor = { kind: "human", id: "tanakon@example.com" };
const CLIENT: Actor = { kind: "client", id: "owner@krua.example" };
const WORKER: Actor = { kind: "system", id: "worker:publish" };

function build(): { log: AuditLog; store: InMemoryAuditStore; clock: FakeClock } {
  const clock = new FakeClock(START);
  const store = new InMemoryAuditStore();
  return { log: new AuditLog({ store, clock }), store, clock };
}

describe("record", () => {
  it("บันทึกครบว่าใครทำอะไร เมื่อไหร่ กับเพจไหน", async () => {
    const { log } = build();
    const e = await log.record({
      actor: ME,
      action: "post.publish",
      pageId: "p1",
      targetId: "post-9",
      th: "โพสต์ขึ้นเพจแล้ว",
    });

    expect(e.actor).toEqual(ME);
    expect(e.action).toBe("post.publish");
    expect(e.pageId).toBe("p1");
    expect(e.targetId).toBe("post-9");
    expect(e.atMs).toBe(START);
  });

  it("แยกได้ว่าเป็นทีมงาน ลูกค้า หรือระบบอัตโนมัติ", async () => {
    // คำถามแรกตอนมีข้อพิพาทคือ "ใครกด" — ถ้าตอบไม่ได้ เราเป็นฝ่ายผิด
    const { log } = build();
    await log.record({ actor: ME, action: "a", th: "x" });
    await log.record({ actor: CLIENT, action: "b", th: "y" });
    await log.record({ actor: WORKER, action: "c", th: "z" });

    const all = await log.query();
    expect(all.map((e) => e.actor.kind).sort()).toEqual([
      "client",
      "human",
      "system",
    ]);
  });
});

describe("ความลับต้องไม่หลุดลง log (กฎข้อ 3)", () => {
  it("ค่าที่เป็น token ถูก scrub ก่อนบันทึก", async () => {
    // การตั้งค่าที่เปลี่ยนอาจมีฟิลด์ที่เป็นความลับปนมาโดยไม่ตั้งใจ
    const { log } = build();
    const e = await log.record({
      actor: ME,
      action: "settings.update",
      th: "แก้ค่า",
      changes: [
        { field: "accessToken", before: "EAAxxxxxxxxxxxxxxxxxxxxxxxxxxx", after: "EAAyyyyyyyyyyyyyyyyyyyyyyyy" },
      ],
    });
    const json = JSON.stringify(e);
    expect(json).not.toContain("EAAxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(json).not.toContain("EAAyyyyyyyyyyyyyyyyyyyyyyyy");
  });

  it("ค่าปกติไม่ถูก scrub เกินจนอ่านไม่รู้เรื่อง", async () => {
    const { log } = build();
    const e = await log.record({
      actor: ME,
      action: "settings.update",
      th: "แก้ค่า",
      changes: [{ field: "slaMinutes", before: 240, after: 60 }],
    });
    expect(e.changes?.[0]?.before).toBe(240);
    expect(e.changes?.[0]?.after).toBe(60);
  });
});

describe("แก้ไม่ได้ (append-only)", () => {
  it("แก้ object ที่ส่งเข้าไปแล้ว ไม่กระทบของที่บันทึกไว้", async () => {
    // log ที่แก้ได้ใช้เป็นหลักฐานไม่ได้
    const { log } = build();
    const changes = [{ field: "x", before: 1, after: 2 }];
    await log.record({ actor: ME, action: "a", th: "เดิม", changes });
    changes[0]!.after = 999;

    const [saved] = await log.query();
    expect(saved!.changes?.[0]?.after).toBe(2);
  });

  it("แก้ผลลัพธ์ที่ query ได้ ไม่กระทบของที่เก็บไว้", async () => {
    const { log } = build();
    await log.record({ actor: ME, action: "a", th: "เดิม" });
    const [first] = await log.query();
    first!.th = "แก้แล้ว";

    const [again] = await log.query();
    expect(again!.th).toBe("เดิม");
  });
});

describe("query", () => {
  async function seeded(): Promise<AuditLog> {
    const { log, clock } = build();
    await log.record({ actor: ME, action: "post.publish", pageId: "p1", th: "a" });
    await clock.advance(HOUR);
    await log.record({ actor: CLIENT, action: "portal.approve", pageId: "p1", th: "b" });
    await clock.advance(HOUR);
    await log.record({ actor: ME, action: "post.publish", pageId: "p2", th: "c" });
    return log;
  }

  it("ใหม่สุดขึ้นก่อน — คนสอบสวนเริ่มจาก 'เมื่อกี้เกิดอะไรขึ้น' เสมอ", async () => {
    const log = await seeded();
    const all = await log.query();
    expect(all.map((e) => e.th)).toEqual(["c", "b", "a"]);
  });

  it("กรองตามเพจ", async () => {
    const log = await seeded();
    expect((await log.query({ pageId: "p1" })).map((e) => e.th)).toEqual(["b", "a"]);
  });

  it("กรองตามคนทำ", async () => {
    const log = await seeded();
    expect((await log.query({ actorId: CLIENT.id })).map((e) => e.th)).toEqual(["b"]);
  });

  it("กรองตามชนิดการกระทำ", async () => {
    const log = await seeded();
    expect((await log.query({ action: "post.publish" })).map((e) => e.th)).toEqual([
      "c",
      "a",
    ]);
  });

  it("กรองตามช่วงเวลา", async () => {
    const log = await seeded();
    const r = await log.query({ fromMs: START + HOUR + 1 });
    expect(r.map((e) => e.th)).toEqual(["c"]);
  });

  it("จำกัดจำนวน", async () => {
    const log = await seeded();
    expect(await log.query({ limit: 2 })).toHaveLength(2);
  });
});

describe("recordSafe", () => {
  class BrokenStore implements AuditStore {
    async append(): Promise<void> {
      throw new Error("db down");
    }
    async query(): Promise<AuditEntry[]> {
      return [];
    }
    async purgeBefore(): Promise<number> {
      return 0;
    }
  }

  it("บันทึกล้ม → ไม่โยนต่อ งานหลักไม่พัง", async () => {
    // DB สะดุดตอนบันทึก audit ไม่ควรทำให้การอนุมัติของลูกค้าล้มเหลว
    const log = new AuditLog({ store: new BrokenStore(), clock: new FakeClock(START) });
    await expect(
      log.recordSafe({ actor: ME, action: "a", th: "x" }),
    ).resolves.toBeNull();
  });

  it("แต่ต้องนับไว้ — audit ที่หายเงียบๆ คือ audit ที่พึ่งไม่ได้", async () => {
    const log = new AuditLog({ store: new BrokenStore(), clock: new FakeClock(START) });
    await log.recordSafe({ actor: ME, action: "a", th: "x" });
    await log.recordSafe({ actor: ME, action: "b", th: "y" });
    expect(log.failedWrites).toBe(2);
  });

  it("record แบบเข้มงวดยังโยน error ตามปกติ", async () => {
    const log = new AuditLog({ store: new BrokenStore(), clock: new FakeClock(START) });
    await expect(log.record({ actor: ME, action: "a", th: "x" })).rejects.toThrow();
  });
});

describe("purge", () => {
  it("ลบของเก่าตามอายุที่กำหนด", async () => {
    const { log, clock } = build();
    await log.record({ actor: ME, action: "old", th: "เก่า" });
    await clock.advance(100 * DAY);
    await log.record({ actor: ME, action: "new", th: "ใหม่" });

    const removed = await log.purge(90 * DAY, ME);
    expect(removed).toBe(1);
    const left = await log.query();
    expect(left.some((e) => e.action === "old")).toBe(false);
  });

  it("ตัวการล้างเองก็ถูกบันทึก", async () => {
    // ไม่งั้นแยกไม่ออกระหว่าง "ไม่มีเหตุการณ์" กับ "มีคนลบทิ้ง"
    // ซึ่งเป็นคำถามแรกตอนมีข้อพิพาท
    const { log, clock } = build();
    await log.record({ actor: ME, action: "old", th: "เก่า" });
    await clock.advance(100 * DAY);
    await log.purge(90 * DAY, ME);

    const purgeEntries = await log.query({ action: "audit.purge" });
    expect(purgeEntries).toHaveLength(1);
    expect(purgeEntries[0]!.th).toMatch(/ล้างประวัติ/);
    expect(purgeEntries[0]!.th).toMatch(/1 รายการ/);
  });
});

describe("diffSettings", () => {
  it("เก็บเฉพาะฟิลด์ที่เปลี่ยนจริง", () => {
    // log ที่บันทึกค่าทั้งชุดทุกครั้งทำให้ต้องเทียบเองว่าอะไรต่าง แล้วคนเลิกอ่าน
    const d = diffSettings(
      { slaMinutes: 240, botEnabled: true, timezone: "Asia/Bangkok" },
      { slaMinutes: 60, botEnabled: true, timezone: "Asia/Bangkok" },
    );
    expect(d).toEqual([{ field: "slaMinutes", before: 240, after: 60 }]);
  });

  it("ฟิลด์ที่เพิ่มมาใหม่และที่หายไป", () => {
    const d = diffSettings({ a: 1 }, { b: 2 });
    expect(d).toEqual([
      { field: "a", before: 1, after: undefined },
      { field: "b", before: undefined, after: 2 },
    ]);
  });

  it("เทียบค่าที่เป็น object ได้ ไม่ถือว่าต่างเพราะเป็นคนละ reference", () => {
    const d = diffSettings({ tags: ["a", "b"] }, { tags: ["a", "b"] });
    expect(d).toEqual([]);
  });

  it("ไม่มีอะไรเปลี่ยน → รายการว่าง", () => {
    expect(diffSettings({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("เรียงตามชื่อฟิลด์ ให้อ่านซ้ำได้เหมือนเดิมทุกครั้ง", () => {
    const d = diffSettings({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(d.map((c) => c.field)).toEqual(["a", "z"]);
  });
});

describe("describeChanges", () => {
  it("สรุปเป็นภาษาไทยที่คนอ่านรู้เรื่อง", () => {
    expect(
      describeChanges([{ field: "slaMinutes", before: 240, after: 60 }]),
    ).toBe("slaMinutes: 240 → 60");
  });

  it("ค่า boolean แสดงเป็นเปิด/ปิด", () => {
    expect(describeChanges([{ field: "botEnabled", before: false, after: true }])).toBe(
      "botEnabled: ปิด → เปิด",
    );
  });

  it("ค่าที่ยังไม่เคยตั้งกับค่าว่าง แยกกันได้", () => {
    expect(describeChanges([{ field: "note", before: undefined, after: "" }])).toBe(
      "note: (ไม่ได้ตั้ง) → (ว่าง)",
    );
  });

  it("ไม่มีอะไรเปลี่ยน", () => {
    expect(describeChanges([])).toBe("ไม่มีอะไรเปลี่ยน");
  });
});
