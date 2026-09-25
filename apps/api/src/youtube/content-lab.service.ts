/** YT-3/YT-4/YT-7: Content Lab (§69), lifecycle (§26), agents (§30–39), approval + upload package (§56–62), repurposing (§75–76), BrandInsight (§72) */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { channelInWorkspace, contentInWorkspace, pageInWorkspace } from '@fbpm/database';
import { canTransitionYt, type YtContentStatus } from '@fbpm/shared';
import { checkProcessing, runUpload, uploadBlockReason, type YtDeps } from '@fbpm/youtube-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../jobs/queue.service';
import { localToUtc, isValidTimeZone } from '../content/tz';
import { QUOTA, QuotaLedger, YT } from './youtube.provider';
import { statsFromSnapshots } from './videos.service';
import { rethrowYt } from './errors';
import type { CreateYtContentDto, IdeasDto, RepurposeDto, ScriptDto, UpdateYtContentDto } from './dto';

export const PV = { ideas: 'youtube-topic-opportunity-v1', titles: 'youtube-title-generator-v1', thumb: 'youtube-thumbnail-brief-v1', script: 'youtube-script-v1', seo: 'youtube-seo-v1', review: 'youtube-reviewer-v1', repurpose: 'content-repurpose-v1', insight: 'brand-insight-v1' };
const SELECT = { id: true, platform: true, youtubeChannelId: true, status: true, ytStatus: true, contentType: true, title: true, caption: true, objective: true, contentPillar: true, scheduledLocal: true, scheduledTz: true, scheduledAt: true, retryCount: true, createdById: true, aiProvider: true, aiModel: true, promptVersion: true, editedByHuman: true, externalPostId: true, publishedAt: true, aiNotes: true, reviewResult: true, lastError: true, createdAt: true, updatedAt: true,
  youtubeMeta: true, youtubeChannel: { select: { id: true, title: true, thumbnailUrl: true, timezone: true, automationLevel: true, uploadsPaused: true, accessMode: true, policy: true, brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } } } },
  approvals: { orderBy: { requestedAt: 'desc' as const }, take: 5, select: { id: true, status: true, requestedAt: true, reviewedAt: true, reviewerComment: true, requestedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } } },
  uploadOps: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { status: true, youtubeVideoId: true, bytesSent: true, totalBytes: true, error: true, retryCount: true, updatedAt: true } },
  relationsFrom: { select: { relationType: true, child: { select: { id: true, platform: true, title: true, status: true } } } }, relationsTo: { select: { relationType: true, parent: { select: { id: true, platform: true, title: true, status: true } } } } } as const;
const ser = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x))) as T;
/** map ytStatus → ContentStatus หลัก (คิวอนุมัติ/ปฏิทินร่วม) */
const MAIN: Partial<Record<YtContentStatus, string>> = { IDEA: 'IDEA', RESEARCH: 'PLANNED', OUTLINE: 'PLANNED', SCRIPT: 'DRAFT', PRODUCTION: 'DRAFT', VIDEO_READY: 'DRAFT', METADATA_READY: 'DRAFT', THUMBNAIL_READY: 'DRAFT', AI_REVIEW: 'AI_REVIEW', READY_FOR_APPROVAL: 'READY_FOR_APPROVAL', APPROVED: 'APPROVED', UPLOAD_PENDING: 'APPROVED', UPLOADING: 'PUBLISHING', PROCESSING: 'PUBLISHING', SCHEDULED: 'SCHEDULED', PUBLISHED: 'PUBLISHED', ANALYTICS_PENDING: 'PUBLISHED', ANALYZED: 'ANALYZED', REJECTED: 'REJECTED', UPLOAD_FAILED: 'PUBLISH_FAILED', PROCESSING_FAILED: 'PUBLISH_FAILED', PUBLISH_FAILED: 'PUBLISH_FAILED', CANCELLED: 'CANCELLED' };

@Injectable()
export class YtContentLabService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(YT) private readonly yt: YtDeps, @Inject(QUOTA) private readonly quota: QuotaLedger, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService, @Inject(QueueService) private readonly queue: QueueService) {}

  private async load(workspaceId: string, id: string) { const c = await this.prisma.contentItem.findFirst({ where: { id, platform: 'YOUTUBE', ...contentInWorkspace(workspaceId) }, select: SELECT }); if (!c) throw new NotFoundException('ไม่พบคอนเทนต์ YouTube'); return ser(c); }
  private async transition(workspaceId: string, userId: string | null, id: string, to: YtContentStatus, requestId: string, extra: Prisma.ContentItemUpdateInput = {}, action = 'youtube.content.transition') {
    const c = await this.prisma.contentItem.findFirst({ where: { id, platform: 'YOUTUBE', ...contentInWorkspace(workspaceId) }, select: { ytStatus: true } }); if (!c) throw new NotFoundException('ไม่พบคอนเทนต์');
    const from = (c.ytStatus ?? 'IDEA') as YtContentStatus;
    if (!canTransitionYt(from, to)) throw new ConflictException(`เปลี่ยนสถานะจาก ${from} → ${to} ไม่ได้`);
    await this.prisma.contentItem.update({ where: { id }, data: { ytStatus: to, status: (MAIN[to] ?? 'DRAFT') as never, ...extra } });
    await this.audit.log({ workspaceId, userId, action, resourceType: 'contentItem', resourceId: id, before: { ytStatus: from }, after: { ytStatus: to }, requestId });
  }
  private async channelCtx(workspaceId: string, channelId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true, subscriberCount: true, timezone: true, policy: true, defaultLanguage: true, brand: { select: { id: true, name: true, client: { select: { name: true } }, industry: true, description: true, targetAudience: true, toneOfVoice: true, preferredLanguage: true, primaryCTA: true, website: true, serviceArea: true, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } }, pages: { where: { disconnectedAt: null }, select: { id: true, name: true } } } } } });
    if (!ch) throw new NotFoundException('ไม่พบช่อง');
    const vids = await this.prisma.youTubeVideo.findMany({ where: { channelId, availability: 'AVAILABLE' }, orderBy: { publishedAt: 'desc' }, take: 40, select: { id: true, title: true, videoType: true, publishedAt: true, contentPillar: true, durationSeconds: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 2, select: { source: true, metricsJson: true, capturedAt: true, dateRangeStart: true, dateRangeEnd: true } } } });
    const rows = vids.map(v => { const d = v.snapshots.find(s => s.source === 'DATA_API'); const a = v.snapshots.find(s => s.source === 'ANALYTICS_API'); const st = statsFromSnapshots((d?.metricsJson as never) ?? null, a ? { metricsJson: a.metricsJson as never, capturedAt: a.capturedAt, dateRangeStart: a.dateRangeStart, dateRangeEnd: a.dateRangeEnd } : null); return { id: v.id, title: v.title, type: v.videoType, date: v.publishedAt?.toISOString().slice(0, 10), pillar: v.contentPillar, sec: v.durationSeconds, views: st.views, avd: st.avgViewDuration, subs: st.subscribersGained }; });
    const clusters = await this.prisma.commentCluster.findMany({ where: { channelId }, orderBy: { count: 'desc' }, take: 8, select: { label: true, kind: true, count: true } });
    const analysis = await this.prisma.youTubeChannelAnalysis.findFirst({ where: { channelId }, orderBy: { createdAt: 'desc' }, select: { result: true } });
    const b = ch.brand; const prohibited = b.knowledge.filter(k => k.type === 'prohibited_claim');
    const policy = (ch.policy as { factualNiche?: boolean } | null) ?? {};
    const text = [`ช่อง "${ch.title}" ผู้ติดตาม ${ch.subscriberCount ?? 'ไม่ทราบ'} · ลูกค้า ${b.client.name} / แบรนด์ ${b.name} (${b.industry ?? '-'})`, `กลุ่มเป้าหมาย: ${b.targetAudience ?? '-'} · น้ำเสียง: ${b.toneOfVoice ?? '-'} · ภาษา: ${b.preferredLanguage} · CTA: ${b.primaryCTA ?? '-'} · เว็บ: ${b.website ?? '-'} · พื้นที่: ${b.serviceArea ?? '-'}`,
      b.knowledge.length ? `ข้อมูลแบรนด์ (ใช้ได้เฉพาะที่ระบุ ห้ามแต่ง):\n${b.knowledge.filter(k => k.type !== 'prohibited_claim').map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 400)}`).join('\n')}` : 'ข้อมูลแบรนด์: ยังไม่ได้กรอก — ห้ามแต่งราคา/โปร/เบอร์/ที่อยู่/ใบรับรอง',
      prohibited.length ? `ข้อห้ามกล่าวอ้าง:\n${prohibited.map(k => `- ${k.title}: ${k.content}`).join('\n')}` : 'ข้อห้ามทั่วไป: ห้ามอ้างผลทางการแพทย์/กฎหมาย/การเงิน ห้ามสัญญาผลลัพธ์ ห้ามแต่งรีวิว',
      policy.factualNiche ? 'ช่องนี้เป็นสายข้อเท็จจริง (§38, §153): แยก Verified Research / Brand Knowledge / AI Creative Interpretation และระบุแหล่งอ้างอิงที่ต้องตรวจ' : '',
      rows.length ? `วิดีโอล่าสุด ${rows.length} รายการ (null = ไม่มีข้อมูล):\n${JSON.stringify(rows)}` : 'ยังไม่มีวิดีโอที่ซิงก์',
      clusters.length ? `สิ่งที่ผู้ชมถาม/ขอซ้ำ:\n${clusters.map(c => `- ${c.label} (${c.kind}, ${c.count})`).join('\n')}` : '', analysis ? `ผลวิเคราะห์ล่าสุด: ${JSON.stringify(analysis.result).slice(0, 2500)}` : ''].filter(Boolean).join('\n\n');
    return { ch, brand: b, rows, clusters, text };
  }

  list(workspaceId: string, q: { channelId?: string; ytStatus?: string; limit?: number }) {
    return this.prisma.contentItem.findMany({ where: { platform: 'YOUTUBE', ...contentInWorkspace(workspaceId), ...(q.channelId && { youtubeChannelId: q.channelId }), ...(q.ytStatus && { ytStatus: q.ytStatus }) }, orderBy: { updatedAt: 'desc' }, take: q.limit ?? 200, select: SELECT }).then(ser);
  }
  get(workspaceId: string, id: string) { return this.load(workspaceId, id); }

  async create(workspaceId: string, userId: string | null, dto: CreateYtContentDto, requestId: string, ai?: { provider: string; model: string; promptVersion: string; notes?: unknown; ytStatus?: YtContentStatus }) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: dto.channelId, ...channelInWorkspace(workspaceId) }, select: { id: true, policy: true, defaultLanguage: true } }); if (!ch) throw new NotFoundException('ไม่พบช่อง');
    const policy = (ch.policy as { defaultPrivacy?: string; defaultMadeForKids?: boolean; defaultCategoryId?: string } | null) ?? {};
    const st = ai?.ytStatus ?? 'IDEA';
    const c = await this.prisma.contentItem.create({ data: { platform: 'YOUTUBE', youtubeChannelId: dto.channelId, status: (MAIN[st] ?? 'IDEA') as never, ytStatus: st, contentType: dto.format === 'SHORT' ? 'YT_SHORT' : dto.format === 'LIVE' ? 'YT_LIVE' : 'YT_LONG_FORM', title: dto.title, objective: dto.objective, contentPillar: dto.contentPillar, createdById: userId, aiProvider: ai?.provider, aiModel: ai?.model, promptVersion: ai?.promptVersion, aiNotes: ({ ...(dto.notes && { notes: dto.notes }), ...((ai?.notes as object) ?? {}) }) as Prisma.InputJsonValue, youtubeMeta: { create: { format: dto.format, hook: dto.hook, privacyStatus: policy.defaultPrivacy ?? 'private', madeForKids: policy.defaultMadeForKids ?? null, categoryId: policy.defaultCategoryId ?? null, objective: dto.objective } } }, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: ai ? 'YOUTUBE_CONTENT_CREATED_AI' : 'YOUTUBE_CONTENT_CREATED', resourceType: 'contentItem', resourceId: c.id, after: { channelId: dto.channelId, title: dto.title, format: dto.format }, requestId });
    return this.load(workspaceId, c.id);
  }
  /** แก้ไขโดยคน (§55) — แก้ metadata/script หลังอนุมัติ → กลับ METADATA_READY */
  async update(workspaceId: string, userId: string, id: string, dto: UpdateYtContentDto, requestId: string) {
    const c = await this.load(workspaceId, id);
    if (['UPLOADING', 'PROCESSING', 'PUBLISHED', 'ANALYTICS_PENDING', 'ANALYZED', 'CANCELLED'].includes(c.ytStatus ?? '')) throw new ConflictException(`แก้ไขคอนเทนต์สถานะ ${c.ytStatus} ไม่ได้`);
    const { scheduledLocal, timezone, internalTitle, reason, outline, ...meta } = dto;
    let scheduled: { scheduledLocal: string | null; scheduledTz: string | null; scheduledAt: Date | null; scheduledPublishAt: Date | null } | null = null;
    if (scheduledLocal !== undefined) {
      if (scheduledLocal === null) scheduled = { scheduledLocal: null, scheduledTz: null, scheduledAt: null, scheduledPublishAt: null };
      else { const tz = timezone ?? c.youtubeChannel?.timezone ?? (await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } })).timezone; if (!isValidTimeZone(tz)) throw new BadRequestException('เขตเวลาไม่ถูกต้อง'); const at = localToUtc(scheduledLocal, tz); if (at.getTime() < Date.now() + 15 * 60_000) throw new BadRequestException('ตั้งเวลาต้องล่วงหน้าอย่างน้อย 15 นาที'); scheduled = { scheduledLocal, scheduledTz: tz, scheduledAt: at, scheduledPublishAt: at }; }
    }
    const scriptChanged = meta.script !== undefined && meta.script !== c.youtubeMeta?.script;
    const backToMeta = ['READY_FOR_APPROVAL', 'APPROVED', 'UPLOAD_PENDING', 'REJECTED', 'UPLOAD_FAILED'].includes(c.ytStatus ?? '') && (Object.keys(meta).length > 0 || scheduled);
    await this.prisma.contentItem.update({ where: { id }, data: { editedByHuman: true, ...(internalTitle !== undefined && { title: internalTitle }), ...(meta.objective !== undefined && { objective: meta.objective }), ...(meta.contentPillar !== undefined && { contentPillar: meta.contentPillar }), ...(scheduled && { scheduledLocal: scheduled.scheduledLocal, scheduledTz: scheduled.scheduledTz, scheduledAt: scheduled.scheduledAt }), ...(backToMeta && { ytStatus: 'METADATA_READY', status: 'DRAFT', reviewResult: undefined }), ...(scriptChanged && { revisions: { create: { version: (await this.prisma.contentRevision.count({ where: { contentId: id } })) + 1, caption: meta.script ?? null, editedBy: userId, reason: reason ?? 'human edit (script)' } } }),
      youtubeMeta: { update: { ...(meta.title !== undefined && { title: meta.title }), ...(meta.description !== undefined && { description: meta.description }), ...(meta.tags && { tags: meta.tags }), ...(meta.categoryId !== undefined && { categoryId: meta.categoryId }), ...(meta.privacyStatus && { privacyStatus: meta.privacyStatus }), ...(meta.madeForKids !== undefined && { madeForKids: meta.madeForKids }), ...(meta.syntheticMedia !== undefined && { syntheticMedia: meta.syntheticMedia }), ...(meta.paidPlacement !== undefined && { paidPlacement: meta.paidPlacement }), ...(meta.format && { format: meta.format }), ...(meta.targetDurationSec !== undefined && { targetDurationSec: meta.targetDurationSec }), ...(meta.hook !== undefined && { hook: meta.hook }), ...(meta.script !== undefined && { script: meta.script }), ...(outline && { outline: outline as Prisma.InputJsonValue }), ...(meta.objective !== undefined && { objective: meta.objective }), ...(scheduled && { scheduledPublishAt: scheduled.scheduledPublishAt }) } } } });
    if (c.ytStatus === 'UPLOAD_PENDING' && backToMeta) await this.queue.cancelYtUpload(id);
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_CONTENT_UPDATED', resourceType: 'contentItem', resourceId: id, after: { fields: Object.keys(dto), backToMeta }, requestId });
    return this.load(workspaceId, id);
  }
  async setStatus(workspaceId: string, userId: string, id: string, to: string, requestId: string) {
    const allowed: YtContentStatus[] = ['RESEARCH', 'OUTLINE', 'SCRIPT', 'PRODUCTION', 'VIDEO_READY', 'METADATA_READY', 'THUMBNAIL_READY', 'CANCELLED'];
    if (!allowed.includes(to as YtContentStatus)) throw new BadRequestException(`เปลี่ยนสถานะเป็น ${to} ผ่านปุ่มเฉพาะเท่านั้น`);
    const c = await this.load(workspaceId, id);
    if (to === 'CANCELLED' && c.ytStatus === 'UPLOAD_PENDING') await this.queue.cancelYtUpload(id);
    await this.transition(workspaceId, userId, id, to as YtContentStatus, requestId, {}, to === 'CANCELLED' ? 'YOUTUBE_CONTENT_CANCELLED' : 'youtube.content.transition');
    return this.load(workspaceId, id);
  }

  // ---------- Agents ----------
  /** Topic Opportunity + Gap Finder (§30–32) → ContentItem IDEA + BrandInsight */
  async ideas(workspaceId: string, userId: string, channelId: string, dto: IdeasDto, requestId: string) {
    const ctx = await this.channelCtx(workspaceId, channelId); const count = dto?.count ?? 5;
    const fbPosts = ctx.brand.pages.length ? await this.prisma.facebookPost.findMany({ where: { pageId: { in: ctx.brand.pages.map(p => p.id) } }, orderBy: { publishedAt: 'desc' }, take: 20, select: { message: true, content: { select: { contentPillar: true } } } }) : [];
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.ideas', role: 'strategy', requestId, promptVersion: PV.ideas, resourceType: 'youtubeChannel', resourceId: channelId }, {
      system: 'คุณคือ Topic Opportunity Agent ของช่อง YouTube หาหัวข้อที่ควรทำถัดไปจากหลักฐานจริง: วิดีโอที่ทำผลงานดี, หัวข้อที่ทำน้อยแต่ผลดี (content gap), หัวข้อที่ทำเยอะเกิน (saturation), สิ่งที่ผู้ชมถามซ้ำ, ข้อมูลแบรนด์/เป้าหมายธุรกิจ และสัญญาณจาก Facebook ของแบรนด์เดียวกัน (ถ้ามี) ห้ามอ้าง search volume ห้ามสัญญาผลลัพธ์ ตอบภาษาไทย',
      prompt: `${ctx.text}${fbPosts.length ? `\n\nโพสต์ Facebook ล่าสุดของแบรนด์ (สัญญาณข้ามแพลตฟอร์ม):\n${fbPosts.map(p => `- ${(p.message ?? '').slice(0, 100)} [${p.content?.contentPillar ?? '-'}]`).join('\n')}` : ''}\n\nงาน: เสนอ ${count} หัวข้อ${dto?.objective ? ` เป้าหมาย: ${dto.objective}` : ''}${dto?.notes ? `\nโน้ต: ${dto.notes}` : ''} ระบุ gaps/saturation ที่พบ และ insight ข้ามแพลตฟอร์มถ้ามี`,
      schemaDescription: `{ "ideas": [{ "topic": string, "title": string, "whyNow": string, "evidence": string[], "contentPillar": string, "format": "LONG_FORM"|"SHORT", "objective": string, "hook": string, "priority": number, "confidence": number, "source": "PERFORMANCE"|"COMMENTS"|"GAP"|"CROSS_PLATFORM"|"BRAND" }], "gaps": [{ "pillar": string, "finding": string }], "saturation": [{ "pillar": string, "finding": string }], "insights": [{ "type": "STRONG_TOPIC"|"CONTENT_GAP"|"AUDIENCE_QUESTION"|"CROSS_PLATFORM_OPPORTUNITY", "title": string, "observation": string, "inference": string, "recommendation": string, "platforms": ("YOUTUBE"|"FACEBOOK")[], "confidence": "LOW"|"MEDIUM"|"HIGH" }] }`,
      validate: v => { const o = v as { ideas?: Record<string, unknown>[]; gaps?: unknown[]; saturation?: unknown[]; insights?: Record<string, unknown>[] }; if (!Array.isArray(o.ideas) || !o.ideas.length) throw new Error('ideas ต้องมี'); return { ideas: o.ideas.filter(i => i.topic && i.title), gaps: o.gaps ?? [], saturation: o.saturation ?? [], insights: (o.insights ?? []).filter(i => i.title && i.observation) }; }, maxTokens: 7000,
    });
    const items = [];
    for (const i of out.result.data.ideas.slice(0, count)) items.push(await this.create(workspaceId, userId, { channelId, title: String(i.title).slice(0, 200), format: i.format === 'SHORT' ? 'SHORT' : 'LONG_FORM', objective: String(i.objective ?? '').slice(0, 300) || undefined, contentPillar: String(i.contentPillar ?? '').slice(0, 120) || undefined, hook: String(i.hook ?? '').slice(0, 500) || undefined }, requestId, { provider: out.provider, model: out.model, promptVersion: PV.ideas, notes: { topic: i.topic, whyNow: i.whyNow, evidence: i.evidence, priority: i.priority, confidence: i.confidence, source: i.source }, ytStatus: 'IDEA' }));
    for (const ins of out.result.data.insights.slice(0, 6)) await this.prisma.brandInsight.create({ data: { brandId: ctx.brand.id, type: String(ins.type), platforms: Array.isArray(ins.platforms) ? (ins.platforms as string[]) : ['YOUTUBE'], title: String(ins.title).slice(0, 200), observation: String(ins.observation), inference: ins.inference ? String(ins.inference) : null, recommendation: ins.recommendation ? String(ins.recommendation) : null, confidence: ['LOW', 'MEDIUM', 'HIGH'].includes(String(ins.confidence)) ? String(ins.confidence) : 'MEDIUM', evidence: { gaps: out.result.data.gaps, saturation: out.result.data.saturation } as Prisma.InputJsonValue } });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_IDEAS_GENERATED', resourceType: 'youtubeChannel', resourceId: channelId, after: { ideas: items.length, insights: out.result.data.insights.length, costUsd: out.costUsd }, requestId });
    return { items, gaps: out.result.data.gaps, saturation: out.result.data.saturation, insights: out.result.data.insights, provider: out.provider, model: out.model, costUsd: out.costUsd };
  }
  /** สร้างไอเดียจากคลัสเตอร์คอมเมนต์ (§50) */
  async ideaFromCluster(workspaceId: string, userId: string, clusterId: string, requestId: string) {
    const cl = await this.prisma.commentCluster.findFirst({ where: { id: clusterId, channel: channelInWorkspace(workspaceId) }, select: { id: true, channelId: true, label: true, description: true, count: true, kind: true } }); if (!cl) throw new NotFoundException('ไม่พบคลัสเตอร์');
    return this.create(workspaceId, userId, { channelId: cl.channelId, title: cl.label.slice(0, 200), format: 'LONG_FORM', objective: 'FAQ', hook: undefined, notes: cl.description ?? undefined }, requestId, { provider: 'rules', model: 'comment-cluster', promptVersion: 'comment-idea-v1', notes: { source: 'COMMENTS', evidence: [`ผู้ชมถาม/ขอเรื่องนี้ ${cl.count} ครั้ง (${cl.kind})`], clusterId: cl.id }, ytStatus: 'IDEA' });
  }
  /** Script Agent (§37–38) */
  async script(workspaceId: string, userId: string, id: string, dto: ScriptDto, requestId: string) {
    const c = await this.load(workspaceId, id); const ctx = await this.channelCtx(workspaceId, c.youtubeChannelId!);
    const m = c.youtubeMeta!; const target = dto?.targetDurationSec ?? m.targetDurationSec ?? (m.format === 'SHORT' ? 55 : 480);
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.script', role: 'content', requestId, promptVersion: PV.script, resourceType: 'contentItem', resourceId: id }, {
      system: `คุณคือ Script Agent เขียนสคริปต์ YouTube ${m.format === 'SHORT' ? 'Shorts (แนวตั้ง สั้น เปิดเรื่องภายใน 2 วินาที)' : 'long-form'} ภาษา${ctx.brand.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย'} น้ำเสียงแบรนด์ ใช้เฉพาะข้อเท็จจริงจากข้อมูลแบรนด์/งานวิจัยที่ให้ ส่วนที่เป็นการตีความของ AI ให้ระบุใน aiInterpretation ส่วนข้อมูลที่ขาด (ราคา/สถานที่/ตัวเลข) ห้ามเดา ใส่ใน missingInfo แทน โครงสร้าง: hook → สัญญา → เนื้อหาเป็นตอน → สรุป → CTA พร้อม visual cue ต่อตอน`,
      prompt: `${ctx.text}\n\nหัวข้อ: ${c.title ?? '-'} · เป้าหมาย: ${c.objective ?? '-'} · เสาหลัก: ${c.contentPillar ?? '-'} · hook เดิม: ${m.hook ?? '-'} · ความยาวเป้าหมาย ${target} วินาที${dto?.notes ? `\nโน้ต: ${dto.notes}` : ''}${dto?.research?.length ? `\nงานวิจัยที่ตรวจแล้ว (Verified Research):\n${dto.research.map(r => `- ${r.claim} (${r.source})`).join('\n')}` : ''}${m.script ? `\nสคริปต์เดิม (ปรับปรุง): ${m.script.slice(0, 3000)}` : ''}`,
      schemaDescription: `{ "hook": string, "outline": [{ "section": string, "points": string[], "visual": string, "durationSec": number }], "script": string, "cta": string, "aiInterpretation": string[], "missingInfo": string[], "researchNeeded": string[] }`,
      validate: v => { const o = v as Record<string, unknown>; if (typeof o.script !== 'string' || !o.script) throw new Error('script หาย'); return { hook: String(o.hook ?? ''), outline: Array.isArray(o.outline) ? o.outline : [], script: o.script, cta: String(o.cta ?? ''), aiInterpretation: Array.isArray(o.aiInterpretation) ? o.aiInterpretation.map(String) : [], missingInfo: Array.isArray(o.missingInfo) ? o.missingInfo.map(String) : [], researchNeeded: Array.isArray(o.researchNeeded) ? o.researchNeeded.map(String) : [] }; }, maxTokens: 9000,
    });
    const r = out.result.data; const rev = await this.prisma.contentRevision.count({ where: { contentId: id } });
    await this.prisma.contentItem.update({ where: { id }, data: { aiProvider: out.provider, aiModel: out.model, promptVersion: PV.script, aiNotes: { ...((c.aiNotes as object) ?? {}), missingInfo: r.missingInfo, researchNeeded: r.researchNeeded, aiInterpretation: r.aiInterpretation, needsHumanInput: r.missingInfo.length > 0 } as Prisma.InputJsonValue, revisions: { create: { version: rev + 1, caption: r.script, editedBy: 'ai', reason: 'ai script' } }, youtubeMeta: { update: { hook: r.hook, outline: r.outline as Prisma.InputJsonValue, script: r.script, targetDurationSec: target, research: (dto?.research ?? []) as unknown as Prisma.InputJsonValue } } } });
    if (['IDEA', 'RESEARCH', 'OUTLINE'].includes(c.ytStatus ?? 'IDEA')) await this.transition(workspaceId, userId, id, 'SCRIPT', requestId, {}, 'YOUTUBE_SCRIPT_GENERATED');
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_SCRIPT_GENERATED', resourceType: 'contentItem', resourceId: id, after: { costUsd: out.costUsd, model: out.model, missingInfo: r.missingInfo.length }, requestId });
    return { ...(await this.load(workspaceId, id)), cta: r.cta, costUsd: out.costUsd };
  }
  /** Title Optimizer (§33) — หลายมุม ห้ามสัญญา CTR */
  async titles(workspaceId: string, userId: string, id: string, count: number, requestId: string) {
    const c = await this.load(workspaceId, id); const ctx = await this.channelCtx(workspaceId, c.youtubeChannelId!);
    const existing = ctx.rows.map(r => r.title);
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.titles', role: 'content', requestId, promptVersion: PV.titles, resourceType: 'contentItem', resourceId: id }, {
      system: 'คุณคือ Title Optimizer เสนอชื่อวิดีโอหลายมุม (search / curiosity / benefit / listicle / question) ≤ 60 ตัวอักษรถ้าทำได้ ไม่ซ้ำกับชื่อเดิมในช่อง ไม่หลอกคลิก ไม่สัญญาผลลัพธ์ ระบุ risk (low/medium/high = โอกาสไม่ตรงเนื้อหา) ภาษาไทย',
      prompt: `${ctx.text.slice(0, 4000)}\n\nชื่อเดิมในช่อง (ห้ามซ้ำ): ${existing.slice(0, 30).join(' | ')}\n\nวิดีโอ: ${c.title ?? '-'} · hook: ${c.youtubeMeta?.hook ?? '-'} · สคริปต์ย่อ: ${(c.youtubeMeta?.script ?? '').slice(0, 1200)}\nเสนอ ${count} ชื่อ`,
      schemaDescription: `{ "titles": [{ "title": string, "angle": "search"|"curiosity"|"benefit"|"listicle"|"question", "reason": string, "risk": "low"|"medium"|"high" }] }`,
      validate: v => { const o = v as { titles?: { title?: string; angle?: string; reason?: string; risk?: string }[] }; if (!Array.isArray(o.titles) || !o.titles.length) throw new Error('titles หาย'); return o.titles.filter(t => t.title).map(t => ({ title: String(t.title).slice(0, 100), angle: String(t.angle ?? 'search'), reason: String(t.reason ?? ''), risk: ['low', 'medium', 'high'].includes(t.risk ?? '') ? t.risk! : 'medium' })); }, maxTokens: 2500,
    });
    await this.prisma.youTubeContentMetadata.update({ where: { contentItemId: id }, data: { titleCandidates: out.result.data as unknown as Prisma.InputJsonValue, ...(!c.youtubeMeta?.title && { title: out.result.data[0]!.title }) } });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_TITLES_GENERATED', resourceType: 'contentItem', resourceId: id, after: { count: out.result.data.length, costUsd: out.costUsd }, requestId });
    return { titles: out.result.data, costUsd: out.costUsd };
  }
  /** Thumbnail Strategist (§35) → brief + prompt สำหรับ MediaService/เครื่องมือภาพ */
  async thumbnailBrief(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id); const ctx = await this.channelCtx(workspaceId, c.youtubeChannelId!);
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.thumbnail', role: 'content', requestId, promptVersion: PV.thumb, resourceType: 'contentItem', resourceId: id }, {
      system: 'คุณคือ Thumbnail Strategist ออกแบบบรีฟภาพปก 1280×720 อ่านง่ายบนมือถือ ข้อความ ≤ 4 คำ ระบุ primaryVisual, emotion, layout, สิ่งที่ควรเลี่ยง และ hypothesis ว่าทำไมน่าจะได้ผล (เป็นสมมติฐาน) พร้อม imagePrompt ภาษาอังกฤษสำหรับเครื่องมือสร้างภาพ (ไม่ใช้ใบหน้าคนจริง/แบรนด์อื่น) ภาษาไทยยกเว้น imagePrompt',
      prompt: `${ctx.text.slice(0, 2500)}\n\nวิดีโอ: ${c.youtubeMeta?.title ?? c.title ?? '-'} · hook: ${c.youtubeMeta?.hook ?? '-'} · สรุป: ${(c.youtubeMeta?.script ?? '').slice(0, 800)}`,
      schemaDescription: `{ "primaryVisual": string, "emotion": string, "thumbnailText": string, "layout": string, "colors": string[], "avoid": string[], "hypothesis": string, "imagePrompt": string, "variants": [{ "thumbnailText": string, "primaryVisual": string }] }`,
      validate: v => { const o = v as Record<string, unknown>; if (typeof o.thumbnailText !== 'string') throw new Error('thumbnailText หาย'); return o; }, maxTokens: 2000,
    });
    await this.prisma.youTubeContentMetadata.update({ where: { contentItemId: id }, data: { thumbnailBrief: out.result.data as Prisma.InputJsonValue } });
    return { brief: out.result.data, costUsd: out.costUsd };
  }
  /** SEO / Metadata Agent (§39) — chapters เฉพาะเมื่อมี timing (§114): ไม่มี → ไม่สร้าง */
  async metadata(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id); const ctx = await this.channelCtx(workspaceId, c.youtubeChannelId!);
    const playlists = await this.prisma.youTubePlaylist.findMany({ where: { channelId: c.youtubeChannelId! }, select: { id: true, title: true } });
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.metadata', role: 'content', requestId, promptVersion: PV.seo, resourceType: 'contentItem', resourceId: id }, {
      system: 'คุณคือ SEO/Metadata Agent เขียน description (2–3 ย่อหน้าแรกสำคัญที่สุด มี CTA และลิงก์/ข้อมูลติดต่อเฉพาะที่แบรนด์ให้), tags ≤ 15 (tags มีผลน้อย อย่ายัด), เสนอ playlist ที่เข้ากับวิดีโอจากรายการที่มี, category, ภาษา และ CTA ไปวิดีโอที่เกี่ยวข้อง ห้ามอ้างอันดับ/ปริมาณค้นหา ห้ามสร้าง chapter timestamps (ไม่มีข้อมูลเวลา)',
      prompt: `${ctx.text.slice(0, 3000)}\n\nวิดีโอ: ${c.youtubeMeta?.title ?? c.title} · สคริปต์: ${(c.youtubeMeta?.script ?? '').slice(0, 2500)}\nplaylists ที่มี: ${playlists.map(p => `${p.id}:${p.title}`).join(', ') || '-'}`,
      schemaDescription: `{ "title": string, "description": string, "tags": string[], "categoryId": string, "defaultLanguage": string, "playlistIds": string[], "relatedVideoCta": string, "notes": string[] }`,
      validate: v => { const o = v as Record<string, unknown>; if (typeof o.description !== 'string') throw new Error('description หาย'); return { title: String(o.title ?? c.youtubeMeta?.title ?? c.title ?? '').slice(0, 100), description: String(o.description).slice(0, 5000), tags: Array.isArray(o.tags) ? o.tags.map(String).slice(0, 15) : [], categoryId: String(o.categoryId ?? '22'), defaultLanguage: String(o.defaultLanguage ?? 'th'), playlistIds: Array.isArray(o.playlistIds) ? o.playlistIds.map(String).filter(pid => playlists.some(p => p.id === pid)) : [], relatedVideoCta: String(o.relatedVideoCta ?? ''), notes: Array.isArray(o.notes) ? o.notes.map(String) : [] }; }, maxTokens: 3500,
    });
    const m = out.result.data;
    await this.prisma.youTubeContentMetadata.update({ where: { contentItemId: id }, data: { title: m.title, description: m.description, tags: m.tags, categoryId: m.categoryId, playlistIds: m.playlistIds } });
    // แพ็กเกจ (ชื่อ/description/tags) พร้อมก่อนมีไฟล์วิดีโอได้ — เดิน state ถึง METADATA_READY; ไฟล์วิดีโอถูกตรวจอีกครั้งตอนอัปโหลด (uploadBlockReason)
    for (const step of (['PRODUCTION', 'VIDEO_READY', 'METADATA_READY'] as YtContentStatus[])) { const cur = (await this.prisma.contentItem.findUnique({ where: { id }, select: { ytStatus: true } }))!.ytStatus as YtContentStatus; if (['METADATA_READY', 'THUMBNAIL_READY'].includes(cur) || !['SCRIPT', 'PRODUCTION', 'VIDEO_READY'].includes(cur)) break; if (canTransitionYt(cur, step)) await this.transition(workspaceId, userId, id, step, requestId); }
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_METADATA_GENERATED', resourceType: 'contentItem', resourceId: id, after: { costUsd: out.costUsd }, requestId });
    return { ...(await this.load(workspaceId, id)), seoNotes: m.notes, relatedVideoCta: m.relatedVideoCta, costUsd: out.costUsd };
  }

  // ---------- Assets (§57) ----------
  /** รับไฟล์วิดีโอ/ภาพปกเป็น stream → MEDIA_DIR → MediaAsset (ตรวจก่อนเข้าคิว) */
  async storeAsset(workspaceId: string, userId: string, id: string, kind: 'video' | 'thumbnail', fileName: string, mimeType: string, body: Readable, requestId: string) {
    const c = await this.load(workspaceId, id);
    const okType = kind === 'video' ? /^video\//.test(mimeType) : /^image\/(jpeg|png|webp)$/.test(mimeType); if (!okType) throw new BadRequestException(`ชนิดไฟล์ ${mimeType} ไม่รองรับสำหรับ ${kind}`);
    const dir = resolve(this.env.MEDIA_DIR, workspaceId, 'youtube'); mkdirSync(dir, { recursive: true });
    const safe = fileName.replace(/[^\w.\-ก-๙]+/g, '_').slice(0, 80); const path = join(dir, `${kind}-${Date.now()}-${safe}`);
    await pipeline(body, createWriteStream(path));
    const bytes = statSync(path).size; if (!bytes) throw new BadRequestException('ไฟล์ว่าง'); if (kind === 'thumbnail' && bytes > 2 * 1024 * 1024) throw new BadRequestException('ภาพปกต้องไม่เกิน 2MB');
    const asset = await this.prisma.mediaAsset.create({ data: { workspaceId, contentId: id, kind, path, mimeType, bytes, meta: { fileName } as Prisma.InputJsonValue, createdById: userId }, select: { id: true, kind: true, mimeType: true, bytes: true, createdAt: true } });
    await this.prisma.youTubeContentMetadata.update({ where: { contentItemId: id }, data: kind === 'video' ? { videoAssetId: asset.id } : { thumbnailAssetId: asset.id } });
    if (kind === 'video' && ['IDEA', 'RESEARCH', 'OUTLINE', 'SCRIPT', 'PRODUCTION'].includes(c.ytStatus ?? '')) { for (const step of (['SCRIPT', 'PRODUCTION', 'VIDEO_READY'] as YtContentStatus[])) { const cur = (await this.prisma.contentItem.findUnique({ where: { id }, select: { ytStatus: true } }))!.ytStatus as YtContentStatus; if (canTransitionYt(cur, step) && cur !== 'VIDEO_READY') await this.transition(workspaceId, userId, id, step, requestId); } }
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_ASSET_UPLOADED', resourceType: 'mediaAsset', resourceId: asset.id, after: { kind, bytes, mimeType, contentId: id }, requestId });
    return asset;
  }

  // ---------- Review / approval (§25, §56, §152) ----------
  async submit(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id); const m = c.youtubeMeta!;
    if (!m.title) throw new UnprocessableEntityException('ต้องมีชื่อวิดีโอ (metadata) ก่อนส่งอนุมัติ');
    if (!['METADATA_READY', 'THUMBNAIL_READY', 'SCRIPT', 'VIDEO_READY', 'PRODUCTION'].includes(c.ytStatus ?? '')) throw new ConflictException(`สถานะ ${c.ytStatus} ส่งอนุมัติไม่ได้`);
    // ให้ state machine ไปถึง METADATA_READY ก่อน
    for (const step of (['PRODUCTION', 'VIDEO_READY', 'METADATA_READY'] as YtContentStatus[])) { const cur = (await this.prisma.contentItem.findUnique({ where: { id }, select: { ytStatus: true } }))!.ytStatus as YtContentStatus; if (cur === 'METADATA_READY' || cur === 'THUMBNAIL_READY') break; if (canTransitionYt(cur, step)) await this.transition(workspaceId, userId, id, step, requestId); }
    const policy = (c.youtubeChannel!.policy as { requireSyntheticMediaReview?: boolean; requirePaidPlacementReview?: boolean; factualNiche?: boolean } | null) ?? {};
    const issues: string[] = [];
    if (m.madeForKids === null) issues.push('ต้องระบุ "สำหรับเด็ก" (madeForKids) — นโยบายไม่ให้ AI ตัดสิน (§62)');
    if (policy.requireSyntheticMediaReview && m.syntheticMedia === null) issues.push('ต้องระบุการเปิดเผยสื่อสังเคราะห์ (syntheticMedia) — POSSIBLE_SYNTHETIC_MEDIA_DISCLOSURE (§63)');
    if (policy.requirePaidPlacementReview && m.paidPlacement === null) issues.push('ต้องระบุว่ามีการโปรโมทแบบชำระเงินหรือไม่ (paidPlacement)');
    const notes = (c.aiNotes as { missingInfo?: string[]; researchNeeded?: string[] } | null) ?? {};
    if (policy.factualNiche && (notes.researchNeeded?.length ?? 0) > 0 && !((m.research as unknown[] | null)?.length)) issues.push(`ช่องสายข้อเท็จจริง: ต้องแนบงานวิจัยที่ตรวจแล้วสำหรับ ${notes.researchNeeded!.length} ประเด็น (§153)`);
    let review: { result: string; issues: { type: string; detail: string; severity: string }[]; summary: string } | null = null;
    try { review = await this.review(workspaceId, userId, id, requestId); } catch (e) { review = { result: 'SKIPPED', issues: [], summary: `ข้ามการตรวจโดย AI: ${e instanceof Error ? e.message : String(e)}` }; }
    if (issues.length || review?.result === 'BLOCKED' || review?.result === 'NEEDS_REVISION') {
      await this.transition(workspaceId, userId, id, 'AI_REVIEW', requestId, { reviewResult: { result: issues.length ? 'BLOCKED' : review!.result, summary: review?.summary ?? '', issues: [...issues.map(d => ({ type: 'policy', detail: d, severity: 'high' })), ...(review?.issues ?? [])] } as Prisma.InputJsonValue }, 'YOUTUBE_CONTENT_REVIEWED');
      await this.transition(workspaceId, userId, id, 'METADATA_READY', requestId);
      return this.load(workspaceId, id);
    }
    await this.transition(workspaceId, userId, id, 'AI_REVIEW', requestId, { reviewResult: (review ?? { result: 'SKIPPED', issues: [] }) as Prisma.InputJsonValue }, 'YOUTUBE_CONTENT_REVIEWED');
    await this.transition(workspaceId, userId, id, 'READY_FOR_APPROVAL', requestId, {}, 'YOUTUBE_CONTENT_SUBMITTED');
    await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await this.prisma.approvalRequest.create({ data: { workspaceId, resourceType: 'contentItem', resourceId: id, contentId: id, requestedById: userId } });
    await this.notifications.notify(workspaceId, { type: 'approval_required', severity: 'warn', title: `รออนุมัติ (YouTube): ${m.title}`, body: `ช่อง ${c.youtubeChannel!.title}`, href: '/youtube/content', resourceType: 'contentItem', resourceId: id, dedupeKey: `approval:${id}` });
    return this.load(workspaceId, id);
  }
  private async review(workspaceId: string, userId: string, id: string, requestId: string) {
    try { await this.ai.resolve(workspaceId, 'fast'); } catch { return null; }
    const c = await this.load(workspaceId, id); const ctx = await this.channelCtx(workspaceId, c.youtubeChannelId!); const m = c.youtubeMeta!;
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.review', role: 'fast', requestId, promptVersion: PV.review, resourceType: 'contentItem', resourceId: id }, {
      system: 'คุณคือ YouTube Reviewer ตรวจก่อนอัปโหลด: ข้อเท็จจริงตรงข้อมูลแบรนด์, ข้อห้ามกล่าวอ้าง, ราคา/เบอร์/ที่อยู่ต้องมาจากข้อมูลแบรนด์, ชื่อ/ภาพปกต้องตรงเนื้อหา (TITLE_CONTENT_MISMATCH / THUMBNAIL_CONTENT_MISMATCH), ซ้ำกับวิดีโอเดิม, ภาษา, CTA. BLOCKED เมื่ออ้างสิ่งที่ตรวจไม่ได้/ผิดนโยบาย; NEEDS_REVISION เมื่อแก้ได้; PASS เมื่อพร้อม',
      prompt: `${ctx.text.slice(0, 3000)}\n\nชื่อ: ${m.title}\ndescription: ${(m.description ?? '').slice(0, 1500)}\ntags: ${m.tags.join(', ')}\nสคริปต์: ${(m.script ?? '').slice(0, 3000)}\nบรีฟภาพปก: ${JSON.stringify(m.thumbnailBrief ?? {}).slice(0, 500)}\nชื่อวิดีโอเดิมในช่อง: ${ctx.rows.map(r => r.title).slice(0, 30).join(' | ')}`,
      schemaDescription: `{ "result": "PASS"|"NEEDS_REVISION"|"BLOCKED", "summary": string, "issues": [{ "type": string, "detail": string, "severity": "low"|"medium"|"high" }] }`,
      validate: v => { const o = v as { result?: string; summary?: string; issues?: { type?: string; detail?: string; severity?: string }[] }; if (!['PASS', 'NEEDS_REVISION', 'BLOCKED'].includes(o.result ?? '')) throw new Error('result ไม่ถูกต้อง'); return { result: o.result!, summary: String(o.summary ?? ''), issues: (o.issues ?? []).map(i => ({ type: String(i.type ?? 'other'), detail: String(i.detail ?? ''), severity: ['low', 'medium', 'high'].includes(i.severity ?? '') ? i.severity! : 'medium' })) }; }, maxTokens: 2000,
    });
    return out.result.data;
  }
  private async decide(workspaceId: string, userId: string, id: string, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED', comment: string | undefined, requestId: string) {
    const c = await this.load(workspaceId, id); if (c.ytStatus !== 'READY_FOR_APPROVAL') throw new ConflictException('ไม่ได้อยู่ในคิวรออนุมัติ');
    await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: decision, reviewedById: userId, reviewedAt: new Date(), reviewerComment: comment ?? null } });
    await this.transition(workspaceId, userId, id, decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'METADATA_READY', requestId, {}, `YOUTUBE_CONTENT_${decision}`);
    return this.load(workspaceId, id);
  }
  approve(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'APPROVED', comment, rid); }
  reject(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'REJECTED', comment, rid); }
  requestChanges(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'CHANGES_REQUESTED', comment, rid); }

  // ---------- Upload (§56–61, §104) ----------
  /** ขออัปโหลด: ต้อง APPROVED → UPLOAD_PENDING แล้วเข้าคิว (worker ทำ resumable) — inline=true รันทันที (ไฟล์เล็ก/ทดสอบ) */
  async requestUpload(workspaceId: string, userId: string, id: string, requestId: string, inline = false) {
    const c = await this.load(workspaceId, id);
    if (!['APPROVED', 'UPLOAD_FAILED', 'PROCESSING_FAILED'].includes(c.ytStatus ?? '')) throw new ConflictException('ต้องอนุมัติก่อนอัปโหลด');
    if (c.youtubeChannel!.uploadsPaused) throw new ForbiddenException('ช่องนี้หยุดการอัปโหลดไว้');
    await this.transition(workspaceId, userId, id, 'UPLOAD_PENDING', requestId, {}, 'YOUTUBE_UPLOAD_REQUESTED');
    const blocked = await uploadBlockReason(this.yt, id);
    if (blocked) { await this.transition(workspaceId, userId, id, 'APPROVED', requestId); throw new UnprocessableEntityException(blocked); }
    if (inline) { const outcome = await this.quota.scope({ workspaceId, channelId: c.youtubeChannelId!, requestId }, () => runUpload(this.yt, id, requestId)); await this.audit.log({ workspaceId, userId, action: outcome.status === 'FAILED' ? 'YOUTUBE_UPLOAD_FAILED' : 'YOUTUBE_UPLOAD_COMPLETED', resourceType: 'contentItem', resourceId: id, after: outcome as unknown as Prisma.InputJsonValue, requestId }); if (outcome.status === 'UPLOADED') await this.checkProcessing(workspaceId, userId, id, requestId); return { outcome, content: await this.load(workspaceId, id) }; }
    const jobId = await this.queue.enqueueYtUpload(id, requestId);
    return { outcome: { status: 'QUEUED', jobId }, content: await this.load(workspaceId, id) };
  }
  async checkProcessing(workspaceId: string, userId: string | null, id: string, requestId: string) {
    const c = await this.load(workspaceId, id);
    try {
      const r = await this.quota.scope({ workspaceId, channelId: c.youtubeChannelId!, requestId }, () => checkProcessing(this.yt, id));
      if (r.state === 'READY') { await this.audit.log({ workspaceId, userId, action: c.youtubeMeta?.scheduledPublishAt ? 'YOUTUBE_VIDEO_SCHEDULED' : 'YOUTUBE_VIDEO_PUBLISHED', resourceType: 'contentItem', resourceId: id, after: { youtubeVideoId: c.externalPostId }, requestId }); if (c.externalPostId) { const v = await this.prisma.youTubeVideo.findFirst({ where: { channelId: c.youtubeChannelId!, youtubeVideoId: c.externalPostId }, select: { id: true } }); if (v) await this.queue.scheduleYtMetricCollection(v.id, requestId).catch(() => undefined); } }
      if (r.state === 'FAILED') await this.notifications.notify(workspaceId, { type: 'publish_failed', severity: 'bad', title: `YouTube ประมวลผลวิดีโอไม่สำเร็จ: ${c.youtubeMeta?.title ?? ''}`, body: r.detail, href: '/youtube/content', dedupeKey: `yt-proc:${id}` });
      return { ...r, content: await this.load(workspaceId, id) };
    } catch (e) { rethrowYt(e); }
  }

  // ---------- Cross-platform (§71, §75–76, §116) ----------
  /** YouTube → Facebook drafts (ContentItem platform FACEBOOK) + ContentRelation REPURPOSED_FROM */
  async repurposeToFacebook(workspaceId: string, userId: string, id: string, dto: RepurposeDto, requestId: string) {
    const c = await this.load(workspaceId, id);
    const page = await this.prisma.facebookPage.findFirst({ where: { id: dto.targetPageId, ...pageInWorkspace(workspaceId), disconnectedAt: null }, select: { id: true, name: true, brandId: true, brand: { select: { name: true, toneOfVoice: true, primaryCTA: true, preferredLanguage: true, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
    if (!page) throw new NotFoundException('ไม่พบเพจ Facebook');
    if (page.brandId !== c.youtubeChannel!.brand.id) throw new ConflictException('เพจกับช่องต้องอยู่แบรนด์เดียวกัน');
    const m = c.youtubeMeta!; const source = `ชื่อ: ${m.title ?? c.title}\nhook: ${m.hook ?? '-'}\nสคริปต์/สาระ: ${(m.script ?? m.description ?? '').slice(0, 4000)}${c.externalPostId ? `\nลิงก์วิดีโอ: https://www.youtube.com/watch?v=${c.externalPostId}` : ''}`;
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'content.repurpose', role: 'content', requestId, promptVersion: PV.repurpose, resourceType: 'contentItem', resourceId: id }, {
      system: `คุณคือ Content Repurposing Agent แปลงสาระจากวิดีโอ YouTube เป็นโพสต์ Facebook ${dto.count} แบบที่ต่างกัน (เช่น FAQ, teaser, ข้อคิด, ลิสต์เคล็ดลับ) ห้ามคัดลอกข้อความเดิม ปรับ hook/ความยาว/CTA/บรีฟภาพให้เหมาะ Facebook น้ำเสียง ${page.brand.toneOfVoice ?? 'เป็นกันเอง'} CTA ${page.brand.primaryCTA ?? '-'} ภาษา${page.brand.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย'} ใช้ข้อเท็จจริงจากแหล่งเท่านั้น hashtag แยกใน hashtags`,
      prompt: `ข้อมูลแบรนด์: ${page.brand.knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.slice(0, 200)}`).join(' | ') || '-'}\n\nแหล่ง (YouTube):\n${source}`,
      schemaDescription: `{ "posts": [{ "kind": "FAQ"|"TEASER"|"TIPS"|"QUOTE"|"STORY", "headline": string, "caption": string, "cta": string, "hashtags": string[], "mediaBrief": string, "contentPillar": string }] }`,
      validate: v => { const o = v as { posts?: Record<string, unknown>[] }; if (!Array.isArray(o.posts) || !o.posts.length) throw new Error('posts หาย'); return o.posts.filter(p => typeof p.caption === 'string' && p.caption); }, maxTokens: 6000,
    });
    const created = [];
    for (const p of out.result.data.slice(0, dto.count)) {
      const fb = await this.prisma.contentItem.create({ data: { platform: 'FACEBOOK', pageId: page.id, status: 'DRAFT', contentType: 'post', title: String(p.headline ?? '').slice(0, 200) || null, caption: String(p.caption), cta: String(p.cta ?? '') || null, hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]).map(h => h.replace(/^#/, '')).slice(0, 15) : [], mediaBrief: String(p.mediaBrief ?? '') || null, contentPillar: String(p.contentPillar ?? c.contentPillar ?? '') || null, createdById: userId, aiProvider: out.provider, aiModel: out.model, promptVersion: PV.repurpose, aiNotes: { repurposedFrom: id, kind: p.kind } as Prisma.InputJsonValue, revisions: { create: { version: 1, caption: String(p.caption), editedBy: 'ai', reason: 'repurposed from YouTube' } } }, select: { id: true, title: true } });
      await this.prisma.contentRelation.create({ data: { parentContentId: id, childContentId: fb.id, relationType: 'REPURPOSED_FROM' } });
      created.push(fb);
    }
    await this.audit.log({ workspaceId, userId, action: 'CONTENT_REPURPOSED', resourceType: 'contentItem', resourceId: id, after: { targetPageId: page.id, created: created.map(x => x.id), costUsd: out.costUsd }, requestId });
    return { created, page: { id: page.id, name: page.name }, costUsd: out.costUsd };
  }
  listInsights(workspaceId: string, brandId?: string) { return this.prisma.brandInsight.findMany({ where: { brand: { client: { workspaceId } }, ...(brandId && { brandId }), status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 50, include: { brand: { select: { id: true, name: true } } } }); }
  async setInsightStatus(workspaceId: string, id: string, status: string) { const r = await this.prisma.brandInsight.updateMany({ where: { id, brand: { client: { workspaceId } } }, data: { status } }); if (!r.count) throw new NotFoundException('ไม่พบ insight'); return { ok: true }; }
  /** ปฏิทินรวม (§65, §117) — ทุกแพลตฟอร์ม (Facebook / YouTube / เว็บ) */
  calendar(workspaceId: string, from: Date, to: Date, platform?: string) {
    return this.prisma.contentItem.findMany({ where: { ...contentInWorkspace(workspaceId), ...(platform && { platform }), OR: [{ scheduledAt: { gte: from, lte: to } }, { publishedAt: { gte: from, lte: to } }] }, orderBy: { scheduledAt: 'asc' }, select: { id: true, platform: true, status: true, ytStatus: true, title: true, caption: true, scheduledAt: true, scheduledTz: true, publishedAt: true, page: { select: { id: true, name: true } }, youtubeChannel: { select: { id: true, title: true } }, youtubeMeta: { select: { title: true, format: true } }, site: { select: { id: true, name: true } }, webMeta: { select: { title: true, wpLink: true } } } }).then(ser);
  }
}
