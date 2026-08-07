import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import { assertThaiRejection } from "@page-os/core/testing";
import {
  APPROVAL_TOKEN_TTL_MS,
  ApprovalError,
  ApprovalService,
  canTransition,
  createApprovalToken,
  statusTh,
  verifyApprovalToken,
  type ApprovalNotifier,
  type ApprovalRepository,
  type ApprovalStatus,
} from "./approval.js";

const SECRET = "APPSECRET";
const NOW = 1_700_000_000_000;

class MemApprovalRepo implements ApprovalRepository {
  status: ApprovalStatus = "none";
  alreadyPublished = false;
  readonly writes: Array<{ status: ApprovalStatus; actor: string; note?: string }> =
    [];
  exists = true;

  async getStatus(): Promise<{
    status: ApprovalStatus;
    alreadyPublished: boolean;
  } | null> {
    if (!this.exists) return null;
    return { status: this.status, alreadyPublished: this.alreadyPublished };
  }
  async setStatus(a: {
    status: ApprovalStatus;
    actor: string;
    note?: string;
  }): Promise<void> {
    this.status = a.status;
    this.writes.push({
      status: a.status,
      actor: a.actor,
      ...(a.note !== undefined ? { note: a.note } : {}),
    });
  }
}

class MemNotifier implements ApprovalNotifier {
  readonly sent: Array<{ postId: string; approveUrl: string; changesUrl: string }> =
    [];
  async requestApproval(a: {
    postId: string;
    approveUrl: string;
    changesUrl: string;
  }): Promise<void> {
    this.sent.push(a);
  }
}

function setup() {
  const repo = new MemApprovalRepo();
  const notifier = new MemNotifier();
  const clock = new FakeClock(NOW);
  const svc = new ApprovalService({
    repo,
    secret: SECRET,
    approveBaseUrl: "https://pageos.app/approve/",
    notifier,
    clock,
  });
  return { repo, notifier, clock, svc };
}

describe("approval token", () => {
  it("สร้างแล้วตรวจกลับได้", () => {
    const t = createApprovalToken(
      { postId: "post-1", decision: "approve", nowMs: NOW },
      SECRET,
    );
    expect(verifyApprovalToken(t, SECRET, NOW)).toMatchObject({
      postId: "post-1",
      decision: "approve",
    });
  });

  it("ปุ่มอนุมัติกับปุ่มขอแก้ใช้คนละ token", () => {
    const a = createApprovalToken(
      { postId: "p", decision: "approve", nowMs: NOW },
      SECRET,
    );
    const b = createApprovalToken(
      { postId: "p", decision: "request_changes", nowMs: NOW },
      SECRET,
    );
    expect(a).not.toBe(b);
  });

  it("ปลอมไม่ได้ (secret คนละตัว)", () => {
    const t = createApprovalToken(
      { postId: "p", decision: "approve", nowMs: NOW },
      SECRET,
    );
    expect(() => verifyApprovalToken(t, "อื่น", NOW)).toThrow(ApprovalError);
  });

  it("เปลี่ยน postId ใน token ไม่ได้ (ใช้อนุมัติโพสต์อื่นไม่ได้)", () => {
    const t = createApprovalToken(
      { postId: "post-1", decision: "approve", nowMs: NOW },
      SECRET,
    );
    const [b64, sig] = t.split(".") as [string, string];
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    payload.postId = "post-ของคนอื่น";
    const tampered =
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64url") +
      "." +
      sig;
    expect(() => verifyApprovalToken(tampered, SECRET, NOW)).toThrow(
      ApprovalError,
    );
  });

  it("หมดอายุแล้วใช้ไม่ได้", () => {
    const t = createApprovalToken(
      { postId: "p", decision: "approve", nowMs: NOW },
      SECRET,
    );
    expect(() =>
      verifyApprovalToken(t, SECRET, NOW + APPROVAL_TOKEN_TTL_MS + 1),
    ).toThrow(/expired/);
  });

  it("token ที่ผิดรูปแบบถูกปฏิเสธพร้อมข้อความไทย", () => {
    for (const bad of [undefined, null, "", "ไม่มีจุด", "a.b.c"]) {
      try {
        verifyApprovalToken(bad, SECRET, NOW);
        expect.unreachable(`ควรปฏิเสธ: ${String(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ApprovalError);
        expect((err as ApprovalError).th).toMatch(/[ก-๙]/);
      }
    }
  });
});

describe("canTransition", () => {
  it("เส้นทางปกติ", () => {
    expect(canTransition("none", "pending")).toBe(true);
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("pending", "changes_requested")).toBe(true);
    expect(canTransition("changes_requested", "pending")).toBe(true);
  });

  it("ลูกค้าเปลี่ยนใจหลังอนุมัติได้ (ตราบใดที่ยังไม่ถึงเวลาโพสต์)", () => {
    expect(canTransition("approved", "changes_requested")).toBe(true);
  });

  it("ข้ามขั้นไม่ได้", () => {
    expect(canTransition("none", "approved")).toBe(false);
    expect(canTransition("changes_requested", "approved")).toBe(false);
  });

  it("ทุกสถานะมีป้ายไทย", () => {
    for (const s of [
      "none",
      "pending",
      "approved",
      "changes_requested",
    ] as const) {
      expect(statusTh(s)).toMatch(/[ก-๙]/);
    }
  });
});

describe("ApprovalService — ขออนุมัติ", () => {
  it("ส่งเข้าคิวรออนุมัติ และยิงการ์ดเข้า LINE พร้อมปุ่มสองปุ่ม", async () => {
    const { svc, repo, notifier } = setup();

    const r = await svc.requestApproval("post-1");

    expect(r.status).toBe("pending");
    expect(repo.status).toBe("pending");
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.approveUrl).toContain("https://pageos.app/approve?t=");
    expect(notifier.sent[0]!.changesUrl).not.toBe(notifier.sent[0]!.approveUrl);
  });

  it("โพสต์ที่ขึ้นเพจไปแล้ว ขออนุมัติย้อนหลังไม่ได้", async () => {
    const { svc, repo } = setup();
    repo.alreadyPublished = true;
    await assertThaiRejection(expect, svc.requestApproval("post-1"), /ขึ้นเพจไปแล้ว/);
  });

  it("ขออนุมัติซ้ำตอนที่ยังรออยู่ไม่ได้", async () => {
    const { svc, repo } = setup();
    repo.status = "pending";
    await assertThaiRejection(expect, svc.requestApproval("post-1"), /รออนุมัติ/);
  });

  it("โพสต์ที่ไม่มีแล้ว → error ภาษาไทย", async () => {
    const { svc, repo } = setup();
    repo.exists = false;
    await assertThaiRejection(expect, svc.requestApproval("post-1"), /ไม่พบโพสต์/);
  });
});

describe("ApprovalService — ลูกค้ากดปุ่มจาก LINE", () => {
  it("กดอนุมัติ → สถานะ approved", async () => {
    const { svc, repo, notifier } = setup();
    await svc.requestApproval("post-1");

    const r = await svc.decideByToken(
      new URL(notifier.sent[0]!.approveUrl).searchParams.get("t"),
    );

    expect(r.status).toBe("approved");
    expect(repo.status).toBe("approved");
    expect(r.th).toContain("อนุมัติเรียบร้อย");
    expect(repo.writes.at(-1)!.actor).toBe("client");
  });

  it("กดขอแก้ไข → สถานะ changes_requested พร้อมโน้ต", async () => {
    const { svc, repo, notifier } = setup();
    await svc.requestApproval("post-1");

    const r = await svc.decideByToken(
      new URL(notifier.sent[0]!.changesUrl).searchParams.get("t"),
      "ขอเปลี่ยนรูปหน่อยครับ",
    );

    expect(r.status).toBe("changes_requested");
    expect(repo.writes.at(-1)!.note).toBe("ขอเปลี่ยนรูปหน่อยครับ");
  });

  it("กดปุ่มเดิมซ้ำจากแชทเก่า → ไม่ error ให้ลูกค้าตกใจ", async () => {
    const { svc, notifier } = setup();
    await svc.requestApproval("post-1");
    const token = new URL(notifier.sent[0]!.approveUrl).searchParams.get("t");

    await svc.decideByToken(token);
    const again = await svc.decideByToken(token);

    expect(again.status).toBe("approved");
    expect(again.th).toContain("ไม่ต้องกดซ้ำ");
  });

  it("โพสต์ขึ้นเพจไปแล้ว กดเปลี่ยนใจไม่ได้", async () => {
    const { svc, repo, notifier } = setup();
    await svc.requestApproval("post-1");
    repo.alreadyPublished = true;

    await assertThaiRejection(
      expect,
      svc.decideByToken(
        new URL(notifier.sent[0]!.changesUrl).searchParams.get("t"),
      ),
      /ขึ้นเพจไปแล้ว/,
    );
  });

  it("token ปลอมใช้ไม่ได้", async () => {
    const { svc } = setup();
    await expect(svc.decideByToken("ปลอม.มาก")).rejects.toThrow(ApprovalError);
  });

  it("อนุมัติผ่าน Client Portal (ไม่ผ่าน token) ได้เหมือนกัน", async () => {
    const { svc, repo } = setup();
    await svc.requestApproval("post-1");

    const r = await svc.decide({
      postId: "post-1",
      decision: "approve",
      actor: "client-portal",
    });

    expect(r.status).toBe("approved");
    expect(repo.writes.at(-1)!.actor).toBe("client-portal");
  });

  it("ขอแก้แล้วส่งขออนุมัติใหม่ได้", async () => {
    const { svc, repo } = setup();
    await svc.requestApproval("post-1");
    await svc.decide({
      postId: "post-1",
      decision: "request_changes",
      actor: "client",
    });
    expect(repo.status).toBe("changes_requested");

    const again = await svc.requestApproval("post-1");
    expect(again.status).toBe("pending");
  });

  it("ทำงานร่วมกับ worker: pending/changes_requested = ไม่ยิง, approved = ยิงได้", () => {
    // เอกสารเชื่อมกับ PublishWorker — worker เช็คสองสถานะนี้แล้วข้าม
    expect(canTransition("pending", "approved")).toBe(true);
    expect(statusTh("pending")).toBe("รออนุมัติ");
  });
});
