/**
 * สิ่งที่ลูกค้ากดได้จาก portal (M9)
 *
 * สเปก: "กดอนุมัติ/ขอแก้"
 *
 * ⚠️ จุดที่ต้องระวัง: `ApprovalService.decide()` ของ M-B **ไม่รู้จักขอบเขตลูกค้า**
 * มันถูกออกแบบมาให้ทีมงานเรียกและให้ลิงก์จาก LINE เรียก ซึ่งทั้งสองทาง
 * ผูกกับโพสต์ใบเดียวอยู่แล้ว
 *
 * แต่ portal ต่างออกไป: `postId` มาจากคำขอของผู้ใช้ ถ้าส่งต่อเข้าไปตรงๆ
 * ลูกค้า ก จะกดอนุมัติโพสต์ของลูกค้า ข ได้ด้วยการเปลี่ยนตัวเลขใน URL
 * (IDOR — ช่องโหว่ที่พบบ่อยที่สุดในระบบที่มีหลายผู้เช่า)
 *
 * ไฟล์นี้จึงเป็นชั้นที่ **ตรวจความเป็นเจ้าของก่อนเสมอ** แล้วค่อยส่งต่อ
 */
import type { ApprovalDecision, ApprovalStatus } from "@page-os/publish";
import { assertCan, assertPageInScope, type PortalScope } from "./scope.js";

/** สิ่งที่ต้องรู้เกี่ยวกับโพสต์ก่อนตัดสินใจว่าให้กดได้ไหม */
export interface PostOwnership {
  postId: string;
  pageId: string;
}

export interface PortalApprovalDeps {
  /** หาว่าโพสต์นี้เป็นของเพจไหน — คืน null ถ้าไม่มีโพสต์นี้ */
  findPost(postId: string): Promise<PostOwnership | null>;
  /** ตัวตัดสินจริง (ApprovalService.decide ของ M-B) */
  decide(args: {
    postId: string;
    decision: ApprovalDecision;
    actor: string;
    note?: string;
  }): Promise<{ status: ApprovalStatus; th: string }>;
}

/** บันทึกว่าใครกดอะไร — ป้องกันข้อพิพาทกับลูกค้า (สเปกข้อ M8 Audit Log) */
export interface PortalAuditSink {
  record(entry: {
    atMs: number;
    workspaceId: string;
    email: string;
    action: string;
    targetId: string;
    detail?: string;
  }): Promise<void>;
}

export const noopAudit: PortalAuditSink = {
  async record() {
    /* ไม่ทำอะไร — ใช้ตอนเทสต์หรือตอนยังไม่มีที่เก็บ */
  },
};

export class PortalActionError extends Error {
  override readonly name = "PortalActionError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface DecideResult {
  postId: string;
  status: ApprovalStatus;
  th: string;
}

/**
 * ลูกค้ากดอนุมัติหรือขอแก้
 *
 * ลำดับการตรวจ (ห้ามสลับ):
 *   1. มีสิทธิ์กดไหม
 *   2. โพสต์นี้มีจริงไหม และเป็นของเพจที่ลูกค้ารายนี้ดูแลอยู่ไหม
 *   3. ค่อยส่งต่อให้ตัวตัดสินจริง
 *
 * ข้อ 2 ต้องตอบเหมือนกันทั้ง "ไม่มีโพสต์นี้" และ "โพสต์นี้ของคนอื่น"
 * ไม่งั้นการไล่เลข id จะบอกได้ว่าโพสต์ไหนมีอยู่จริงในระบบ
 */
export async function decideFromPortal(
  scope: PortalScope,
  deps: PortalApprovalDeps,
  args: {
    postId: string;
    decision: ApprovalDecision;
    note?: string;
    nowMs: number;
    audit?: PortalAuditSink;
  },
): Promise<DecideResult> {
  assertCan(scope, "approve");

  const notFound = (): never => {
    throw new PortalActionError(
      `post ${args.postId} not visible to ${scope.workspaceId}`,
      "ไม่พบโพสต์นี้ในบัญชีของคุณ",
    );
  };

  const post = await deps.findPost(args.postId);
  if (!post) notFound();
  // ตรงนี้คือด่านที่กัน IDOR — ห้ามลบ
  if (!scope.pageIds.includes(post!.pageId)) notFound();
  assertPageInScope(scope, post!.pageId);

  if (args.note !== undefined && args.note.length > 2000) {
    throw new PortalActionError(
      "note too long",
      "ข้อความขอแก้ไขยาวเกินไป กรุณาย่อให้สั้นลง (ไม่เกิน 2,000 ตัวอักษร)",
    );
  }

  const result = await deps.decide({
    postId: args.postId,
    decision: args.decision,
    // ระบุให้ชัดว่ามาจาก portal ไม่ใช่ทีมงานกดเอง — สำคัญตอนมีข้อโต้แย้ง
    actor: `portal:${scope.email}`,
    ...(args.note !== undefined ? { note: args.note } : {}),
  });

  await (args.audit ?? noopAudit).record({
    atMs: args.nowMs,
    workspaceId: scope.workspaceId,
    email: scope.email,
    action: args.decision === "approve" ? "portal.approve" : "portal.request_changes",
    targetId: args.postId,
    ...(args.note !== undefined ? { detail: args.note } : {}),
  });

  return { postId: args.postId, status: result.status, th: result.th };
}
