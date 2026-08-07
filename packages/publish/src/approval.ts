/**
 * Approval Queue (M4)
 *
 * "ลูกค้ากดอนุมัติผ่าน Client Portal หรือผ่าน LINE (ปุ่ม อนุมัติ/แก้ไข)"
 *
 * ลิงก์อนุมัติต้องใช้ได้โดยลูกค้าไม่ต้อง login (กดจาก LINE ได้เลย) จึงต้อง:
 *   - เซ็นด้วย HMAC ปลอมไม่ได้
 *   - ผูกกับโพสต์ใบเดียว ใช้กับโพสต์อื่นไม่ได้
 *   - หมดอายุ
 *   - ใช้ได้ครั้งเดียวต่อการตัดสินใจ (กันกดซ้ำจากแชทเก่า)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { systemClock, type Clock } from "@page-os/core";

export type ApprovalStatus =
  | "none"
  | "pending"
  | "approved"
  | "changes_requested";

export type ApprovalDecision = "approve" | "request_changes";

export class ApprovalError extends Error {
  override readonly name = "ApprovalError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

/** ลิงก์อนุมัติมีอายุ 14 วัน — ยาวพอให้ลูกค้าที่ตอบช้า แต่ไม่ค้างตลอดไป */
export const APPROVAL_TOKEN_TTL_MS = 14 * 86_400_000;

export interface ApprovalTokenPayload {
  postId: string;
  decision: ApprovalDecision;
  issuedAtMs: number;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * สร้าง token สำหรับปุ่มใน LINE
 * แยก token ต่อการตัดสินใจ — ปุ่ม "อนุมัติ" กับ "ขอแก้" ใช้คนละอัน
 */
export function createApprovalToken(
  args: { postId: string; decision: ApprovalDecision; nowMs: number },
  secret: string,
): string {
  const payload: ApprovalTokenPayload = {
    postId: args.postId,
    decision: args.decision,
    issuedAtMs: args.nowMs,
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${b64}.${sign(b64, secret)}`;
}

export function verifyApprovalToken(
  token: string | undefined | null,
  secret: string,
  nowMs: number,
  ttlMs = APPROVAL_TOKEN_TTL_MS,
): ApprovalTokenPayload {
  const invalid = (msg: string): never => {
    throw new ApprovalError(
      msg,
      "ลิงก์อนุมัติไม่ถูกต้อง — กรุณาเปิดจากข้อความล่าสุดที่เราส่งให้",
    );
  };

  if (!token) invalid("missing token");
  const dot = token!.lastIndexOf(".");
  if (dot <= 0) invalid("malformed token");

  const b64 = token!.slice(0, dot);
  const expected = Buffer.from(sign(b64, secret), "utf8");
  const actual = Buffer.from(token!.slice(dot + 1), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    invalid("bad signature");
  }

  let payload: ApprovalTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(b64, "base64url").toString("utf8"),
    ) as ApprovalTokenPayload;
  } catch {
    return invalid("unparseable payload");
  }
  if (
    typeof payload?.postId !== "string" ||
    (payload.decision !== "approve" && payload.decision !== "request_changes")
  ) {
    invalid("invalid payload");
  }
  if (nowMs - payload.issuedAtMs > ttlMs) {
    throw new ApprovalError(
      "token expired",
      "ลิงก์อนุมัติหมดอายุแล้ว — กรุณาแจ้งเราเพื่อส่งลิงก์ใหม่",
    );
  }
  return payload;
}

// ---------------------------------------------------------------------------

/** สถานะไหนเปลี่ยนไปเป็นอะไรได้บ้าง */
const ALLOWED: Record<ApprovalStatus, ApprovalStatus[]> = {
  none: ["pending"],
  pending: ["approved", "changes_requested"],
  // ลูกค้าเปลี่ยนใจหลังอนุมัติได้ ตราบใดที่ยังไม่ถึงเวลาโพสต์
  approved: ["changes_requested", "pending"],
  // แก้แล้วส่งขออนุมัติใหม่
  changes_requested: ["pending"],
};

export function canTransition(
  from: ApprovalStatus,
  to: ApprovalStatus,
): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export interface ApprovalRepository {
  getStatus(postId: string): Promise<{
    status: ApprovalStatus;
    /** โพสต์ขึ้นเพจไปแล้วหรือยัง — ถ้าขึ้นแล้วห้ามเปลี่ยนสถานะอนุมัติ */
    alreadyPublished: boolean;
  } | null>;
  setStatus(args: {
    postId: string;
    status: ApprovalStatus;
    note?: string;
    actor: string;
    atMs: number;
  }): Promise<void>;
}

export interface ApprovalNotifier {
  /** ส่งการ์ดขออนุมัติเข้า LINE พร้อมปุ่ม 2 ปุ่ม */
  requestApproval(args: {
    postId: string;
    approveUrl: string;
    changesUrl: string;
  }): Promise<void>;
}

export interface ApprovalResult {
  status: ApprovalStatus;
  th: string;
}

export interface ApprovalServiceOptions {
  repo: ApprovalRepository;
  secret: string;
  /** base URL ของหน้า callback เช่น https://pageos.app/approve */
  approveBaseUrl: string;
  notifier?: ApprovalNotifier;
  clock?: Clock;
}

export class ApprovalService {
  private readonly repo: ApprovalRepository;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly notifier: ApprovalNotifier | undefined;
  private readonly clock: Clock;

  constructor(opts: ApprovalServiceOptions) {
    this.repo = opts.repo;
    this.secret = opts.secret;
    this.baseUrl = opts.approveBaseUrl.replace(/\/+$/, "");
    this.notifier = opts.notifier;
    this.clock = opts.clock ?? systemClock;
  }

  private url(postId: string, decision: ApprovalDecision): string {
    const token = createApprovalToken(
      { postId, decision, nowMs: this.clock.now() },
      this.secret,
    );
    return `${this.baseUrl}?t=${encodeURIComponent(token)}`;
  }

  /** ส่งโพสต์เข้าคิวรออนุมัติ แล้วยิงการ์ดเข้า LINE */
  async requestApproval(postId: string): Promise<ApprovalResult> {
    const current = await this.repo.getStatus(postId);
    if (!current) {
      throw new ApprovalError("post not found", "ไม่พบโพสต์นี้แล้ว");
    }
    if (current.alreadyPublished) {
      throw new ApprovalError(
        "already published",
        "โพสต์นี้ขึ้นเพจไปแล้ว ขออนุมัติย้อนหลังไม่ได้",
      );
    }
    if (!canTransition(current.status, "pending")) {
      throw new ApprovalError(
        `cannot move ${current.status} -> pending`,
        `โพสต์นี้อยู่ในสถานะ "${statusTh(current.status)}" จึงส่งขออนุมัติซ้ำไม่ได้`,
      );
    }

    await this.repo.setStatus({
      postId,
      status: "pending",
      actor: "system",
      atMs: this.clock.now(),
    });

    await this.notifier?.requestApproval({
      postId,
      approveUrl: this.url(postId, "approve"),
      changesUrl: this.url(postId, "request_changes"),
    });

    return { status: "pending", th: "ส่งให้ลูกค้าอนุมัติแล้ว" };
  }

  /** ลูกค้ากดปุ่มจาก LINE หรือ Client Portal */
  async decideByToken(
    token: string | undefined | null,
    note?: string,
  ): Promise<ApprovalResult> {
    const now = this.clock.now();
    const payload = verifyApprovalToken(token, this.secret, now);
    return this.decide({
      postId: payload.postId,
      decision: payload.decision,
      actor: "client",
      ...(note !== undefined ? { note } : {}),
    });
  }

  async decide(args: {
    postId: string;
    decision: ApprovalDecision;
    actor: string;
    note?: string;
  }): Promise<ApprovalResult> {
    const current = await this.repo.getStatus(args.postId);
    if (!current) {
      throw new ApprovalError("post not found", "ไม่พบโพสต์นี้แล้ว");
    }
    if (current.alreadyPublished) {
      throw new ApprovalError(
        "already published",
        "โพสต์นี้ขึ้นเพจไปแล้ว เปลี่ยนผลอนุมัติไม่ได้",
      );
    }

    const next: ApprovalStatus =
      args.decision === "approve" ? "approved" : "changes_requested";

    // กดปุ่มเดิมซ้ำจากแชทเก่า — ไม่ควรเป็น error ให้ลูกค้าตกใจ
    if (current.status === next) {
      return {
        status: next,
        th:
          next === "approved"
            ? "โพสต์นี้อนุมัติไว้แล้ว ไม่ต้องกดซ้ำ"
            : "รับเรื่องขอแก้ไขไว้แล้ว ทีมงานกำลังดำเนินการ",
      };
    }

    if (!canTransition(current.status, next)) {
      throw new ApprovalError(
        `cannot move ${current.status} -> ${next}`,
        `โพสต์นี้อยู่ในสถานะ "${statusTh(current.status)}" จึงเปลี่ยนเป็น "${statusTh(next)}" ไม่ได้`,
      );
    }

    await this.repo.setStatus({
      postId: args.postId,
      status: next,
      actor: args.actor,
      atMs: this.clock.now(),
      ...(args.note !== undefined ? { note: args.note } : {}),
    });

    return {
      status: next,
      th:
        next === "approved"
          ? "อนุมัติเรียบร้อย โพสต์จะขึ้นตามเวลาที่ตั้งไว้"
          : "รับเรื่องขอแก้ไขแล้ว ทีมงานจะแก้แล้วส่งให้ดูใหม่",
    };
  }
}

/** ป้ายไทยของสถานะอนุมัติ */
export function statusTh(s: ApprovalStatus): string {
  switch (s) {
    case "none":
      return "ไม่ต้องอนุมัติ";
    case "pending":
      return "รออนุมัติ";
    case "approved":
      return "อนุมัติแล้ว";
    case "changes_requested":
      return "ขอแก้ไข";
  }
}
