/** Google Search Console API (AGENTS_WEB.md W-2) — ใช้ access token จาก GoogleConnection เดิม (scope webmasters.readonly) */
import type { SearchDay, SearchRow } from './types';
import { WebError } from './types';

export interface SearchConsoleOptions { baseUrl?: string; fetchImpl?: typeof fetch }
export interface ScSite { siteUrl: string; permissionLevel: string }

export class SearchConsoleClient {
  private readonly base: string; private readonly fetchImpl: typeof fetch;
  constructor(o: SearchConsoleOptions = {}) { this.base = (o.baseUrl ?? 'https://www.googleapis.com/webmasters/v3').replace(/\/$/, ''); this.fetchImpl = o.fetchImpl ?? fetch; }

  private async call<T>(accessToken: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try { res = await this.fetchImpl(`${this.base}${path}`, { method: init.method ?? 'GET', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) }); }
    catch (e) { throw new WebError(`ติดต่อ Search Console ไม่ได้: ${(e as Error).message}`, 'network'); }
    const j = await res.json().catch(() => ({})) as { error?: { message?: string; status?: string } } & Record<string, unknown>;
    if (!res.ok) {
      const msg = j.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 401) throw new WebError('การอนุญาต Google หมดอายุ — เชื่อมต่อใหม่', 'reconnect', 401);
      if (res.status === 403) throw new WebError(`ไม่มีสิทธิ์ใน Search Console (${msg}) — เจ้าของเว็บต้องเพิ่มบัญชี Google นี้เป็น user ของ property`, 'forbidden', 403);
      if (res.status === 404) throw new WebError('ไม่พบ property นี้ใน Search Console', 'notFound', 404);
      if (res.status === 429) throw new WebError('Search Console จำกัดจำนวนคำขอ — ลองใหม่ภายหลัง', 'quota', 429);
      throw new WebError(`Search Console: ${msg}`, 'unknown', res.status);
    }
    return j as T;
  }

  /** property ที่บัญชีนี้เข้าถึงได้ */
  async listSites(accessToken: string): Promise<ScSite[]> {
    const j = await this.call<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(accessToken, '/sites');
    return (j.siteEntry ?? []).map(s => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
  }
  /** เลือก property ที่ตรงกับ URL เว็บ: sc-domain ของโดเมน หรือ URL prefix ที่ครอบ */
  static matchProperty(sites: ScSite[], siteUrl: string): string | null {
    const u = new URL(siteUrl); const host = u.hostname.replace(/^www\./, '');
    const domain = sites.find(s => s.siteUrl === `sc-domain:${host}`); if (domain) return domain.siteUrl;
    const prefix = sites.filter(s => s.siteUrl.startsWith('http')).map(s => s.siteUrl).filter(s => { try { const p = new URL(s); return p.hostname.replace(/^www\./, '') === host && (u.pathname + '/').startsWith(p.pathname.replace(/\/$/, '') + '/'); } catch { return false; } }).sort((a, b) => b.length - a.length)[0];
    return prefix ?? null;
  }

  private async query(accessToken: string, property: string, body: Record<string, unknown>): Promise<SearchRow[]> {
    const j = await this.call<{ rows?: SearchRow[] }>(accessToken, `/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: 'POST', body });
    return (j.rows ?? []).map(r => ({ keys: r.keys ?? [], clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0), ctr: Number(r.ctr ?? 0), position: Number(r.position ?? 0) }));
  }
  /** สรุปรายวัน + top queries/pages ของทั้งช่วง (แนบให้วันสุดท้าย) — ข้อมูล GSC ล่าช้า ~2–3 วัน */
  async daily(accessToken: string, property: string, startDate: string, endDate: string, top = 20): Promise<{ days: SearchDay[]; topQueries: SearchRow[]; topPages: SearchRow[] }> {
    const [byDate, topQueries, topPages] = await Promise.all([
      this.query(accessToken, property, { startDate, endDate, dimensions: ['date'], rowLimit: 500 }),
      this.query(accessToken, property, { startDate, endDate, dimensions: ['query'], rowLimit: top }),
      this.query(accessToken, property, { startDate, endDate, dimensions: ['page'], rowLimit: top }),
    ]);
    const days: SearchDay[] = byDate.map(r => ({ date: r.keys[0]!, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, topQueries: [], topPages: [] }));
    return { days, topQueries, topPages };
  }
}
