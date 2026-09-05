/**
 * YouTube monthly report (AGENTS_YOUTUBE §78, §88) — สรุปจาก snapshot/วิเคราะห์ที่บันทึกไว้ (ไม่ยิง API ตอนสร้าง)
 * metric ที่อ่านไม่ได้ (ไม่มี Analytics scope / channel สาธารณะ) ต้อง "ไม่มีข้อมูล" ห้ามเป็น 0; AI ใช้แค่เขียน executive summary (ปิดได้)
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { channelInWorkspace } from '@fbpm/database';
import { metricValue, type YtMetricSnapshot } from '@fbpm/youtube-core';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { YtVideosService } from './videos.service';

export const YT_REPORT_PROMPT_VERSION = 'youtube-report-v1';
interface VideoRow { id: string; youtubeVideoId: string; title: string; videoType: string; publishedAt: string | null; pillar: string | null; source: string; views: number | null; avgViewDuration: number | null; avgViewPct: number | null; subscribersGained: number | null; likes: number | null; comments: number | null }
export interface YtReportData {
  channel: { id: string; title: string; accessMode: string; subscribers: number | null; videoCount: number | null; analyticsStatus: string };
  period: { start: string; end: string; label: string; days: number };
  metricsAvailable: Record<'views' | 'watchTime' | 'avd' | 'subscribers' | 'impressions' | 'revenue', boolean>;
  dataLimitations: string[];
  publishing: { videos: number; videosPrevPeriod: number; longForm: number; shorts: number; live: number; perWeek: number; bySystem: number };
  channelMetrics: { views: number | null; watchMinutes: number | null; subscribersGained: number | null; subscribersLost: number | null; impressions: number | null; ctr: number | null; revenueUsd: number | null };
  topVideos: VideoRow[]; bottomVideos: VideoRow[];
  pillars: { pillar: string; videos: number; views: number | null }[];
  formats: { format: string; videos: number; medianViews: number | null; medianAvd: number | null }[];
  comments: { total: number; questions: number; requests: number; complaints: number; leads: number; unresolved: number; clusters: { label: string; size: number; intent: string }[] };
  content: { created: number; approved: number; uploaded: number; published: number; scheduledNext: number; aiDrafted: number };
  recommendations: { open: number; accepted: number; done: number; top: { title: string; actionType: string; confidence: string }[] };
  analysis: { createdAt: string; result: unknown } | null;
  ai: { tasks: number; costUsd: number };
  summary: { executiveSummary: string; whatHappened: string[]; whyItHappened: string[]; repeat: string[]; stop: string[]; experiments: string[]; nextMonthFocus: string[] } | null;
  text: string;
}
function validateSummary(v: unknown): NonNullable<YtReportData['summary']> {
  const o = v as Record<string, unknown>;
  if (typeof o.executiveSummary !== 'string' || !o.executiveSummary) throw new Error('executiveSummary ต้องเป็นข้อความ');
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : []);
  return { executiveSummary: o.executiveSummary, whatHappened: arr('whatHappened'), whyItHappened: arr('whyItHappened'), repeat: arr('repeat'), stop: arr('stop'), experiments: arr('experiments'), nextMonthFocus: arr('nextMonthFocus') };
}
const median = (xs: (number | null)[]): number | null => { const s = xs.filter((x): x is number => x !== null).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

@Injectable()
export class YtReportsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService, @Inject(YtVideosService) private readonly videos: YtVideosService) {}

  private period(month: string | undefined): { start: Date; end: Date; label: string } {
    const m = month ?? (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
    const [y, mo] = m.split('-').map(Number);
    const start = new Date(Date.UTC(y!, mo! - 1, 1, -7)); const end = new Date(Date.UTC(y!, mo!, 1, -7));   // เดือนตามเวลาไทย
    return { start, end, label: m };
  }

  async generate(workspaceId: string, userId: string, channelId: string, dto: { month?: string; withAi?: boolean } | undefined, requestId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true, accessMode: true, subscriberCount: true, videoCount: true, analyticsStatus: true, brand: { select: { name: true, client: { select: { name: true } } } } } });
    if (!ch) throw new NotFoundException('ไม่พบช่อง');
    const { start, end, label } = this.period(dto?.month);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    const [vids, prevCount, chanSnap, commentsAgg, unresolvedCount, clusters, contentRows, recs, analysis, aiAgg] = await Promise.all([
      this.prisma.youTubeVideo.findMany({ where: { channelId, publishedAt: { gte: start, lt: end } }, orderBy: { publishedAt: 'asc' }, select: { id: true, youtubeVideoId: true, title: true, videoType: true, publishedAt: true, contentPillar: true, source: true } }),
      this.prisma.youTubeVideo.count({ where: { channelId, publishedAt: { gte: prevStart, lt: start } } }),
      // snapshot ระดับช่องจาก Analytics ที่ครอบช่วงรายงานมากที่สุด (ล่าสุดที่ rangeStart <= start)
      this.prisma.youTubeChannelMetricSnapshot.findFirst({ where: { channelId, source: 'ANALYTICS_API', rangeStart: { lte: new Date(start.getTime() + 86_400_000) }, rangeEnd: { gte: new Date(end.getTime() - 86_400_000) } }, orderBy: { capturedAt: 'desc' }, select: { metricsJson: true, rangeStart: true, rangeEnd: true, capturedAt: true } }),
      this.prisma.youTubeComment.groupBy({ by: ['classification'], where: { channelId, publishedAt: { gte: start, lt: end } }, _count: { _all: true } }),
      this.prisma.youTubeComment.count({ where: { channelId, publishedAt: { gte: start, lt: end }, resolvedAt: null, classification: { in: ['QUESTION', 'FOLLOW_UP_QUESTION', 'CRITICISM', 'FACT_CHALLENGE', 'PRODUCT_INTEREST', 'SERVICE_INTEREST'] } } }),
      this.prisma.commentCluster.findMany({ where: { channelId, lastSeen: { gte: start } }, orderBy: { count: 'desc' }, take: 5, select: { label: true, count: true, kind: true } }),
      this.prisma.contentItem.findMany({ where: { platform: 'YOUTUBE', youtubeChannelId: channelId, OR: [{ createdAt: { gte: start, lt: end } }, { publishedAt: { gte: start, lt: end } }, { status: 'SCHEDULED', scheduledAt: { gte: end } }] }, select: { status: true, ytStatus: true, createdAt: true, publishedAt: true, scheduledAt: true, aiProvider: true, approvals: { select: { status: true, reviewedAt: true } }, uploadOps: { select: { status: true, createdAt: true } } } }),
      this.prisma.youTubeRecommendation.findMany({ where: { channelId }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], select: { title: true, actionType: true, confidence: true, status: true } }),
      this.prisma.youTubeChannelAnalysis.findFirst({ where: { channelId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, result: true } }),
      this.prisma.aiTaskLog.aggregate({ where: { workspaceId, createdAt: { gte: start, lt: end }, OR: [{ resourceId: channelId }, { resourceType: 'contentItem' }] }, _count: { _all: true }, _sum: { estimatedCost: true } }),
    ]);
    const withStats = await this.videos.withStats(vids);
    const rows: VideoRow[] = withStats.map(v => ({ id: v.id, youtubeVideoId: v.youtubeVideoId, title: v.title.slice(0, 120), videoType: v.videoType, publishedAt: v.publishedAt?.toISOString() ?? null, pillar: v.contentPillar, source: v.source, views: v.stats.views, avgViewDuration: v.stats.avgViewDuration, avgViewPct: v.stats.avgViewPct, subscribersGained: v.stats.subscribersGained, likes: v.stats.likes, comments: v.stats.comments }));
    const cm = (chanSnap?.metricsJson ?? null) as YtMetricSnapshot | null;
    const channelMetrics = { views: metricValue(cm, 'views'), watchMinutes: metricValue(cm, 'watchMinutes'), subscribersGained: metricValue(cm, 'subscribersGained'), subscribersLost: metricValue(cm, 'subscribersLost'), impressions: metricValue(cm, 'impressions'), ctr: metricValue(cm, 'impressionsCtr'), revenueUsd: metricValue(cm, 'estimatedRevenue') };
    const avail = { views: rows.some(r => r.views !== null) || channelMetrics.views !== null, watchTime: channelMetrics.watchMinutes !== null, avd: rows.some(r => r.avgViewDuration !== null), subscribers: channelMetrics.subscribersGained !== null || rows.some(r => r.subscribersGained !== null), impressions: channelMetrics.impressions !== null, revenue: channelMetrics.revenueUsd !== null };
    const dataLimitations = [
      ...(ch.accessMode !== 'OAUTH' ? ['ช่องเชื่อมแบบอ่านสาธารณะ (API key) — มีเฉพาะยอดวิว/ไลก์/คอมเมนต์สาธารณะ ไม่มี watch time, AVD, ผู้ติดตองที่ได้, impressions/CTR'] : []),
      ...(ch.accessMode === 'OAUTH' && !avail.avd ? ['ยังไม่มีข้อมูล Analytics ของวิดีโอในช่วงนี้ (ยังไม่ซิงก์ analytics หรือไม่มี scope yt-analytics.readonly)'] : []),
      ...(!avail.impressions ? ['impressions/CTR ไม่มีใน Analytics API ระดับวิดีโอ/ช่องที่ดึงได้ — ดูใน YouTube Studio'] : []),
      ...(!avail.revenue ? ['ไม่มีข้อมูลรายได้ (ต้อง scope yt-analytics-monetary.readonly และช่องอยู่ใน YPP)'] : []),
      ...(!chanSnap ? ['ไม่มี snapshot ระดับช่องที่ครอบช่วงรายงาน — ตัวเลขรวมของช่องแสดงเป็น "ไม่มีข้อมูล"'] : []),
      ...(rows.length < 4 ? [`วิดีโอที่เผยแพร่ในช่วงนี้มีเพียง ${rows.length} รายการ ข้อสรุปมีความมั่นใจต่ำ`] : []),
    ];
    const ranked = avail.views ? rows.filter(r => r.views !== null).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)) : [];
    const pillarMap = new Map<string, { videos: number; views: number | null }>();
    for (const r of rows) { const k = r.pillar ?? 'ไม่ระบุ'; const cur = pillarMap.get(k) ?? { videos: 0, views: avail.views ? 0 : null }; cur.videos++; if (avail.views && r.views !== null) cur.views = (cur.views ?? 0) + r.views; pillarMap.set(k, cur); }
    const formats = ['LONG_FORM', 'SHORT', 'LIVE'].map(f => { const xs = rows.filter(r => r.videoType === f); return { format: f, videos: xs.length, medianViews: median(xs.map(r => r.views)), medianAvd: median(xs.map(r => r.avgViewDuration)) }; }).filter(f => f.videos > 0);
    const cnt = (cls: string) => commentsAgg.filter(c => c.classification === cls).reduce((n, c) => n + c._count._all, 0);
    const comments = { total: commentsAgg.reduce((n, c) => n + c._count._all, 0), questions: cnt('QUESTION') + cnt('FOLLOW_UP_QUESTION'), requests: cnt('CONTENT_REQUEST'), complaints: cnt('CRITICISM') + cnt('FACT_CHALLENGE'), leads: cnt('PRODUCT_INTEREST') + cnt('SERVICE_INTEREST'), unresolved: unresolvedCount, clusters: clusters.map(c => ({ label: c.label, size: c.count, intent: c.kind })) };
    const inPeriod = (d: Date | null) => !!d && d >= start && d < end;
    const content = {
      created: contentRows.filter(c => inPeriod(c.createdAt)).length,
      approved: contentRows.filter(c => c.approvals.some(a => a.status === 'APPROVED' && inPeriod(a.reviewedAt))).length,
      uploaded: contentRows.filter(c => c.uploadOps.some(o => ['UPLOADED', 'PROCESSING', 'READY'].includes(o.status) && inPeriod(o.createdAt))).length,
      published: contentRows.filter(c => inPeriod(c.publishedAt)).length,
      scheduledNext: contentRows.filter(c => c.status === 'SCHEDULED' && !!c.scheduledAt && c.scheduledAt >= end).length,
      aiDrafted: contentRows.filter(c => inPeriod(c.createdAt) && !!c.aiProvider).length,
    };
    const data: YtReportData = {
      channel: { id: ch.id, title: ch.title, accessMode: ch.accessMode, subscribers: ch.subscriberCount, videoCount: ch.videoCount, analyticsStatus: ch.analyticsStatus },
      period: { start: start.toISOString(), end: end.toISOString(), label, days }, metricsAvailable: avail, dataLimitations,
      publishing: { videos: rows.length, videosPrevPeriod: prevCount, longForm: rows.filter(r => r.videoType === 'LONG_FORM').length, shorts: rows.filter(r => r.videoType === 'SHORT').length, live: rows.filter(r => r.videoType === 'LIVE' || r.videoType === 'PREMIERE').length, perWeek: Math.round((rows.length / days) * 7 * 10) / 10, bySystem: rows.filter(r => r.source === 'app').length },
      channelMetrics, topVideos: ranked.slice(0, 5), bottomVideos: ranked.length > 5 ? ranked.slice(-3).reverse() : [],
      pillars: [...pillarMap.entries()].map(([pillar, v]) => ({ pillar, ...v })).sort((a, b) => b.videos - a.videos), formats, comments, content,
      recommendations: { open: recs.filter(r => r.status === 'OPEN').length, accepted: recs.filter(r => r.status === 'ACCEPTED').length, done: recs.filter(r => r.status === 'DONE').length, top: recs.filter(r => r.status === 'OPEN').slice(0, 5).map(r => ({ title: r.title, actionType: r.actionType, confidence: r.confidence })) },
      analysis: analysis ? { createdAt: analysis.createdAt.toISOString(), result: analysis.result } : null,
      ai: { tasks: aiAgg._count._all, costUsd: Number(aiAgg._sum.estimatedCost ?? 0) }, summary: null, text: '',
    };
    let provider: string | null = null; let model: string | null = null;
    if (dto?.withAi !== false) {
      try {
        await this.ai.resolve(workspaceId, 'analysis');
        const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.report.summary', role: 'analysis', requestId, promptVersion: YT_REPORT_PROMPT_VERSION, resourceType: 'youtubeChannel', resourceId: channelId }, {
          system: 'คุณคือผู้จัดการช่อง YouTube ของเอเจนซี่ เขียนสรุปรายงานประจำเดือนให้ลูกค้าอ่าน ภาษาไทย ตรงไปตรงมา อิงเฉพาะตัวเลขที่ให้ (ค่า null = ไม่มีข้อมูล ห้ามอ้างหรือเดา) ระบุระดับความมั่นใจเมื่อข้อมูลน้อย ห้ามพูดถึงอัลกอริทึมเชิงฟันธง ตอบ: เกิดอะไรขึ้น ทำไม ควรทำซ้ำ ควรหยุด ควรทดลอง และเดือนหน้าเน้นอะไร',
          prompt: `รายงานช่อง "${ch.title}" ลูกค้า ${ch.brand.client.name} ช่วง ${label}:\n${JSON.stringify({ ...data, text: undefined, analysis: data.analysis ? { createdAt: data.analysis.createdAt, result: JSON.stringify(data.analysis.result).slice(0, 3000) } : null }).slice(0, 12000)}`,
          schemaDescription: `{ "executiveSummary": string, "whatHappened": string[], "whyItHappened": string[], "repeat": string[], "stop": string[], "experiments": string[], "nextMonthFocus": string[] }`, validate: validateSummary, maxTokens: 4000,
        });
        data.summary = out.result.data; provider = out.provider; model = out.model;
      } catch (e) { data.dataLimitations.push(`ไม่ได้สรุปด้วย AI: ${e instanceof Error ? (e as Error & { response?: { message?: string } }).response?.message ?? e.message : String(e)}`); }
    }
    data.text = renderText(data, ch.brand.client.name, ch.brand.name);
    const saved = await this.prisma.youTubeReport.create({ data: { channelId, periodStart: start, periodEnd: end, data: data as unknown as Prisma.InputJsonValue, provider, model, createdById: userId }, select: { id: true, createdAt: true } });
    await this.notifications.notify(workspaceId, { type: 'report_ready', title: `รายงาน YouTube ${ch.title} (${label}) พร้อมแล้ว`, href: '/youtube/reports', resourceType: 'youtubeReport', resourceId: saved.id });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_REPORT_GENERATED', resourceType: 'youtubeReport', resourceId: saved.id, after: { channelId, period: label, videos: rows.length, withAi: !!data.summary }, requestId });
    return { id: saved.id, createdAt: saved.createdAt, channelId, periodStart: start, periodEnd: end, provider, model, data };
  }

  async list(workspaceId: string, channelId?: string) {
    const rows = await this.prisma.youTubeReport.findMany({ where: { channel: channelInWorkspace(workspaceId), ...(channelId && { channelId }) }, orderBy: { createdAt: 'desc' }, take: 24, select: { id: true, channelId: true, periodStart: true, periodEnd: true, provider: true, model: true, createdAt: true, data: true, channel: { select: { title: true } } } });
    return rows.map(r => { const d = r.data as unknown as YtReportData; return { id: r.id, channelId: r.channelId, channelTitle: r.channel.title, periodStart: r.periodStart, periodEnd: r.periodEnd, label: d.period.label, videos: d.publishing.videos, hasSummary: !!d.summary, provider: r.provider, model: r.model, createdAt: r.createdAt }; });
  }

  async get(workspaceId: string, id: string) {
    const r = await this.prisma.youTubeReport.findFirst({ where: { id, channel: channelInWorkspace(workspaceId) }, select: { id: true, channelId: true, periodStart: true, periodEnd: true, provider: true, model: true, createdAt: true, data: true } });
    if (!r) throw new NotFoundException('ไม่พบรายงาน');
    return { ...r, data: r.data as unknown as YtReportData };
  }
}

/** ข้อความรายงานสำหรับส่งลูกค้า */
function renderText(d: YtReportData, client: string, brand: string): string {
  const na = 'ไม่มีข้อมูล'; const n = (v: number | null, unit = '') => (v === null ? na : `${Math.round(v * 10) / 10}${unit}`);
  const L: string[] = [`รายงาน YouTube ${d.channel.title} (${brand} · ${client}) — ${d.period.label}`, ''];
  L.push(`[ การเผยแพร่ ] วิดีโอ ${d.publishing.videos} รายการ (เดือนก่อน ${d.publishing.videosPrevPeriod}) · ยาว ${d.publishing.longForm} · Shorts ${d.publishing.shorts} · ไลฟ์ ${d.publishing.live} · เฉลี่ย ${d.publishing.perWeek}/สัปดาห์`);
  L.push(`[ ภาพรวมช่อง ] ผู้ติดตาม ${n(d.channel.subscribers)} · วิวช่วงนี้ ${n(d.channelMetrics.views)} · watch time ${n(d.channelMetrics.watchMinutes, ' นาที')} · ผู้ติดตามที่ได้ ${n(d.channelMetrics.subscribersGained)} · รายได้ ${d.channelMetrics.revenueUsd === null ? na : `$${d.channelMetrics.revenueUsd}`}`);
  if (d.topVideos.length) { L.push('', '[ วิดีโอเด่น ]'); for (const v of d.topVideos) L.push(`• ${v.title} — วิว ${n(v.views)} · AVD ${n(v.avgViewDuration, ' วิ')} · sub+ ${n(v.subscribersGained)}`); }
  if (d.formats.length) { L.push('', '[ ตามรูปแบบ ]'); for (const f of d.formats) L.push(`• ${f.format}: ${f.videos} รายการ · วิวกลาง ${n(f.medianViews)} · AVD กลาง ${n(f.medianAvd, ' วิ')}`); }
  L.push('', `[ คอมเมนต์ ] ทั้งหมด ${d.comments.total} · คำถาม ${d.comments.questions} · คำขอ ${d.comments.requests} · ร้องเรียน ${d.comments.complaints} · ลีด ${d.comments.leads} · ค้างตอบ ${d.comments.unresolved}`);
  for (const c of d.comments.clusters) L.push(`• กลุ่มหัวข้อ: ${c.label} (${c.size})`);
  L.push('', `[ งานในระบบ ] ร่าง ${d.content.created} · อนุมัติ ${d.content.approved} · อัปโหลด ${d.content.uploaded} · เผยแพร่ ${d.content.published} · ตั้งเวลาไว้ ${d.content.scheduledNext}`);
  if (d.recommendations.top.length) { L.push('', '[ ข้อเสนอที่ยังเปิดอยู่ ]'); for (const r of d.recommendations.top) L.push(`• ${r.title} (${r.actionType}, ความมั่นใจ ${r.confidence})`); }
  if (d.summary) { L.push('', '[ สรุปผู้บริหาร ]', d.summary.executiveSummary); const sec = (t: string, xs: string[]) => { if (xs.length) { L.push('', `[ ${t} ]`); for (const x of xs) L.push(`• ${x}`); } }; sec('เกิดอะไรขึ้น', d.summary.whatHappened); sec('ทำไม', d.summary.whyItHappened); sec('ควรทำซ้ำ', d.summary.repeat); sec('ควรหยุด', d.summary.stop); sec('ควรทดลอง', d.summary.experiments); sec('เดือนหน้าเน้น', d.summary.nextMonthFocus); }
  if (d.dataLimitations.length) { L.push('', '[ ข้อจำกัดของข้อมูล ]'); for (const x of d.dataLimitations) L.push(`• ${x}`); }
  return L.join('\n');
}
