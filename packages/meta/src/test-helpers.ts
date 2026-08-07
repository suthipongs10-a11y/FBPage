/** ตัวช่วยสำหรับเทสต์ gateway — ไม่ได้ export ออกนอก package */
import { FakeClock, type Logger } from "@page-os/core";
import { MetaApiError } from "./errors.js";
import { MetaGateway, type MetaGatewayConfig } from "./gateway.js";
import type { CallLogEntry, CallLogSink, PageToken, TokenStore } from "./types.js";

export interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FakeResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** โยน error แทนการตอบ (จำลองเน็ตหลุด) */
  throws?: Error;
}

/** fetch ปลอมที่ตอบตามคิวที่กำหนดไว้ล่วงหน้า และบันทึกทุก request */
export class FakeFetch {
  readonly calls: FakeCall[] = [];
  private queue: FakeResponseSpec[] = [];
  private fallback: FakeResponseSpec = { status: 200, json: { ok: true } };
  private handler?: (call: FakeCall) => FakeResponseSpec | undefined;

  push(...specs: FakeResponseSpec[]): this {
    this.queue.push(...specs);
    return this;
  }

  setFallback(spec: FakeResponseSpec): this {
    this.fallback = spec;
    return this;
  }

  /**
   * ตอบตามเนื้อหาของ request แทนที่จะตอบตามลำดับ
   * จำเป็นเมื่อโค้ดที่ทดสอบยิงแบบขนาน — คิวตามลำดับจะสลับกันจนเทสต์ไม่แน่นอน
   * คืน undefined เพื่อให้ตกไปใช้คิว/fallback ตามปกติ
   */
  setHandler(fn: (call: FakeCall) => FakeResponseSpec | undefined): this {
    this.handler = fn;
    return this;
  }

  get callCount(): number {
    return this.calls.length;
  }

  get lastCall(): FakeCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  readonly fn: typeof fetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = input instanceof URL ? input.toString() : String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      (init?.headers ?? {}) as Record<string, string>,
    )) {
      headers[k.toLowerCase()] = v;
    }
    const call: FakeCall = {
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    this.calls.push(call);

    const spec =
      this.handler?.(call) ?? this.queue.shift() ?? this.fallback;
    if (spec.throws) throw spec.throws;

    const body =
      spec.text ?? (spec.json !== undefined ? JSON.stringify(spec.json) : "");
    return new Response(body, {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json", ...(spec.headers ?? {}) },
    });
  };
}

export class FakeTokenStore implements TokenStore {
  readonly invalidated: Array<{ pageId: string; reason: string }> = [];
  private tokens = new Map<string, PageToken>();

  constructor(seed: Record<string, string> = { p1: "PAGETOKEN_p1" }) {
    for (const [pageId, accessToken] of Object.entries(seed)) {
      this.tokens.set(pageId, {
        pageId,
        accessToken,
        tokenType: "page",
        scopes: [],
      });
    }
  }

  set(pageId: string, token: PageToken | null): void {
    if (token === null) this.tokens.delete(pageId);
    else this.tokens.set(pageId, token);
  }

  async getPageToken(pageId: string): Promise<PageToken | null> {
    return this.tokens.get(pageId) ?? null;
  }

  async markInvalid(pageId: string, reason: string): Promise<void> {
    this.invalidated.push({ pageId, reason });
  }
}

export class RecordingCallLog implements CallLogSink {
  readonly entries: CallLogEntry[] = [];
  record(entry: CallLogEntry): void {
    this.entries.push(entry);
  }
}

export function makeGateway(
  overrides: {
    config?: Partial<MetaGatewayConfig>;
    tokens?: FakeTokenStore;
    logger?: Logger;
  } = {},
): {
  gateway: MetaGateway;
  fetch: FakeFetch;
  clock: FakeClock;
  tokens: FakeTokenStore;
  callLog: RecordingCallLog;
} {
  const fetchImpl = new FakeFetch();
  const clock = new FakeClock(1_700_000_000_000);
  const tokens = overrides.tokens ?? new FakeTokenStore();
  const callLog = new RecordingCallLog();

  const gateway = new MetaGateway(
    {
      appId: "APP123",
      appSecret: "APPSECRET",
      graphVersion: "v25.0",
      // ถังใหญ่เป็นค่าเริ่มต้น เทสต์ที่ไม่ได้สนใจ rate limit จะได้ไม่ต้อง advance clock
      rateLimit: { burst: 1000, refillPerSec: 1000 },
      ...(overrides.config ?? {}),
    },
    {
      tokenStore: tokens,
      clock,
      callLog,
      fetchImpl: fetchImpl.fn,
      random: () => 0, // jitter คงที่ ให้เทสต์คาดเดาได้
      ...(overrides.logger ? { logger: overrides.logger } : {}),
    },
  );

  return { gateway, fetch: fetchImpl, clock, tokens, callLog };
}

/**
 * รอให้ promise ล้มเหลวแล้วคืน MetaApiError แบบ type ถูกต้อง
 * (เขียน `.catch(e => e as MetaApiError)` ตรงๆ จะได้ union กับผลลัพธ์ปกติ)
 */
export async function catchMetaError(
  p: Promise<unknown>,
): Promise<MetaApiError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof MetaApiError) return err;
    throw err;
  }
  throw new Error("คาดว่าจะโยน MetaApiError แต่ทำงานผ่านไปได้");
}

/** สร้าง body ของ Graph error */
export function graphError(
  code: number,
  message = "boom",
  subcode?: number,
): unknown {
  const error: Record<string, unknown> = {
    message,
    type: "OAuthException",
    code,
    fbtrace_id: "TRACE123",
  };
  if (subcode !== undefined) error["error_subcode"] = subcode;
  return { error };
}
