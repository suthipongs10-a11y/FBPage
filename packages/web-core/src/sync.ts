/**
 * Site checks + Search Console sync (AGENTS_WEB.md §4–5) — ใช้ร่วม API/worker (ต้องมี prisma ฝั่งเซิร์ฟเวอร์)
 * - runSiteChecks: เก็บ SiteCheck ทุกครั้ง, อัปเดต Site.last*, เปิด/ปิด SiteIncident (DOWN ต้อง FAIL 2 ครั้งติดกัน กัน false alarm)
 * - syncSearchConsole: SearchSnapshot รายวัน (upsert) + gscStatus
 * ไม่มี AI ในไฟล์นี้; การแจ้งเตือนทำผ่าน callback ให้ผู้เรียก (API/worker) เลือก transport
 */
import type { Prisma, PrismaClient } from '@fbpm/database';
import { ChannelNotAccessible, googleConnectionAccessToken, type GoogleAuth } from '@fbpm/youtube-core';
import { checkLinks, checkPageSpeed, checkSsl, checkUptime, seoAudit, type CheckOptions } from './checks';
import { SearchConsoleClient } from './search-console';
import type { CheckKind, SearchRow, SiteStatus } from './types';
import { WebError } from './types';

export interface WebDeps { prisma: PrismaClient; google: GoogleAuth | null; authSecret: string; pagespeedKey?: string; pagespeedBaseUrl?: string; searchConsole: SearchConsoleClient; check?: CheckOptions; linkDelayMs?: number }
export interface IncidentEvent { siteId: string; kind: string; opened: boolean; summary: string; incidentId: string }
export interface RunResult { site: { id: string; url: string; name: string; workspaceId: string }; status: SiteStatus; results: Partial<Record<CheckKind, { status: string; error: string | null }>>; events: IncidentEvent[] }

const SITE_SELECT = { id: true, url: true, name: true, expectedText: true, monitorEnabled: true, disconnectedAt: true, lastStatus: true, brand: { select: { client: { select: { workspaceId: true } } } } } as const;

async function openOrKeep(prisma: PrismaClient, siteId: string, kind: string, summary: string, events: IncidentEvent[]): Promise<void> {
  const open = await prisma.siteIncident.findFirst({ where: { siteId, kind, resolvedAt: null }, select: { id: true } });
  if (open) return;
  const inc = await prisma.siteIncident.create({ data: { siteId, kind, summary }, select: { id: true } });
  events.push({ siteId, kind, opened: true, summary, incidentId: inc.id });
}
async function resolveIfOpen(prisma: PrismaClient, siteId: string, kind: string, summary: string, events: IncidentEvent[]): Promise<void> {
  const open = await prisma.siteIncident.findFirst({ where: { siteId, kind, resolvedAt: null }, select: { id: true } });
  if (!open) return;
  await prisma.siteIncident.update({ where: { id: open.id }, data: { resolvedAt: new Date() } });
  events.push({ siteId, kind, opened: false, summary, incidentId: open.id });
}

/** รันชุดตรวจที่เลือก (ค่าเริ่มต้น: UPTIME) — หน้าแรกเท่านั้น */
export async function runSiteChecks(d: WebDeps, siteId: string, kinds: CheckKind[] = ['UPTIME']): Promise<RunResult> {
  const site = await d.prisma.site.findUnique({ where: { id: siteId }, select: SITE_SELECT });
  if (!site) throw new WebError('ไม่พบเว็บไซต์', 'notFound', 404);
  if (site.disconnectedAt) throw new WebError('เว็บไซต์นี้ถูกปิดการดูแลแล้ว', 'invalid');
  const out: RunResult = { site: { id: site.id, url: site.url, name: site.name, workspaceId: site.brand.client.workspaceId }, status: site.lastStatus as SiteStatus, results: {}, events: [] };
  const save = (kind: CheckKind, status: string, details: unknown, extra: { httpStatus?: number | null; latencyMs?: number | null; error?: string | null } = {}) =>
    d.prisma.siteCheck.create({ data: { siteId, kind, status, details: details as Prisma.InputJsonValue, httpStatus: extra.httpStatus ?? null, latencyMs: extra.latencyMs ?? null, error: extra.error ?? null } });
  let html: string | null = null;
  const wants = (k: CheckKind) => kinds.includes(k);

  if (wants('UPTIME') || wants('SEO') || wants('LINKS')) {
    const r = await checkUptime(site.url, site.expectedText, d.check);
    html = r.html;
    if (wants('UPTIME')) {
      const { html: _h, ...details } = r; void _h;
      await save('UPTIME', r.status, details, { httpStatus: r.httpStatus, latencyMs: r.latencyMs, error: r.error });
      // DOWN ต้องล้ม 2 ครั้งติด (ครั้งก่อนหน้าก็ FAIL) จึงเปิด incident; DEGRADED เปิดทันทีแบบ warn
      const prev = await d.prisma.siteCheck.findMany({ where: { siteId, kind: 'UPTIME' }, orderBy: { checkedAt: 'desc' }, take: 2, select: { status: true } });
      const twoFails = prev.length >= 2 && prev.every(p => p.status === 'FAIL');
      if (r.siteStatus === 'DOWN' && twoFails) await openOrKeep(d.prisma, siteId, 'DOWN', `เว็บล่ม: ${r.error ?? 'ไม่ทราบสาเหตุ'}`, out.events);
      if (r.siteStatus !== 'DOWN') await resolveIfOpen(d.prisma, siteId, 'DOWN', `เว็บกลับมาใช้งานได้ (HTTP ${r.httpStatus}, ${r.latencyMs} ms)`, out.events);
      if (r.siteStatus === 'DEGRADED') await openOrKeep(d.prisma, siteId, 'DEGRADED', `เว็บช้า: ${r.latencyMs} ms`, out.events);
      if (r.siteStatus === 'UP') await resolveIfOpen(d.prisma, siteId, 'DEGRADED', `ความเร็วกลับมาปกติ (${r.latencyMs} ms)`, out.events);
      const status: SiteStatus = r.siteStatus === 'DOWN' && !twoFails && site.lastStatus !== 'DOWN' ? 'DEGRADED' : r.siteStatus;
      out.status = status;
      await d.prisma.site.update({ where: { id: siteId }, data: { lastStatus: status, lastHttpStatus: r.httpStatus, lastLatencyMs: r.latencyMs, lastCheckedAt: new Date() } });
      out.results.UPTIME = { status: r.status, error: r.error };
    }
  }
  if (wants('SSL')) {
    const r = await checkSsl(site.url, d.check);
    await save('SSL', r.status, r, { error: r.error });
    await d.prisma.site.update({ where: { id: siteId }, data: { sslExpiresAt: r.validTo ? new Date(r.validTo) : null, sslIssuer: r.issuer } });
    if (r.status === 'FAIL' && r.daysLeft !== null && r.daysLeft < 0) await openOrKeep(d.prisma, siteId, 'SSL_EXPIRED', 'ใบรับรอง SSL หมดอายุแล้ว — เบราว์เซอร์จะเตือนผู้เข้าชม', out.events);
    else if (r.status === 'WARN') await openOrKeep(d.prisma, siteId, 'SSL_EXPIRING', `ใบรับรอง SSL จะหมดอายุใน ${r.daysLeft} วัน (${r.validTo?.slice(0, 10)})`, out.events);
    if (r.status === 'OK') { await resolveIfOpen(d.prisma, siteId, 'SSL_EXPIRING', 'ต่ออายุใบรับรองแล้ว', out.events); await resolveIfOpen(d.prisma, siteId, 'SSL_EXPIRED', 'ต่ออายุใบรับรองแล้ว', out.events); }
    out.results.SSL = { status: r.status, error: r.error };
  }
  if (wants('SEO')) {
    if (html) { const r = seoAudit(html, site.url); await save('SEO', r.status, r); out.results.SEO = { status: r.status, error: null }; }
    else { await save('SEO', 'SKIPPED', null, { error: 'ไม่ได้ HTML ของหน้าแรก' }); out.results.SEO = { status: 'SKIPPED', error: 'ไม่ได้ HTML ของหน้าแรก' }; }
  }
  if (wants('LINKS')) {
    if (html) { const r = await checkLinks(site.url, html, { ...d.check, delayMs: d.linkDelayMs ?? 1000 }); await save('LINKS', r.status, r, { error: r.error }); out.results.LINKS = { status: r.status, error: r.error }; }
    else { await save('LINKS', 'SKIPPED', null, { error: 'ไม่ได้ HTML ของหน้าแรก' }); out.results.LINKS = { status: 'SKIPPED', error: 'ไม่ได้ HTML ของหน้าแรก' }; }
  }
  if (wants('PAGESPEED')) {
    const r = await checkPageSpeed(site.url, d.pagespeedKey, { ...d.check, baseUrl: d.pagespeedBaseUrl });
    await save('PAGESPEED', r.status, r, { error: r.error }); out.results.PAGESPEED = { status: r.status, error: r.error };
  }
  return out;
}

/** W-2: ซิงก์ Search Console ย้อนหลัง N วัน → SearchSnapshot; ไม่มีสิทธิ์ → gscStatus NO_ACCESS (ไม่โยนต่อ) */
export async function syncSearchConsole(d: WebDeps, siteId: string, days = 28): Promise<{ days: number; status: string; error?: string }> {
  const site = await d.prisma.site.findUnique({ where: { id: siteId }, select: { id: true, url: true, googleConnectionId: true, searchConsoleProperty: true } });
  if (!site) throw new WebError('ไม่พบเว็บไซต์', 'notFound', 404);
  if (!site.googleConnectionId || !site.searchConsoleProperty) { await d.prisma.site.update({ where: { id: siteId }, data: { gscStatus: 'UNKNOWN' } }); return { days: 0, status: 'UNKNOWN', error: 'ยังไม่เชื่อม Search Console' }; }
  try {
    const token = await googleConnectionAccessToken(d.prisma, d.google, d.authSecret, site.googleConnectionId);
    // GSC ล่าช้า ~3 วัน: ดึงถึงเมื่อวานเสมอ แล้วเก็บเฉพาะวันที่ API ให้
    const end = new Date(Date.now() - 86_400_000); const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    const r = await d.searchConsole.daily(token, site.searchConsoleProperty, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
    for (const [i, day] of r.days.entries()) {
      const last = i === r.days.length - 1;
      await d.prisma.searchSnapshot.upsert({ where: { siteId_date: { siteId, date: new Date(day.date) } }, create: { siteId, date: new Date(day.date), clicks: day.clicks, impressions: day.impressions, ctr: day.ctr, position: day.position, ...(last && { topQueries: r.topQueries as unknown as Prisma.InputJsonValue, topPages: r.topPages as unknown as Prisma.InputJsonValue }) }, update: { clicks: day.clicks, impressions: day.impressions, ctr: day.ctr, position: day.position, capturedAt: new Date(), ...(last && { topQueries: r.topQueries as unknown as Prisma.InputJsonValue, topPages: r.topPages as unknown as Prisma.InputJsonValue }) } });
    }
    await d.prisma.site.update({ where: { id: siteId }, data: { gscStatus: 'OK', gscSyncedAt: new Date() } });
    await resolveIfOpen(d.prisma, siteId, 'GSC_ACCESS', 'เข้าถึง Search Console ได้แล้ว', []);
    return { days: r.days.length, status: 'OK' };
  } catch (e) {
    const noAccess = (e instanceof WebError && (e.code === 'forbidden' || e.code === 'notFound')) || e instanceof ChannelNotAccessible || (e instanceof WebError && e.code === 'reconnect');
    const msg = e instanceof Error ? e.message : String(e);
    await d.prisma.site.update({ where: { id: siteId }, data: { gscStatus: noAccess ? 'NO_ACCESS' : 'ERROR' } });
    if (noAccess) await openOrKeep(d.prisma, siteId, 'GSC_ACCESS', msg, []);
    if (e instanceof WebError && e.code === 'quota') return { days: 0, status: 'ERROR', error: msg };
    return { days: 0, status: noAccess ? 'NO_ACCESS' : 'ERROR', error: msg };
  }
}

/** สรุปสำหรับ UI/รายงาน: uptime % 30 วัน, latency median, ปัญหา SEO ล่าสุด, PageSpeed ล่าสุด, ค้นหา 28 วัน */
export async function siteSummary(prisma: PrismaClient, siteId: string) {
  const since30 = new Date(Date.now() - 30 * 86_400_000); const since28 = new Date(Date.now() - 28 * 86_400_000);
  const [uptime, latest, search, incidents] = await Promise.all([
    prisma.siteCheck.findMany({ where: { siteId, kind: 'UPTIME', checkedAt: { gte: since30 } }, select: { status: true, latencyMs: true } }),
    Promise.all((['SSL', 'SEO', 'LINKS', 'PAGESPEED'] as CheckKind[]).map(kind => prisma.siteCheck.findFirst({ where: { siteId, kind }, orderBy: { checkedAt: 'desc' }, select: { kind: true, status: true, details: true, error: true, checkedAt: true } }))),
    prisma.searchSnapshot.findMany({ where: { siteId, date: { gte: since28 } }, orderBy: { date: 'asc' }, select: { date: true, clicks: true, impressions: true, ctr: true, position: true, topQueries: true, topPages: true } }),
    prisma.siteIncident.findMany({ where: { siteId }, orderBy: { startedAt: 'desc' }, take: 20 }),
  ]);
  const okCount = uptime.filter(u => u.status !== 'FAIL').length; const lat = uptime.map(u => u.latencyMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const sum = (k: 'clicks' | 'impressions') => (search.some(s => s[k] !== null) ? search.reduce((n, s) => n + (s[k] ?? 0), 0) : null);
  const withTop = [...search].reverse().find(s => s.topQueries);
  return {
    uptime: { checks: uptime.length, availabilityPct: uptime.length ? Math.round((okCount / uptime.length) * 1000) / 10 : null, medianLatencyMs: lat.length ? lat[Math.floor(lat.length / 2)]! : null },
    latest: Object.fromEntries(latest.filter(Boolean).map(l => [l!.kind, { status: l!.status, details: l!.details, error: l!.error, checkedAt: l!.checkedAt }])),
    search: { days: search.length, clicks: sum('clicks'), impressions: sum('impressions'), avgPosition: search.length && search.some(s => s.position !== null) ? Math.round((search.reduce((n, s) => n + (s.position ?? 0), 0) / search.filter(s => s.position !== null).length) * 10) / 10 : null, series: search.map(s => ({ date: s.date.toISOString().slice(0, 10), clicks: s.clicks, impressions: s.impressions })), topQueries: (withTop?.topQueries as SearchRow[] | null) ?? [], topPages: (withTop?.topPages as SearchRow[] | null) ?? [] },
    incidents,
  };
}

/** แปลง incident event เป็นข้อความแจ้งเตือน (API/worker เลือก transport เอง) — dedupe ต่อ incident */
export function incidentNotification(ev: IncidentEvent, site: { id: string; name: string; url: string }): { type: 'publish_failed' | 'reconnect_required' | 'info'; severity: 'info' | 'warn' | 'bad'; title: string; body: string; href: string; resourceType: string; resourceId: string; dedupeKey: string } {
  const base = { href: '/web', resourceType: 'site', resourceId: site.id, dedupeKey: `site-${ev.kind}:${ev.incidentId}:${ev.opened ? 'open' : 'resolved'}`, body: `${site.url} — ${ev.summary}` };
  if (!ev.opened) return { ...base, type: 'info', severity: 'info', title: `เว็บ ${site.name}: ${ev.kind === 'DOWN' ? 'กลับมาใช้งานได้แล้ว' : ev.kind === 'DEGRADED' ? 'ความเร็วกลับมาปกติ' : ev.kind.startsWith('SSL') ? 'ต่ออายุ SSL แล้ว' : 'เข้าถึง Search Console ได้แล้ว'}` };
  if (ev.kind === 'DOWN') return { ...base, type: 'publish_failed', severity: 'bad', title: `เว็บ ${site.name} ล่ม` };
  if (ev.kind === 'SSL_EXPIRED') return { ...base, type: 'publish_failed', severity: 'bad', title: `SSL ของเว็บ ${site.name} หมดอายุแล้ว` };
  if (ev.kind === 'SSL_EXPIRING') return { ...base, type: 'info', severity: 'warn', title: `SSL ของเว็บ ${site.name} ใกล้หมดอายุ` };
  if (ev.kind === 'GSC_ACCESS') return { ...base, type: 'reconnect_required', severity: 'warn', title: `เว็บ ${site.name}: เข้าถึง Search Console ไม่ได้` };
  return { ...base, type: 'info', severity: 'warn', title: `เว็บ ${site.name} ช้ากว่าปกติ` };
}
