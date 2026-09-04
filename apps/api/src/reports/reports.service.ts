/**
 * Report Service (§34, §64) — สรุปรายเดือน/ช่วงของเพจจากข้อมูลที่บันทึกไว้ (โพสต์ + snapshot + คอนเทนต์ + ผลวิเคราะห์ล่าสุด)
 * AI ใช้เฉพาะเขียน executive summary/ข้อเสนอ (เลือกปิดได้) และผลถูกเก็บไว้ ไม่รันซ้ำตอนเปิดดู
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { pageInWorkspace } from '@fbpm/database';
import { pageCompleteness, type MetricSnapshot } from '@fbpm/facebook-core';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import type { GenerateReportDto } from './dto';

export const REPORT_PROMPT_VERSION = 'report-v1';
interface PostRow { facebookPostId: string; publishedAt: string | null; mediaType: string | null; message: string; source: string; permalink: string | null; shares: number | null; reactions: number | null; comments: number | null; pillar: string | null }
export interface ReportData {
  page: { id: string; name: string; category: string | null; followers: number | null; completeness: number; missing: string[] };
  period: { start: string; end: string; label: string; days: number };
  metricsAvailable: Record<'shares' | 'reactions' | 'comments', boolean>;
  dataLimitations: string[];
  publishing: { posts: number; postsPrevPeriod: number; perWeek: number; activeDays: number; longestGapDays: number; bySystem: number; byType: Record<string, number> };
  engagement: { sharesTotal: number | null; sharesAvg: number | null };
  topPosts: PostRow[]; bottomPosts: PostRow[];
  pillars: { pillar: string; posts: number; shares: number | null }[];
  content: { created: number; approved: number; rejected: number; published: number; scheduledNext: number; aiDrafted: number };
  ai: { tasks: number; costUsd: number };
  analysis: { createdAt: string; recommendations: unknown[]; patterns: unknown[]; contentPillars: string[] } | null;
  summary: { executiveSummary: string; whatHappened: string[]; whyItHappened: string[]; repeat: string[]; stop: string[]; experiments: string[]; nextMonthFocus: string[] } | null;
  text: string;
}

function validateSummary(v: unknown): NonNullable<ReportData['summary']> {
  const o = v as Record<string, unknown>;
  if (typeof o.executiveSummary !== 'string' || !o.executiveSummary) throw new Error('executiveSummary ต้องเป็นข้อความ');
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : []);
  return { executiveSummary: o.executiveSummary, whatHappened: arr('whatHappened'), whyItHappened: arr('whyItHappened'), repeat: arr('repeat'), stop: arr('stop'), experiments: arr('experiments'), nextMonthFocus: arr('nextMonthFocus') };
}

@Injectable()
export class ReportsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService) {}

  private period(dto: GenerateReportDto): { start: Date; end: Date; label: string } {
    if (dto?.from && dto.to) return { start: new Date(dto.from), end: new Date(dto.to), label: `${dto.from.slice(0, 10)} – ${dto.to.slice(0, 10)}` };
    const m = dto?.month ?? (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
    const [y, mo] = m.split('-').map(Number);
    // เดือนตามเวลาไทย (UTC+7) — เพจส่วนใหญ่อยู่ในไทย; ช่วงเวลาถูกเก็บใน data ให้ตรวจสอบได้
    const start = new Date(Date.UTC(y!, mo! - 1, 1, -7)); const end = new Date(Date.UTC(y!, mo!, 1, -7));
    return { start, end, label: m };
  }

  async generate(workspaceId: string, userId: string, pageId: string, dto: GenerateReportDto, requestId: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, name: true, category: true, fanCount: true, profile: true, brand: { select: { name: true, client: { select: { name: true } } } } } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    const { start, end, label } = this.period(dto);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    const [posts, prevCount, contentRows, analysis, aiAgg] = await Promise.all([
      this.prisma.facebookPost.findMany({ where: { pageId, publishedAt: { gte: start, lt: end } }, orderBy: { publishedAt: 'asc' }, select: { facebookPostId: true, publishedAt: true, mediaType: true, message: true, source: true, permalink: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { metrics: true } }, content: { select: { contentPillar: true } } } }),
      this.prisma.facebookPost.count({ where: { pageId, publishedAt: { gte: prevStart, lt: start } } }),
      this.prisma.contentItem.findMany({ where: { pageId, OR: [{ createdAt: { gte: start, lt: end } }, { publishedAt: { gte: start, lt: end } }, { status: 'SCHEDULED', scheduledAt: { gte: end } }] }, select: { status: true, createdAt: true, publishedAt: true, scheduledAt: true, aiProvider: true, approvals: { select: { status: true, reviewedAt: true } } } }),
      this.prisma.pageAnalysis.findFirst({ where: { pageId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, result: true } }),
      this.prisma.aiTaskLog.aggregate({ where: { workspaceId, createdAt: { gte: start, lt: end }, OR: [{ resourceId: pageId }, { resourceType: 'contentItem' }] }, _count: { _all: true }, _sum: { estimatedCost: true } }),
    ]);
    const rows: PostRow[] = posts.map(p => { const m = (p.snapshots[0]?.metrics ?? null) as MetricSnapshot | null; return { facebookPostId: p.facebookPostId, publishedAt: p.publishedAt?.toISOString() ?? null, mediaType: p.mediaType, message: (p.message ?? '').slice(0, 200), source: p.source, permalink: p.permalink, shares: m?.shares?.value ?? null, reactions: m?.reactions?.value ?? null, comments: m?.comments?.value ?? null, pillar: p.content?.contentPillar ?? null }; });
    const avail = { shares: rows.some(r => r.shares !== null), reactions: rows.some(r => r.reactions !== null), comments: rows.some(r => r.comments !== null) };
    const dataLimitations = [
      ...(!avail.reactions ? ['ยอดถูกใจ/รีแอคชันอ่านไม่ได้ด้วยสิทธิ์ปัจจุบัน (ต้องผ่าน App Review) — ไม่นำมาจัดอันดับ'] : []),
      ...(!avail.comments ? ['จำนวนคอมเมนต์อ่านไม่ได้ด้วยสิทธิ์ปัจจุบัน'] : []),
      'ยังไม่มี reach/impressions (ต้องมี read_insights) และไม่มีประวัติจำนวนผู้ติดตามรายวัน — แสดงเฉพาะค่าปัจจุบัน',
      ...(rows.length < 4 ? [`โพสต์ในช่วงนี้มีเพียง ${rows.length} รายการ ข้อสรุปมีความมั่นใจต่ำ`] : []),
    ];
    const dayKeys = new Set(rows.map(r => r.publishedAt?.slice(0, 10)).filter(Boolean));
    let longestGap = 0; const times = rows.map(r => new Date(r.publishedAt!).getTime());
    const bounds = [start.getTime(), ...times, end.getTime()];
    for (let i = 1; i < bounds.length; i++) longestGap = Math.max(longestGap, (bounds[i]! - bounds[i - 1]!) / 86_400_000);
    const byType: Record<string, number> = {}; for (const r of rows) byType[r.mediaType ?? 'unknown'] = (byType[r.mediaType ?? 'unknown'] ?? 0) + 1;
    const ranked = avail.shares ? [...rows].filter(r => r.shares !== null).sort((a, b) => (b.shares ?? 0) - (a.shares ?? 0)) : [];
    const sharesTotal = avail.shares ? ranked.reduce((n, r) => n + (r.shares ?? 0), 0) : null;
    const pillarMap = new Map<string, { posts: number; shares: number | null }>();
    for (const r of rows) { const k = r.pillar ?? 'ไม่ระบุ'; const cur = pillarMap.get(k) ?? { posts: 0, shares: avail.shares ? 0 : null }; cur.posts++; if (avail.shares && r.shares !== null) cur.shares = (cur.shares ?? 0) + r.shares; pillarMap.set(k, cur); }
    const inPeriod = (d: Date | null) => !!d && d >= start && d < end;
    const content = {
      created: contentRows.filter(c => inPeriod(c.createdAt)).length,
      approved: contentRows.filter(c => c.approvals.some(a => a.status === 'APPROVED' && inPeriod(a.reviewedAt))).length,
      rejected: contentRows.filter(c => c.approvals.some(a => a.status === 'REJECTED' && inPeriod(a.reviewedAt))).length,
      published: contentRows.filter(c => inPeriod(c.publishedAt)).length,
      scheduledNext: contentRows.filter(c => c.status === 'SCHEDULED' && !!c.scheduledAt && c.scheduledAt >= end).length,
      aiDrafted: contentRows.filter(c => inPeriod(c.createdAt) && !!c.aiProvider).length,
    };
    const completeness = pageCompleteness((page.profile as Record<string, unknown> | null) ?? {});
    const an = analysis ? (analysis.result as { recommendations?: unknown[]; patterns?: unknown[]; contentPillars?: string[] }) : null;
    const data: ReportData = {
      page: { id: page.id, name: page.name, category: page.category, followers: page.fanCount, completeness: completeness.score, missing: completeness.missing.map(m => m.label) },
      period: { start: start.toISOString(), end: end.toISOString(), label, days }, metricsAvailable: avail, dataLimitations,
      publishing: { posts: rows.length, postsPrevPeriod: prevCount, perWeek: Math.round((rows.length / days) * 7 * 10) / 10, activeDays: dayKeys.size, longestGapDays: Math.round(longestGap), bySystem: rows.filter(r => r.source === 'app').length, byType },
      engagement: { sharesTotal, sharesAvg: sharesTotal === null || !ranked.length ? null : Math.round((sharesTotal / ranked.length) * 10) / 10 },
      topPosts: ranked.slice(0, 5), bottomPosts: ranked.length > 5 ? ranked.slice(-3).reverse() : [],
      pillars: [...pillarMap.entries()].map(([pillar, v]) => ({ pillar, ...v })).sort((a, b) => b.posts - a.posts),
      content, ai: { tasks: aiAgg._count._all, costUsd: Number(aiAgg._sum.estimatedCost ?? 0) },
      analysis: analysis && an ? { createdAt: analysis.createdAt.toISOString(), recommendations: an.recommendations ?? [], patterns: an.patterns ?? [], contentPillars: an.contentPillars ?? [] } : null,
      summary: null, text: '',
    };
    let provider: string | null = null; let model: string | null = null;
    if (dto?.withAi !== false) {
      try {
        await this.ai.resolve(workspaceId, 'analysis');
        const out = await this.ai.structured({ workspaceId, userId, taskType: 'report.summary', role: 'analysis', requestId, promptVersion: REPORT_PROMPT_VERSION, resourceType: 'facebookPage', resourceId: pageId }, {
          system: 'คุณคือผู้จัดการเอเจนซี่เขียนสรุปรายงานให้ลูกค้าอ่าน ภาษาไทย ตรงไปตรงมา อิงเฉพาะตัวเลขที่ให้ ห้ามอ้างค่าที่อ่านไม่ได้ ตอบคำถาม §34: เกิดอะไรขึ้น ทำไม อะไรควรทำซ้ำ อะไรควรหยุด ควรทดลองอะไร และเดือนหน้าเน้นอะไร',
          prompt: `ข้อมูลรายงานเพจ "${page.name}" ลูกค้า ${page.brand.client.name} ช่วง ${label}:\n${JSON.stringify({ ...data, text: undefined }).slice(0, 12000)}`,
          schemaDescription: `{ "executiveSummary": string, "whatHappened": string[], "whyItHappened": string[], "repeat": string[], "stop": string[], "experiments": string[], "nextMonthFocus": string[] }`, validate: validateSummary, maxTokens: 4000,
        });
        data.summary = out.result.data; provider = out.provider; model = out.model;
      } catch (e) { data.dataLimitations.push(`ไม่ได้สรุปด้วย AI: ${e instanceof Error ? (e as Error & { response?: { message?: string } }).response?.message ?? e.message : String(e)}`); }
    }
    data.text = renderText(data, page.brand.client.name, page.brand.name);
    const saved = await this.prisma.report.create({ data: { pageId, periodStart: start, periodEnd: end, data: data as unknown as Prisma.InputJsonValue, provider, model, createdById: userId }, select: { id: true, createdAt: true } });
    await this.audit.log({ workspaceId, userId, action: 'report.generate', resourceType: 'report', resourceId: saved.id, after: { pageId, period: label, posts: rows.length, withAi: !!data.summary }, requestId });
    return { id: saved.id, createdAt: saved.createdAt, pageId, periodStart: start, periodEnd: end, provider, model, data };
  }

  async list(workspaceId: string, pageId: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    const rows = await this.prisma.report.findMany({ where: { pageId }, orderBy: { createdAt: 'desc' }, take: 24, select: { id: true, periodStart: true, periodEnd: true, provider: true, model: true, createdAt: true, data: true } });
    return rows.map(r => { const d = r.data as unknown as ReportData; return { id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, label: d.period.label, posts: d.publishing.posts, hasSummary: !!d.summary, provider: r.provider, model: r.model, createdAt: r.createdAt }; });
  }

  async get(workspaceId: string, id: string) {
    const r = await this.prisma.report.findFirst({ where: { id, page: pageInWorkspace(workspaceId) }, select: { id: true, pageId: true, periodStart: true, periodEnd: true, provider: true, model: true, createdAt: true, data: true } });
    if (!r) throw new NotFoundException('ไม่พบรายงาน');
    return { ...r, data: r.data as unknown as ReportData };
  }
}

/** ข้อความรายงานสำหรับส่งลูกค้า (คัดลอกไปวางใน LINE/อีเมลได้) */
function renderText(d: ReportData, client: string, brand: string): string {
  const na = 'อ่านไม่ได้';
  const n = (v: number | null) => (v === null ? na : String(v));
  const L: string[] = [
    `รายงานเพจ ${d.page.name} — ${d.period.label}`, `ลูกค้า: ${client} · แบรนด์: ${brand}`, '',
    ...(d.summary ? ['[ สรุปผู้บริหาร ]', d.summary.executiveSummary, ''] : []),
    '[ ภาพรวมเพจ ]', `• ผู้ติดตามปัจจุบัน: ${d.page.followers ?? 'ไม่ทราบ'}`, `• ข้อมูลเพจครบ ${d.page.completeness}%${d.page.missing.length ? ` (ยังขาด: ${d.page.missing.join(', ')})` : ''}`, '',
    '[ การโพสต์ ]', `• โพสต์ ${d.publishing.posts} รายการ (ช่วงก่อนหน้า ${d.publishing.postsPrevPeriod}) · เฉลี่ย ${d.publishing.perWeek}/สัปดาห์ · โพสต์ ${d.publishing.activeDays} วัน · เว้นนานสุด ${d.publishing.longestGapDays} วัน`, `• โพสต์ผ่านระบบ ${d.publishing.bySystem} รายการ · ประเภท: ${Object.entries(d.publishing.byType).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`, '',
    '[ การมีส่วนร่วม ]', `• แชร์รวม ${n(d.engagement.sharesTotal)} · เฉลี่ย ${n(d.engagement.sharesAvg)}/โพสต์`, `• ถูกใจ/คอมเมนต์: ${d.metricsAvailable.reactions ? 'อ่านได้' : na} (สิทธิ์ Facebook ปัจจุบัน)`, '',
  ];
  if (d.topPosts.length) { L.push('[ โพสต์เด่น (ตามแชร์) ]'); d.topPosts.forEach((p, i) => L.push(`${i + 1}. ${p.message.slice(0, 80) || p.facebookPostId} — แชร์ ${n(p.shares)}${p.permalink ? ` ${p.permalink}` : ''}`)); L.push(''); }
  if (d.bottomPosts.length) { L.push('[ โพสต์ที่ผลงานต่ำ ]'); d.bottomPosts.forEach(p => L.push(`• ${p.message.slice(0, 80) || p.facebookPostId} — แชร์ ${n(p.shares)}`)); L.push(''); }
  if (d.pillars.length) { L.push('[ ตามเสาหลักคอนเทนต์ ]'); d.pillars.forEach(p => L.push(`• ${p.pillar}: ${p.posts} โพสต์ · แชร์ ${n(p.shares)}`)); L.push(''); }
  L.push('[ งานคอนเทนต์ในระบบ ]', `• สร้าง ${d.content.created} · อนุมัติ ${d.content.approved} · ไม่อนุมัติ ${d.content.rejected} · เผยแพร่ ${d.content.published} · ร่างโดย AI ${d.content.aiDrafted} · ตั้งเวลาไว้เดือนหน้า ${d.content.scheduledNext}`, '');
  if (d.summary) {
    const sec = (t: string, xs: string[]) => { if (xs.length) { L.push(`[ ${t} ]`); xs.forEach(x => L.push(`• ${x}`)); L.push(''); } };
    sec('เกิดอะไรขึ้น', d.summary.whatHappened); sec('เพราะอะไร', d.summary.whyItHappened); sec('ควรทำซ้ำ', d.summary.repeat); sec('ควรหยุด', d.summary.stop); sec('ทดลองเดือนหน้า', d.summary.experiments); sec('เดือนหน้าเน้น', d.summary.nextMonthFocus);
  } else if (d.analysis) { L.push('[ คำแนะนำจากผลวิเคราะห์ล่าสุด ]'); (d.analysis.recommendations as { title?: string; action?: string }[]).slice(0, 5).forEach(r => L.push(`• ${r.title ?? ''}${r.action ? ` — ${r.action}` : ''}`)); L.push(''); }
  L.push('[ ข้อจำกัดของข้อมูล ]'); d.dataLimitations.forEach(x => L.push(`• ${x}`));
  return L.join('\n');
}
