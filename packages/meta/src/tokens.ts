/**
 * Token lifecycle (M0)
 *
 *   OAuth code → short-lived user token → long-lived user token → page tokens
 *   หรือทางที่ควรใช้กับลูกค้าจริง: System User Token จาก Business Manager (ไม่หมดอายุ)
 *
 * ทุก call ในไฟล์นี้ผ่าน MetaGateway เท่านั้น (กฎข้อ 1)
 */
import type { Logger } from "@page-os/core";
import { nullLogger } from "@page-os/core";
import type { MetaGateway } from "./gateway.js";
import { MetaApiError } from "./errors.js";
import { checkPermissions, type PermissionGap } from "./permissions.js";
import type { TokenType } from "./types.js";

export interface OAuthConfig {
  appId: string;
  redirectUri: string;
}

/** ผลจาก /oauth/access_token */
export interface RawTokenResponse {
  access_token: string;
  token_type?: string;
  /** วินาทีจนหมดอายุ; ไม่มี = ไม่หมดอายุ */
  expires_in?: number;
}

export interface ExchangedToken {
  accessToken: string;
  /** epoch ms; undefined = ไม่หมดอายุ */
  expiresAtMs?: number;
}

/** ผลจาก /debug_token */
export interface DebugTokenInfo {
  appId: string;
  type: string;
  application: string;
  /** epoch ms; undefined หรือ 0 = ไม่หมดอายุ */
  expiresAtMs?: number;
  dataAccessExpiresAtMs?: number;
  isValid: boolean;
  scopes: string[];
  userId?: string;
  /** เหตุผลที่ token ใช้ไม่ได้ (ถ้ามี) */
  invalidReason?: string;
}

export interface ManagedPage {
  pageId: string;
  name: string;
  category?: string;
  accessToken: string;
  /** permission ที่ token ของเพจนี้มีจริง */
  tasks: string[];
}

/** สถานะการเชื่อมต่อของเพจ 1 เพจ — ใช้เรนเดอร์หน้า Connection Status */
export type ConnectionState =
  | "ok"
  | "expiring_soon"
  | "expired"
  | "revoked"
  | "missing_permissions"
  | "no_token"
  | "unknown";

export interface PageConnectionHealth {
  pageId: string;
  state: ConnectionState;
  tokenType: TokenType;
  expiresAtMs?: number;
  /** เหลือกี่ชั่วโมงก่อนหมดอายุ (undefined = ไม่หมดอายุ) */
  hoursUntilExpiry?: number;
  permissions: PermissionGap;
  /** ข้อความไทยพร้อมบอกว่าต้องทำอะไร */
  th: string;
  checkedAtMs: number;
}

/** ต่ำกว่านี้ถือว่า "ใกล้หมดอายุ" ต้องเตือนแล้ว — 7 วัน */
export const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

function toExpiresAtMs(
  expiresIn: number | undefined,
  nowMs: number,
): number | undefined {
  if (expiresIn === undefined || expiresIn === null) return undefined;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return undefined;
  return nowMs + expiresIn * 1000;
}

/** วินาที (Meta ส่งมาเป็น epoch วินาที) → epoch ms; 0 แปลว่าไม่หมดอายุ */
function epochSecToMs(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n * 1000;
}

export class TokenService {
  constructor(
    private readonly gateway: MetaGateway,
    private readonly oauth: OAuthConfig,
    private readonly logger: Logger = nullLogger,
    private readonly nowFn: () => number = () => Date.now(),
  ) {}

  /** URL ที่ส่งให้ลูกค้ากดเชื่อมเพจ (Onboarding Wizard ขั้นที่ 1) */
  buildLoginUrl(scope: string, state: string): string {
    const u = new URL(
      `https://www.facebook.com/${this.gateway.graphVersion}/dialog/oauth`,
    );
    u.searchParams.set("client_id", this.oauth.appId);
    u.searchParams.set("redirect_uri", this.oauth.redirectUri);
    u.searchParams.set("scope", scope);
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    return u.toString();
  }

  /** ขั้นที่ 2: code → short-lived user token */
  async exchangeCode(code: string): Promise<ExchangedToken> {
    const res = await this.gateway.call<RawTokenResponse>({
      pageId: null,
      method: "GET",
      path: "oauth/access_token",
      priority: "realtime",
      params: {
        client_id: this.oauth.appId,
        redirect_uri: this.oauth.redirectUri,
        code,
      },
      // ห้าม retry — code ใช้ได้ครั้งเดียว ยิงซ้ำจะได้ error สับสน
      noRetry: true,
    });
    return this.toExchanged(res.data);
  }

  /** ขั้นที่ 3: short-lived → long-lived user token (~60 วัน) */
  async exchangeForLongLived(
    shortLivedToken: string,
  ): Promise<ExchangedToken> {
    const res = await this.gateway.call<RawTokenResponse>({
      pageId: null,
      method: "GET",
      path: "oauth/access_token",
      priority: "realtime",
      params: {
        grant_type: "fb_exchange_token",
        client_id: this.oauth.appId,
        fb_exchange_token: shortLivedToken,
      },
    });
    return this.toExchanged(res.data);
  }

  private toExchanged(raw: RawTokenResponse): ExchangedToken {
    if (!raw?.access_token) {
      throw new MetaApiError({
        message: "Facebook ไม่ได้ส่ง access_token กลับมา",
        code: 190,
        path: "oauth/access_token",
      });
    }
    const expiresAtMs = toExpiresAtMs(raw.expires_in, this.nowFn());
    const out: ExchangedToken = { accessToken: raw.access_token };
    if (expiresAtMs !== undefined) out.expiresAtMs = expiresAtMs;
    return out;
  }

  /**
   * ขั้นที่ 4: ดึง page tokens ทั้งหมดที่ user คนนี้ดูแล
   * page token ที่ได้จาก long-lived user token จะไม่หมดอายุ (ตราบใดที่ user token ยังใช้ได้)
   */
  async listManagedPages(userAccessToken: string): Promise<ManagedPage[]> {
    const pages: ManagedPage[] = [];
    let after: string | undefined;

    for (let guard = 0; guard < 25; guard++) {
      const params: Record<string, string | number> = {
        fields: "id,name,category,access_token,tasks",
        limit: 100,
      };
      if (after) params["after"] = after;

      const res = await this.gateway.call<{
        data?: Array<Record<string, unknown>>;
        paging?: { cursors?: { after?: string }; next?: string };
      }>({
        pageId: null,
        method: "GET",
        path: "me/accounts",
        accessToken: userAccessToken,
        priority: "realtime",
        params,
      });

      for (const p of res.data?.data ?? []) {
        const id = p["id"];
        const token = p["access_token"];
        if (typeof id !== "string" || typeof token !== "string") continue;
        pages.push({
          pageId: id,
          name: typeof p["name"] === "string" ? p["name"] : id,
          category:
            typeof p["category"] === "string" ? p["category"] : undefined,
          accessToken: token,
          tasks: Array.isArray(p["tasks"]) ? (p["tasks"] as string[]) : [],
        });
      }

      const next = res.data?.paging?.next;
      after = res.data?.paging?.cursors?.after;
      if (!next || !after) break;
    }
    return pages;
  }

  /**
   * ตรวจ token — หัวใจของ health check ทุก 6 ชม. (สเปกข้อ M0)
   * ใช้ app access token ตรวจ ไม่ต้องใช้ token ที่กำลังตรวจ
   */
  async debugToken(token: string): Promise<DebugTokenInfo> {
    const res = await this.gateway.call<{
      data?: Record<string, unknown>;
    }>({
      pageId: null,
      method: "GET",
      path: "debug_token",
      priority: "high",
      params: { input_token: token },
    });

    const d = res.data?.data ?? {};
    const errorObj = d["error"] as Record<string, unknown> | undefined;
    return {
      appId: String(d["app_id"] ?? ""),
      type: String(d["type"] ?? ""),
      application: String(d["application"] ?? ""),
      expiresAtMs: epochSecToMs(d["expires_at"]),
      dataAccessExpiresAtMs: epochSecToMs(d["data_access_expires_at"]),
      isValid: d["is_valid"] === true,
      scopes: Array.isArray(d["scopes"]) ? (d["scopes"] as string[]) : [],
      userId: typeof d["user_id"] === "string" ? d["user_id"] : undefined,
      invalidReason:
        errorObj && typeof errorObj["message"] === "string"
          ? errorObj["message"]
          : undefined,
    };
  }

  /**
   * ประเมินสถานะการเชื่อมต่อของเพจ — ใช้ทั้งใน cron health check
   * และหน้า Connection Status
   */
  async checkPageHealth(args: {
    pageId: string;
    token: string;
    tokenType: TokenType;
    requiredPermissions?: readonly string[];
  }): Promise<PageConnectionHealth> {
    const checkedAtMs = this.nowFn();
    let info: DebugTokenInfo;
    try {
      info = await this.debugToken(args.token);
    } catch (err) {
      const e = err instanceof MetaApiError ? err : undefined;
      this.logger.warn("debug_token ล้มเหลว", {
        pageId: args.pageId,
        err: e?.toJSON() ?? String(err),
      });
      return {
        pageId: args.pageId,
        state: e?.action === "reconnect" ? "revoked" : "unknown",
        tokenType: args.tokenType,
        permissions: { missing: [], blockedFeatures: [], ok: false },
        th:
          e?.th ??
          "ตรวจสถานะ token ไม่สำเร็จ — ลองใหม่อีกครั้ง หรือดู log ประกอบ",
        checkedAtMs,
      };
    }

    const permissions = checkPermissions(
      info.scopes,
      args.requiredPermissions,
    );

    if (!info.isValid) {
      return {
        pageId: args.pageId,
        state: "revoked",
        tokenType: args.tokenType,
        expiresAtMs: info.expiresAtMs,
        permissions,
        th: `token ถูกเพิกถอนแล้ว${info.invalidReason ? ` (${info.invalidReason})` : ""} — ต้องส่งลิงก์ให้ลูกค้าเชื่อมเพจใหม่`,
        checkedAtMs,
      };
    }

    // System User Token ไม่มีวันหมดอายุ → expiresAtMs undefined
    if (info.expiresAtMs === undefined) {
      if (!permissions.ok) {
        return {
          pageId: args.pageId,
          state: "missing_permissions",
          tokenType: args.tokenType,
          permissions,
          th: `token ใช้ได้ แต่ขาดสิทธิ์: ${permissions.missing.join(", ")} — ฟีเจอร์ที่ยังใช้ไม่ได้: ${permissions.blockedFeatures.join(", ") || "-"}`,
          checkedAtMs,
        };
      }
      return {
        pageId: args.pageId,
        state: "ok",
        tokenType: args.tokenType,
        permissions,
        th: "token ปกติ ไม่มีวันหมดอายุ",
        checkedAtMs,
      };
    }

    const remainingMs = info.expiresAtMs - checkedAtMs;
    const hoursUntilExpiry = Math.floor(remainingMs / 3_600_000);

    if (remainingMs <= 0) {
      return {
        pageId: args.pageId,
        state: "expired",
        tokenType: args.tokenType,
        expiresAtMs: info.expiresAtMs,
        hoursUntilExpiry: 0,
        permissions,
        th: "token หมดอายุแล้ว — ต้องส่งลิงก์ให้ลูกค้าเชื่อมเพจใหม่",
        checkedAtMs,
      };
    }
    if (remainingMs <= EXPIRY_WARNING_MS) {
      return {
        pageId: args.pageId,
        state: "expiring_soon",
        tokenType: args.tokenType,
        expiresAtMs: info.expiresAtMs,
        hoursUntilExpiry,
        permissions,
        th: `token จะหมดอายุในอีก ${Math.ceil(remainingMs / 86_400_000)} วัน — ควรต่ออายุหรือย้ายไปใช้ System User Token`,
        checkedAtMs,
      };
    }
    if (!permissions.ok) {
      return {
        pageId: args.pageId,
        state: "missing_permissions",
        tokenType: args.tokenType,
        expiresAtMs: info.expiresAtMs,
        hoursUntilExpiry,
        permissions,
        th: `token ใช้ได้ แต่ขาดสิทธิ์: ${permissions.missing.join(", ")} — ฟีเจอร์ที่ยังใช้ไม่ได้: ${permissions.blockedFeatures.join(", ") || "-"}`,
        checkedAtMs,
      };
    }
    return {
      pageId: args.pageId,
      state: "ok",
      tokenType: args.tokenType,
      expiresAtMs: info.expiresAtMs,
      hoursUntilExpiry,
      permissions,
      th: `token ปกติ เหลืออีก ${Math.floor(remainingMs / 86_400_000)} วัน`,
      checkedAtMs,
    };
  }
}

/** สถานะไหนต้องยิง alert เข้า LINE ทันที (M8 Alert Center) */
export function needsAlert(state: ConnectionState): boolean {
  return (
    state === "expired" ||
    state === "revoked" ||
    state === "expiring_soon" ||
    state === "missing_permissions"
  );
}
