/** HTTP client ชั้นล่างสำหรับ Data API v3 / Analytics API / resumable upload — error normalization (§139), retry (§140), quota (§21) */
import { YouTubeApiError, type QuotaRecorder, type YtAuth, type YtErrorCode } from './types';
import { quotaCost } from './quota';

export interface YouTubeClientOptions { dataBaseUrl?: string; analyticsBaseUrl?: string; uploadBaseUrl?: string; fetchImpl?: typeof fetch; quota?: QuotaRecorder; maxRetries?: number; sleep?: (ms: number) => Promise<void> }
export interface CallOptions { auth: YtAuth; method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; params?: Record<string, string | number | boolean | undefined>; body?: unknown; quotaMethod: string; api?: 'data' | 'analytics'; rawResponse?: boolean; headers?: Record<string, string>; bodyRaw?: Buffer | Uint8Array }

function mapError(status: number, j: unknown): YouTubeApiError {
  const e = ((j as Record<string, unknown> | null)?.error ?? {}) as { message?: string; errors?: { reason?: string; message?: string }[]; status?: string };
  const reason = e.errors?.[0]?.reason ?? '';
  let code: YtErrorCode = 'unknown';
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') code = 'quotaExceeded';
  else if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 429) code = 'rateLimit';
  else if (reason === 'commentsDisabled') code = 'commentsDisabled';
  else if (status === 401 || reason === 'authError' || e.status === 'UNAUTHENTICATED') code = 'invalidGrant';
  else if (reason === 'insufficientPermissions' || reason === 'forbidden' && /scope|permission/i.test(e.message ?? '')) code = 'insufficientPermissions';
  else if (status === 403) code = 'forbidden';
  else if (status === 404 || reason === 'videoNotFound' || reason === 'channelNotFound' || reason === 'playlistNotFound') code = 'notFound';
  else if (status === 400) code = 'invalidRequest';
  return new YouTubeApiError(`YouTube API ${status}: ${e.message ?? reason ?? 'error'}`, code, status, j ?? undefined);
}

export class YouTubeClient {
  readonly dataBase: string; readonly analyticsBase: string; readonly uploadBase: string;
  private readonly fetchImpl: typeof fetch; private readonly quota?: QuotaRecorder; private readonly maxRetries: number; private readonly sleep: (ms: number) => Promise<void>;
  constructor(o: YouTubeClientOptions = {}) {
    this.dataBase = (o.dataBaseUrl ?? 'https://www.googleapis.com/youtube/v3').replace(/\/+$/, '');
    this.analyticsBase = (o.analyticsBaseUrl ?? 'https://youtubeanalytics.googleapis.com/v2').replace(/\/+$/, '');
    this.uploadBase = (o.uploadBaseUrl ?? 'https://www.googleapis.com/upload/youtube/v3').replace(/\/+$/, '');
    this.fetchImpl = o.fetchImpl ?? fetch; this.quota = o.quota; this.maxRetries = o.maxRetries ?? 2; this.sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  }

  async call<T = Record<string, unknown>>(path: string, o: CallOptions): Promise<T> {
    const base = o.api === 'analytics' ? this.analyticsBase : this.dataBase;
    const u = new URL(`${base}/${path.replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(o.params ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.auth.kind === 'oauth') headers.authorization = `Bearer ${o.auth.accessToken}`; else u.searchParams.set('key', o.auth.apiKey);
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const units = o.api === 'analytics' ? 0 : quotaCost(o.quotaMethod);
    let attempt = 0;
    for (;;) {
      let res: Response;
      try { res = await this.fetchImpl(u, { method: o.method ?? 'GET', headers, body: o.bodyRaw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) }); }
      catch (e) { if (attempt++ < this.maxRetries) { await this.sleep(300 * 2 ** attempt); continue; } await this.quota?.record({ api: o.api ?? 'data', method: o.quotaMethod, units, success: false }); throw new YouTubeApiError(`ติดต่อ YouTube ไม่ได้: ${(e as Error).message}`, 'network', 0); }
      if (res.status === 204) { await this.quota?.record({ api: o.api ?? 'data', method: o.quotaMethod, units, success: true }); return {} as T; }
      const text = await res.text(); let j: Record<string, unknown> | null = null; try { j = text ? JSON.parse(text) : {}; } catch { j = null; }
      if (!res.ok) {
        const err = mapError(res.status, j);
        if (err.isRetryable && attempt++ < this.maxRetries) { await this.sleep(500 * 2 ** attempt); continue; }
        await this.quota?.record({ api: o.api ?? 'data', method: o.quotaMethod, units, success: false });
        throw err;
      }
      await this.quota?.record({ api: o.api ?? 'data', method: o.quotaMethod, units, success: true });
      return (j ?? {}) as T;
    }
  }

  /** resumable upload (§59): initiate → session URI */
  async initiateResumable(auth: YtAuth, metadata: unknown, totalBytes: number, mimeType: string, parts = 'snippet,status'): Promise<string> {
    if (auth.kind !== 'oauth') throw new YouTubeApiError('อัปโหลดต้องใช้ OAuth', 'insufficientPermissions', 401);
    const u = new URL(`${this.uploadBase}/videos`); u.searchParams.set('uploadType', 'resumable'); u.searchParams.set('part', parts);
    let res: Response;
    try { res = await this.fetchImpl(u, { method: 'POST', headers: { authorization: `Bearer ${auth.accessToken}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(totalBytes), 'x-upload-content-type': mimeType }, body: JSON.stringify(metadata) }); }
    catch (e) { throw new YouTubeApiError(`ติดต่อ YouTube ไม่ได้: ${(e as Error).message}`, 'network', 0); }
    if (!res.ok) { const j = await res.json().catch(() => null); await this.quota?.record({ api: 'upload', method: 'videos.insert', units: quotaCost('videos.insert'), success: false }); throw mapError(res.status, j); }
    const loc = res.headers.get('location'); if (!loc) throw new YouTubeApiError('ไม่ได้รับ upload session URI', 'unknown', res.status);
    return loc;
  }
  /** ส่งไบต์ช่วงหนึ่ง — คืน {done, video} เมื่อเสร็จ หรือ {done:false, received} เมื่อ 308 */
  async putChunk(sessionUri: string, chunk: Uint8Array, start: number, total: number): Promise<{ done: true; video: Record<string, unknown> } | { done: false; received: number }> {
    let res: Response;
    try { res = await this.fetchImpl(sessionUri, { method: 'PUT', headers: { 'content-length': String(chunk.byteLength), 'content-range': `bytes ${start}-${start + chunk.byteLength - 1}/${total}` }, body: chunk }); }
    catch (e) { throw new YouTubeApiError(`อัปโหลดหลุด: ${(e as Error).message}`, 'network', 0); }
    if (res.status === 308) { const range = res.headers.get('range'); const received = range ? Number(range.split('-')[1]) + 1 : start + chunk.byteLength; return { done: false, received }; }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw mapError(res.status, j);
    await this.quota?.record({ api: 'upload', method: 'videos.insert', units: quotaCost('videos.insert'), success: true });
    return { done: true, video: (j ?? {}) as Record<string, unknown> };
  }
  /** สอบถามสถานะ session ที่ค้าง (resume) */
  async queryResumable(sessionUri: string, total: number): Promise<{ done: true; video: Record<string, unknown> } | { done: false; received: number }> {
    const res = await this.fetchImpl(sessionUri, { method: 'PUT', headers: { 'content-length': '0', 'content-range': `bytes */${total}` } });
    if (res.status === 308) { const range = res.headers.get('range'); return { done: false, received: range ? Number(range.split('-')[1]) + 1 : 0 }; }
    const j = await res.json().catch(() => null); if (!res.ok) throw mapError(res.status, j);
    return { done: true, video: (j ?? {}) as Record<string, unknown> };
  }
  async setThumbnail(auth: YtAuth, videoId: string, image: Uint8Array, mimeType: string): Promise<void> {
    if (auth.kind !== 'oauth') throw new YouTubeApiError('ต้องใช้ OAuth', 'insufficientPermissions', 401);
    const u = new URL(`${this.uploadBase}/thumbnails/set`); u.searchParams.set('videoId', videoId); u.searchParams.set('uploadType', 'media');
    const res = await this.fetchImpl(u, { method: 'POST', headers: { authorization: `Bearer ${auth.accessToken}`, 'content-type': mimeType }, body: image });
    const j = await res.json().catch(() => null);
    await this.quota?.record({ api: 'upload', method: 'thumbnails.set', units: quotaCost('thumbnails.set'), success: res.ok });
    if (!res.ok) throw mapError(res.status, j);
  }
}
