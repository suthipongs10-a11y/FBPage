import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import { expectThaiThrow, expectThaiRejection } from "@page-os/core/testing";
import {
  AuditLog,
  InMemoryAuditStore,
  type Actor,
} from "./audit-log.js";
import {
  CONFIRM_ABOVE_CLIENTS,
  CONFIRM_ABOVE_PAGES,
  applyBulkChange,
  planBulkChange,
  type BulkApplier,
  type BulkTarget,
} from "./bulk.js";

const START = Date.UTC(2026, 7, 8, 3, 0, 0);
const ME: Actor = { kind: "human", id: "tanakon@example.com" };

function target(over: Partial<BulkTarget> = {}): BulkTarget {
  return {
    pageId: "p1",
    pageName: "ครัวคุณยาย",
    clientName: "ครัวคุณยาย",
    connectionState: "ok",
    settings: { slaMinutes: 240, botEnabled: false },
    ...over,
  };
}

/** สร้างเพจหลายใบให้ลูกค้าหลายราย */
function many(count: number, clientsCount = 1): BulkTarget[] {
  return Array.from({ length: count }, (_, i) =>
    target({
      pageId: `p${i}`,
      pageName: `เพจ ${i}`,
      clientName: `ลูกค้า ${i % clientsCount}`,
    }),
  );
}

function auditLog(): { log: AuditLog; store: InMemoryAuditStore } {
  const store = new InMemoryAuditStore();
  return { log: new AuditLog({ store, clock: new FakeClock(START) }), store };
}

class FakeApplier implements BulkApplier {
  calls: Array<{ pageId: string; patch: Record<string, unknown> }> = [];
  failOn = new Set<string>();
  async apply(pageId: string, patch: Record<string, unknown>): Promise<void> {
    if (this.failOn.has(pageId)) throw new Error("บันทึกไม่สำเร็จ");
    this.calls.push({ pageId, patch });
  }
}

describe("planBulkChange — ดูก่อนทำ", () => {
  it("บอกว่าเพจไหนจะเปลี่ยนอะไร โดยไม่แตะอะไรเลย", () => {
    const plan = planBulkChange({
      targets: [target()],
      patch: { slaMinutes: 60 },
    });
    expect(plan.willChange).toBe(1);
    expect(plan.pages[0]!.changes).toEqual([
      { field: "slaMinutes", before: 240, after: 60 },
    ]);
  });

  it("ข้ามเพจที่ค่าตรงอยู่แล้ว", () => {
    // ไม่งั้น audit จะมี 20 บรรทัดที่กลบ 3 บรรทัดที่เปลี่ยนจริง
    const plan = planBulkChange({
      targets: [
        target({ pageId: "same", settings: { slaMinutes: 60 } }),
        target({ pageId: "diff", settings: { slaMinutes: 240 } }),
      ],
      patch: { slaMinutes: 60 },
    });
    expect(plan.willChange).toBe(1);
    expect(plan.willSkip).toBe(1);
    expect(plan.pages[0]!.skippedTh).toMatch(/ตรงกับที่ตั้งไว้อยู่แล้ว/);
  });

  it("นับจำนวนลูกค้าที่กระทบ ไม่ใช่แค่จำนวนเพจ", () => {
    const plan = planBulkChange({
      targets: many(6, 3),
      patch: { slaMinutes: 60 },
    });
    expect(plan.affectedClients).toBe(3);
  });

  it("เกินเกณฑ์จำนวนเพจ → ต้องยืนยันซ้ำ", () => {
    const plan = planBulkChange({
      targets: many(CONFIRM_ABOVE_PAGES + 1),
      patch: { slaMinutes: 60 },
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("ข้ามลูกค้าหลายรายเกินเกณฑ์ → ต้องยืนยันซ้ำ แม้เพจจะน้อย", () => {
    // แก้ 3 เพจของลูกค้า 3 รายอันตรายกว่าแก้ 3 เพจของลูกค้าเดียว
    const plan = planBulkChange({
      targets: many(CONFIRM_ABOVE_CLIENTS + 1, CONFIRM_ABOVE_CLIENTS + 1),
      patch: { slaMinutes: 60 },
    });
    expect(plan.pages.length).toBeLessThanOrEqual(CONFIRM_ABOVE_PAGES);
    expect(plan.needsConfirmation).toBe(true);
  });

  it("แก้ไม่กี่เพจของลูกค้าเดียว → ไม่ต้องยืนยันซ้ำ", () => {
    const plan = planBulkChange({ targets: many(2), patch: { slaMinutes: 60 } });
    expect(plan.needsConfirmation).toBe(false);
  });

  it("เพจที่เชื่อมต่อไม่ได้ → เตือนแต่ยังทำ", () => {
    // คนต้องรู้ว่าค่าถูกเก็บแล้วแต่ยังไม่มีผลกับ Facebook
    const plan = planBulkChange({
      targets: [target({ connectionState: "expired" })],
      patch: { slaMinutes: 60 },
    });
    expect(plan.pages[0]!.skippedTh).toBeUndefined();
    expect(plan.pages[0]!.warningTh).toMatch(/ยังไม่มีผลจนกว่าจะเชื่อมใหม่/);
  });

  it("ไม่ได้เลือกค่าที่จะเปลี่ยน → error ไทย", () => {
    const err = expectThaiThrow(() =>
      planBulkChange({ targets: [target()], patch: {} }),
    );
    expect(err.th).toMatch(/ยังไม่ได้เลือกว่าจะเปลี่ยนค่าอะไร/);
  });

  it("ไม่ได้เลือกเพจ → error ไทย", () => {
    const err = expectThaiThrow(() =>
      planBulkChange({ targets: [], patch: { a: 1 } }),
    );
    expect(err.th).toMatch(/ยังไม่ได้เลือกเพจ/);
  });

  it("ทุกเพจค่าตรงหมด → บอกตรงๆ ว่าไม่ต้องทำอะไร", () => {
    const plan = planBulkChange({
      targets: [target({ settings: { slaMinutes: 60 } })],
      patch: { slaMinutes: 60 },
    });
    expect(plan.willChange).toBe(0);
    expect(plan.th).toMatch(/ไม่มีเพจไหนต้องเปลี่ยน/);
  });
});

describe("applyBulkChange", () => {
  it("เขียนค่าลงทุกเพจที่ต้องเปลี่ยน", async () => {
    const { log } = auditLog();
    const applier = new FakeApplier();
    const plan = planBulkChange({ targets: many(3), patch: { slaMinutes: 60 } });

    const r = await applyBulkChange({ plan, applier, audit: log, actor: ME });
    expect(r.applied).toBe(3);
    expect(r.failed).toBe(0);
    expect(applier.calls).toHaveLength(3);
  });

  it("ส่งเฉพาะฟิลด์ที่เปลี่ยนจริงของเพจนั้น ไม่ใช่ทั้งก้อน", async () => {
    // เพจที่ค่าตรงอยู่แล้วบางฟิลด์ไม่ควรถูกเขียนทับให้เกิด event ซ้ำ
    const { log } = auditLog();
    const applier = new FakeApplier();
    const plan = planBulkChange({
      targets: [target({ settings: { slaMinutes: 240, botEnabled: true } })],
      patch: { slaMinutes: 60, botEnabled: true },
    });

    await applyBulkChange({ plan, applier, audit: log, actor: ME });
    expect(applier.calls[0]!.patch).toEqual({ slaMinutes: 60 });
  });

  it("เพจที่ข้าม ไม่ถูกเขียนเลย", async () => {
    const { log } = auditLog();
    const applier = new FakeApplier();
    const plan = planBulkChange({
      targets: [
        target({ pageId: "same", settings: { slaMinutes: 60 } }),
        target({ pageId: "diff", settings: { slaMinutes: 240 } }),
      ],
      patch: { slaMinutes: 60 },
    });

    const r = await applyBulkChange({ plan, applier, audit: log, actor: ME });
    expect(applier.calls.map((c) => c.pageId)).toEqual(["diff"]);
    expect(r.skipped).toBe(1);
  });

  it("ต้องยืนยันแล้วไม่ยืนยัน → ปฏิเสธ และไม่แตะเพจใดเลย", async () => {
    const { log } = auditLog();
    const applier = new FakeApplier();
    const plan = planBulkChange({
      targets: many(CONFIRM_ABOVE_PAGES + 2),
      patch: { slaMinutes: 60 },
    });

    const err = await expectThaiRejection(
      applyBulkChange({ plan, applier, audit: log, actor: ME }),
    );
    expect(err.th).toMatch(/กรุณายืนยันอีกครั้ง/);
    expect(applier.calls).toHaveLength(0);
  });

  it("ยืนยันแล้ว → ทำได้", async () => {
    const { log } = auditLog();
    const applier = new FakeApplier();
    const plan = planBulkChange({
      targets: many(CONFIRM_ABOVE_PAGES + 2),
      patch: { slaMinutes: 60 },
    });
    const r = await applyBulkChange({
      plan,
      applier,
      audit: log,
      actor: ME,
      confirmed: true,
    });
    expect(r.applied).toBe(CONFIRM_ABOVE_PAGES + 2);
  });

  it("บางเพจล้ม → ไม่ล้มทั้งชุด และบอกว่าเพจไหนไม่ผ่าน", async () => {
    const { log } = auditLog();
    const applier = new FakeApplier();
    applier.failOn.add("p1");
    const plan = planBulkChange({ targets: many(3), patch: { slaMinutes: 60 } });

    const r = await applyBulkChange({ plan, applier, audit: log, actor: ME });
    expect(r.applied).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.outcomes.find((o) => o.pageId === "p1")!.ok).toBe(false);
    expect(r.th).toMatch(/กดซ้ำเฉพาะเพจที่ล้มได้/);
  });

  it("ไม่ย้อนคืนของที่สำเร็จไปแล้ว — สถานะสุดท้ายต้องเดาได้", async () => {
    const { log } = auditLog();
    const applier = new FakeApplier();
    applier.failOn.add("p2");
    const plan = planBulkChange({ targets: many(3), patch: { slaMinutes: 60 } });

    await applyBulkChange({ plan, applier, audit: log, actor: ME });
    expect(applier.calls.map((c) => c.pageId).sort()).toEqual(["p0", "p1"]);
  });

  it("บันทึก audit ต่อเพจ พร้อมบอกว่าเปลี่ยนอะไร", async () => {
    const { log } = auditLog();
    const plan = planBulkChange({ targets: many(2), patch: { slaMinutes: 60 } });
    await applyBulkChange({ plan, applier: new FakeApplier(), audit: log, actor: ME });

    const entries = await log.query({ action: "settings.bulk_update" });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.th).toMatch(/240 → 60/);
    expect(entries[0]!.actor).toEqual(ME);
  });

  it("บันทึกภาพรวมหนึ่งรายการ ให้ไล่ย้อนได้ว่าการกดครั้งนั้นทำอะไรบ้าง", async () => {
    const { log } = auditLog();
    const applier = new FakeApplier();
    applier.failOn.add("p0");
    const plan = planBulkChange({ targets: many(2), patch: { slaMinutes: 60 } });
    await applyBulkChange({ plan, applier, audit: log, actor: ME });

    const [run] = await log.query({ action: "settings.bulk_run" });
    expect(run!.th).toMatch(/สำเร็จ 1/);
    expect(run!.th).toMatch(/ล้มเหลว 1/);
  });

  it("เพจที่ถูกข้ามยังนับว่าสำเร็จ ไม่ใช่ล้มเหลว", async () => {
    const { log } = auditLog();
    const plan = planBulkChange({
      targets: [target({ settings: { slaMinutes: 60 } })],
      patch: { slaMinutes: 60 },
    });
    const r = await applyBulkChange({
      plan,
      applier: new FakeApplier(),
      audit: log,
      actor: ME,
    });
    expect(r.outcomes[0]!.ok).toBe(true);
    expect(r.failed).toBe(0);
  });
});
