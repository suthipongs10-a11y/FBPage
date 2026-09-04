/**
 * FacebookService (AGENTS.md §11) — จุดเดียวที่คุยกับ Meta Graph สำหรับเพจ
 * ไม่รู้จัก DB, tenant หรือ AI — รับ token มาแล้วคืนข้อมูลที่ normalize แล้ว
 */
import { GraphClient, FacebookApiError, type GraphClientOptions } from './graph-client';
import { mediaTypeOf, normalizePostMetrics, type MetricAvailability, type RawPost } from './metrics';
import type { NormalizedMetric } from '@fbpm/shared';

export interface FacebookUser { id: string; name: string }
export interface TokenInfo { user: FacebookUser; grantedScopes: string[]; expiresAt: Date | null; type: string | null }
export interface FacebookPageSummary { id: string; name: string; category: string | null; tasks: string[]; pictureUrl: string | null; accessToken: string }
export interface FacebookPageDetails {
  id: string; name: string; username: string | null; category: string | null; link: string | null; about: string | null; description: string | null;
  phone: string | null; website: string | null; emails: string[]; address: string | null; hours: Record<string, string> | null;
  pictureUrl: string | null; coverUrl: string | null; fanCount: number | null; isPublished: boolean; raw: Record<string, unknown>;
}
export interface PagePost { id: string; message: string | null; createdTime: Date; permalink: string | null; mediaType: string; metrics: NormalizedMetric[]; raw: RawPost }
export interface GetPostsOptions { since?: Date; limit?: number }
export interface CreatePostInput { message?: string; link?: string; scheduledAt?: Date }
export interface PhotoPostInput extends CreatePostInput { photos: (string | { data: Buffer; filename: string } | { url: string })[] }
export interface PublishResult { externalId: string; permalink: string; scheduled: boolean }
export interface PageComment { id: string; postId: string; parentId: string | null; fromId: string | null; fromName: string | null; message: string | null; createdTime: Date; permalink: string | null; isHidden: boolean; raw: Record<string, unknown> }
export class CommentsPermissionError extends Error { constructor(public readonly graphError: FacebookApiError) { super('อ่านคอมเมนต์ไม่ได้ — token ต้องมีสิทธิ์ pages_read_user_content (และ pages_manage_engagement เพื่อตอบ)'); this.name = 'CommentsPermissionError'; } }

export const PAGE_FIELDS = [
  'id', 'name', 'username', 'link', 'category', 'about', 'description', 'phone', 'website', 'emails', 'single_line_address', 'hours',
  'cover', 'picture{url,is_silhouette}', 'is_published', 'fan_count',
].join(',');

// Graph ปฏิเสธ likes.summary/comments.summary เมื่อยังไม่ผ่าน App Review — ไล่ชุดฟิลด์จากมาก→น้อย แล้วบันทึกว่าได้อะไรจริง (ADR-001)
const POST_FIELD_SETS: { fields: string; avail: MetricAvailability }[] = [
  { fields: 'id,message,created_time,permalink_url,shares,full_picture,attachments{media_type,type},likes.summary(true).limit(0),comments.summary(true).limit(0)', avail: { likes: true, comments: true, shares: true } },
  { fields: 'id,message,created_time,permalink_url,shares,full_picture,attachments{media_type,type}', avail: { likes: false, comments: false, shares: true } },
  { fields: 'id,message,created_time,permalink_url', avail: { likes: false, comments: false, shares: false } },
];
const POST_EDGES = ['published_posts', 'feed', 'posts'];

export class FacebookService {
  readonly graph: GraphClient;
  constructor(opts: GraphClientOptions = {}) { this.graph = new GraphClient(opts); }

  /** ตรวจ user token: ใครเป็นเจ้าของ มีสิทธิ์อะไร หมดอายุเมื่อไหร่ */
  async inspectUserToken(userToken: string): Promise<TokenInfo> {
    const me = await this.graph.call<{ id: string; name: string }>('me', { token: userToken, params: { fields: 'id,name' } });
    let grantedScopes: string[] = [];
    try {
      const p = await this.graph.call<{ data?: { permission: string; status: string }[] }>('me/permissions', { token: userToken });
      grantedScopes = (p.data ?? []).filter(x => x.status === 'granted').map(x => x.permission);
    } catch { /* บางแอปอ่านไม่ได้ — ไม่ถือเป็นข้อผิดพลาด */ }
    let expiresAt: Date | null = null; let type: string | null = null;
    try {
      const d = await this.graph.call<{ data?: { expires_at?: number; type?: string } }>('debug_token', { token: userToken, params: { input_token: userToken } });
      if (d.data?.expires_at) expiresAt = d.data.expires_at === 0 ? null : new Date(d.data.expires_at * 1000);
      type = d.data?.type ?? null;
    } catch { /* debug_token ต้องใช้ app token ในบางกรณี — ข้ามได้ */ }
    return { user: { id: me.id, name: me.name }, grantedScopes, expiresAt, type };
  }

  /** เพจทั้งหมดที่ user token มองเห็น พร้อม page token และสิทธิ์ (tasks) */
  async listPages(userToken: string): Promise<FacebookPageSummary[]> {
    const out: FacebookPageSummary[] = [];
    for await (const chunk of this.graph.paginate<{ id: string; name: string; category?: string; tasks?: string[]; access_token: string; picture?: { data?: { url?: string } } }>(
      'me/accounts', { token: userToken, params: { fields: 'id,name,category,tasks,access_token,picture{url}', limit: 100 } })) {
      for (const p of chunk) out.push({ id: p.id, name: p.name, category: p.category ?? null, tasks: p.tasks ?? [], pictureUrl: p.picture?.data?.url ?? null, accessToken: p.access_token });
    }
    return out;
  }

  async getPage(pageId: string, pageToken: string): Promise<FacebookPageDetails> {
    const r = await this.graph.call<Record<string, unknown>>(pageId, { token: pageToken, params: { fields: PAGE_FIELDS } });
    const pic = r.picture as { data?: { url?: string } } | undefined; const cover = r.cover as { source?: string } | undefined;
    const raw = { ...r }; delete raw.picture; delete raw.cover;
    return {
      id: String(r.id), name: String(r.name), username: (r.username as string) ?? null, category: (r.category as string) ?? null, link: (r.link as string) ?? null,
      about: (r.about as string) ?? null, description: (r.description as string) ?? null, phone: (r.phone as string) ?? null, website: (r.website as string) ?? null,
      emails: (r.emails as string[]) ?? [], address: (r.single_line_address as string) ?? null, hours: (r.hours as Record<string, string>) ?? null,
      pictureUrl: pic?.data?.url ?? null, coverUrl: cover?.source ?? null, fanCount: typeof r.fan_count === 'number' ? r.fan_count : null,
      isPublished: r.is_published !== false, raw: { ...raw, picture: pic, cover },
    };
  }

  /** โพสต์ของเพจ + metric ที่อ่านได้ — ค่าที่อ่านไม่ได้เป็น null */
  async getPosts(pageId: string, pageToken: string, opts: GetPostsOptions = {}): Promise<{ posts: PagePost[]; availability: MetricAvailability }> {
    const sinceSec = opts.since ? Math.floor(opts.since.getTime() / 1000) : undefined;
    let lastErr: unknown;
    for (const edge of POST_EDGES) {
      for (const set of POST_FIELD_SETS) {
        try {
          const raws: RawPost[] = [];
          for await (const chunk of this.graph.paginate<RawPost>(`${pageId}/${edge}`, { token: pageToken, params: { fields: set.fields, limit: Math.min(100, opts.limit ?? 100), ...(sinceSec && { since: sinceSec }) } }, 20)) {
            raws.push(...chunk);
            if (opts.limit && raws.length >= opts.limit) break;
          }
          const captured = new Date();
          const posts = raws
            .filter(p => !sinceSec || new Date(p.created_time).getTime() / 1000 >= sinceSec)
            .slice(0, opts.limit)
            .map(p => ({ id: p.id, message: p.message ?? null, createdTime: new Date(p.created_time), permalink: p.permalink_url ?? null, mediaType: mediaTypeOf(p), metrics: normalizePostMetrics(p, set.avail, captured), raw: p }));
          return { posts, availability: set.avail };
        } catch (e) {
          lastErr = e;
          if (e instanceof FacebookApiError && (e.isTokenError || e.isRateLimited)) throw e; // ไม่ใช่เรื่องฟิลด์ — อย่าไล่ต่อ
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('อ่านโพสต์ไม่ได้');
  }

  async createPost(pageId: string, pageToken: string, input: CreatePostInput): Promise<PublishResult> {
    if (!input.message && !input.link) throw new Error('ต้องมี message หรือ link');
    const params: Record<string, unknown> = {};
    if (input.message) params.message = input.message;
    if (input.link) params.link = input.link;
    Object.assign(params, scheduleParams(input.scheduledAt));
    const r = await this.graph.call<{ id: string }>(`${pageId}/feed`, { token: pageToken, method: 'POST', params });
    return { externalId: r.id, permalink: `https://www.facebook.com/${r.id}`, scheduled: !!input.scheduledAt };
  }

  /** รูปหลายใบ: อัปโหลด published=false แล้วแนบด้วย attached_media (วิธีที่ทดสอบกับเพจจริงแล้ว) */
  async createPhotoPost(pageId: string, pageToken: string, input: PhotoPostInput): Promise<PublishResult> {
    if (!input.photos.length) return this.createPost(pageId, pageToken, input);
    if (input.photos.length > 10) throw new Error('แนบรูปได้สูงสุด 10 ใบ');
    const media: string[] = [];
    for (const ph of input.photos) {
      const r = typeof ph === 'object' && 'url' in ph
        ? await this.graph.call<{ id: string }>(`${pageId}/photos`, { token: pageToken, method: 'POST', params: { url: ph.url, published: false } })
        : await this.graph.call<{ id: string }>(`${pageId}/photos`, { token: pageToken, method: 'POST', params: { published: false }, files: { source: ph } });
      media.push(r.id);
    }
    const params: Record<string, unknown> = {};
    if (input.message) params.message = input.message;
    media.forEach((id, i) => { params[`attached_media[${i}]`] = { media_fbid: id }; });
    Object.assign(params, scheduleParams(input.scheduledAt));
    const r = await this.graph.call<{ id: string }>(`${pageId}/feed`, { token: pageToken, method: 'POST', params });
    return { externalId: r.id, permalink: `https://www.facebook.com/${r.id}`, scheduled: !!input.scheduledAt };
  }

  /** คอมเมนต์ของโพสต์ (รวมคำตอบย่อย) — ต้องมี pages_read_user_content; ถ้าโดนปฏิเสธ (code 10/200) โยน CommentsPermissionError */
  async getComments(postId: string, pageToken: string, opts: { since?: Date; limit?: number } = {}): Promise<PageComment[]> {
    const out: PageComment[] = [];
    try {
      for await (const chunk of this.graph.paginate<Record<string, unknown>>(`${postId}/comments`, { token: pageToken, params: { fields: 'id,message,created_time,from{id,name},parent{id},permalink_url,is_hidden', filter: 'stream', order: 'reverse_chronological', limit: Math.min(100, opts.limit ?? 100), ...(opts.since && { since: Math.floor(opts.since.getTime() / 1000) }) } }, 10)) {
        for (const c of chunk) {
          const from = c.from as { id?: string; name?: string } | undefined; const parent = c.parent as { id?: string } | undefined;
          out.push({ id: String(c.id), postId, parentId: parent?.id ?? null, fromId: from?.id ?? null, fromName: from?.name ?? null, message: (c.message as string) ?? null, createdTime: new Date(String(c.created_time)), permalink: (c.permalink_url as string) ?? null, isHidden: c.is_hidden === true, raw: c });
          if (opts.limit && out.length >= opts.limit) return out;
        }
      }
    } catch (e) { if (e instanceof FacebookApiError && e.isPermissionError) throw new CommentsPermissionError(e); throw e; }
    return out;
  }

  /** ตอบคอมเมนต์ในนามเพจ — ต้องมี pages_manage_engagement */
  async replyToComment(commentId: string, pageToken: string, message: string): Promise<{ externalId: string }> {
    try { const r = await this.graph.call<{ id: string }>(`${commentId}/comments`, { token: pageToken, method: 'POST', params: { message } }); return { externalId: r.id }; }
    catch (e) { if (e instanceof FacebookApiError && e.isPermissionError) throw new CommentsPermissionError(e); throw e; }
  }

  async hideComment(commentId: string, pageToken: string, hidden = true): Promise<void> {
    try { await this.graph.call(commentId, { token: pageToken, method: 'POST', params: { is_hidden: hidden } }); }
    catch (e) { if (e instanceof FacebookApiError && e.isPermissionError) throw new CommentsPermissionError(e); throw e; }
  }

  async deletePost(postId: string, pageToken: string): Promise<void> {
    await this.graph.call(postId, { token: pageToken, method: 'DELETE' });
  }

  /** ตรวจว่า page token ยังใช้ได้ — คืน true/false ไม่ throw (ใช้ใน job ตรวจสุขภาพ §13) */
  async validatePageToken(pageId: string, pageToken: string): Promise<{ valid: boolean; error?: string }> {
    try { await this.graph.call(pageId, { token: pageToken, params: { fields: 'id' } }); return { valid: true }; }
    catch (e) { return { valid: false, error: e instanceof FacebookApiError ? e.userMessage : (e as Error).message }; }
  }
}

function scheduleParams(at?: Date): Record<string, unknown> {
  if (!at) return {};
  const mins = (at.getTime() - Date.now()) / 60000;
  if (mins < 10 || mins > 75 * 1440) throw new Error('ตั้งเวลาต้องล่วงหน้า 10 นาที ถึง 75 วัน');
  return { published: false, scheduled_publish_time: Math.floor(at.getTime() / 1000) };
}
