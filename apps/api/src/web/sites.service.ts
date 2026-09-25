/** Website Care service (AGENTS_WEB.md W-1/W-2) — เว็บผูกกับแบรนด์, ตรวจ/ซิงก์ผ่าน @fbpm/web-core, SEO Analyst ผ่าน AiGatewayService เท่านั้น */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { brandInWorkspace } from '@fbpm/database';
import { ChannelNotAccessible, googleConnectionAccessToken } from '@fbpm/youtube-core';
import { SearchConsoleClient, WebError, incidentNotification, normalizeSiteUrl, runSiteChecks, siteSummary, syncSearchConsole, type CheckKind, type SeoResult, type WebDeps } from '@fbpm/web-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WEB } from './web.provider';
import type { CreateSiteDto, UpdateSiteDto } from './dto';

export const WEB_ANALYSIS_PROMPT_VERSION = 'web-seo-analyst-v1';
export const siteInWorkspace = (workspaceId: string) => ({ brand: { client: { workspaceId } } });
const SITE_SELECT = { id: true, brandId: true, url: true, name: true, platform: true, monitorEnabled: true, checkIntervalMin: true, expectedText: true, lastStatus: true, lastHttpStatus: true, lastLatencyMs: true, lastCheckedAt: true, sslExpiresAt: true, sslIssuer: true, googleConnectionId: true, searchConsoleProperty: true, gscStatus: true, gscSyncedAt: true, wpUsername: true, wpStatus: true, wpUserName: true, wpCheckedAt: true, wpLastError: true, publishingPaused: true, disconnectedAt: true, createdAt: true, brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } }, _count: { select: { incidents: { where: { resolvedAt: null } }, contents: { where: { status: { in: ['DRAFT', 'READY_FOR_APPROVAL', 'APPROVED', 'SCHEDULED'] as ('DRAFT' | 'READY_FOR_APPROVAL' | 'APPROVED' | 'SCHEDULED')[] } } } } } } as const;

function rethrow(e: unknown): never {
  if (e instanceof WebError) {
    const status = e.code === 'blocked' || e.code === 'invalid' ? 400 : e.code === 'notFound' ? 404 : e.code === 'forbidden' || e.code === 'reconnect' ? 422 : e.code === 'quota' ? 429 : 502;
    if (status === 400) throw new BadRequestException(e.message); if (status === 404) throw new NotFoundException(e.message); if (status === 422) throw new UnprocessableEntityException(e.message);
    throw new UnprocessableEntityException(e.message);
  }
  if (e instanceof ChannelNotAccessible) throw new UnprocessableEntityException(e.message);
  throw e;
}

@Injectable()
export class SitesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(WEB) private readonly web: WebDeps, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService, @Inject(AiGatewayService) private readonly ai: AiGatewayService) {}

  list(workspaceId: string) { return this.prisma.site.findMany({ where: siteInWorkspace(workspaceId), orderBy: [{ disconnectedAt: 'asc' }, { createdAt: 'desc' }], select: SITE_SELECT }); }
  private async load(workspaceId: string, id: string) {
    const s = await this.prisma.site.findFirst({ where: { id, ...siteInWorkspace(workspaceId) }, select: SITE_SELECT });
    if (!s) throw new NotFoundException('ไม่พบเว็บไซต์'); return s;
  }
  async get(workspaceId: string, id: string) {
    const s = await this.load(workspaceId, id);
    const [summary, checks, analysis] = await Promise.all([siteSummary(this.prisma, id), this.prisma.siteCheck.findMany({ where: { siteId: id }, orderBy: { checkedAt: 'desc' }, take: 60, select: { id: true, kind: true, status: true, httpStatus: true, latencyMs: true, error: true, checkedAt: true } }), this.prisma.siteAnalysis.findFirst({ where: { siteId: id }, orderBy: { createdAt: 'desc' } })]);
    return { ...s, summary, checks, analysis };
  }

  /** เพิ่มเว็บ → ตรวจ UPTIME/SSL/SEO ทันที (ไม่รอ worker) */
  async create(workspaceId: string, userId: string, dto: CreateSiteDto, requestId: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id: dto.brandId, ...brandInWorkspace(workspaceId) }, select: { id: true, name: true } });
    if (!brand) throw new NotFoundException('ไม่พบแบรนด์');
    let url: string; try { url = normalizeSiteUrl(dto.url, this.env.WEB_ALLOW_PRIVATE_TARGETS); } catch (e) { rethrow(e); }
    const dup = await this.prisma.site.findUnique({ where: { brandId_url: { brandId: brand.id, url } }, select: { id: true, disconnectedAt: true } });
    if (dup && !dup.disconnectedAt) throw new ConflictException('เว็บนี้อยู่ในระบบแล้ว');
    const data = { name: dto.name ?? new URL(url).hostname.replace(/^www\./, ''), platform: dto.platform ?? 'UNKNOWN', expectedText: dto.expectedText ?? null, checkIntervalMin: dto.checkIntervalMin ?? 15, monitorEnabled: true, disconnectedAt: null, lastStatus: 'UNKNOWN' };
    const site = dup ? await this.prisma.site.update({ where: { id: dup.id }, data, select: { id: true } }) : await this.prisma.site.create({ data: { brandId: brand.id, url, ...data }, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: 'WEB_SITE_ADDED', resourceType: 'site', resourceId: site.id, after: { url, brandId: brand.id, name: data.name }, requestId });
    const initial = await this.runChecks(workspaceId, userId, site.id, ['UPTIME', 'SSL', 'SEO'], requestId).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    return { ...(await this.get(workspaceId, site.id)), initialCheck: initial };
  }
  async update(workspaceId: string, userId: string, id: string, dto: UpdateSiteDto, requestId: string) {
    await this.load(workspaceId, id);
    const out = await this.prisma.site.update({ where: { id }, data: { ...dto }, select: SITE_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'WEB_SITE_UPDATED', resourceType: 'site', resourceId: id, after: dto as Prisma.InputJsonValue, requestId });
    return out;
  }
  async remove(workspaceId: string, userId: string, id: string, requestId: string) {
    await this.load(workspaceId, id);
    await this.prisma.site.update({ where: { id }, data: { disconnectedAt: new Date(), monitorEnabled: false } });
    await this.audit.log({ workspaceId, userId, action: 'WEB_SITE_REMOVED', resourceType: 'site', resourceId: id, requestId });
    return { ok: true };
  }

  /** ตรวจเดี๋ยวนี้ — แจ้งเตือนเมื่อ incident เปิด/ปิด */
  async runChecks(workspaceId: string, userId: string | null, id: string, kinds: CheckKind[], requestId: string) {
    const site = await this.load(workspaceId, id);
    if (site.disconnectedAt) throw new ForbiddenException('เว็บไซต์นี้ถูกปิดการดูแลแล้ว');
    try {
      const r = await runSiteChecks(this.web, id, kinds);
      for (const ev of r.events) await this.notifications.notify(workspaceId, incidentNotification(ev, r.site));
      await this.audit.log({ workspaceId, userId, action: 'WEB_SITE_CHECKED', resourceType: 'site', resourceId: id, after: { kinds, status: r.status, results: r.results, events: r.events.length } as Prisma.InputJsonValue, requestId });
      return r;
    } catch (e) { rethrow(e); }
  }

  // ---------- Search Console (W-2) ----------
  async listProperties(workspaceId: string, connectionId: string) {
    const conn = await this.prisma.googleConnection.findFirst({ where: { id: connectionId, workspaceId }, select: { id: true, scopes: true } });
    if (!conn) throw new NotFoundException('ไม่พบบัญชี Google');
    if (!conn.scopes.some(s => s.includes('webmasters'))) throw new UnprocessableEntityException('บัญชี Google นี้ยังไม่ได้ให้สิทธิ์ Search Console — กด "เชื่อมบัญชี Google" ใหม่โดยเลือกฟีเจอร์ค้นหา (search)');
    try { const token = await googleConnectionAccessToken(this.prisma, this.web.google, this.env.AUTH_SECRET, conn.id); return this.web.searchConsole.listSites(token); } catch (e) { rethrow(e); }
  }
  async connectSearchConsole(workspaceId: string, userId: string, id: string, connectionId: string, property: string | undefined, requestId: string) {
    const site = await this.load(workspaceId, id);
    const props = await this.listProperties(workspaceId, connectionId);
    const chosen = property ?? SearchConsoleClient.matchProperty(props, site.url);
    if (!chosen) throw new UnprocessableEntityException(`ไม่พบ property ของ ${site.url} ในบัญชีนี้ — เจ้าของเว็บต้องเพิ่มบัญชี Google นี้เป็น user ใน Search Console (property ที่มี: ${props.map(p => p.siteUrl).join(', ') || 'ไม่มี'})`);
    if (!props.some(p => p.siteUrl === chosen)) throw new UnprocessableEntityException('property นี้ไม่อยู่ในบัญชีที่เลือก');
    await this.prisma.site.update({ where: { id }, data: { googleConnectionId: connectionId, searchConsoleProperty: chosen, gscStatus: 'UNKNOWN' } });
    await this.audit.log({ workspaceId, userId, action: 'WEB_GSC_CONNECTED', resourceType: 'site', resourceId: id, after: { property: chosen, connectionId }, requestId });
    const sync = await this.syncSearch(workspaceId, userId, id, 28, requestId);
    return { ...(await this.get(workspaceId, id)), sync };
  }
  async syncSearch(workspaceId: string, userId: string | null, id: string, days: number, requestId: string) {
    const site = await this.load(workspaceId, id);
    const r = await syncSearchConsole(this.web, id, days);
    if (r.status === 'NO_ACCESS') { const inc = await this.prisma.siteIncident.findFirst({ where: { siteId: id, kind: 'GSC_ACCESS', resolvedAt: null }, select: { id: true } }); if (inc) await this.notifications.notify(workspaceId, incidentNotification({ siteId: id, kind: 'GSC_ACCESS', opened: true, summary: r.error ?? '', incidentId: inc.id }, site)); }
    await this.audit.log({ workspaceId, userId, action: 'WEB_GSC_SYNCED', resourceType: 'site', resourceId: id, after: r as unknown as Prisma.InputJsonValue, requestId });
    return r;
  }

  /** แนวโน้มรายสัปดาห์: uptime %, latency median, clicks/impressions (จาก snapshot) */
  async trends(workspaceId: string, id: string, weeks = 12) {
    await this.load(workspaceId, id);
    const w = Math.min(52, Math.max(4, weeks)); const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1); const start = new Date(end.getTime() - w * 7 * 86_400_000);
    const [checks, search] = await Promise.all([
      this.prisma.siteCheck.findMany({ where: { siteId: id, kind: 'UPTIME', checkedAt: { gte: start } }, select: { checkedAt: true, status: true, latencyMs: true } }),
      this.prisma.searchSnapshot.findMany({ where: { siteId: id, date: { gte: start } }, select: { date: true, clicks: true, impressions: true } }),
    ]);
    const buckets = Array.from({ length: w }, (_, i) => ({ start: new Date(start.getTime() + i * 7 * 86_400_000).toISOString().slice(0, 10), checks: 0, ok: 0, latencies: [] as number[], clicks: null as number | null, impressions: null as number | null }));
    const idx = (d: Date) => Math.min(w - 1, Math.max(0, Math.floor((d.getTime() - start.getTime()) / (7 * 86_400_000))));
    for (const c of checks) { const b = buckets[idx(c.checkedAt)]!; b.checks++; if (c.status !== 'FAIL') b.ok++; if (c.latencyMs !== null) b.latencies.push(c.latencyMs); }
    for (const s of search) { const b = buckets[idx(s.date)]!; if (s.clicks !== null) b.clicks = (b.clicks ?? 0) + s.clicks; if (s.impressions !== null) b.impressions = (b.impressions ?? 0) + s.impressions; }
    return { weeks: buckets.map(b => ({ start: b.start, availabilityPct: b.checks ? Math.round((b.ok / b.checks) * 1000) / 10 : null, medianLatencyMs: b.latencies.length ? b.latencies.sort((a, c) => a - c)[Math.floor(b.latencies.length / 2)]! : null, clicks: b.clicks, impressions: b.impressions })), limitations: ['Search Console ให้ข้อมูลล่าช้า 2–3 วัน', 'uptime % นับจากรอบตรวจของระบบ (ค่าเริ่มต้นทุก 15 นาที) ไม่ใช่ทุกวินาที'] };
  }

  async overview(workspaceId: string) {
    const where = { ...siteInWorkspace(workspaceId), disconnectedAt: null }; const since28 = new Date(Date.now() - 28 * 86_400_000);
    const [sites, down, degraded, sslExpiring, gscNoAccess, openIncidents, clicks] = await Promise.all([
      this.prisma.site.count({ where }), this.prisma.site.count({ where: { ...where, lastStatus: 'DOWN' } }), this.prisma.site.count({ where: { ...where, lastStatus: 'DEGRADED' } }),
      this.prisma.site.count({ where: { ...where, sslExpiresAt: { lt: new Date(Date.now() + 14 * 86_400_000) } } }), this.prisma.site.count({ where: { ...where, gscStatus: 'NO_ACCESS' } }),
      this.prisma.siteIncident.count({ where: { site: where, resolvedAt: null } }),
      this.prisma.searchSnapshot.aggregate({ where: { site: where, date: { gte: since28 } }, _sum: { clicks: true, impressions: true }, _count: { _all: true } }),
    ]);
    return { sites, down, degraded, sslExpiring, gscNoAccess, openIncidents, search: { days: clicks._count._all, clicks: clicks._count._all ? clicks._sum.clicks : null, impressions: clicks._count._all ? clicks._sum.impressions : null } };
  }

  /** SEO Analyst (AI): observed / inference / recommendation จาก audit + PageSpeed + Search Console เท่านั้น */
  async analyze(workspaceId: string, userId: string, id: string, requestId: string) {
    const site = await this.load(workspaceId, id); const summary = await siteSummary(this.prisma, id);
    const brand = await this.prisma.brand.findUnique({ where: { id: site.brandId }, select: { name: true, industry: true, targetAudience: true, primaryCTA: true, serviceArea: true, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } });
    const seo = summary.latest.SEO?.details as SeoResult | null | undefined;
    const limitations = [...(!summary.latest.PAGESPEED || summary.latest.PAGESPEED.status === 'SKIPPED' ? ['ไม่มีข้อมูล Core Web Vitals (ไม่ได้ตั้ง PAGESPEED_API_KEY)'] : []), ...(!summary.search.days ? ['ไม่มีข้อมูล Search Console (ยังไม่เชื่อมหรือไม่มีสิทธิ์) — ห้ามอ้างคำค้น/อันดับ'] : []), ...(summary.search.days && summary.search.days < 14 ? [`ข้อมูลค้นหามีเพียง ${summary.search.days} วัน — ความมั่นใจต่ำ`] : [])];
    const schema = `{ "summary": string, "observations": [{ "kind": "OBSERVED", "text": string, "evidence": string[] }], "inferences": [{ "kind": "INFERENCE", "text": string, "confidence": "LOW"|"MEDIUM"|"HIGH" }], "recommendations": [{ "actionType": "FIX_META"|"FIX_PERFORMANCE"|"CREATE_CONTENT"|"FIX_BROKEN_LINK"|"IMPROVE_PAGE"|"TECHNICAL"|"OTHER", "title": string, "why": string, "evidence": string[], "confidence": "LOW"|"MEDIUM"|"HIGH", "priority": number, "effort": "LOW"|"MEDIUM"|"HIGH" }], "contentIdeas": [{ "topic": string, "targetQuery": string|null, "why": string }], "dataLimitations": string[] }`;
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'web.seo.analyze', role: 'analysis', requestId, promptVersion: WEB_ANALYSIS_PROMPT_VERSION, resourceType: 'site', resourceId: id }, {
      system: 'คุณคือ SEO Analyst ของเอเจนซี่ วิเคราะห์เว็บลูกค้าจากข้อมูลที่ให้เท่านั้น แยก OBSERVED (ข้อเท็จจริงจาก audit/PageSpeed/Search Console) / INFERENCE (การตีความ ระบุความมั่นใจ) / RECOMMENDATION (ทำได้จริง มี evidence และ effort) ห้ามอ้างอันดับ ปริมาณค้นหา หรือคู่แข่งที่ไม่มีในข้อมูล ห้ามสัญญาผลลัพธ์ ค่า null = ไม่มีข้อมูล ภาษาไทย',
      prompt: `เว็บ ${site.name} (${site.url}) แบรนด์ ${brand?.name} (${brand?.industry ?? '-'}) กลุ่มเป้าหมาย ${brand?.targetAudience ?? '-'} พื้นที่ ${brand?.serviceArea ?? '-'} CTA ${brand?.primaryCTA ?? '-'}\nข้อมูลแบรนด์: ${brand?.knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.slice(0, 160)}`).join(' | ') || '-'}\n\nuptime 30 วัน: ${JSON.stringify(summary.uptime)}\nSEO audit หน้าแรก: ${JSON.stringify(seo ? { ...seo, issues: seo.issues } : null)}\nSSL: ${JSON.stringify(summary.latest.SSL?.details ?? null)}\nลิงก์เสีย: ${JSON.stringify(summary.latest.LINKS?.details ?? null)}\nPageSpeed: ${JSON.stringify(summary.latest.PAGESPEED?.details ?? null)}\nSearch Console 28 วัน: ${JSON.stringify({ clicks: summary.search.clicks, impressions: summary.search.impressions, avgPosition: summary.search.avgPosition, topQueries: summary.search.topQueries.slice(0, 15), topPages: summary.search.topPages.slice(0, 10) })}\nข้อจำกัด: ${limitations.join('; ') || '-'}`.slice(0, 14000),
      schemaDescription: schema, validate: v => { const o = v as Record<string, unknown>; if (typeof o.summary !== 'string' || !Array.isArray(o.recommendations)) throw new Error('summary/recommendations หาย'); return o as { summary: string; observations?: unknown[]; inferences?: unknown[]; recommendations: { actionType: string; title: string; why: string; evidence?: string[]; confidence?: string; priority?: number; effort?: string }[]; contentIdeas?: unknown[]; dataLimitations?: string[] }; }, maxTokens: 5000,
    });
    const result = { ...out.result.data, dataLimitations: [...limitations, ...(out.result.data.dataLimitations ?? [])] };
    const saved = await this.prisma.siteAnalysis.create({ data: { siteId: id, result: result as unknown as Prisma.InputJsonValue, provider: out.provider, model: out.model, promptVersion: WEB_ANALYSIS_PROMPT_VERSION, createdById: userId }, select: { id: true, createdAt: true } });
    await this.audit.log({ workspaceId, userId, action: 'WEB_SITE_ANALYZED', resourceType: 'site', resourceId: id, after: { analysisId: saved.id, recommendations: result.recommendations.length, costUsd: out.costUsd }, requestId });
    return { id: saved.id, createdAt: saved.createdAt, provider: out.provider, model: out.model, costUsd: out.costUsd, result };
  }
  analyses(workspaceId: string, id: string) { return this.load(workspaceId, id).then(() => this.prisma.siteAnalysis.findMany({ where: { siteId: id }, orderBy: { createdAt: 'desc' }, take: 10 })); }
}
