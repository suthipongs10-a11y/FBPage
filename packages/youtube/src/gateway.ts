/**
 * ทางเดียวที่ระบบคุยกับ YouTube Data API
 *
 * กฎเดียวกับ `packages/meta`: **ห้ามเรียก googleapis.com ตรงจากที่อื่น**
 * ทุก call ต้องผ่าน `YouTubeGateway.call()` เพราะที่นี่ที่เดียวที่:
 *
 *   1. นับโควตาและเบรกตัวเองก่อนโดนปฏิเสธ
 *   2. แปลง error เป็นภาษาไทยที่บอกว่าต้องทำอะไรต่อ
 *   3. ถอยแล้วลองใหม่เฉพาะ error ที่ลองใหม่แล้วมีประโยชน์
 *   4. กัน key/token หลุดลง log
 *
 * ─── สองแบบของการยืนยันตัวตน และเลือกยังไง ───
 *
 * | ใช้อะไร | อ่านอะไรได้ | ต้องมีอะไร |
 * |---|---|---|
 * | **API key** | ข้อมูล**สาธารณะ**ของช่องไหนก็ได้ — วิดีโอ ยอดวิว คอมเมนต์ | แค่คีย์ |
 * | **OAuth token** | ของช่องตัวเอง + ซ่อน/ลบคอมเมนต์ได้ | ให้เจ้าของช่องกดอนุญาต |
 *
 * ข้อแรกคือความต่างที่ใหญ่ที่สุดจากฝั่ง Facebook — **อ่านคอมเมนต์ของช่อง
 * คู่แข่งได้ด้วย API key เฉยๆ ไม่ต้องผ่าน App Review** ต่างจาก Facebook
 * ที่ต้องขอ Page Public Content Access ซึ่งอนุมัติยากที่สุดในชุด
 */
import {
  nullLogger,
  systemClock,
  type Clock,
  type Logger,
} from "@page-os/core";
import { YouTubeApiError } from "./errors.js";
import {
  DEFAULT_DAILY_QUOTA,
  QuotaBucket,
  QUOTA_COST,
  type QuotaEndpoint,
  type QuotaSnapshot,
} from "./quota.js";

/**
 * ฐานของ API — อ่านจาก env ได้เพื่อให้ชี้ไปที่ mock server ตอนเทสต์
 * (ไม่ได้ตั้งใจให้เปลี่ยนตอนใช้งานจริง)
 */
export function resolveApiBase(raw?: string | undefined): string {
  const v = (raw ?? "").trim();
  return v === "" ? "https://www.googleapis.com/youtube/v3" : v.replace(/\/+$/, "");
}

export interface YouTubeGatewayConfig {
  /** สำหรับอ่านข้อมูลสาธารณะ — ช่องไหนก็ได้ */
  apiKey: string;
  apiBase?: string;
  /** เพดานโควตารายวัน — ขอเพิ่มจาก Google แล้วค่อยแก้ค่านี้ */
  dailyQuota?: number;
  maxAttempts?: number;
}

export interface YouTubeGatewayDeps {
  clock?: Clock;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  /** สุ่มสำหรับ jitter — inject ได้ตอนเทสต์ */
  random?: () => number;
}

export interface YouTubeCallOptions {
  endpoint: QuotaEndpoint;
  params: Record<string, string | number | undefined>;
  /**
   * โทเคน OAuth ของช่องเรา — ใส่เมื่อต้องอ่านของที่ไม่สาธารณะ
   * หรือเขียน (ซ่อน/ลบคอมเมนต์) ไม่ใส่ = ใช้ API key อ่านของสาธารณะ
   */
  accessToken?: string | undefined;
  /**
   * งานเบื้องหลัง (cron) → `true` จะโดนเบรกก่อนเมื่อโควตาใกล้หมด
   * เพื่อกันโควตาไว้ให้งานที่คนกดเองแล้วนั่งรออยู่
   */
  background?: boolean;
  /** ใช้ประกอบข้อความ error ให้รู้ว่าเป็นของช่องไหน */
  channelId?: string | undefined;
}

export interface YouTubeResponse<T> {
  data: T;
  quota: QuotaSnapshot;
}

/** ชื่อพารามิเตอร์ที่ห้ามหลุดลง log เด็ดขาด (กฎข้อ 3) */
const SECRET_PARAMS = new Set(["key", "access_token"]);

export class YouTubeGateway {
  private readonly cfg: Required<Omit<YouTubeGatewayConfig, "apiBase">> & {
    apiBase: string;
  };
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly random: () => number;
  private readonly quota: QuotaBucket;

  constructor(config: YouTubeGatewayConfig, deps: YouTubeGatewayDeps = {}) {
    this.cfg = {
      apiKey: config.apiKey,
      apiBase: resolveApiBase(config.apiBase),
      dailyQuota: config.dailyQuota ?? DEFAULT_DAILY_QUOTA,
      maxAttempts: config.maxAttempts ?? 3,
    };
    this.clock = deps.clock ?? systemClock;
    this.logger = deps.logger ?? nullLogger;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.random = deps.random ?? Math.random;
    this.quota = new QuotaBucket(this.cfg.dailyQuota, this.clock.now());
  }

  /** โควตาที่ใช้ไปแล้ววันนี้ — หน้า Ops เอาไปโชว์ */
  quotaSnapshot(): QuotaSnapshot {
    return this.quota.snapshot(this.clock.now());
  }

  async call<T = unknown>(opts: YouTubeCallOptions): Promise<YouTubeResponse<T>> {
    const cost = QUOTA_COST[opts.endpoint];
    const background = opts.background ?? true;

    /**
     * เช็คโควตา**ก่อน**ยิง ไม่ใช่รอให้ Google ปฏิเสธ
     *
     * เพราะ call ที่โดนปฏิเสธเพราะโควตาหมด **ยังกินโควตา** — ยิงต่อไป
     * เรื่อยๆ ตอนหมดแล้วคือการเผาโควตาของวันถัดไปทิ้งไปด้วย
     */
    const allowed = this.quota.canSpend({
      cost,
      nowMs: this.clock.now(),
      background,
    });
    if (!allowed.ok) {
      throw new YouTubeApiError({
        message: `quota guard: ${opts.endpoint}`,
        reason: "quotaExceeded",
        path: opts.endpoint,
        channelId: opts.channelId,
      });
    }

    let lastErr: YouTubeApiError | undefined;
    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      try {
        return await this.execute<T>(opts, cost, attempt);
      } catch (err) {
        const apiErr =
          err instanceof YouTubeApiError
            ? err
            : new YouTubeApiError({
                message: err instanceof Error ? err.message : String(err),
                path: opts.endpoint,
                channelId: opts.channelId,
                attempts: attempt,
                cause: err,
              });
        lastErr = apiErr;

        if (!apiErr.retryable || attempt === this.cfg.maxAttempts) throw apiErr;

        this.logger.warn(
          "ยิง YouTube ไม่สำเร็จ กำลังลองใหม่",
          { endpoint: opts.endpoint, attempt, reason: apiErr.reason },
        );
        await this.clock.sleep(this.backoffDelay(attempt));
      }
    }

    /* c8 ignore next — ลูปข้างบนคืนค่าหรือโยนเสมอ */
    throw lastErr ?? new YouTubeApiError({ message: "unreachable" });
  }

  private async execute<T>(
    opts: YouTubeCallOptions,
    cost: number,
    attempt: number,
  ): Promise<YouTubeResponse<T>> {
    const url = new URL(`${this.cfg.apiBase}/${opts.endpoint.split(".")[0]}`);
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.accessToken !== undefined && opts.accessToken !== "") {
      headers["authorization"] = `Bearer ${opts.accessToken}`;
    } else {
      url.searchParams.set("key", this.cfg.apiKey);
    }

    /**
     * จดว่าใช้โควตาไปแล้ว**ก่อน**รู้ผล — เพราะ Google หักโควตาตั้งแต่รับคำขอ
     * ไม่ว่าจะตอบสำเร็จหรือ error การจดหลังจากรู้ผลจะทำให้เรานับต่ำกว่าจริง
     * แล้วเดินชนเพดานโดยไม่รู้ตัว
     */
    this.quota.spend(cost, this.clock.now());

    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "GET", headers });
    } catch (err) {
      throw new YouTubeApiError({
        message: err instanceof Error ? err.message : String(err),
        httpStatus: undefined,
        path: opts.endpoint,
        channelId: opts.channelId,
        attempts: attempt,
        // ต่อเน็ตไม่ได้ = ลองใหม่มีประโยชน์
        reason: "rateLimitExceeded",
        cause: err,
      });
    }

    const body = (await res.json().catch(() => ({}))) as {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string }>;
      };
    };

    if (!res.ok || body.error !== undefined) {
      throw new YouTubeApiError({
        message: body.error?.message ?? `HTTP ${res.status}`,
        reason: body.error?.errors?.[0]?.reason,
        httpStatus: res.status,
        path: this.safePath(url),
        channelId: opts.channelId,
        attempts: attempt,
      });
    }

    return { data: body as T, quota: this.quotaSnapshot() };
  }

  /**
   * path สำหรับ log ที่**ตัดค่าลับออกแล้ว**
   *
   * `key` กับ `access_token` เดินทางมาใน query string ถ้า log ทั้ง URL
   * ดิบๆ คีย์จะไปนอนอยู่ในไฟล์ log ให้ใครก็ได้อ่าน (กฎข้อ 3)
   */
  private safePath(url: URL): string {
    const clean = new URL(url.toString());
    for (const p of SECRET_PARAMS) {
      if (clean.searchParams.has(p)) clean.searchParams.set(p, "***");
    }
    return `${clean.pathname}${clean.search}`;
  }

  /** ถอยแบบทวีคูณ + jitter — เหมือนฝั่ง Meta */
  private backoffDelay(attempt: number): number {
    const base = 500 * 2 ** (attempt - 1);
    return Math.round(base * (0.5 + this.random() * 0.5));
  }
}
