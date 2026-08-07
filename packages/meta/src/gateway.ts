/**
 * Meta Gateway — โมดูลเดียวที่คุยกับ graph.facebook.com ได้
 *
 * สเปกข้อ 5 กำหนดหน้าที่ไว้ 7 ข้อ ทั้งหมดอยู่ในไฟล์นี้:
 *   1. ดึง token ที่ถูกต้องจาก page_tokens + decrypt   → TokenStore
 *   2. ใส่ GRAPH_VERSION จาก env                        → resolveGraphVersion()
 *   3. Token bucket ต่อเพจ เข้าคิวถ้าใกล้เต็ม            → PageScheduler + TokenBucket
 *   4. อ่าน X-App-Usage ทุก response > 80% ชะลอ         → UsageGovernor
 *   5. Retry exponential backoff เฉพาะ 4/32/80001/5xx   → executeWithRetry()
 *   6. Map error → ข้อความไทย                           → MetaApiError
 *   7. Log ทุก call ลง DB                                → CallLogSink
 */
import { createHmac } from "node:crypto";
import type { Clock, Logger } from "@page-os/core";
import { nullLogger, systemClock } from "@page-os/core";
import { MetaApiError, MetaTransportError } from "./errors.js";
import {
  TokenBucket,
  UsageGovernor,
  parseBusinessUsageHeader,
  parseUsageHeader,
} from "./rate-limit.js";
import { PageScheduler } from "./scheduler.js";
import {
  noopCallLog,
  type CallLogEntry,
  type CallLogSink,
  type CallPriority,
  type HttpMethod,
  type TokenStore,
} from "./types.js";

export const APP_SCOPE = "app";

/** Graph version ที่สเปกกำหนด ณ ส.ค. 2026 */
export const DEFAULT_GRAPH_VERSION = "v25.0";

const GRAPH_VERSION_RE = /^v\d+\.\d+$/;

/**
 * กฎข้อ 2: อ่าน GRAPH_VERSION จาก env ห้าม hardcode กระจาย
 * ที่เดียวในระบบที่รู้จักเลขเวอร์ชันคือฟังก์ชันนี้
 */
export function resolveGraphVersion(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env["GRAPH_VERSION"]?.trim();
  if (!raw) return DEFAULT_GRAPH_VERSION;
  if (!GRAPH_VERSION_RE.test(raw)) {
    throw new Error(
      `GRAPH_VERSION="${raw}" ไม่ถูกต้อง — ต้องเป็นรูปแบบ vXX.Y เช่น ${DEFAULT_GRAPH_VERSION}`,
    );
  }
  return raw;
}

export type GraphParams = Record<
  string,
  string | number | boolean | null | undefined | object
>;

export interface GatewayCallOptions {
  /** เพจที่จะใช้ token — null = ใช้ app access token (เช่น debug_token) */
  pageId: string | null;
  method?: HttpMethod;
  /** เช่น "me/feed" หรือ "{page-id}/conversations" (ห้ามใส่เวอร์ชันหรือ host) */
  path: string;
  params?: GraphParams;
  priority?: CallPriority;
  /** override token (ใช้ตอน OAuth ที่ยังไม่มี token ใน store) */
  accessToken?: string;
  signal?: AbortSignal;
  /** timeout ต่อ attempt (ms) */
  timeoutMs?: number;
  /** ปิด retry สำหรับงานที่ห้ามทำซ้ำ */
  noRetry?: boolean;
  idempotencyKey?: string;
}

export interface GatewayResult<T> {
  data: T;
  httpStatus: number;
  attempts: number;
  appUsagePct?: number;
  pageUsagePct?: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor: number;
  /** สุ่มบวก 0..jitterMs กันยิงพร้อมกันหมดหลัง backoff */
  jitterMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  factor: 2,
  jitterMs: 250,
};

export interface RateLimitConfig {
  /** ยิงรัวติดกันได้กี่ครั้งต่อเพจ */
  burst: number;
  /** เติมโควตากี่ครั้งต่อวินาที ต่อเพจ */
  refillPerSec: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  burst: 10,
  refillPerSec: 5,
};

export interface MetaGatewayConfig {
  appId: string;
  appSecret: string;
  graphVersion?: string;
  baseUrl?: string;
  retry?: Partial<RetryPolicy>;
  rateLimit?: Partial<RateLimitConfig>;
  /** ส่ง appsecret_proof ไปด้วย (เปิดไว้ถ้าตั้ง "Require App Secret" ใน App Settings) */
  useAppSecretProof?: boolean;
  defaultTimeoutMs?: number;
}

export interface MetaGatewayDeps {
  tokenStore: TokenStore;
  clock?: Clock;
  logger?: Logger;
  callLog?: CallLogSink;
  fetchImpl?: typeof fetch;
  /** สุ่มสำหรับ jitter — inject ได้ตอนเทสต์ */
  random?: () => number;
}

interface PageLane {
  bucket: TokenBucket;
  scheduler: PageScheduler;
}

export class MetaGateway {
  private readonly cfg: Required<
    Omit<MetaGatewayConfig, "retry" | "rateLimit">
  > & {
    retry: RetryPolicy;
    rateLimit: RateLimitConfig;
  };
  private readonly deps: Required<Omit<MetaGatewayDeps, "fetchImpl">> & {
    fetchImpl: typeof fetch;
  };
  private readonly lanes = new Map<string, PageLane>();
  readonly governor: UsageGovernor;

  constructor(config: MetaGatewayConfig, deps: MetaGatewayDeps) {
    if (!config.appId) throw new Error("MetaGateway: ต้องมี appId");
    if (!config.appSecret) throw new Error("MetaGateway: ต้องมี appSecret");

    this.cfg = {
      appId: config.appId,
      appSecret: config.appSecret,
      graphVersion: config.graphVersion ?? resolveGraphVersion(),
      baseUrl: config.baseUrl ?? "https://graph.facebook.com",
      useAppSecretProof: config.useAppSecretProof ?? true,
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30_000,
      retry: { ...DEFAULT_RETRY, ...(config.retry ?? {}) },
      rateLimit: { ...DEFAULT_RATE_LIMIT, ...(config.rateLimit ?? {}) },
    };
    this.deps = {
      tokenStore: deps.tokenStore,
      clock: deps.clock ?? systemClock,
      logger: deps.logger ?? nullLogger,
      callLog: deps.callLog ?? noopCallLog,
      fetchImpl: deps.fetchImpl ?? globalThis.fetch,
      random: deps.random ?? Math.random,
    };
    this.governor = new UsageGovernor({ clock: this.deps.clock });
  }

  get graphVersion(): string {
    return this.cfg.graphVersion;
  }

  private lane(scope: string): PageLane {
    let l = this.lanes.get(scope);
    if (!l) {
      const bucket = new TokenBucket({
        capacity: this.cfg.rateLimit.burst,
        refillPerSec: this.cfg.rateLimit.refillPerSec,
        clock: this.deps.clock,
      });
      const scheduler = new PageScheduler({
        bucket,
        clock: this.deps.clock,
        // หน่วงตามค่าที่แย่ที่สุดระหว่างโควตาระดับแอปกับระดับเพจ
        delayBeforeRelease: () =>
          this.governor.delayForAll([APP_SCOPE, scope]),
      });
      l = { bucket, scheduler };
      this.lanes.set(scope, l);
    }
    return l;
  }

  /** เมตริกสำหรับหน้า Ops Center */
  stats(): {
    graphVersion: string;
    lanes: Array<{ scope: string; queued: number; tokens: number }>;
    usage: ReturnType<UsageGovernor["snapshotAll"]>;
  } {
    return {
      graphVersion: this.cfg.graphVersion,
      lanes: [...this.lanes.entries()].map(([scope, l]) => ({
        scope,
        queued: l.scheduler.queueLength,
        tokens: Math.floor(l.bucket.available),
      })),
      usage: this.governor.snapshotAll(),
    };
  }

  /** จุดเข้าเดียวของทั้งระบบ */
  async call<T = unknown>(
    opts: GatewayCallOptions,
  ): Promise<GatewayResult<T>> {
    const method = opts.method ?? "GET";
    const priority = opts.priority ?? "normal";
    const path = normalizePath(opts.path);
    const scope = opts.pageId ?? APP_SCOPE;
    const startedAtMs = this.deps.clock.now();

    assertNoManualToken(opts.params);

    const accessToken =
      opts.accessToken ?? (await this.resolveToken(opts.pageId));

    // เข้าคิว: priority สูงแซงได้ + token bucket ต่อเพจ + หน่วงตาม X-App-Usage
    await this.lane(scope).scheduler.acquire(priority, opts.signal);

    let attempts = 0;
    let lastError: MetaApiError | undefined;

    for (;;) {
      attempts++;
      try {
        const res = await this.execute<T>({
          method,
          path,
          params: opts.params ?? {},
          accessToken,
          pageId: opts.pageId,
          scope,
          timeoutMs: opts.timeoutMs ?? this.cfg.defaultTimeoutMs,
          signal: opts.signal,
          idempotencyKey: opts.idempotencyKey,
        });

        this.safeLog({
          pageId: opts.pageId,
          method,
          path,
          httpStatus: res.httpStatus,
          ok: true,
          durationMs: this.deps.clock.now() - startedAtMs,
          attempts,
          appUsagePct: res.appUsagePct,
          pageUsagePct: res.pageUsagePct,
          priority,
          startedAtMs,
        });
        return { ...res, attempts };
      } catch (err) {
        const apiErr =
          err instanceof MetaApiError
            ? err
            : toUnexpectedError(err, path, opts.pageId);

        // AbortError ของผู้เรียก ไม่ใช่ error ของ Meta — ปล่อยผ่านทันที
        if (isAbort(err)) throw err;

        lastError = apiErr;

        // token ใช้ไม่ได้ → ทำเครื่องหมายไว้ให้ health check เก็บไปแจ้งเตือน
        if (apiErr.action === "reconnect" && opts.pageId) {
          await this.deps.tokenStore
            .markInvalid(opts.pageId, apiErr.th)
            .catch((e: unknown) => {
              this.deps.logger.error("markInvalid ล้มเหลว", {
                pageId: opts.pageId,
                err: e,
              });
            });
        }

        const canRetry =
          !opts.noRetry &&
          apiErr.retryable &&
          attempts < this.cfg.retry.maxAttempts;

        if (!canRetry) {
          this.safeLog({
            pageId: opts.pageId,
            method,
            path,
            httpStatus: apiErr.httpStatus ?? null,
            ok: false,
            durationMs: this.deps.clock.now() - startedAtMs,
            attempts,
            errorCode: apiErr.code,
            errorSubcode: apiErr.subcode,
            errorMessage: apiErr.message,
            errorTh: apiErr.th,
            fbtraceId: apiErr.fbtraceId,
            priority,
            startedAtMs,
          });
          throw new MetaApiError({
            message: apiErr.message,
            code: apiErr.code,
            subcode: apiErr.subcode,
            type: apiErr.type,
            httpStatus: apiErr.httpStatus,
            fbtraceId: apiErr.fbtraceId,
            path,
            pageId: opts.pageId ?? undefined,
            attempts,
            // ต้องส่งต่อ ไม่งั้นข้อความไทยที่เจาะจง (เช่น "ต่อ Facebook ไม่ได้")
            // จะถูกคำนวณใหม่จาก httpStatus กลายเป็น "HTTP 599" ที่ไม่บอกอะไร
            th: apiErr.th,
            cause: apiErr,
          });
        }

        const delay = this.backoffDelay(attempts, apiErr);
        this.deps.logger.warn("เรียก Meta ไม่สำเร็จ กำลังลองใหม่", {
          path,
          pageId: opts.pageId,
          attempt: attempts,
          maxAttempts: this.cfg.retry.maxAttempts,
          delayMs: delay,
          code: apiErr.code,
          th: apiErr.th,
        });
        await this.deps.clock.sleep(delay, opts.signal);
        // ขอคิวใหม่ก่อนยิงรอบถัดไป ไม่งั้นการ retry จะข้าม rate limit
        await this.lane(scope).scheduler.acquire(priority, opts.signal);
      }
    }
  }

  /**
   * บันทึก log แบบไม่มีทางทำให้ call หลักพัง
   *
   * สำคัญมาก: ถ้าปล่อยให้ record() โยน error ออกมา มันจะถูกจับโดย catch ของ
   * retry loop แล้วยิงซ้ำทั้ง call — ซึ่งแปลว่า DB สะดุดหลังโพสต์สำเร็จ = โพสต์ซ้ำ
   */
  private safeLog(entry: CallLogEntry): void {
    try {
      this.deps.callLog.record(entry);
    } catch (err) {
      this.deps.logger.error("บันทึก call log ไม่สำเร็จ (ข้ามไป)", {
        path: entry.path,
        pageId: entry.pageId,
        err,
      });
    }
  }

  private backoffDelay(attempt: number, err: MetaApiError): number {
    // ถ้า Meta บอกมาแล้วว่าต้องรอนานเท่าไหร่ ให้เชื่อค่านั้น
    const governed = this.governor.delayForAll([APP_SCOPE]);
    const exp =
      this.cfg.retry.baseDelayMs * Math.pow(this.cfg.retry.factor, attempt - 1);
    const jitter = Math.floor(this.deps.random() * this.cfg.retry.jitterMs);
    const base = Math.min(exp, this.cfg.retry.maxDelayMs) + jitter;
    // error โควตาให้รอนานกว่าปกติ
    const floor = err.action === "throttle" ? 2_000 : 0;
    return Math.max(base, floor, governed);
  }

  private async resolveToken(pageId: string | null): Promise<string> {
    if (pageId === null) {
      // app access token — ใช้กับ /debug_token เท่านั้น
      return `${this.cfg.appId}|${this.cfg.appSecret}`;
    }
    const token = await this.deps.tokenStore.getPageToken(pageId);
    if (!token) {
      throw new MetaApiError({
        message: `no usable token for page ${pageId}`,
        code: 190,
        path: "(token lookup)",
        pageId,
      });
    }
    return token.accessToken;
  }

  private async execute<T>(args: {
    method: HttpMethod;
    path: string;
    params: GraphParams;
    accessToken: string;
    pageId: string | null;
    scope: string;
    timeoutMs: number;
    signal?: AbortSignal;
    idempotencyKey?: string;
  }): Promise<Omit<GatewayResult<T>, "attempts">> {
    const url = new URL(
      `${this.cfg.baseUrl}/${this.cfg.graphVersion}/${args.path}`,
    );

    const bodyParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(args.params)) {
      if (v === undefined || v === null) continue;
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (args.method === "GET" || args.method === "DELETE") {
        url.searchParams.set(k, s);
      } else {
        bodyParams[k] = s;
      }
    }

    if (this.cfg.useAppSecretProof) {
      // proof ผูกกับ token ป้องกันคนขโมย token ไปใช้จากแอปอื่น
      url.searchParams.set(
        "appsecret_proof",
        createHmac("sha256", this.cfg.appSecret)
          .update(args.accessToken)
          .digest("hex"),
      );
    }

    const headers: Record<string, string> = {
      // ใส่ token ใน header ไม่ใช่ query — URL โผล่ใน log/proxy ได้ header ไม่โผล่
      authorization: `Bearer ${args.accessToken}`,
      accept: "application/json",
    };
    let body: string | undefined;
    if (args.method === "POST") {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(bodyParams).toString();
    }

    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), args.timeoutMs);
    const signal = args.signal
      ? AbortSignal.any([args.signal, timeoutCtl.signal])
      : timeoutCtl.signal;

    let res: Response;
    try {
      const init: RequestInit = { method: args.method, headers, signal };
      if (body !== undefined) init.body = body;
      res = await this.deps.fetchImpl(url, init);
    } catch (err) {
      if (args.signal?.aborted) throw err; // ผู้เรียกยกเลิกเอง
      const isTimeout = timeoutCtl.signal.aborted;
      throw new MetaTransportError(
        isTimeout
          ? `ต่อ Facebook ไม่ทันใน ${args.timeoutMs}ms`
          : `ต่อ Facebook ไม่ได้: ${(err as Error)?.message ?? "unknown"}`,
        { path: args.path, pageId: args.pageId ?? undefined, cause: err },
      );
    } finally {
      clearTimeout(timer);
    }

    // อ่านโควตาทุก response ไม่ว่าจะสำเร็จหรือไม่ (สเปกข้อ 5.4)
    const appUsage = parseUsageHeader(res.headers.get("x-app-usage"));
    const pageUsage = parseUsageHeader(res.headers.get("x-page-usage"));
    const bizUsage = parseBusinessUsageHeader(
      res.headers.get("x-business-use-case-usage"),
    );
    this.governor.observe(APP_SCOPE, appUsage);
    this.governor.observe(args.scope, pageUsage ?? bizUsage);

    const appUsagePct = appUsage
      ? Math.max(appUsage.callCount, appUsage.totalTime, appUsage.totalCputime)
      : undefined;
    const pageUsagePct = pageUsage
      ? Math.max(
          pageUsage.callCount,
          pageUsage.totalTime,
          pageUsage.totalCputime,
        )
      : undefined;

    const text = await res.text();
    let payload: unknown = undefined;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (!res.ok || hasGraphError(payload)) {
      const e = extractGraphError(payload);
      throw new MetaApiError({
        message: e.message ?? `HTTP ${res.status}`,
        code: e.code,
        subcode: e.subcode,
        type: e.type,
        httpStatus: res.status,
        fbtraceId: e.fbtraceId,
        path: args.path,
        pageId: args.pageId ?? undefined,
      });
    }

    const result: Omit<GatewayResult<T>, "attempts"> = {
      data: payload as T,
      httpStatus: res.status,
    };
    if (appUsagePct !== undefined) result.appUsagePct = appUsagePct;
    if (pageUsagePct !== undefined) result.pageUsagePct = pageUsagePct;
    return result;
  }
}

// --------------------------------------------------------------------------

/** ห้ามให้โมดูลอื่นแอบส่ง token เอง — จะทำให้ระบบจัดการ token พัง */
function assertNoManualToken(params: GraphParams | undefined): void {
  if (!params) return;
  for (const k of Object.keys(params)) {
    const lower = k.toLowerCase();
    if (
      lower === "access_token" ||
      lower === "appsecret_proof" ||
      lower === "client_secret"
    ) {
      throw new Error(
        `ห้ามส่ง "${k}" มาใน params — gateway จัดการ token ให้เอง (สเปกข้อ 5.1)`,
      );
    }
  }
}

/** path ต้องเป็น relative เท่านั้น กันการยิงไป host อื่นและกันเวอร์ชันซ้อน */
export function normalizePath(path: string): string {
  const p = path.trim();
  if (p === "") throw new Error("gateway: path ว่างไม่ได้");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith("//")) {
    throw new Error(
      `gateway: path ต้องเป็น relative ห้ามใส่ host เต็ม ("${path}")`,
    );
  }
  const stripped = p.replace(/^\/+/, "");
  if (GRAPH_VERSION_RE.test(stripped.split("/")[0] ?? "")) {
    throw new Error(
      `gateway: ห้ามใส่เวอร์ชันใน path ("${path}") — gateway ใส่ GRAPH_VERSION ให้เอง (กฎข้อ 2)`,
    );
  }
  return stripped;
}

interface GraphErrorShape {
  message?: string;
  code?: number;
  subcode?: number;
  type?: string;
  fbtraceId?: string;
}

function hasGraphError(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in (payload as Record<string, unknown>)
  );
}

function extractGraphError(payload: unknown): GraphErrorShape {
  if (typeof payload !== "object" || payload === null) return {};
  const err = (payload as Record<string, unknown>)["error"];
  if (typeof err !== "object" || err === null) return {};
  const e = err as Record<string, unknown>;
  const out: GraphErrorShape = {};
  if (typeof e["message"] === "string") out.message = e["message"];
  if (typeof e["code"] === "number") out.code = e["code"];
  if (typeof e["error_subcode"] === "number")
    out.subcode = e["error_subcode"] as number;
  if (typeof e["type"] === "string") out.type = e["type"];
  if (typeof e["fbtrace_id"] === "string") out.fbtraceId = e["fbtrace_id"];
  return out;
}

function isAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      (err instanceof DOMException && err.name === "AbortError"))
  );
}

function toUnexpectedError(
  err: unknown,
  path: string,
  pageId: string | null,
): MetaApiError {
  return new MetaTransportError(
    `ข้อผิดพลาดที่ไม่คาดคิดใน gateway: ${(err as Error)?.message ?? String(err)}`,
    { path, pageId: pageId ?? undefined, cause: err },
  );
}
