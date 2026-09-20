/**
 * ตัวตรวจเว็บ (AGENTS_WEB.md W-1) — fetch + node:tls ล้วน ไม่มี dependency
 * - สุภาพต่อเว็บลูกค้า: UA ระบุตัว, timeout, crawl จำกัด, robots.txt สำหรับ crawl
 * - กัน SSRF: อนุญาตแค่ http/https และห้าม IP ส่วนตัว/loopback ยกเว้น allowPrivate (test)
 * - ค่าที่อ่านไม่ได้ = null / SKIPPED ห้ามเดา
 */
import { connect as tlsConnect } from 'node:tls';
import { isIP } from 'node:net';
import type { LinksResult, PageSpeedResult, SeoIssue, SeoResult, SslResult, UptimeResult } from './types';
import { WebError } from './types';

export const USER_AGENT = 'FBPM-SiteMonitor/1.0 (+https://github.com/suthipongs10-a11y/FBPage)';
export interface CheckOptions { fetchImpl?: typeof fetch; timeoutMs?: number; allowPrivate?: boolean; now?: () => number }
const f = (o: CheckOptions) => o.fetchImpl ?? fetch;

/** normalize URL ที่ผู้ใช้ป้อน → origin + path (ไม่มี query/hash) และปฏิเสธเป้าหมายที่ไม่ปลอดภัย */
export function normalizeSiteUrl(input: string, allowPrivate = false): string {
  let u: URL;
  const raw = input.trim(); if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) throw new WebError('รองรับเฉพาะ http/https', 'invalid');
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new WebError('URL ไม่ถูกต้อง', 'invalid'); }
  if (!/^https?:$/.test(u.protocol)) throw new WebError('รองรับเฉพาะ http/https', 'invalid');
  if (!allowPrivate && isPrivateHost(u.hostname)) throw new WebError('ไม่อนุญาตเป้าหมายในเครือข่ายภายใน', 'blocked');
  u.hash = ''; u.search = ''; u.username = ''; u.password = '';
  return u.toString().replace(/\/$/, '');
}
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v = isIP(h);
  if (v === 4) { const [a, b] = h.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || a! >= 224; }
  if (v === 6) return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  return false;
}
const withTimeout = (ms: number) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };

/** W-1: uptime — HTTP status + คำที่ต้องพบ + latency (> 3 วิ = DEGRADED) */
export async function checkUptime(url: string, expectedText: string | null | undefined, o: CheckOptions = {}): Promise<UptimeResult> {
  const t = withTimeout(o.timeoutMs ?? 15_000); const started = (o.now ?? Date.now)();
  try {
    const res = await f(o)(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' }, redirect: 'follow', signal: t.signal });
    const latencyMs = (o.now ?? Date.now)() - started;
    const html = (res.headers.get('content-type') ?? '').includes('text/html') ? (await res.text()).slice(0, 2_000_000) : null;
    const textFound = expectedText ? (html ?? '').toLowerCase().includes(expectedText.toLowerCase()) : null;
    const redirected = res.url !== url && res.url !== `${url}/`;
    const ok = res.status >= 200 && res.status < 400 && textFound !== false;
    const slow = latencyMs > 3_000;
    return { status: !ok ? 'FAIL' : slow ? 'WARN' : 'OK', siteStatus: !ok ? 'DOWN' : slow ? 'DEGRADED' : 'UP', httpStatus: res.status, latencyMs, finalUrl: res.url, redirected, textFound, error: !ok ? (textFound === false ? `ไม่พบข้อความ "${expectedText}" ในหน้า` : `HTTP ${res.status}`) : null, html };
  } catch (e) {
    return { status: 'FAIL', siteStatus: 'DOWN', httpStatus: null, latencyMs: null, finalUrl: null, redirected: false, textFound: null, error: (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message, html: null };
  } finally { t.done(); }
}

/** W-1: ใบรับรอง TLS — เชื่อมต่อ tls ตรง อ่านวันหมดอายุ (http ล้วน = SKIPPED) */
export function checkSsl(url: string, o: CheckOptions = {}): Promise<SslResult> {
  const u = new URL(url);
  if (u.protocol !== 'https:') return Promise.resolve({ status: 'SKIPPED', validTo: null, validFrom: null, daysLeft: null, issuer: null, subject: null, error: 'ไม่ใช่ https' });
  return new Promise(resolve => {
    const port = Number(u.port) || 443; let settled = false;
    const done = (r: SslResult) => { if (!settled) { settled = true; resolve(r); } };
    const sock = tlsConnect({ host: u.hostname, port, servername: u.hostname, rejectUnauthorized: false, timeout: o.timeoutMs ?? 10_000 }, () => {
      const cert = sock.getPeerCertificate(); const authorized = sock.authorized; const authErr = sock.authorizationError;
      sock.end();
      if (!cert || !cert.valid_to) return done({ status: 'FAIL', validTo: null, validFrom: null, daysLeft: null, issuer: null, subject: null, error: 'ไม่พบใบรับรอง' });
      const validTo = new Date(cert.valid_to); const daysLeft = Math.floor((validTo.getTime() - (o.now ?? Date.now)()) / 86_400_000);
      const issuer = cert.issuer ? [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(' ') : null;
      const status = daysLeft < 0 || (!authorized && !o.allowPrivate) ? 'FAIL' : daysLeft <= 14 ? 'WARN' : 'OK';
      done({ status, validTo: validTo.toISOString(), validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null, daysLeft, issuer, subject: cert.subject?.CN ? String(cert.subject.CN) : null, error: daysLeft < 0 ? 'ใบรับรองหมดอายุแล้ว' : !authorized && !o.allowPrivate ? `ใบรับรองไม่ผ่านการตรวจสอบ: ${String(authErr)}` : null });
    });
    sock.on('error', e => done({ status: 'FAIL', validTo: null, validFrom: null, daysLeft: null, issuer: null, subject: null, error: e.message }));
    sock.on('timeout', () => { sock.destroy(); done({ status: 'FAIL', validTo: null, validFrom: null, daysLeft: null, issuer: null, subject: null, error: 'timeout' }); });
  });
}

// ---------- SEO audit (HTML parsing แบบ regex ระวังพอสำหรับ meta/heading/link) ----------
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null; };
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();
export function seoAudit(html: string, pageUrl: string): SeoResult {
  const head = html.slice(0, 300_000);
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '') || null;
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]);
  const meta = (n: string) => { const t = metas.find(x => (attr(x, 'name') ?? attr(x, 'property') ?? '').toLowerCase() === n); return t ? decode(attr(t, 'content') ?? '') || null : null; };
  const description = meta('description'); const robotsMeta = meta('robots'); const viewport = !!meta('viewport'); const ogTitle = !!meta('og:title'); const ogImage = !!meta('og:image');
  const lang = attr(/<html\b[^>]*>/i.exec(head)?.[0] ?? '', 'lang');
  const canonicalTag = [...head.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).find(x => (attr(x, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'));
  const canonical = canonicalTag ? attr(canonicalTag, 'href') : null;
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const h1Count = (body.match(/<h1\b/gi) ?? []).length;
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]); const imagesMissingAlt = imgs.filter(i => { const a = attr(i, 'alt'); return a === null || a === ''; }).length;
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); const wordCount = text ? text.split(' ').filter(w => w.length > 1).length : 0;
  const origin = new URL(pageUrl).origin; let internalLinks = 0; let externalLinks = 0;
  for (const a of body.matchAll(/<a\b[^>]*>/gi)) { const href = attr(a[0], 'href'); if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue; try { const u = new URL(href, pageUrl); if (u.origin === origin) internalLinks++; else externalLinks++; } catch { /* skip */ } }
  const issues: SeoIssue[] = [];
  if (!title) issues.push({ code: 'TITLE_MISSING', severity: 'high', message: 'ไม่มี <title>' });
  else if (title.length > 60) issues.push({ code: 'TITLE_LONG', severity: 'low', message: `title ยาว ${title.length} ตัวอักษร (แนะนำ ≤ 60)` });
  else if (title.length < 15) issues.push({ code: 'TITLE_SHORT', severity: 'low', message: `title สั้น ${title.length} ตัวอักษร` });
  if (!description) issues.push({ code: 'DESCRIPTION_MISSING', severity: 'medium', message: 'ไม่มี meta description' });
  else if (description.length > 160) issues.push({ code: 'DESCRIPTION_LONG', severity: 'low', message: `description ยาว ${description.length} ตัวอักษร (แนะนำ ≤ 160)` });
  if (h1Count === 0) issues.push({ code: 'H1_MISSING', severity: 'medium', message: 'ไม่มี <h1>' }); else if (h1Count > 1) issues.push({ code: 'H1_MULTIPLE', severity: 'low', message: `มี <h1> ${h1Count} อัน` });
  if (!canonical) issues.push({ code: 'CANONICAL_MISSING', severity: 'low', message: 'ไม่มี canonical' });
  if (robotsMeta && /noindex/i.test(robotsMeta)) issues.push({ code: 'NOINDEX', severity: 'high', message: 'หน้านี้ตั้ง noindex — Google จะไม่จัดทำดัชนี', detail: robotsMeta });
  if (!viewport) issues.push({ code: 'VIEWPORT_MISSING', severity: 'medium', message: 'ไม่มี meta viewport (มือถือ)' });
  if (!lang) issues.push({ code: 'LANG_MISSING', severity: 'low', message: 'ไม่ระบุ lang ที่ <html>' });
  if (!ogTitle || !ogImage) issues.push({ code: 'OG_INCOMPLETE', severity: 'low', message: 'Open Graph ไม่ครบ (og:title/og:image) — แชร์ลง Facebook แล้วภาพ/ชื่อไม่ขึ้น' });
  if (imagesMissingAlt > 0) issues.push({ code: 'IMG_ALT', severity: 'low', message: `รูป ${imagesMissingAlt}/${imgs.length} ไม่มี alt` });
  if (wordCount < 150) issues.push({ code: 'THIN_CONTENT', severity: 'medium', message: `เนื้อหาน้อย (${wordCount} คำ)` });
  const status = issues.some(i => i.severity === 'high') ? 'FAIL' : issues.some(i => i.severity === 'medium') ? 'WARN' : 'OK';
  return { status, title, titleLength: title?.length ?? 0, description, descriptionLength: description?.length ?? 0, h1Count, canonical, robotsMeta, lang, viewport, ogTitle, ogImage, imagesTotal: imgs.length, imagesMissingAlt, wordCount, internalLinks, externalLinks, issues };
}

/** robots.txt แบบง่าย: คืน path prefix ที่ Disallow สำหรับ UA ทั่วไป */
export async function fetchDisallows(origin: string, o: CheckOptions = {}): Promise<string[]> {
  const t = withTimeout(o.timeoutMs ?? 8_000);
  try { const res = await f(o)(`${origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: t.signal }); if (!res.ok) return []; const txt = await res.text(); const out: string[] = []; let applies = false;
    for (const raw of txt.split(/\r?\n/)) { const line = raw.split('#')[0]!.trim(); if (!line) continue; const [k, ...rest] = line.split(':'); const v = rest.join(':').trim(); const key = k!.trim().toLowerCase(); if (key === 'user-agent') applies = v === '*' || v.toLowerCase().includes('fbpm'); else if (applies && key === 'disallow' && v) out.push(v); }
    return out; } catch { return []; } finally { t.done(); }
}
/** W-1: ลิงก์เสียภายใน — HEAD/GET ทีละลิงก์ ≤ max หน้า เคารพ robots */
export async function checkLinks(pageUrl: string, html: string, o: CheckOptions & { max?: number; delayMs?: number } = {}): Promise<LinksResult> {
  const origin = new URL(pageUrl).origin; const max = o.max ?? 50; const disallows = await fetchDisallows(origin, o);
  const seen = new Set<string>();
  for (const a of html.matchAll(/<a\b[^>]*>/gi)) { const href = attr(a[0], 'href'); if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue; try { const u = new URL(href, pageUrl); u.hash = ''; if (u.origin === origin && u.toString() !== pageUrl && u.toString() !== `${pageUrl}/`) seen.add(u.toString()); } catch { /* skip */ } }
  const targets = [...seen].filter(u => !disallows.some(d => new URL(u).pathname.startsWith(d))).slice(0, max);
  const broken: LinksResult['broken'] = []; let checked = 0;
  for (const url of targets) {
    const t = withTimeout(o.timeoutMs ?? 10_000);
    try { let res = await f(o)(url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: t.signal }); if (res.status === 405 || res.status === 403) res = await f(o)(url, { method: 'GET', headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: t.signal }); checked++; if (res.status >= 400) broken.push({ url, status: res.status, ok: false, error: null }); }
    catch (e) { checked++; broken.push({ url, status: null, ok: false, error: (e as Error).message }); }
    finally { t.done(); }
    if (o.delayMs !== 0) await new Promise(r => setTimeout(r, o.delayMs ?? 1000));   // สุภาพ: ≤ 1 คำขอ/วินาที
  }
  return { status: broken.length === 0 ? 'OK' : broken.length <= 2 ? 'WARN' : 'FAIL', checked, broken, skipped: seen.size - targets.length, error: null };
}

/** W-1: Core Web Vitals ผ่าน PageSpeed Insights API (ไม่มี key = SKIPPED ไม่เดา) */
export async function checkPageSpeed(url: string, apiKey: string | undefined, o: CheckOptions & { baseUrl?: string; strategy?: 'mobile' | 'desktop' } = {}): Promise<PageSpeedResult> {
  const strategy = o.strategy ?? 'mobile'; const empty = { strategy, performance: null, seo: null, accessibility: null, bestPractices: null, lcpMs: null, cls: null, inpMs: null, fcpMs: null, ttfbMs: null, fieldData: false } as const;
  if (!apiKey) return { ...empty, status: 'SKIPPED', error: 'ไม่มี PAGESPEED_API_KEY' };
  const api = new URL(`${(o.baseUrl ?? 'https://www.googleapis.com/pagespeedonline/v5').replace(/\/$/, '')}/runPagespeed`);
  api.searchParams.set('url', url); api.searchParams.set('key', apiKey); api.searchParams.set('strategy', strategy); for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) api.searchParams.append('category', c);
  const t = withTimeout(o.timeoutMs ?? 60_000);
  try {
    const res = await f(o)(api, { signal: t.signal }); const j = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) { const msg = String((j.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`); return { ...empty, status: res.status === 429 ? 'SKIPPED' : 'FAIL', error: msg }; }
    const lh = j.lighthouseResult as { categories?: Record<string, { score: number | null }>; audits?: Record<string, { numericValue?: number }> } | undefined; const cats = lh?.categories ?? {}; const aud = lh?.audits ?? {};
    const score = (k: string) => (cats[k]?.score === null || cats[k]?.score === undefined ? null : Math.round(cats[k]!.score! * 100));
    const num = (k: string) => (typeof aud[k]?.numericValue === 'number' ? Math.round(aud[k]!.numericValue! * 1000) / 1000 : null);
    const field = (j.loadingExperience as { metrics?: Record<string, { percentile?: number }> } | undefined)?.metrics;
    const lcpMs = field?.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? (num('largest-contentful-paint') === null ? null : Math.round(num('largest-contentful-paint')!));
    const cls = field?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile !== undefined ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : num('cumulative-layout-shift');
    const inpMs = field?.INTERACTION_TO_NEXT_PAINT?.percentile ?? null;
    const perf = score('performance');
    return { strategy, status: perf === null ? 'SKIPPED' : perf >= 90 ? 'OK' : perf >= 50 ? 'WARN' : 'FAIL', performance: perf, seo: score('seo'), accessibility: score('accessibility'), bestPractices: score('best-practices'), lcpMs, cls, inpMs, fcpMs: num('first-contentful-paint') === null ? null : Math.round(num('first-contentful-paint')!), ttfbMs: num('server-response-time') === null ? null : Math.round(num('server-response-time')!), fieldData: !!field, error: null };
  } catch (e) { return { ...empty, status: 'FAIL', error: (e as Error).message }; } finally { t.done(); }
}
