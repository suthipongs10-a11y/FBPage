import { describe, expect, it } from "vitest";
import { expectThaiRejection } from "@page-os/core/testing";
import type { ApprovalDecision, ApprovalStatus } from "@page-os/publish";
import {
  decideFromPortal,
  type PortalApprovalDeps,
  type PortalAuditSink,
} from "./actions.js";
import { DEFAULT_PERMISSIONS, type PortalScope } from "./scope.js";

const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);

function scope(over: Partial<PortalScope> = {}): PortalScope {
  return {
    workspaceId: "ws-a",
    clientName: "ครัวคุณยาย",
    pageIds: ["p1", "p2"],
    permissions: DEFAULT_PERMISSIONS,
    email: "owner@krua.example",
    ...over,
  };
}

/** โพสต์สองใบคนละลูกค้า — ใบหนึ่งของเรา ใบหนึ่งของคนอื่น */
const POSTS = new Map([
  ["ของเรา", { postId: "ของเรา", pageId: "p1" }],
  ["ของลูกค้าอื่น", { postId: "ของลูกค้าอื่น", pageId: "p-ลูกค้าอื่น" }],
]);

function deps(): PortalApprovalDeps & {
  calls: Array<{ postId: string; decision: ApprovalDecision; actor: string; note?: string }>;
} {
  const calls: Array<{
    postId: string;
    decision: ApprovalDecision;
    actor: string;
    note?: string;
  }> = [];
  return {
    calls,
    async findPost(postId) {
      return POSTS.get(postId) ?? null;
    },
    async decide(args) {
      calls.push(args);
      return {
        status: (args.decision === "approve"
          ? "approved"
          : "changes_requested") as ApprovalStatus,
        th: "บันทึกแล้ว",
      };
    },
  };
}

class RecordingAudit implements PortalAuditSink {
  entries: Array<Record<string, unknown>> = [];
  async record(e: Record<string, unknown>): Promise<void> {
    this.entries.push(e);
  }
}

describe("decideFromPortal", () => {
  it("อนุมัติโพสต์ของตัวเอง → ผ่าน", async () => {
    const d = deps();
    const r = await decideFromPortal(scope(), d, {
      postId: "ของเรา",
      decision: "approve",
      nowMs: NOW,
    });
    expect(r.status).toBe("approved");
    expect(d.calls).toHaveLength(1);
  });

  it("โพสต์ของลูกค้ารายอื่น → ปฏิเสธ และไม่เรียกตัวตัดสินเลย", async () => {
    // นี่คือ IDOR: ลูกค้าเปลี่ยนเลขใน URL แล้วกดอนุมัติโพสต์ของคนอื่น
    const d = deps();
    const err = await expectThaiRejection(
      decideFromPortal(scope(), d, {
        postId: "ของลูกค้าอื่น",
        decision: "approve",
        nowMs: NOW,
      }),
    );
    expect(err.th).toMatch(/ไม่พบโพสต์นี้ในบัญชีของคุณ/);
    expect(d.calls).toHaveLength(0);
  });

  it("ตอบเหมือนกันทั้งโพสต์ที่ไม่มีจริงและโพสต์ของคนอื่น", async () => {
    // ตอบต่างกันเมื่อไหร่ การไล่เลข id จะบอกได้ว่าโพสต์ไหนมีอยู่จริง
    const d = deps();
    const missing = await expectThaiRejection(
      decideFromPortal(scope(), d, {
        postId: "ไม่มีโพสต์นี้",
        decision: "approve",
        nowMs: NOW,
      }),
    );
    const foreign = await expectThaiRejection(
      decideFromPortal(scope(), d, {
        postId: "ของลูกค้าอื่น",
        decision: "approve",
        nowMs: NOW,
      }),
    );
    expect(missing.th).toBe(foreign.th);
  });

  it("บัญชีที่ดูได้อย่างเดียว → กดไม่ได้ และไม่ไปแตะฐานข้อมูลด้วยซ้ำ", async () => {
    const d = deps();
    await expectThaiRejection(
      decideFromPortal(
        scope({ permissions: { ...DEFAULT_PERMISSIONS, approve: false } }),
        d,
        { postId: "ของเรา", decision: "approve", nowMs: NOW },
      ),
    );
    expect(d.calls).toHaveLength(0);
  });

  it("เพจถูกถอดออกจากสัญญาแล้ว → กดโพสต์เดิมไม่ได้อีก", async () => {
    const d = deps();
    await expectThaiRejection(
      decideFromPortal(scope({ pageIds: ["p2"] }), d, {
        postId: "ของเรา",
        decision: "approve",
        nowMs: NOW,
      }),
    );
  });

  it("ระบุว่าใครกดมาจาก portal — สำคัญตอนมีข้อโต้แย้งกับลูกค้า", async () => {
    const d = deps();
    await decideFromPortal(scope(), d, {
      postId: "ของเรา",
      decision: "approve",
      nowMs: NOW,
    });
    expect(d.calls[0]!.actor).toBe("portal:owner@krua.example");
  });

  it("ขอแก้ไขพร้อมข้อความ → ส่งข้อความต่อไปด้วย", async () => {
    const d = deps();
    const r = await decideFromPortal(scope(), d, {
      postId: "ของเรา",
      decision: "request_changes",
      note: "ขอเปลี่ยนรูปเป็นเมนูใหม่ค่ะ",
      nowMs: NOW,
    });
    expect(r.status).toBe("changes_requested");
    expect(d.calls[0]!.note).toBe("ขอเปลี่ยนรูปเป็นเมนูใหม่ค่ะ");
  });

  it("ข้อความยาวเกินไป → ปฏิเสธก่อนบันทึก", async () => {
    const d = deps();
    await expectThaiRejection(
      decideFromPortal(scope(), d, {
        postId: "ของเรา",
        decision: "request_changes",
        note: "ก".repeat(2001),
        nowMs: NOW,
      }),
    );
    expect(d.calls).toHaveLength(0);
  });

  it("บันทึก audit ว่าใครกดอะไรกับโพสต์ไหน", async () => {
    const audit = new RecordingAudit();
    await decideFromPortal(scope(), deps(), {
      postId: "ของเรา",
      decision: "approve",
      nowMs: NOW,
      audit,
    });
    expect(audit.entries[0]).toMatchObject({
      atMs: NOW,
      workspaceId: "ws-a",
      email: "owner@krua.example",
      action: "portal.approve",
      targetId: "ของเรา",
    });
  });

  it("ไม่บันทึก audit เมื่อกดไม่ผ่าน — ไม่งั้น log เต็มไปด้วยความพยายามที่ล้มเหลว", async () => {
    const audit = new RecordingAudit();
    await expectThaiRejection(
      decideFromPortal(scope(), deps(), {
        postId: "ของลูกค้าอื่น",
        decision: "approve",
        nowMs: NOW,
        audit,
      }),
    );
    expect(audit.entries).toEqual([]);
  });

  it("ไม่ส่ง audit sink มา → ยังทำงานได้ปกติ", async () => {
    await expect(
      decideFromPortal(scope(), deps(), {
        postId: "ของเรา",
        decision: "approve",
        nowMs: NOW,
      }),
    ).resolves.toBeDefined();
  });
});
