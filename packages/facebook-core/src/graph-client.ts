/**
 * Graph API client ชั้นล่างสุด — พอร์ตจาก lib/graph.mjs ที่ทดสอบกับเพจจริงแล้ว (ADR-001)
 * - เวอร์ชัน Graph ตั้งได้ (§61)  - token อยู่ใน body/query เท่านั้น ไม่เคยถูก log (§13)
 * - retry แบบ exponential backoff เมื่อโดน rate limit / ปัญหาชั่วคราว (§93)
 * - ข้อผิดพลาดถูกแปลงเป็น FacebookApiError ที่มี code/subcode และข้อความอ่านรู้เรื่อง (§59)
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface GraphClientOptions {
  version?: string;          // เช่น v26.0
  baseUrl?: string;          // override สำหรับ mock ใน test (§77)
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class FacebookApiError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly subcode: number | null,
    public readonly httpStatus: number,
    public readonly type: string | null = null,
  ) { super(message); this.name = 'FacebookApiError'; }

  /** token หมดอายุ / ถูกเพิกถอน / ไม่มีสิทธิ์ — ผู้ใช้ต้องเชื่อมต่อใหม่ */
  get isTokenError(): boolean {
    if (this.code === 190 || this.code === 102 || this.code === 463 || this.code === 467) return true;   // หมดอายุ/เพิกถอน/เปลี่ยนรหัสผ่าน
    // OAuthException ที่ไม่ใช่เรื่องสิทธิ์ฟิลด์ / rate limit / พารามิเตอร์ผิด → ถือว่า token ใช้ไม่ได้
    return this.type === 'OAuthException' && !this.isPermissionError && !this.isRateLimited && this.code !== 100 && this.code !== 1 && this.code !== 803;
  }
  /** ไม่มีสิทธิ์อ่านฟิลด์/edge นี้ (เช่น likes.summary โดยไม่ผ่าน App Review) */
  get isPermissionError(): boolean { return this.code === 10 || this.code === 200 || (this.code === 100 && /permission/i.test(this.message)); }
  /** โดน rate limit — ควร retry ทีหลัง (§93) */
  get isRateLimited(): boolean { return this.code === 4 || this.code === 17 || this.code === 32 || this.code === 613 || this.httpStatus === 429; }
  /** ข้อความสำหรับผู้ใช้ (§59) — ไม่เผยรายละเอียดภายใน */
  get userMessage(): string {
    if (this.isTokenError) return 'การเข้าถึง Facebook ของเพจนี้หมดอายุหรือถูกเพิกถอน กรุณาเชื่อมต่อเพจใหม่';
    if (this.isRateLimited) return 'Facebook จำกัดจำนวนคำขอชั่วคราว ระบบจะลองใหม่ให้อัตโนมัติ';
    if (this.isPermissionError) return 'สิทธิ์ที่มีไม่พอสำหรับข้อมูลส่วนนี้ (อาจต้องผ่าน App Review)';
    return 'Facebook ตอบกลับผิดพลาด กรุณาลองใหม่ภายหลัง';
  }
}

export interface GraphRequest {
  token: string;
  method?: 'GET' | 'POST' | 'DELETE';
  params?: Record<string, unknown>;
  /** อัปโหลดไฟล์ (multipart) — key = ชื่อฟิลด์, value = path ในเครื่อง หรือ Buffer+ชื่อไฟล์ */
  files?: Record<string, string | { data: Buffer; filename: string }>;
}

export class GraphClient {
  readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GraphClientOptions = {}) {
    const version = opts.version ?? process.env.META_GRAPH_API_VERSION ?? 'v26.0';
    this.base = (opts.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '') + '/' + version;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  }

  async call<T = Record<string, unknown>>(path: string, req: GraphRequest): Promise<T> {
    const { token, method = 'GET', params = {}, files } = req;
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    if (token) body.set('access_token', token);   // oauth/access_token ใช้ client_id+secret แทน
    const url = `${this.base}/${path.replace(/^\/+/, '')}`;

    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        if (files) {
          const form = new FormData();
          for (const [k, v] of body) form.set(k, v);
          for (const [k, f] of Object.entries(files)) {
            if (typeof f === 'string') form.set(k, new Blob([readFileSync(f)]), basename(f));
            else form.set(k, new Blob([f.data]), f.filename);
          }
          res = await this.fetchImpl(url, { method, body: form });
        } else if (method === 'GET') {
          res = await this.fetchImpl(`${url}?${body}`);
        } else {
          res = await this.fetchImpl(url, { method, body });
        }
      } catch (e) {
        if (attempt++ < this.maxRetries) { await this.sleep(300 * 2 ** attempt); continue; }
        throw new FacebookApiError(`ต่อ Graph API ไม่ได้: ${(e as Error & { cause?: Error }).cause?.message ?? (e as Error).message}`, null, null, 0);
      }
      const text = await res.text();
      let json: { error?: { message?: string; code?: number; error_subcode?: number; type?: string } } & Record<string, unknown>;
      try { json = JSON.parse(text); } catch { throw new FacebookApiError(`Graph ตอบกลับไม่ใช่ JSON (HTTP ${res.status})`, null, null, res.status); }
      if (json.error) {
        const err = new FacebookApiError(json.error.message ?? 'Unknown Graph error', json.error.code ?? null, json.error.error_subcode ?? null, res.status, json.error.type ?? null);
        if (err.isRateLimited && attempt++ < this.maxRetries) {
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          await this.sleep(retryAfter ? retryAfter * 1000 : 1000 * 2 ** attempt);
          continue;
        }
        throw err;
      }
      return json as T;
    }
  }

  /** ไล่หน้า paging.cursors.after จนหมด (จำกัดจำนวนหน้าเพื่อกัน loop ไม่รู้จบ) */
  async *paginate<T>(path: string, req: GraphRequest, maxPages = 50): AsyncGenerator<T[]> {
    let after: string | undefined; let pages = 0;
    do {
      const j = await this.call<{ data?: T[]; paging?: { next?: string; cursors?: { after?: string } } }>(path, { ...req, params: { ...req.params, ...(after && { after }) } });
      yield j.data ?? [];
      after = j.paging?.next ? j.paging.cursors?.after : undefined;
    } while (after && ++pages < maxPages);
  }
}
