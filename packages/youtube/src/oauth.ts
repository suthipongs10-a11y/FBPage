/**
 * ต่ออายุโทเคน OAuth ของ Google ให้เอง
 *
 * ─── ทำไมไม่เก็บ access token ไว้ใน .env ตรงๆ ───
 *
 * access token ของ Google **หมดอายุใน 1 ชั่วโมง** ถ้าเก็บไว้ใน .env
 * ระบบจะใช้งานได้ชั่วโมงเดียวหลังตั้งค่า แล้วเงียบไปจนกว่าจะมีคนมาแปะใหม่
 *
 * สิ่งที่ต้องเก็บคือ **refresh token** ซึ่งอยู่ได้จนกว่าเจ้าของจะเพิกถอน —
 * แล้วให้ตัวนี้แลกเป็น access token ใหม่ตอนใกล้หมดอายุ
 *
 * ─── ทำไมต้องจำไว้ ไม่ใช่ขอใหม่ทุกครั้ง ───
 *
 * การแลกโทเคนไม่กินโควตา YouTube ก็จริง แต่เป็นการยิงข้ามเน็ตเวิร์กหนึ่งรอบ
 * ที่คนกดปุ่มต้องรอ — ถ้าขอใหม่ทุกครั้งที่ซ่อนคอมเมนต์ ทุกการกดจะช้าขึ้น
 * โดยไม่ได้อะไรกลับมา
 *
 * ─── วิธีได้ refresh token มาครั้งแรก ───
 *
 * 1. Google Cloud Console → Credentials → Create credentials → OAuth client ID
 *    → เลือก "Desktop app" (ได้ทั้ง client id และ client secret)
 * 2. ขอสิทธิ์ `https://www.googleapis.com/auth/youtube.force-ssl`
 *    (ไม่ใช่ `youtube.readonly` — อันนั้นซ่อน/ลบคอมเมนต์ไม่ได้)
 * 3. ทำ consent หนึ่งครั้งโดยใส่ `access_type=offline` จะได้ refresh token กลับมา
 *    เอาค่านั้นใส่ `YOUTUBE_OAUTH_REFRESH_TOKEN` ในไฟล์ .env
 *
 * ⚠️ refresh token คือกุญแจที่เปิดสิทธิ์แก้ไขช่องได้ — ห้าม log ห้าม commit
 *    (กฎข้อ 3 ของโปรเจ็ค)
 */
import { systemClock, type Clock } from "@page-os/core";
import { YouTubeApiError } from "./errors.js";

/** ปลายทางแลกโทเคนของ Google — แยกออกมาให้ชี้ไป mock server ตอนเทสต์ได้ */
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * ต่ออายุก่อนหมดจริงกี่มิลลิวินาที
 *
 * โทเคนอยู่ได้ 1 ชม. แต่ถ้าใช้จนวินาทีสุดท้าย จะมีช่วงที่เราคิดว่ายังใช้ได้
 * แต่ Google มองว่าหมดแล้ว (นาฬิกาสองฝั่งไม่ตรงกันเป๊ะ + เวลาเดินทางของคำขอ)
 * — เผื่อไว้หนึ่งนาทีกว้างพอสำหรับทั้งสองเรื่อง
 */
export const REFRESH_MARGIN_MS = 60_000;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUrl?: string;
}

export interface GoogleOAuthDeps {
  clock?: Clock;
  fetchImpl?: typeof fetch;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * ผู้ให้โทเคนที่จำค่าไว้จนใกล้หมดอายุ
 *
 * ใช้เป็น `accessToken` ที่ `YouTubeCommentActions` ต้องการได้ตรงๆ:
 *
 *   const oauth = new GoogleOAuth({ clientId, clientSecret, refreshToken });
 *   new YouTubeCommentActions({ gateway, accessToken: () => oauth.token() });
 */
export class GoogleOAuth {
  private readonly cfg: Required<GoogleOAuthConfig>;
  private readonly clock: Clock;
  private readonly fetchImpl: typeof fetch;

  private cached: string | null = null;
  private expiresAtMs = 0;
  /**
   * คำขอที่กำลังวิ่งอยู่ — กันการยิงซ้ำเมื่อมีหลายงานขอโทเคนพร้อมกัน
   *
   * ถ้าไม่มีตัวนี้ การกด "ซ่อน 3 ก้อนพร้อมกัน" ตอนโทเคนหมดพอดี จะยิงคำขอ
   * แลกโทเคนไป 3 ครั้ง — Google มีเพดานการแลกต่อช่วงเวลาด้วย
   */
  private inFlight: Promise<string> | null = null;

  constructor(config: GoogleOAuthConfig, deps: GoogleOAuthDeps = {}) {
    this.cfg = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
      tokenUrl: config.tokenUrl ?? GOOGLE_TOKEN_URL,
    };
    this.clock = deps.clock ?? systemClock;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  /** โทเคนที่ใช้ได้ตอนนี้ — แลกใหม่ให้เองถ้าใกล้หมดอายุ */
  async token(): Promise<string> {
    if (this.cached !== null && this.clock.now() < this.expiresAtMs) {
      return this.cached;
    }
    if (this.inFlight !== null) return await this.inFlight;

    this.inFlight = this.refresh();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  /** ทิ้งของที่จำไว้ — ใช้เมื่อ Google บอกว่าโทเคนใช้ไม่ได้แล้ว */
  forget(): void {
    this.cached = null;
    this.expiresAtMs = 0;
  }

  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: this.cfg.refreshToken,
      grant_type: "refresh_token",
    });

    let res: Response;
    try {
      res = await this.fetchImpl(this.cfg.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (err) {
      throw new YouTubeApiError({
        message: err instanceof Error ? err.message : String(err),
        // ต่อเน็ตไม่ได้ = ลองใหม่มีประโยชน์
        reason: "rateLimitExceeded",
        path: "oauth/token",
        cause: err,
      });
    }

    const data = (await res.json().catch(() => ({}))) as TokenResponse;

    if (!res.ok || data.error !== undefined || data.access_token === undefined) {
      /**
       * `invalid_grant` = refresh token ถูกเพิกถอนหรือหมดอายุ — ต้องให้คนไป
       * กดอนุญาตใหม่ ลองใหม่กี่ครั้งก็ไม่หาย จึงต้องแยกออกจาก error อื่น
       *
       * ⚠️ ห้ามใส่ `body` หรือค่าใดๆ จาก config ลงในข้อความ — ในนั้นมีทั้ง
       * client secret และ refresh token (กฎข้อ 3)
       */
      const isRevoked = data.error === "invalid_grant";
      throw new YouTubeApiError({
        message: `oauth ${res.status}: ${data.error ?? "unknown"}`,
        reason: isRevoked ? "authError" : undefined,
        httpStatus: res.status,
        path: "oauth/token",
      });
    }

    /**
     * `expires_in` เป็นวินาที และอาจไม่ส่งมา — ถ้าไม่มีให้ถือว่าสั้นๆ ไว้ก่อน
     * (5 นาที) ดีกว่าเดาว่ายาวแล้วใช้โทเคนที่หมดอายุไปแล้ว
     */
    const ttlSec = typeof data.expires_in === "number" ? data.expires_in : 300;
    this.cached = data.access_token;
    this.expiresAtMs = this.clock.now() + Math.max(0, ttlSec * 1000 - REFRESH_MARGIN_MS);
    return this.cached;
  }
}

/**
 * สร้างจาก env — คืน `null` เมื่อยังตั้งค่าไม่ครบ
 *
 * คืน null แทนที่จะล้ม เพราะคนที่ยังไม่ต้องการซ่อน/ลบคอมเมนต์ก็ควรใช้
 * ส่วนที่เหลือของระบบได้ตามปกติ (อ่านคอมเมนต์ใช้แค่ API key)
 */
export function googleOAuthFromEnv(
  env: Record<string, string | undefined>,
  deps: GoogleOAuthDeps = {},
): GoogleOAuth | null {
  const clientId = env["YOUTUBE_OAUTH_CLIENT_ID"]?.trim() ?? "";
  const clientSecret = env["YOUTUBE_OAUTH_CLIENT_SECRET"]?.trim() ?? "";
  const refreshToken = env["YOUTUBE_OAUTH_REFRESH_TOKEN"]?.trim() ?? "";
  if (clientId === "" || clientSecret === "" || refreshToken === "") return null;
  return new GoogleOAuth({ clientId, clientSecret, refreshToken }, deps);
}
