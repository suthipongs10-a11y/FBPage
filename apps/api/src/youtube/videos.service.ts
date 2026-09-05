/** Video library + detail + metadata update (§40, §67–68) + analyst/recommendations (§28, §34, §41–43, §79–81) */
import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { channelInWorkspace, videoInWorkspace } from '@fbpm/database';
import { REVIVAL_SCORE_VERSION, channelAuth, mapVideo, median, metricValue, packagingDiagnosis, revivalScore, subscriberConversion, type YtDeps, type YtMetricSnapshot } from '@fbpm/youtube-core';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { QUOTA, QuotaLedger, YT } from './youtube.provider';
import { rethrowYt } from './errors';
import type { ListVideosDto, UpdateVideoMetaDto } from './dto';

export const YT_ANALYSIS_PROMPT_VERSION = 'youtube-channel-analysis-v1';
const VIDEO_SELECT = { id: true, channelId: true, youtubeVideoId: true, title: true, description: true, publishedAt: true, scheduledPublishAt: true, privacyStatus: true, uploadStatus: true, durationSeconds: true, categoryId: true, tags: true, thumbnailUrl: true, madeForKids: true, videoType: true, contentPillar: true, pillarConfidence: true, pillarManual: true, source: true, availability: true, commentsDisabled: true, viewCount: true, likeCount: true, commentCount: true, lastSyncedAt: true, channel: { select: { id: true, title: true, accessMode: true, analyticsStatus: true } } } as const;
const ser = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x))) as T;

export interface VideoStats { views: number | null; likes: number | null; comments: number | null; watchMinutes: number | null; avgViewDuration: number | null; avgViewPct: number | null; shares: number | null; subscribersGained: number | null; subscriberConversion: number | null; analyticsAt: string | null; analyticsRange: { start: string | null; end: string | null } | null }
export function statsFromSnapshots(dataSnap: YtMetricSnapshot | null, anSnap: { metricsJson: YtMetricSnapshot; capturedAt: Date; dateRangeStart: Date | null; dateRangeEnd: Date | null } | null): VideoStats {
  const a = anSnap?.metricsJson ?? null;
  const views = metricValue(a, 'views') ?? metricValue(dataSnap, 'views');
  return { views, likes: metricValue(a, 'likes') ?? metricValue(dataSnap, 'likes'), comments: metricValue(a, 'comments') ?? metricValue(dataSnap, 'comments'), watchMinutes: metricValue(a, 'watchMinutes'), avgViewDuration: metricValue(a, 'averageViewDuration'), avgViewPct: metricValue(a, 'averageViewPercentage'), shares: metricValue(a, 'shares'), subscribersGained: metricValue(a, 'subscribersGained'), subscriberConversion: subscriberConversion(metricValue(a, 'subscribersGained'), metricValue(a, 'views')), analyticsAt: anSnap?.capturedAt.toISOString() ?? null, analyticsRange: anSnap ? { start: anSnap.dateRangeStart?.toISOString().slice(0, 10) ?? null, end: anSnap.dateRangeEnd?.toISOString().slice(0, 10) ?? null } : null };
}

@Injectable()
export class YtVideosService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(YT) private readonly yt: YtDeps, @Inject(QUOTA) private readonly quota: QuotaLedger, @Inject(AuditService) private readonly audit: AuditService, @Inject(AiGatewayService) private readonly ai: AiGatewayService) {}

  /** วิดีโอ + stats จาก snapshot ล่าสุด (Data API และ Analytics ถ้ามี) */
  async withStats<V extends { id: string }>(videos: V[]) {
    const ids = videos.map(v => v.id);
    const snaps = await this.prisma.youTubeVideoMetricSnapshot.findMany({ where: { videoId: { in: ids } }, orderBy: { capturedAt: 'desc' }, select: { videoId: true, source: true, metricsJson: true, capturedAt: true, dateRangeStart: true, dateRangeEnd: true } });
    const latest = new Map<string, { data: YtMetricSnapshot | null; an: typeof snaps[number] | null }>();
    for (const s of snaps) { const e = latest.get(s.videoId) ?? { data: null, an: null }; if (s.source === 'DATA_API' && !e.data) e.data = s.metricsJson as YtMetricSnapshot; if (s.source === 'ANALYTICS_API' && !e.an) e.an = s; latest.set(s.videoId, e); }
    return videos.map(v => { const e = latest.get(v.id); return { ...v, stats: statsFromSnapshots(e?.data ?? null, e?.an ? { metricsJson: e.an.metricsJson as YtMetricSnapshot, capturedAt: e.an.capturedAt, dateRangeStart: e.an.dateRangeStart, dateRangeEnd: e.an.dateRangeEnd } : null) }; });
  }
  async list(workspaceId: string, q: ListVideosDto) {
    const rows = await this.prisma.youTubeVideo.findMany({ where: { ...videoInWorkspace(workspaceId), ...(q.channelId && { channelId: q.channelId }), ...(q.type && { videoType: q.type }), ...(q.pillar && { contentPillar: q.pillar }), ...(q.q && { title: { contains: q.q, mode: 'insensitive' } }) }, orderBy: q.sort === 'views' ? { viewCount: 'desc' } : { publishedAt: 'desc' }, take: q.limit ?? 200, select: VIDEO_SELECT });
    const out = await this.withStats(rows);
    if (q.sort === 'subs') out.sort((a, b) => (b.stats.subscribersGained ?? -1) - (a.stats.subscribersGained ?? -1));
    if (q.sort === 'avd') out.sort((a, b) => (b.stats.avgViewDuration ?? -1) - (a.stats.avgViewDuration ?? -1));
    return ser(out);
  }
  async get(workspaceId: string, id: string) {
    const v = await this.prisma.youTubeVideo.findFirst({ where: { id, ...videoInWorkspace(workspaceId) }, select: VIDEO_SELECT });
    if (!v) throw new NotFoundException('ไม่พบวิดีโอ');
    const [withStats] = await this.withStats([v]);
    const [timeline, recs, comments, diag] = await Promise.all([
      this.prisma.youTubeVideoMetricSnapshot.findMany({ where: { videoId: id }, orderBy: { capturedAt: 'asc' }, take: 100, select: { capturedAt: true, source: true, window: true, metricsJson: true } }),
      this.prisma.youTubeRecommendation.findMany({ where: { videoId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.youTubeComment.count({ where: { videoId: id } }),
      this.diagnose(workspaceId, v.channelId, id),
    ]);
    return ser({ ...withStats, timeline, recommendations: recs, commentCount: comments, packaging: diag });
  }

  /** ค่ากลางของช่อง (§97) แยกตาม format */
  async baselines(channelId: string, videoType?: string) {
    const vids = await this.prisma.youTubeVideo.findMany({ where: { channelId, availability: 'AVAILABLE', ...(videoType && { videoType }) }, select: { id: true, videoType: true, publishedAt: true } });
    const ws = await this.withStats(vids);
    const nn = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
    return { n: ws.length, viewsMedian: median(nn(ws.map(w => w.stats.views))), avdMedian: median(nn(ws.map(w => w.stats.avgViewDuration))), subConvMedian: median(nn(ws.map(w => w.stats.subscriberConversion))), pctMedian: median(nn(ws.map(w => w.stats.avgViewPct))), rows: ws };
  }
  /** Packaging Diagnosis (§34) — CTR ไม่มีใน Analytics API ทั่วไป → ใช้ views เทียบค่ากลาง (confidence LOW) */
  async diagnose(workspaceId: string, channelId: string, videoId: string) {
    const v = await this.prisma.youTubeVideo.findFirst({ where: { id: videoId, ...videoInWorkspace(workspaceId) }, select: { id: true, videoType: true } });
    if (!v) return null;
    const b = await this.baselines(channelId, v.videoType); const me = b.rows.find(r => r.id === videoId);
    if (!me || b.n < 5) return { diagnosis: 'INSUFFICIENT_DATA', hypothesis: `วิดีโอประเภทเดียวกันในช่องมี ${b.n} รายการ — น้อยกว่า 5 จึงยังเทียบไม่ได้ (§130)`, confidence: 'LOW', baselines: b.n };
    return { ...packagingDiagnosis({ ctr: null, ctrMedian: null, avgViewDuration: me.stats.avgViewDuration, avdMedian: b.avdMedian, views: me.stats.views, viewsMedian: b.viewsMedian }), baselines: { n: b.n, viewsMedian: b.viewsMedian, avdMedian: b.avdMedian } };
  }

  /** Revival candidates (§41–42) → YouTubeRecommendation (REVIVE_VIDEO) */
  async findRevivalCandidates(workspaceId: string, userId: string, channelId: string, requestId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true } }); if (!ch) throw new NotFoundException('ไม่พบช่อง');
    const b = await this.baselines(channelId, 'LONG_FORM');
    if (b.n < 5) return { candidates: [], note: `วิดีโอยาวมี ${b.n} รายการ — ต้อง ≥ 5 จึงประเมินได้` };
    const demand = await this.prisma.youTubeComment.groupBy({ by: ['videoId'], where: { channelId, classification: { in: ['QUESTION', 'CONTENT_REQUEST', 'FOLLOW_UP_QUESTION'] } }, _count: { _all: true } });
    const out = [];
    for (const r of b.rows) {
      if (!r.publishedAt) continue; const ageDays = (Date.now() - r.publishedAt.getTime()) / 86_400_000; if (ageDays < 30) continue;
      const sc = revivalScore({ avdRatio: r.stats.avgViewDuration !== null && b.avdMedian ? r.stats.avgViewDuration / b.avdMedian : null, subConvRatio: r.stats.subscriberConversion !== null && b.subConvMedian ? r.stats.subscriberConversion / b.subConvMedian : null, viewsRatio: r.stats.views !== null && b.viewsMedian ? r.stats.views / b.viewsMedian : null, ageDays, recentDeclineRatio: null, commentDemand: demand.find(d => d.videoId === r.id)?._count._all ?? 0 });
      if (sc.score >= 45) out.push({ videoId: r.id, score: sc.score, reasons: sc.reasons });
    }
    out.sort((a, b2) => b2.score - a.score);
    for (const c of out.slice(0, 5)) {
      const v = b.rows.find(r => r.id === c.videoId)!;
      const existing = await this.prisma.youTubeRecommendation.findFirst({ where: { channelId, videoId: c.videoId, actionType: 'REVIVE_VIDEO', status: 'OPEN' } });
      if (!existing) await this.prisma.youTubeRecommendation.create({ data: { channelId, videoId: c.videoId, actionType: 'REVIVE_VIDEO', title: `ฟื้นวิดีโอ: ${(v as { title?: string }).title ?? c.videoId}`, why: c.reasons.join(' · '), evidence: { revivalScore: c.score, version: REVIVAL_SCORE_VERSION, reasons: c.reasons } as Prisma.InputJsonValue, confidence: c.score >= 70 ? 'HIGH' : 'MEDIUM', priority: c.score, source: 'revival-rules' } });
    }
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_REVIVAL_SCAN', resourceType: 'youtubeChannel', resourceId: channelId, after: { candidates: out.length }, requestId });
    return { candidates: ser(out.slice(0, 10).map(c => ({ ...c, video: b.rows.find(r => r.id === c.videoId) }))), version: REVIVAL_SCORE_VERSION };
  }

  listRecommendations(workspaceId: string, channelId?: string, status = 'OPEN') {
    return this.prisma.youTubeRecommendation.findMany({ where: { channel: channelInWorkspace(workspaceId), ...(channelId && { channelId }), ...(status !== 'ALL' && { status }) }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 100, include: { video: { select: { id: true, title: true, thumbnailUrl: true, youtubeVideoId: true } } } });
  }
  async setRecommendationStatus(workspaceId: string, userId: string, id: string, status: string, outcome: Record<string, unknown> | undefined, requestId: string) {
    const r = await this.prisma.youTubeRecommendation.findFirst({ where: { id, channel: channelInWorkspace(workspaceId) }, select: { id: true, status: true } });
    if (!r) throw new NotFoundException('ไม่พบคำแนะนำ');
    const out = await this.prisma.youTubeRecommendation.update({ where: { id }, data: { status, ...(outcome && { outcome: outcome as Prisma.InputJsonValue }) } });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_RECOMMENDATION_STATUS', resourceType: 'youtubeRecommendation', resourceId: id, before: { status: r.status }, after: { status }, requestId });
    return out;
  }

  /** แก้ metadata วิดีโอที่เผยแพร่แล้ว (§40) — คนกดเอง; AI แค่เสนอ */
  async updateMetadata(workspaceId: string, userId: string, id: string, dto: UpdateVideoMetaDto, requestId: string) {
    const v = await this.prisma.youTubeVideo.findFirst({ where: { id, ...videoInWorkspace(workspaceId) }, select: { id: true, channelId: true, youtubeVideoId: true, title: true, description: true, tags: true, privacyStatus: true, channel: { select: { automationPaused: true } } } });
    if (!v) throw new NotFoundException('ไม่พบวิดีโอ');
    if (v.channel.automationPaused) throw new ForbiddenException('ช่องนี้หยุดระบบอัตโนมัติไว้ (kill switch)');
    try {
      const { auth } = await channelAuth(this.yt, v.channelId, { requireOAuth: true });
      const updated = await this.quota.scope({ workspaceId, channelId: v.channelId, requestId }, async () => { const [cur] = await this.yt.yt.getVideos(auth, [v.youtubeVideoId]); if (!cur) throw new NotFoundException('ไม่พบวิดีโอบน YouTube'); return this.yt.yt.updateVideo(auth, v.youtubeVideoId, cur, dto); });
      await this.prisma.youTubeVideo.update({ where: { id }, data: { title: updated.title, description: updated.description, tags: updated.tags, privacyStatus: updated.privacyStatus, scheduledPublishAt: updated.scheduledPublishAt ? new Date(updated.scheduledPublishAt) : null, rawData: updated.raw as Prisma.InputJsonValue } });
      await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_VIDEO_UPDATED', resourceType: 'youtubeVideo', resourceId: id, before: { title: v.title, description: v.description?.slice(0, 200), tags: v.tags, privacyStatus: v.privacyStatus }, after: dto as unknown as Prisma.InputJsonValue, requestId });
      await this.prisma.youTubeRecommendation.updateMany({ where: { videoId: id, status: 'ACCEPTED', actionType: { in: ['OPTIMIZE_TITLE', 'UPDATE_DESCRIPTION', 'REVIVE_VIDEO'] } }, data: { status: 'DONE', outcome: { appliedAt: new Date().toISOString(), changes: Object.keys(dto) } as Prisma.InputJsonValue } });
      return this.get(workspaceId, id);
    } catch (e) { rethrowYt(e); }
  }
  async setPillar(workspaceId: string, userId: string, id: string, pillar: string | null, requestId: string) {
    const v = await this.prisma.youTubeVideo.findFirst({ where: { id, ...videoInWorkspace(workspaceId) }, select: { id: true, contentPillar: true } }); if (!v) throw new NotFoundException('ไม่พบวิดีโอ');
    await this.prisma.youTubeVideo.update({ where: { id }, data: { contentPillar: pillar, pillarManual: true, pillarConfidence: pillar ? 1 : null } });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_PILLAR_SET', resourceType: 'youtubeVideo', resourceId: id, before: { pillar: v.contentPillar }, after: { pillar }, requestId });
    return { ok: true };
  }

  /** YouTube Analyst (§28, §109): OBSERVED / INFERENCE / RECOMMENDATION + pillar classification (§29) */
  async analyzeChannel(workspaceId: string, userId: string, channelId: string, days: number, requestId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true, subscriberCount: true, analyticsStatus: true, accessMode: true, brand: { select: { name: true, industry: true, targetAudience: true, toneOfVoice: true, primaryCTA: true, client: { select: { name: true } }, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
    if (!ch) throw new NotFoundException('ไม่พบช่อง');
    const since = new Date(Date.now() - days * 86_400_000);
    const vids = await this.prisma.youTubeVideo.findMany({ where: { channelId, availability: 'AVAILABLE', publishedAt: { gte: since } }, orderBy: { publishedAt: 'desc' }, take: 60, select: { id: true, youtubeVideoId: true, title: true, videoType: true, publishedAt: true, durationSeconds: true, contentPillar: true, pillarManual: true, commentCount: true } });
    if (vids.length < 3) throw new UnprocessableEntityException(`มีวิดีโอในช่วง ${days} วันเพียง ${vids.length} — ต้องซิงก์ประวัติเพิ่ม (stage=history) หรือขยายช่วง`);
    const ws = await this.withStats(vids);
    const analyticsAvailable = ws.some(w => w.stats.avgViewDuration !== null);
    const clusters = await this.prisma.commentCluster.findMany({ where: { channelId }, orderBy: { count: 'desc' }, take: 10, select: { label: true, kind: true, count: true } });
    const askCount = await this.prisma.youTubeComment.count({ where: { channelId, classification: { in: ['QUESTION', 'CONTENT_REQUEST'] } } });
    const all = await this.baselines(channelId);
    const limitations = [
      ...(!analyticsAvailable ? ['ไม่มีข้อมูล Analytics (watch time / AVD / subscribersGained) — ช่องเชื่อมแบบอ่านสาธารณะหรือยังไม่ได้ซิงก์ analytics: วิเคราะห์ได้เฉพาะ views/likes/comments สาธารณะ'] : []),
      'ไม่มี CTR/impressions ผ่าน Analytics API ทั่วไป — packaging diagnosis เป็นสมมติฐานจาก views เทียบค่ากลาง',
      ...(vids.length < 8 ? [`ตัวอย่างวิดีโอ ${vids.length} รายการ — ความมั่นใจต่ำ (§130)`] : []),
      'เปรียบเทียบเฉพาะวิดีโอประเภทเดียวกัน (Shorts ≠ long-form) และใช้ค่ากลาง ไม่ใช่ค่าเฉลี่ย',
    ];
    const rows = ws.map(w => ({ id: w.id, ytId: w.youtubeVideoId, title: w.title, type: w.videoType, date: w.publishedAt?.toISOString().slice(0, 10), durationSec: w.durationSeconds, pillar: w.contentPillar, pillarManual: w.pillarManual, ...w.stats, subConv: w.stats.subscriberConversion === null ? null : Math.round(w.stats.subscriberConversion * 10000) / 100, analyticsAt: undefined, analyticsRange: undefined }));
    const schema = `{ "summary": string, "observations": [{ "kind": "OBSERVED", "text": string, "evidence": string[] }], "inferences": [{ "kind": "INFERENCE", "text": string, "confidence": "LOW"|"MEDIUM"|"HIGH" }],
  "contentPillars": [{ "pillar": string, "videoIds": string[], "confidence": number }], "topVideos": [{ "videoId": string, "why": string }], "subscriberDrivers": [{ "videoId": string, "why": string }],
  "packagingIssues": [{ "videoId": string, "hypothesis": string, "confidence": "LOW"|"MEDIUM"|"HIGH" }], "revivalCandidates": [{ "videoId": string, "why": string }],
  "commentInsights": string[], "dataLimitations": string[],
  "recommendations": [{ "actionType": "CREATE_FOLLOWUP"|"CREATE_SHORT"|"CREATE_FACEBOOK_POST"|"OPTIMIZE_TITLE"|"OPTIMIZE_THUMBNAIL"|"UPDATE_DESCRIPTION"|"ADD_TO_PLAYLIST"|"CREATE_PLAYLIST"|"CREATE_SERIES"|"REVIVE_VIDEO", "videoId": string|null, "title": string, "why": string, "evidence": string[], "confidence": "LOW"|"MEDIUM"|"HIGH", "priority": number }] }`;
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.channel.analyze', role: 'analysis', requestId, promptVersion: YT_ANALYSIS_PROMPT_VERSION, resourceType: 'youtubeChannel', resourceId: channelId }, {
      system: 'คุณคือ YouTube Analyst แยกให้ชัดระหว่าง OBSERVED (ตัวเลขที่ให้), INFERENCE (การตีความพร้อมความมั่นใจ), RECOMMENDATION (สิ่งที่ทำได้จริง มีหลักฐาน) ห้ามแต่งตัวเลข ห้ามอ้าง CTR/รายได้/impressions ที่ไม่มี ค่า null = ไม่มีข้อมูล จำแนก content pillar ให้วิดีโอที่ยังไม่มี (ห้ามเปลี่ยนของที่ pillarManual=true) ตอบภาษาไทย',
      prompt: `ช่อง "${ch.title}" ผู้ติดตาม ${ch.subscriberCount ?? 'ไม่ทราบ'} · ลูกค้า ${ch.brand.client.name} / แบรนด์ ${ch.brand.name} (${ch.brand.industry ?? '-'}) กลุ่มเป้าหมาย ${ch.brand.targetAudience ?? '-'} CTA ${ch.brand.primaryCTA ?? '-'}\nข้อมูลแบรนด์: ${ch.brand.knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.slice(0, 200)}`).join(' | ') || '-'}\nค่ากลางช่องทั้งหมด: views ${all.viewsMedian ?? 'n/a'} · AVD ${all.avdMedian ?? 'n/a'} วินาที · subConv ${all.subConvMedian === null ? 'n/a' : (all.subConvMedian * 100).toFixed(2) + '%'}\nข้อจำกัดข้อมูล (ต้องรายงานใน dataLimitations):\n${limitations.map(l => '- ' + l).join('\n')}\nคลัสเตอร์คอมเมนต์: ${clusters.map(c => `${c.label} (${c.kind}, ${c.count})`).join('; ') || 'ยังไม่มี'} · คอมเมนต์ที่เป็นคำถาม/คำขอ ${askCount}\nวิดีโอ ${rows.length} รายการใน ${days} วัน (subConv เป็น %):\n${JSON.stringify(rows)}`,
      schemaDescription: schema, validate: v => { const o = v as Record<string, unknown>; if (typeof o.summary !== 'string' || !Array.isArray(o.recommendations)) throw new Error('summary/recommendations หาย'); return o as { summary: string; contentPillars?: { pillar: string; videoIds: string[]; confidence: number }[]; recommendations: { actionType: string; videoId: string | null; title: string; why: string; evidence: string[]; confidence: string; priority: number }[]; dataLimitations?: string[] }; }, maxTokens: 8000,
    });
    const r = out.result.data;
    for (const p of r.contentPillars ?? []) for (const vid of p.videoIds ?? []) { const v = vids.find(x => x.id === vid || x.youtubeVideoId === vid); if (v && !v.pillarManual) await this.prisma.youTubeVideo.update({ where: { id: v.id }, data: { contentPillar: p.pillar, pillarConfidence: Math.min(1, Math.max(0, Number(p.confidence ?? 0.6))) } }); }
    const saved = await this.prisma.youTubeChannelAnalysis.create({ data: { channelId, days, result: r as unknown as Prisma.InputJsonValue, provider: out.provider, model: out.model, promptVersion: YT_ANALYSIS_PROMPT_VERSION, createdById: userId }, select: { id: true, createdAt: true } });
    let created = 0;
    for (const rec of r.recommendations.slice(0, 12)) {
      const vid = rec.videoId ? vids.find(x => x.id === rec.videoId || x.youtubeVideoId === rec.videoId)?.id ?? null : null;
      const exists = await this.prisma.youTubeRecommendation.findFirst({ where: { channelId, actionType: rec.actionType, videoId: vid, title: rec.title, status: 'OPEN' } });
      if (!exists) { await this.prisma.youTubeRecommendation.create({ data: { channelId, videoId: vid, actionType: rec.actionType, title: rec.title.slice(0, 200), why: rec.why.slice(0, 2000), evidence: rec.evidence as Prisma.InputJsonValue, confidence: rec.confidence, priority: Math.max(0, Math.min(100, Math.round(rec.priority ?? 50))), source: 'analyst', promptVersion: YT_ANALYSIS_PROMPT_VERSION } }); created++; }
    }
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_CHANNEL_ANALYZED', resourceType: 'youtubeChannel', resourceId: channelId, after: { analysisId: saved.id, days, recommendations: created, costUsd: out.costUsd, model: out.model }, requestId });
    return ser({ id: saved.id, createdAt: saved.createdAt, days, provider: out.provider, model: out.model, costUsd: out.costUsd, videosAnalyzed: rows.length, analyticsAvailable, result: r, recommendationsCreated: created });
  }
  latestAnalyses(workspaceId: string, channelId: string) { return this.prisma.youTubeChannelAnalysis.findMany({ where: { channelId, channel: channelInWorkspace(workspaceId) }, orderBy: { createdAt: 'desc' }, take: 5 }); }
  /** ใช้ทดสอบ mapVideo ผ่าน service (ไม่ใช้ใน route) */
  static map = mapVideo;
}
