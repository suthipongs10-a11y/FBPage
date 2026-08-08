/**
 * Magic link login (M9)
 *
 * สเปก: "ลิงก์เฉพาะลูกค้า login ด้วย magic link (ไม่ต้องมีรหัสผ่าน)"
 *
 * เหตุผลที่ไม่ใช้รหัสผ่าน: ลูกค้าคือเจ้าของร้านที่เข้าเดือนละสองครั้ง
 * เขาจะลืมรหัสทุกครั้ง แล้วโทรหาเรา — ซึ่งแพงกว่าค่าส่งอีเมลมาก
 * และรหัสผ่านที่ตั้งเองมักซ้ำกับที่อื่น ทำให้เรากลายเป็นจุดที่รหัสหลุด
 *
 * สิ่งที่ต้องทำให้ถูกในไฟล์นี้ (ผิดข้อใดข้อหนึ่งคือประตูเปิด):
 *   1. ลิงก์อายุสั้น — อีเมลถูกส่งต่อ/ค้างในกล่องขาเข้าเป็นปี
 *   2. ใช้ได้ครั้งเดียว — ลิงก์ใน history ของเบราว์เซอร์ใช้ซ้ำไม่ได้
 *   3. ตอบเหมือนกันไม่ว่าอีเมลจะมีในระบบหรือไม่ — ไม่งั้นกลายเป็นเครื่องมือ
 *      ให้คนไล่เดาว่าใครเป็นลูกค้าเรา
 *   4. จำกัดจำนวนครั้ง — ไม่งั้นถูกใช้ยิงสแปมใส่อีเมลลูกค้าในนามเรา
 *   5. ห้าม log ตัวลิงก์ — ลิงก์คือรหัสผ่านชั่วคราว (กฎข้อ 3 โดยอนุโลม)
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { systemClock, type Clock } from "@page-os/core";
import {
  DEFAULT_PERMISSIONS,
  type PortalPermissions,
  type PortalScope,
} from "./scope.js";

/**
 * ลิงก์อายุ 15 นาที
 *
 * สั้นพอที่ลิงก์ค้างในกล่องอีเมลจะใช้ไม่ได้ ยาวพอให้คนที่เปิดอีเมลบนมือถือ
 * แล้วเดินไปเปิดคอมยังทัน ถ้าสั้นกว่านี้คนจะกดขอใหม่จนน่ารำคาญ
 */
export const MAGIC_LINK_TTL_MS = 15 * 60_000;

/**
 * session อายุ 7 วัน
 *
 * ลูกค้าเข้ามาดูปฏิทินสัปดาห์ละครั้ง ถ้าสั้นกว่านี้ต้องขอลิงก์ใหม่ทุกครั้ง
 * จนเลิกเข้า — ซึ่งทำให้ฟีเจอร์นี้ไร้ความหมาย
 */
export const SESSION_TTL_MS = 7 * 86_400_000;

/** ขอลิงก์ได้กี่ครั้งต่ออีเมลในหนึ่งช่วงเวลา */
export const MAX_REQUESTS_PER_WINDOW = 5;
export const THROTTLE_WINDOW_MS = 15 * 60_000;

export class PortalAuthError extends Error {
  override readonly name: string = "PortalAuthError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface MagicLinkPayload {
  /** id ของลิงก์ใบนี้ — ใช้กันการใช้ซ้ำ */
  jti: string;
  email: string;
  workspaceId: string;
  issuedAtMs: number;
}

export interface SessionPayload {
  workspaceId: string;
  email: string;
  issuedAtMs: number;
  /** รุ่นของ session ที่ยอมรับ — ขยับค่านี้เพื่อเตะทุกคนออกพร้อมกัน */
  epoch: number;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function encode(kind: string, payload: unknown, secret: string): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const body = `${kind}.${b64}`;
  return `${body}.${sign(body, secret)}`;
}

function decode<T>(
  token: string | undefined | null,
  kind: string,
  secret: string,
  onInvalid: () => never,
): T {
  if (!token) onInvalid();
  const parts = token!.split(".");
  if (parts.length !== 3) onInvalid();
  const [gotKind, b64, sig] = parts as [string, string, string];
  // ตรวจชนิดด้วย — ไม่งั้น session token เอาไปใช้เป็น magic link ได้
  // (ทั้งคู่เซ็นด้วยกุญแจเดียวกัน ลายเซ็นจึงผ่านทั้งคู่)
  if (gotKind !== kind) onInvalid();

  const expected = Buffer.from(sign(`${gotKind}.${b64}`, secret), "utf8");
  const actual = Buffer.from(sig, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    onInvalid();
  }
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as T;
  } catch {
    return onInvalid();
  }
}

/** ข้อความเดียวกันทุกกรณีที่ลิงก์ใช้ไม่ได้ — ไม่บอกว่าเพราะอะไร */
function badLink(reason: string): never {
  throw new PortalAuthError(
    `magic link rejected: ${reason}`,
    "ลิงก์นี้ใช้ไม่ได้แล้ว — ลิงก์มีอายุ 15 นาทีและใช้ได้ครั้งเดียว กรุณาขอลิงก์ใหม่",
  );
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** ตรวจรูปแบบพอให้ไม่ส่งอีเมลไปที่ขยะ ไม่ได้พยายามตรวจตามมาตรฐานเต็ม */
export function looksLikeEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e) && e.length <= 254;
}

// ── ที่เก็บสถานะที่ต้องมีจากภายนอก ─────────────────────────────────────────

export interface MagicLinkStore {
  /**
   * ทำเครื่องหมายว่าลิงก์ใบนี้ถูกใช้แล้ว
   *
   * ต้องเป็น atomic — คืน `true` เฉพาะครั้งแรกเท่านั้น
   * ถ้า implement เป็น "อ่านแล้วค่อยเขียน" จะมีช่องให้กดสองแท็บพร้อมกันแล้วผ่านทั้งคู่
   */
  consume(jti: string, expiresAtMs: number): Promise<boolean>;
}

export interface PortalAccount {
  workspaceId: string;
  clientName: string;
  permissions?: PortalPermissions;
}

export interface PortalDirectory {
  /** หาบัญชีจากอีเมล — คืน null ถ้าไม่มี (ห้ามบอกผู้ใช้ว่าไม่มี) */
  findByEmail(email: string): Promise<PortalAccount | null>;
  /**
   * เพจของ workspace นี้ **ณ ตอนนี้**
   *
   * จงใจไม่เก็บรายการเพจไว้ใน session token: ถ้าเก็บ เพจที่ถูกถอดออกจาก
   * สัญญาแล้วจะยังเปิดดูได้จนกว่า session จะหมดอายุ (นานสุด 7 วัน)
   */
  pageIdsOf(workspaceId: string): Promise<string[]>;
  /** รุ่นของ session ที่ยังใช้ได้ — เพิ่มค่าเพื่อยกเลิกทุก session ทันทีที่เลิกสัญญา */
  sessionEpochOf(workspaceId: string): Promise<number>;
}

export interface Throttle {
  /** นับครั้ง คืนจำนวนครั้งในหน้าต่างเวลาปัจจุบัน (รวมครั้งนี้) */
  hit(key: string, windowMs: number, nowMs: number): Promise<number>;
}

/** throttle แบบเก็บในหน่วยความจำ — พอสำหรับเครื่องเดียว */
export class InMemoryThrottle implements Throttle {
  private readonly hits = new Map<string, number[]>();

  async hit(key: string, windowMs: number, nowMs: number): Promise<number> {
    const cutoff = nowMs - windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    kept.push(nowMs);
    this.hits.set(key, kept);
    return kept.length;
  }
}

/** เก็บ jti ที่ใช้ไปแล้วในหน่วยความจำ */
export class InMemoryMagicLinkStore implements MagicLinkStore {
  private readonly used = new Map<string, number>();

  async consume(jti: string, expiresAtMs: number): Promise<boolean> {
    // ล้างของที่หมดอายุทิ้ง ไม่งั้น map โตไม่หยุด
    for (const [k, exp] of this.used) {
      if (exp < expiresAtMs - MAGIC_LINK_TTL_MS) this.used.delete(k);
    }
    if (this.used.has(jti)) return false;
    this.used.set(jti, expiresAtMs);
    return true;
  }
}

// ── บริการหลัก ─────────────────────────────────────────────────────────────

export interface RequestLinkResult {
  /**
   * ลิงก์ที่ต้องส่งทางอีเมล — **undefined เมื่ออีเมลไม่มีในระบบ**
   *
   * ตัวเรียกต้องส่งอีเมลเฉพาะเมื่อมีค่า แต่ต้องแสดงผลให้ผู้ใช้เหมือนกันทั้งสองกรณี
   */
  url?: string;
  /** ข้อความที่แสดงให้ผู้ใช้เห็น — เหมือนกันเสมอ ไม่ว่าอีเมลจะมีจริงหรือไม่ */
  th: string;
}

export interface PortalAuthOptions {
  directory: PortalDirectory;
  store: MagicLinkStore;
  secret: string;
  /** base URL ของหน้ารับลิงก์ เช่น https://client.pageos.app/enter */
  loginBaseUrl: string;
  throttle?: Throttle;
  clock?: Clock;
  /** ฉีดเข้ามาเพื่อให้เทสต์คาดเดาได้ */
  newId?: () => string;
}

export class PortalAuth {
  private readonly directory: PortalDirectory;
  private readonly store: MagicLinkStore;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly throttle: Throttle;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(opts: PortalAuthOptions) {
    this.directory = opts.directory;
    this.store = opts.store;
    this.secret = opts.secret;
    this.baseUrl = opts.loginBaseUrl.replace(/\/+$/, "");
    this.throttle = opts.throttle ?? new InMemoryThrottle();
    this.clock = opts.clock ?? systemClock;
    this.newId = opts.newId ?? (() => randomUUID());
  }

  /**
   * ขอลิงก์เข้าระบบ
   *
   * ตอบข้อความเดียวกันเสมอ ไม่ว่าอีเมลนั้นจะเป็นลูกค้าเราหรือไม่ —
   * ถ้าตอบต่างกัน หน้านี้จะกลายเป็นเครื่องมือให้คู่แข่งไล่เช็คว่าใครใช้บริการเราอยู่
   */
  async requestLink(rawEmail: string): Promise<RequestLinkResult> {
    const sameAnswer =
      "ถ้าอีเมลนี้อยู่ในระบบ เราส่งลิงก์เข้าใช้งานไปให้แล้ว กรุณาเช็คกล่องจดหมาย (ลิงก์มีอายุ 15 นาที)";
    const email = normalizeEmail(rawEmail);

    if (!looksLikeEmail(email)) {
      throw new PortalAuthError(
        "invalid email format",
        "รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจอีกครั้ง",
      );
    }

    const now = this.clock.now();
    const count = await this.throttle.hit(
      `magic:${email}`,
      THROTTLE_WINDOW_MS,
      now,
    );
    if (count > MAX_REQUESTS_PER_WINDOW) {
      throw new PortalAuthError(
        "throttled",
        "ขอลิงก์ถี่เกินไป กรุณารอสัก 15 นาทีแล้วลองใหม่",
      );
    }

    const account = await this.directory.findByEmail(email);
    // ไม่พบบัญชี: จบเงียบๆ แต่ตอบเหมือนกรณีสำเร็จ
    if (!account) return { th: sameAnswer };

    const payload: MagicLinkPayload = {
      jti: this.newId(),
      email,
      workspaceId: account.workspaceId,
      issuedAtMs: now,
    };
    const token = encode("ml1", payload, this.secret);

    return {
      url: `${this.baseUrl}?t=${encodeURIComponent(token)}`,
      th: sameAnswer,
    };
  }

  /**
   * แลกลิงก์เป็น session
   *
   * ลำดับการตรวจสำคัญ: ตรวจลายเซ็นและอายุ **ก่อน** ไปแตะที่เก็บข้อมูล
   * ไม่งั้นคนยิง token มั่วๆ จะทำให้เราเขียน DB ฟรีๆ ทุกครั้ง
   */
  async redeem(token: string | undefined | null): Promise<{
    sessionToken: string;
    scope: PortalScope;
    th: string;
  }> {
    const now = this.clock.now();
    const payload = decode<MagicLinkPayload>(token, "ml1", this.secret, () =>
      badLink("bad signature or format"),
    );

    if (
      typeof payload.jti !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.workspaceId !== "string" ||
      typeof payload.issuedAtMs !== "number"
    ) {
      badLink("invalid payload");
    }
    if (now - payload.issuedAtMs > MAGIC_LINK_TTL_MS) badLink("expired");
    // ลิงก์ที่ประทับเวลาในอนาคตแปลว่านาฬิกาเพี้ยนหรือมีคนแก้ payload
    if (payload.issuedAtMs > now + 60_000) badLink("issued in the future");

    // อ่านบัญชี **ก่อน** เผาลิงก์
    //
    // ถ้าเผาก่อนแล้วการอ่านล้มเหลวเพราะ DB สะดุดชั่วขณะ ลิงก์ของลูกค้าจะถูกใช้ไป
    // ทั้งที่ยังไม่ได้เข้าระบบ แล้วเขาต้องขอใหม่โดยไม่รู้ว่าทำอะไรผิด
    // สลับลำดับแล้วยังกันการใช้ซ้ำได้เท่าเดิม เพราะ `consume` ยังเป็นประตูอะตอมมิก
    // ที่ผู้ชนะได้ใบเดียวอยู่ดี — การอ่านบัญชีไม่ได้เปลี่ยนสถานะอะไร
    const account = await this.directory.findByEmail(payload.email);
    // บัญชีอาจถูกลบหลังส่งลิงก์ไปแล้ว
    if (!account || account.workspaceId !== payload.workspaceId) {
      badLink("account changed");
    }

    const fresh = await this.store.consume(
      payload.jti,
      payload.issuedAtMs + MAGIC_LINK_TTL_MS,
    );
    if (!fresh) badLink("already used");

    const epoch = await this.directory.sessionEpochOf(account!.workspaceId);
    const session: SessionPayload = {
      workspaceId: account!.workspaceId,
      email: payload.email,
      issuedAtMs: now,
      epoch,
    };

    return {
      sessionToken: encode("ps1", session, this.secret),
      scope: await this.scopeOf(session, account!),
      th: `ยินดีต้อนรับ ${account!.clientName}`,
    };
  }

  /**
   * ตรวจ session แล้วสร้างขอบเขตใหม่ทุกครั้ง
   *
   * ไม่เชื่อรายการเพจจาก token — อ่านจาก directory ใหม่เสมอ เพื่อให้การถอดเพจ
   * ออกจากสัญญามีผลทันที ไม่ต้องรอ session หมดอายุ
   */
  async verifySession(
    sessionToken: string | undefined | null,
  ): Promise<PortalScope> {
    const now = this.clock.now();
    const expired = (): never => {
      throw new PortalAuthError(
        "session invalid",
        "เซสชันหมดอายุแล้ว กรุณาขอลิงก์เข้าใช้งานใหม่",
      );
    };

    const payload = decode<SessionPayload>(
      sessionToken,
      "ps1",
      this.secret,
      expired,
    );
    if (
      typeof payload.workspaceId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.issuedAtMs !== "number"
    ) {
      expired();
    }
    if (now - payload.issuedAtMs > SESSION_TTL_MS) expired();

    const account = await this.directory.findByEmail(payload.email);
    if (!account || account.workspaceId !== payload.workspaceId) expired();

    const epoch = await this.directory.sessionEpochOf(payload.workspaceId);
    // epoch ขยับ = ยกเลิก session ทั้งหมดของ workspace นี้ (เช่นตอนจบสัญญา)
    if (epoch !== payload.epoch) expired();

    return this.scopeOf(payload, account!);
  }

  private async scopeOf(
    session: Pick<SessionPayload, "workspaceId" | "email">,
    account: PortalAccount,
  ): Promise<PortalScope> {
    const pageIds = await this.directory.pageIdsOf(session.workspaceId);
    return {
      workspaceId: session.workspaceId,
      clientName: account.clientName,
      pageIds,
      permissions: account.permissions ?? DEFAULT_PERMISSIONS,
      email: session.email,
    };
  }
}
