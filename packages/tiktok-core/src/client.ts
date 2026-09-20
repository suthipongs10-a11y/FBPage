import { z } from 'zod';

export const TIKTOK_API = 'https://open.tiktokapis.com';
export const TIKTOK_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
export const BASE_SCOPES = ['user.info.basic', 'video.list'];
const count = z.number().finite().nonnegative().nullable().optional().transform(v => v ?? null);
const url = z.string().url().nullable().optional().transform(v => v && /^https:\/\//i.test(v) ? v : null);
export const profileSchema = z.object({ open_id: z.string().min(1), display_name: z.string().optional(), avatar_url: url, username: z.string().nullable().optional(), follower_count: count, following_count: count, likes_count: count, video_count: count });
export const videoSchema = z.object({ id: z.string().min(1), title: z.string().optional().default(''), video_description: z.string().optional().default(''), create_time: count, duration: count, cover_image_url: url, share_url: url, view_count: count, like_count: count, comment_count: count, share_count: count });
const tokensSchema = z.object({ open_id: z.string().min(1), access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive(), refresh_expires_in: z.number().positive(), scope: z.string(), token_type: z.literal('Bearer') });
export type Tokens = z.infer<typeof tokensSchema>;
export type Video = z.infer<typeof videoSchema>;

export class TikTokError extends Error {
  constructor(public readonly code: string, public readonly status = 502, public readonly ambiguous = false) {
    super(['access_token_invalid', 'invalid_grant', 'token_expired'].includes(code) ? 'การเชื่อมต่อ TikTok หมดอายุ กรุณาเชื่อมบัญชีใหม่' : code === 'scope_not_authorized' ? 'TikTok ยังไม่ได้อนุญาตสิทธิ์ที่จำเป็น กรุณาเชื่อมใหม่และอนุญาตสิทธิ์' : code === 'rate_limit_exceeded' ? 'TikTok จำกัดคำขอชั่วคราว กรุณาลองใหม่ภายหลัง' : code === 'publishing_disabled' ? 'ปิดการส่งวิดีโอจริงไว้ในเครื่องพัฒนา' : `TikTok ไม่สามารถทำรายการได้ (${code})`);
  }
  get needsReconnect() { return ['access_token_invalid', 'invalid_grant', 'token_expired'].includes(this.code); }
}
const safeCode = (s: unknown) => typeof s === 'string' && /^[a-z_]{1,80}$/.test(s) ? s : 'api_error';
export interface TikTokConfig { clientKey?: string; clientSecret?: string; redirectUri?: string; mockBaseUrl?: string; testMode?: boolean; timeoutMs?: number }

export class TikTokClient {
  readonly base: string;
  constructor(readonly config: TikTokConfig) {
    if (config.mockBaseUrl && (!config.testMode || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.mockBaseUrl).hostname))) throw new Error('TikTok mock endpoints require test mode and loopback');
    this.base = config.mockBaseUrl || TIKTOK_API;
  }
  get configured() { return !!(this.config.clientKey && this.config.clientSecret && this.config.redirectUri); }
  authUrl(state: string, scopes: string[]) {
    if (!this.configured) throw new TikTokError('not_configured', 409);
    const redirect = new URL(this.config.redirectUri!);
    if ((!this.config.testMode && redirect.protocol !== 'https:') || redirect.search || redirect.hash) throw new TikTokError('https_callback_required', 409);
    const u = new URL(TIKTOK_AUTH);
    u.search = new URLSearchParams({ client_key: this.config.clientKey!, response_type: 'code', scope: scopes.join(','), redirect_uri: redirect.href, state }).toString();
    return u.href;
  }
  private async request(path: string, opts: { token?: string; body?: object; form?: Record<string, string>; read?: boolean } = {}): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetch(this.base + path, { method: opts.body || opts.form ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000), headers: { ...(opts.token && { Authorization: `Bearer ${opts.token}` }), ...(opts.form ? { 'content-type': 'application/x-www-form-urlencoded' } : opts.body ? { 'content-type': 'application/json' } : {}) }, body: opts.form ? new URLSearchParams(opts.form).toString() : opts.body ? JSON.stringify(opts.body) : undefined });
      } catch {
        if (opts.read && attempt < 2) { await new Promise(r => setTimeout(r, 200 * 2 ** attempt)); continue; }
        throw new TikTokError('network_error', 502, !opts.read);
      }
      if (opts.read && attempt < 2 && (response.status >= 500 || response.status === 429)) {
        const wait = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        await new Promise(r => setTimeout(r, Math.min(2000, wait > 0 ? wait * 1000 : 200 * 2 ** attempt)));
        continue;
      }
      let body: unknown;
      try { body = await response.json(); } catch { throw new TikTokError('invalid_response', 502, !opts.read); }
      const envelope = z.object({ error: z.union([z.string(), z.object({ code: z.string().optional() })]).optional(), data: z.unknown().optional() }).passthrough().safeParse(body);
      if (!envelope.success) throw new TikTokError('invalid_response', 502, !opts.read);
      const error = envelope.data.error;
      const code = typeof error === 'string' ? error : error?.code;
      if (!response.ok || (code && code !== 'ok')) throw new TikTokError(code ? safeCode(code) : response.status === 429 ? 'rate_limit_exceeded' : 'api_error', response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 429 ? 429 : 502, !opts.read && response.status >= 500);
      return envelope.data.data ?? body;
    }
    throw new TikTokError('api_error');
  }
  async exchange(code: string) { return this.token({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri! }); }
  async refresh(refreshToken: string) { return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }); }
  private async token(form: Record<string, string>): Promise<Tokens> {
    const data = await this.request('/v2/oauth/token/', { form: { ...form, client_key: this.config.clientKey!, client_secret: this.config.clientSecret! } });
    const parsed = tokensSchema.safeParse(data);
    if (!parsed.success) throw new TikTokError('invalid_response');
    return parsed.data;
  }
  async revoke(token: string) { await this.request('/v2/oauth/revoke/', { form: { client_key: this.config.clientKey!, client_secret: this.config.clientSecret!, token } }); }
  async profile(token: string, scopes: string[]) {
    const fields = ['open_id', 'display_name', 'avatar_url', ...(scopes.includes('user.info.profile') ? ['username'] : []), ...(scopes.includes('user.info.stats') ? ['follower_count', 'following_count', 'likes_count', 'video_count'] : [])];
    const data = await this.request(`/v2/user/info/?fields=${fields.join(',')}`, { token, read: true });
    const parsed = z.object({ user: profileSchema }).safeParse(data);
    if (!parsed.success) throw new TikTokError('invalid_response');
    return parsed.data.user;
  }
  async videos(token: string, cursor?: number) {
    const fields = 'id,title,video_description,create_time,duration,cover_image_url,share_url,view_count,like_count,comment_count,share_count';
    const data = await this.request(`/v2/video/list/?fields=${fields}`, { token, read: true, body: { max_count: 20, ...(cursor !== undefined && { cursor }) } });
    const parsed = z.object({ videos: z.array(videoSchema).max(20), cursor: z.number().nonnegative(), has_more: z.boolean() }).safeParse(data);
    if (!parsed.success) throw new TikTokError('invalid_response');
    return parsed.data;
  }
  async uploadInbox(token: string, videoUrl: string) {
    const data = await this.request('/v2/post/publish/inbox/video/init/', { token, body: { source_info: { source: 'PULL_FROM_URL', video_url: videoUrl } } });
    const parsed = z.object({ publish_id: z.string().min(1).max(64) }).safeParse(data);
    if (!parsed.success) throw new TikTokError('invalid_response', 502, true);
    return parsed.data.publish_id;
  }
  async postStatus(token: string, publishId: string) {
    const data = await this.request('/v2/post/publish/status/fetch/', { token, read: true, body: { publish_id: publishId } });
    const parsed = z.object({ status: z.enum(['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED']), fail_reason: z.string().optional() }).safeParse(data);
    if (!parsed.success) throw new TikTokError('invalid_response');
    return { status: parsed.data.status, failReason: parsed.data.fail_reason ? safeCode(parsed.data.fail_reason) : null };
  }
}
