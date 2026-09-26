/**
 * ห้องข่าว (News) — ดึงหัวข้อข่าวจาก RSS/Atom และค้นข่าวผ่าน Tavily ด้วย fetch ล้วน ไม่มี dependency
 * - สุภาพ: UA ระบุตัว, เคารพ robots.txt, timeout, เพดานขนาด; ผู้เรียกเว้นช่วงระหว่างคำขอเอง (≤ 1 คำขอ/วินาที)
 * - กัน SSRF: http/https เท่านั้น ห้ามโฮสต์ภายใน และตรวจซ้ำทุกครั้งที่ redirect
 * - เก็บเฉพาะหัวข้อ/เกริ่นสั้น + ลิงก์ต้นทางไว้เป็นหลักฐาน — ห้ามเอาเนื้อหาหรือรูปของสำนักข่าวไปโพสต์ตรง
 */
import { createHash } from 'node:crypto';
import { USER_AGENT, fetchDisallows, isPrivateHost, type CheckOptions } from './checks';
import { WebError } from './types';

export interface FeedEntry { title: string; url: string; snippet: string | null; publishedAt: Date | null; sourceName: string | null }
export interface ParsedFeed { title: string | null; entries: FeedEntry[] }
export interface NewsFetchOptions extends CheckOptions { maxBytes?: number; maxRedirects?: number }

const SNIPPET_MAX = 1000;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#')) {
      const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
/** ข้อความล้วนจาก HTML/XML — ตัดสคริปต์/สไตล์/แท็ก ถอด entity ยุบช่องว่าง */
export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
const esc = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, 'i').exec(block);
  return m ? cdata(m[1]!) : null;
}
/** ข้อความในแท็ก — RSS บางเจ้าใส่ HTML แบบ escape (&lt;p&gt;) จึงถอด entity ก่อนตัดแท็ก */
const text = (raw: string | null) => (raw == null ? null : stripHtml(decodeEntities(raw)) || null);
const attr = (el: string, name: string) => { const m = new RegExp(`\\s${esc(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(el); return m ? decodeEntities(m[2] ?? m[3] ?? '') : null; };
const httpUrl = (s: string | null | undefined): string | null => { if (!s) return null; try { const u = new URL(s.trim()); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; } };
const date = (s: string | null): Date | null => { if (!s) return null; const d = new Date(s.trim()); return Number.isNaN(d.getTime()) ? null : d; };

/** RSS 2.0 / Atom แบบย่อ — อ่านเฉพาะหัวข้อ ลิงก์ เกริ่น วันที่ (รายการที่ไม่มีหัวข้อหรือลิงก์ http ถูกข้าม) */
export function parseFeed(xml: string, limit = 50): ParsedFeed {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const itemRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const first = xml.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i);
  const title = text(tag(first >= 0 ? xml.slice(0, first) : xml, 'title'));
  const entries: FeedEntry[] = [];
  for (const m of xml.matchAll(itemRe)) {
    const b = m[0];
    const t = text(tag(b, 'title'));
    let url: string | null;
    if (isAtom) {
      const links = [...b.matchAll(/<link\b[^>]*>/gi)].map(l => l[0]);
      const alt = links.find(l => { const rel = attr(l, 'rel'); return !rel || rel === 'alternate'; }) ?? links[0];
      url = httpUrl(alt ? attr(alt, 'href') : null);
    } else {
      url = httpUrl(text(tag(b, 'link'))) ?? httpUrl(text(tag(b, 'guid')));
    }
    if (!t || !url) continue;
    const body = tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content:encoded') ?? tag(b, 'content');
    const snippet = text(body)?.slice(0, SNIPPET_MAX) ?? null;
    const publishedAt = date(text(tag(b, 'pubDate')) ?? text(tag(b, 'dc:date')) ?? text(tag(b, 'published')) ?? text(tag(b, 'updated')));
    entries.push({ title: t.slice(0, 300), url, snippet, publishedAt, sourceName: text(tag(b, 'source')) ?? title });
    if (entries.length >= limit) break;
  }
  return { title, entries };
}

function checkTarget(raw: string, allowPrivate = false): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new WebError('URL ไม่ถูกต้อง', 'invalid'); }
  if (!/^https?:$/.test(u.protocol)) throw new WebError('รองรับเฉพาะ http/https', 'invalid');
  if (!allowPrivate && isPrivateHost(u.hostname)) throw new WebError('ไม่อนุญาตเป้าหมายในเครือข่ายภายใน', 'blocked');
  return u;
}

/** GET แบบสุภาพ: ตรวจ SSRF ทุก hop (redirect: manual), timeout, เพดานขนาดแบบนับไบต์ระหว่างอ่าน */
export async function politeFetchText(url: string, o: NewsFetchOptions = {}): Promise<{ text: string; finalUrl: string; contentType: string }> {
  const f = o.fetchImpl ?? fetch; const maxBytes = o.maxBytes ?? 2_000_000;
  let current = url;
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    checkTarget(current, o.allowPrivate);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 15_000);
    try {
      let res: Response;
      try { res = await f(current, { headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' }, redirect: 'manual', signal: ctl.signal }); }
      catch (e) { throw new WebError((e as Error).name === 'AbortError' ? 'หมดเวลารอ' : `เชื่อมต่อไม่ได้: ${(e as Error).message}`, 'network'); }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { await res.body?.cancel(); current = new URL(loc, current).toString(); continue; }
      if (!res.ok) { await res.body?.cancel(); throw new WebError(`HTTP ${res.status}`, res.status === 404 ? 'notFound' : res.status === 403 ? 'forbidden' : 'unknown', res.status); }
      const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new WebError(`ไฟล์ใหญ่เกิน ${Math.round(maxBytes / 1000)} KB`, 'invalid'); }
        chunks.push(value);
      }
      return { text: Buffer.concat(chunks).toString('utf8'), finalUrl: current, contentType: res.headers.get('content-type') ?? '' };
    } finally { clearTimeout(timer); }
  }
  throw new WebError('redirect มากเกินไป', 'invalid');
}

/** ดึงฟีด: เคารพ robots.txt ของโฮสต์ แล้วแปลงเป็นรายการข่าว */
export async function fetchFeed(url: string, o: NewsFetchOptions & { limit?: number } = {}): Promise<ParsedFeed> {
  const u = checkTarget(url, o.allowPrivate);
  const disallows = await fetchDisallows(u.origin, o);
  if (disallows.some(d => u.pathname.startsWith(d))) throw new WebError('robots.txt ของเว็บนี้ไม่อนุญาตให้ดึงฟีดนี้', 'forbidden');
  const r = await politeFetchText(url, o);
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(r.text.slice(0, 5000))) throw new WebError('ลิงก์นี้ไม่ใช่ RSS/Atom', 'invalid');
  return parseFeed(r.text, o.limit ?? 50);
}

// ---------- ค้นเว็บ (Tavily) ----------
export interface SearchResult { title: string; url: string; snippet: string | null; publishedAt: Date | null; sourceName: string | null }
export interface TavilyOptions { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxResults?: number; days?: number }

/** ค้นข่าวล่าสุดผ่าน Tavily (topic=news) — คืนเฉพาะหัวข้อ/เกริ่น/ลิงก์ ไม่ขอเนื้อหาเต็มหรือรูป */
export async function tavilySearch(apiKey: string, query: string, o: TavilyOptions = {}): Promise<SearchResult[]> {
  const f = o.fetchImpl ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 20_000);
  try {
    let res: Response;
    try {
      res = await f(`${(o.baseUrl ?? 'https://api.tavily.com').replace(/\/+$/, '')}/search`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'user-agent': USER_AGENT },
        body: JSON.stringify({ query, topic: 'news', days: o.days ?? 3, max_results: Math.min(20, Math.max(1, o.maxResults ?? 10)), include_answer: false, include_raw_content: false, include_images: false }),
      });
    } catch (e) { throw new WebError((e as Error).name === 'AbortError' ? 'Tavily ตอบช้าเกินไป' : `เชื่อมต่อ Tavily ไม่ได้: ${(e as Error).message}`, 'network'); }
    if (res.status === 401 || res.status === 403) throw new WebError('API key ของ Tavily ไม่ถูกต้องหรือถูกปิด', 'forbidden', res.status);
    if (res.status === 429 || res.status === 432 || res.status === 433) throw new WebError('โควตา Tavily เต็มหรือเกินอัตราที่อนุญาต', 'quota', res.status);
    if (!res.ok) throw new WebError(`Tavily ตอบ HTTP ${res.status}`, 'unknown', res.status);
    const body = await res.json() as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
    const out: SearchResult[] = [];
    for (const r of body.results ?? []) {
      const url = httpUrl(r.url); const title = r.title ? stripHtml(r.title) : '';
      if (!url || !title) continue;
      out.push({ title: title.slice(0, 300), url, snippet: r.content ? stripHtml(r.content).slice(0, SNIPPET_MAX) : null, publishedAt: date(r.published_date ?? null), sourceName: new URL(url).hostname.replace(/^www\./, '') });
    }
    return out;
  } finally { clearTimeout(timer); }
}

// ---------- กันข่าวซ้ำ ----------
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|igshid|mc_cid|mc_eid|ref|ref_src|cmpid|ocid)$/i;
/** URL มาตรฐานสำหรับเทียบซ้ำ — ตัด fragment, พารามิเตอร์ติดตาม, www., / ท้าย และเรียงพารามิเตอร์ */
export function canonicalNewsUrl(url: string): string {
  const u = new URL(url);
  u.hash = ''; u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = keep.length ? `?${new URLSearchParams(keep).toString()}` : '';
  return u.toString().replace(/\/(?=$|\?)/, '');
}
/** หัวข้อข่าวแบบ normalize (ภาษาไทยไม่มีช่องว่าง จึงตัดช่องว่าง/เครื่องหมายทั้งหมดแล้วเทียบทั้งสาย) */
export const normalizeTitle = (s: string) => s.normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
