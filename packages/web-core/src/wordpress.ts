/**
 * WordPress REST client (AGENTS_WEB.md W-3) — `fetch` ล้วน ไม่มี dependency
 * ยืนยันตัวด้วย Application Password (Basic auth) ผ่าน HTTPS เท่านั้นใน production (mock ใน test ใช้ http ได้เมื่อ allowInsecure)
 * ห้าม log/return รหัสผ่าน — client เก็บไว้ในหน่วยความจำของ instance เท่านั้น
 */
import { WebError } from './types';

export interface WpCredentials { baseUrl: string; username: string; appPassword: string }
export interface WpClientOptions { fetchImpl?: typeof fetch; timeoutMs?: number; allowInsecure?: boolean; userAgent?: string }
export interface WpUser { id: number; name: string; slug: string; roles: string[]; capabilities: Record<string, boolean> }
export interface WpPostInput { title: string; content: string; excerpt?: string; slug?: string; status: 'draft' | 'publish' | 'future'; date?: string; tags?: number[]; categories?: number[]; meta?: Record<string, unknown> }
export interface WpPost { id: number; link: string; slug: string; status: string; title: string; date: string | null; modified: string | null }
export type WpTermKind = 'tags' | 'categories';

export class WordPressClient {
  private readonly base: string; private readonly auth: string; private readonly fetchImpl: typeof fetch; private readonly timeoutMs: number; private readonly ua: string;
  constructor(creds: WpCredentials, opts: WpClientOptions = {}) {
    const u = new URL(creds.baseUrl);
    if (u.protocol !== 'https:' && !opts.allowInsecure) throw new WebError('WordPress ต้องเป็น https:// เท่านั้น (รหัสผ่านถูกส่งใน header)', 'invalid');
    this.base = `${u.origin}${u.pathname.replace(/\/+$/, '')}/wp-json/wp/v2`;
    this.auth = `Basic ${Buffer.from(`${creds.username}:${creds.appPassword.replace(/\s+/g, '')}`, 'utf8').toString('base64')}`;
    this.fetchImpl = opts.fetchImpl ?? fetch; this.timeoutMs = opts.timeoutMs ?? 20_000; this.ua = opts.userAgent ?? 'FBPM-WebPublisher/1.0 (+agency content tool)';
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try { res = await this.fetchImpl(`${this.base}${path}`, { method, headers: { authorization: this.auth, accept: 'application/json', 'user-agent': this.ua, ...(body !== undefined && { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal }); }
    catch (e) { throw new WebError(`เชื่อมต่อ WordPress ไม่ได้: ${e instanceof Error ? e.message : String(e)}`, 'network'); }
    finally { clearTimeout(timer); }
    const text = await res.text(); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* ไม่ใช่ JSON */ }
    if (!res.ok) {
      const code = (json as { code?: string } | null)?.code ?? ''; const msg = (json as { message?: string } | null)?.message ?? (text.slice(0, 200) || res.statusText);
      if (res.status === 401 || res.status === 403 || code === 'rest_cannot_create' || code === 'rest_forbidden') throw new WebError(`WordPress ปฏิเสธสิทธิ์ (${res.status}): ${msg} — ตรวจ username/Application Password และบทบาทต้องเป็น Editor/Author ขึ้นไป`, 'forbidden', res.status);
      if (res.status === 404 && (code === 'rest_no_route' || !json)) throw new WebError('ไม่พบ REST API ของ WordPress ที่ URL นี้ (เว็บอาจไม่ใช่ WordPress หรือปิด REST API ไว้)', 'notFound', 404);
      if (res.status === 404) throw new WebError(msg, 'notFound', 404);
      if (res.status === 429 || res.status >= 500) throw new WebError(`WordPress ตอบ ${res.status}: ${msg}`, res.status === 429 ? 'quota' : 'network', res.status);
      throw new WebError(`WordPress ตอบ ${res.status}: ${msg}`, 'invalid', res.status);
    }
    return json as T;
  }

  /** ตรวจว่า credential ใช้ได้ + ผู้ใช้สร้างโพสต์ได้ */
  async me(): Promise<WpUser> {
    const u = await this.call<{ id: number; name: string; slug: string; roles?: string[]; capabilities?: Record<string, boolean> }>('GET', '/users/me?context=edit');
    return { id: u.id, name: u.name, slug: u.slug, roles: u.roles ?? [], capabilities: u.capabilities ?? {} };
  }
  async findPostBySlug(slug: string): Promise<WpPost | null> {
    const rows = await this.call<Record<string, unknown>[]>('GET', `/posts?slug=${encodeURIComponent(slug)}&status=any&context=edit&per_page=5`);
    const r = rows[0]; return r ? normalizePost(r) : null;
  }
  async getPost(id: number): Promise<WpPost | null> {
    try { return normalizePost(await this.call<Record<string, unknown>>('GET', `/posts/${id}?context=edit`)); } catch (e) { if (e instanceof WebError && e.code === 'notFound') return null; throw e; }
  }
  async createPost(input: WpPostInput): Promise<WpPost> { return normalizePost(await this.call<Record<string, unknown>>('POST', '/posts', input)); }
  async updatePost(id: number, input: Partial<WpPostInput>): Promise<WpPost> { return normalizePost(await this.call<Record<string, unknown>>('POST', `/posts/${id}`, input)); }
  /** หา/สร้าง term ตามชื่อ → id (WordPress ไม่ให้ซ้ำชื่อ — ถ้ามีแล้วคืน id เดิม) */
  async ensureTerms(kind: WpTermKind, names: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const raw of names.map(n => n.trim()).filter(Boolean).slice(0, 20)) {
      const found = await this.call<{ id: number; name: string }[]>('GET', `/${kind}?search=${encodeURIComponent(raw)}&per_page=20`);
      const exact = found.find(t => t.name.toLowerCase() === raw.toLowerCase());
      if (exact) { ids.push(exact.id); continue; }
      try { const created = await this.call<{ id: number }>('POST', `/${kind}`, { name: raw }); ids.push(created.id); }
      catch (e) { const data = e as WebError; if (data.httpStatus === 400) { const again = await this.call<{ id: number; name: string }[]>('GET', `/${kind}?search=${encodeURIComponent(raw)}&per_page=20`); const t = again.find(x => x.name.toLowerCase() === raw.toLowerCase()); if (t) { ids.push(t.id); continue; } } throw e; }
    }
    return ids;
  }
}

function normalizePost(r: Record<string, unknown>): WpPost {
  const title = r.title as { rendered?: string; raw?: string } | string | undefined;
  return { id: Number(r.id), link: String(r.link ?? ''), slug: String(r.slug ?? ''), status: String(r.status ?? ''), title: typeof title === 'string' ? title : (title?.raw ?? title?.rendered ?? ''), date: (r.date_gmt as string | undefined) ?? (r.date as string | undefined) ?? null, modified: (r.modified_gmt as string | undefined) ?? null };
}

/** slug จากชื่อเรื่อง — รองรับไทย (WordPress รับ UTF-8 slug ได้ แต่เราตัดอักขระพิเศษ/เว้นวรรค) */
export function slugify(title: string): string {
  const s = title.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return s || `post-${Date.now()}`;
}

/** ล้าง HTML บทความก่อนเก็บ/ส่งขึ้นเว็บลูกค้า — ตัด script/style/iframe/object/embed/form, event handler (on*) และ URL javascript: (ไม่ใช่ sanitizer เต็มรูปแบบ แต่กันของอันตรายที่ AI/คนวางมา) */
export function sanitizeArticleHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src|action|formaction|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '')
    .replace(/\s+(href|src)\s*=\s*("\s*data:text\/html[^"]*"|'\s*data:text\/html[^']*')/gi, '')
    .trim();
}
