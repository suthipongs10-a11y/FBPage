/**
 * อ่านบทความจากลิงก์แบบสุภาพ (เคารพ robots.txt, กัน SSRF ทุก redirect, เพดานขนาด) แล้วดึงเนื้อความหลักแบบเบา ๆ
 * ใช้กับโต๊ะค้นคว้า: เนื้อความเต็มใช้ในหน่วยความจำเพื่อสรุปเท่านั้น — ผู้เรียกเก็บลง DB ได้แค่ excerpt สั้น ๆ + ลิงก์
 */
import { fetchDisallows, isPrivateHost, USER_AGENT } from './checks';
import { decodeEntities, politeFetchBytes, stripHtml, type NewsFetchOptions } from './news';
import { WebError } from './types';

export interface Article { url: string; title: string | null; siteName: string | null; publishedAt: Date | null; text: string }

const meta = (html: string, key: string): string | null => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0]; const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? decodeEntities(c).trim() || null : null;
};

/** ดึงเนื้อความหลักจาก HTML: ตัดสคริปต์/เมนู/ส่วนหัวท้าย → เลือก <article>/<main> → เก็บย่อหน้า/หัวข้อ/รายการ */
export function extractArticle(html: string, url: string, maxChars = 8000): Article {
  const title = meta(html, 'og:title') ?? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]!) : null);
  const siteName = meta(html, 'og:site_name') ?? new URL(url).hostname.replace(/^www\./, '');
  const pub = meta(html, 'article:published_time') ?? html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ?? null;
  const publishedAt = pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub) : null;
  let body = html.replace(/<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const main = body.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? body.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  if (main) body = main;
  const blocks: string[] = [];
  for (const m of body.matchAll(/<(p|h[1-4]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = stripHtml(m[2]!).replace(/\s+/g, ' ').trim();
    if (t.length >= (m[1]!.toLowerCase() === 'p' ? 40 : 15)) blocks.push(t);
  }
  let text = [...new Set(blocks)].join('\n');
  if (text.length < 200) text = stripHtml(body).replace(/\s+/g, ' ').trim();
  return { url, title: title?.slice(0, 300) ?? null, siteName: siteName?.slice(0, 120) ?? null, publishedAt, text: text.slice(0, maxChars) };
}

/** อ่านบทความหนึ่งลิงก์ — robots.txt ไม่อนุญาต/ไม่ใช่ HTML = error ที่อ่านเข้าใจได้ */
export async function fetchArticle(url: string, o: NewsFetchOptions & { maxChars?: number } = {}): Promise<Article> {
  let u: URL; try { u = new URL(url); } catch { throw new WebError('ลิงก์ไม่ถูกต้อง', 'invalid'); }
  if (!/^https?:$/.test(u.protocol)) throw new WebError('รองรับเฉพาะลิงก์ http(s)', 'invalid');
  if (!o.allowPrivate && isPrivateHost(u.hostname)) throw new WebError('ไม่อนุญาตเป้าหมายในเครือข่ายภายใน', 'blocked');
  const disallows = await fetchDisallows(u.origin, o).catch(() => [] as string[]);
  if (disallows.some(d => d && u.pathname.startsWith(d))) throw new WebError('robots.txt ของเว็บนี้ไม่อนุญาตให้อ่านหน้านี้', 'forbidden');
  const r = await politeFetchBytes(url, { ...o, maxBytes: o.maxBytes ?? 3_000_000, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' });
  if (r.contentType && !/html|xml/i.test(r.contentType)) throw new WebError(`ลิงก์นี้ไม่ใช่หน้าเว็บ (${r.contentType.split(';')[0]})`, 'invalid');
  const a = extractArticle(r.bytes.toString('utf8'), r.finalUrl, o.maxChars);
  if (a.text.length < 80) throw new WebError('อ่านเนื้อความจากหน้านี้ไม่ได้ (อาจต้องล็อกอิน/เป็นแอป)', 'invalid');
  return a;
}

/** ตามลิงก์ redirect (เช่นลิงก์อ้างอิงของ Google grounding) ไปหาปลายทางจริง — ตรวจ SSRF ทุก hop ไม่อ่านเนื้อหา */
export async function resolveRedirect(url: string, o: { allowPrivate?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number; maxHops?: number } = {}): Promise<string> {
  let current = url;
  for (let hop = 0; hop < (o.maxHops ?? 4); hop++) {
    const u = new URL(current);
    if (!/^https?:$/.test(u.protocol) || (!o.allowPrivate && isPrivateHost(u.hostname))) return current;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 8000);
    try {
      const res = await (o.fetchImpl ?? fetch)(current, { method: 'GET', redirect: 'manual', headers: { 'user-agent': USER_AGENT }, signal: ctl.signal });
      await res.body?.cancel().catch(() => undefined);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
      return current;
    } catch { return current; } finally { clearTimeout(timer); }
  }
  return current;
}
