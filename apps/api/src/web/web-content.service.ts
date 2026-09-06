/**
 * W-3 Web content (AGENTS_WEB.md) — ContentItem platform=WEB ผูกกับ Site: AI Web Content Writer ร่างจากคลิป YouTube/โพสต์ FB/ข้อมูลแบรนด์/SEO ideas
 * → state machine เดิม (§28) → อนุมัติ (§29) → โพสต์ขึ้น WordPress แบบ idempotent (publisher ใน @fbpm/web-core) · ห้ามแก้เว็บลูกค้าโดยไม่ผ่านอนุมัติ
 * AI ผ่าน AiGatewayService เท่านั้น · Application Password เข้ารหัสด้วย common/crypto ไม่อยู่ใน select/response/audit
 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { contentInWorkspace, encryptSecret, siteInWorkspace } from '@fbpm/database';
import { canTransitionContent, type ContentStatus } from '@fbpm/shared';
import { publishWebContent, sanitizeArticleHtml, slugify, updatePublishedWebContent, verifyWordPress, webPublishBlockReason, type WebPublishDeps, type WebPublishOutcome } from '@fbpm/web-core';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../jobs/queue.service';
import { isValidTimeZone, localToUtc } from '../content/tz';
import { WEB_PUBLISH } from './web.provider';
import type { ConnectWpDto, CreateWebContentDto, GenerateWebContentDto, ListWebContentDto, UpdateWebContentDto } from './dto';

export const WEB_PV = { writer: 'web-content-writer-v1', review: 'web-content-reviewer-v1' };
const SELECT = {
  id: true, platform: true, siteId: true, status: true, contentType: true, title: true, objective: true, contentPillar: true, scheduledLocal: true, scheduledTz: true, scheduledAt: true, retryCount: true, createdById: true, aiProvider: true, aiModel: true, promptVersion: true, editedByHuman: true, externalPostId: true, publishedAt: true, aiNotes: true, reviewResult: true, lastError: true, createdAt: true, updatedAt: true,
  webMeta: true,
  site: { select: { id: true, name: true, url: true, platform: true, wpStatus: true, wpUserName: true, publishingPaused: true, disconnectedAt: true, brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } } } },
  approvals: { orderBy: { requestedAt: 'desc' as const }, take: 5, select: { id: true, status: true, requestedAt: true, reviewedAt: true, reviewerComment: true, requestedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } } },
  relationsTo: { select: { relationType: true, parent: { select: { id: true, platform: true, title: true, status: true } } } },
  _count: { select: { revisions: true } },
} as const;

@Injectable()
export class WebContentService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(WEB_PUBLISH) private readonly pub: WebPublishDeps, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService, @Inject(QueueService) private readonly queue: QueueService) {}

  private async load(workspaceId: string, id: string) {
    const c = await this.prisma.contentItem.findFirst({ where: { id, platform: 'WEB', ...contentInWorkspace(workspaceId) }, select: SELECT });
    if (!c) throw new NotFoundException('ไม่พบบทความ'); return c;
  }
  private async transition(workspaceId: string, userId: string | null, id: string, to: ContentStatus, requestId: string, extra: Prisma.ContentItemUpdateInput = {}, action = 'WEB_CONTENT_TRANSITION') {
    const c = await this.load(workspaceId, id);
    if (!canTransitionContent(c.status as ContentStatus, to)) throw new ConflictException(`เปลี่ยนสถานะจาก ${c.status} → ${to} ไม่ได้`);
    await this.prisma.contentItem.update({ where: { id }, data: { status: to, ...extra } });
    await this.audit.log({ workspaceId, userId, action, resourceType: 'contentItem', resourceId: id, before: { status: c.status }, after: { status: to }, requestId });
  }
  private async site(workspaceId: string, siteId: string) {
    const s = await this.prisma.site.findFirst({ where: { id: siteId, ...siteInWorkspace(workspaceId) }, select: { id: true, name: true, url: true, disconnectedAt: true, brandId: true, brand: { select: { id: true, name: true, industry: true, targetAudience: true, toneOfVoice: true, preferredLanguage: true, primaryCTA: true, website: true, serviceArea: true, client: { select: { name: true } }, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
    if (!s) throw new NotFoundException('ไม่พบเว็บไซต์'); return s;
  }

  list(workspaceId: string, q: ListWebContentDto) { return this.prisma.contentItem.findMany({ where: { platform: 'WEB', ...contentInWorkspace(workspaceId), ...(q.siteId && { siteId: q.siteId }), ...(q.status && { status: q.status }) }, orderBy: { updatedAt: 'desc' }, take: q.limit ?? 200, select: SELECT }); }
  get(workspaceId: string, id: string) { return this.load(workspaceId, id); }
  async summary(workspaceId: string) {
    const rows = await this.prisma.contentItem.groupBy({ by: ['status'], where: { platform: 'WEB', ...contentInWorkspace(workspaceId) }, _count: { _all: true } });
    const n = (...st: string[]) => rows.filter(r => st.includes(r.status)).reduce((a, r) => a + r._count._all, 0);
    return { total: n(...rows.map(r => r.status)), drafts: n('DRAFT', 'NEEDS_REVISION', 'AI_REVIEW'), pendingApproval: n('READY_FOR_APPROVAL'), approved: n('APPROVED', 'SCHEDULED'), published: n('PUBLISHED', 'ANALYZED'), failed: n('PUBLISH_FAILED'), wordpressConnected: await this.prisma.site.count({ where: { ...siteInWorkspace(workspaceId), disconnectedAt: null, wpStatus: 'OK' } }) };
  }

  async create(workspaceId: string, userId: string, dto: CreateWebContentDto, requestId: string) {
    const s = await this.site(workspaceId, dto.siteId); if (s.disconnectedAt) throw new ForbiddenException('เว็บไซต์นี้ถูกปิดการดูแลแล้ว');
    const { siteId, topic, objective, contentPillar, ...meta } = dto;
    const c = await this.prisma.contentItem.create({ data: { platform: 'WEB', siteId, status: 'DRAFT', contentType: 'ARTICLE', title: meta.title ?? topic ?? null, objective, contentPillar, createdById: userId, aiNotes: topic ? ({ topic } as Prisma.InputJsonValue) : undefined, webMeta: { create: { ...meta, bodyHtml: meta.bodyHtml ? sanitizeArticleHtml(meta.bodyHtml) : undefined, tags: meta.tags ?? [], categories: meta.categories ?? [], sources: { topic: topic ?? null } as Prisma.InputJsonValue } }, ...(meta.bodyHtml && { revisions: { create: { version: 1, caption: meta.bodyHtml, editedBy: userId, reason: 'created' } } }) }, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: 'WEB_CONTENT_CREATED', resourceType: 'contentItem', resourceId: c.id, after: { siteId, title: dto.title ?? topic }, requestId });
    return this.load(workspaceId, c.id);
  }
  /** แก้โดยคน (§55) — เนื้อหาเปลี่ยนหลังส่ง/อนุมัติ → กลับ DRAFT ขออนุมัติใหม่ */
  async update(workspaceId: string, userId: string, id: string, dto: UpdateWebContentDto, requestId: string) {
    const c = await this.load(workspaceId, id);
    if (['PUBLISHING', 'PUBLISHED', 'ANALYZED', 'CANCELLED'].includes(c.status)) throw new ConflictException(`แก้ไขบทความสถานะ ${c.status} ไม่ได้ — บทความที่เผยแพร่แล้วใช้ "อัปเดตบน WordPress"`);
    const { internalTitle, reason, objective, contentPillar, ...meta } = dto;
    if (meta.bodyHtml !== undefined) meta.bodyHtml = sanitizeArticleHtml(meta.bodyHtml);
    const bodyChanged = meta.bodyHtml !== undefined && meta.bodyHtml !== (c.webMeta?.bodyHtml ?? '');
    const contentChanged = bodyChanged || (meta.title !== undefined && meta.title !== c.webMeta?.title) || (meta.slug !== undefined && meta.slug !== c.webMeta?.slug);
    const backToDraft = ['APPROVED', 'SCHEDULED', 'READY_FOR_APPROVAL', 'PUBLISH_FAILED'].includes(c.status) && contentChanged;
    if (backToDraft && c.status === 'SCHEDULED') await this.queue.cancelWebPublish(id);
    if (backToDraft) await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await this.prisma.contentItem.update({ where: { id }, data: { editedByHuman: true, ...(internalTitle !== undefined && { title: internalTitle }), ...(meta.title !== undefined && internalTitle === undefined && { title: meta.title }), ...(objective !== undefined && { objective }), ...(contentPillar !== undefined && { contentPillar }), ...(backToDraft && { status: 'DRAFT', scheduledAt: null, scheduledLocal: null, scheduledTz: null, reviewResult: undefined }), ...(bodyChanged && { revisions: { create: { version: c._count.revisions + 1, caption: meta.bodyHtml ?? null, editedBy: userId, reason: reason ?? 'human edit' } } }), webMeta: { upsert: { create: { ...meta, tags: meta.tags ?? [], categories: meta.categories ?? [] }, update: meta } } } });
    await this.audit.log({ workspaceId, userId, action: 'WEB_CONTENT_UPDATED', resourceType: 'contentItem', resourceId: id, after: { fields: Object.keys(dto), backToDraft }, requestId });
    return this.load(workspaceId, id);
  }

  /** Web Content Writer (AI) — ใช้ข้อเท็จจริงจากแหล่งที่เลือก + ข้อมูลแบรนด์เท่านั้น ส่วนที่ขาดใส่ missingInfo ห้ามเดา */
  async generate(workspaceId: string, userId: string, id: string, dto: GenerateWebContentDto, requestId: string) {
    const c = await this.load(workspaceId, id); const s = await this.site(workspaceId, c.siteId!); const b = s.brand;
    const ytIds = dto?.youtubeContentIds ?? []; const fbIds = dto?.facebookPostIds ?? [];
    const [yt, fb, analysis, search] = await Promise.all([
      ytIds.length ? this.prisma.contentItem.findMany({ where: { id: { in: ytIds }, platform: 'YOUTUBE', youtubeChannel: { brandId: s.brandId } }, select: { id: true, title: true, externalPostId: true, youtubeMeta: { select: { title: true, description: true, script: true, hook: true } } } }) : [],
      fbIds.length ? this.prisma.facebookPost.findMany({ where: { id: { in: fbIds }, page: { brandId: s.brandId } }, select: { id: true, message: true, permalink: true, publishedAt: true } }) : [],
      this.prisma.siteAnalysis.findFirst({ where: { siteId: s.id }, orderBy: { createdAt: 'desc' }, select: { result: true } }),
      this.prisma.searchSnapshot.findMany({ where: { siteId: s.id }, orderBy: { date: 'desc' }, take: 28, select: { topQueries: true } }),
    ]);
    if (ytIds.length && yt.length !== ytIds.length) throw new NotFoundException('บางคลิป YouTube ไม่พบหรือไม่ได้อยู่แบรนด์เดียวกับเว็บ');
    if (fbIds.length && fb.length !== fbIds.length) throw new NotFoundException('บางโพสต์ Facebook ไม่พบหรือไม่ได้อยู่แบรนด์เดียวกับเว็บ');
    const queries = new Map<string, number>(); for (const row of search) for (const q of ((row.topQueries as { keys?: string[]; clicks?: number }[] | null) ?? [])) { const k = q.keys?.[0]; if (k) queries.set(k, (queries.get(k) ?? 0) + (q.clicks ?? 0)); }
    const topQueries = [...queries.entries()].sort((a, z) => z[1] - a[1]).slice(0, 15).map(([q, n]) => `${q} (${n} คลิก)`);
    const ideas = ((analysis?.result as { contentIdeas?: { topic: string; targetQuery: string | null; why: string }[] } | null)?.contentIdeas ?? []).slice(0, 8);
    const prohibited = b.knowledge.filter(k => k.type === 'prohibited_claim'); const topic = dto?.topic ?? c.title ?? (c.aiNotes as { topic?: string } | null)?.topic ?? c.webMeta?.title ?? '';
    if (!topic && !yt.length && !fb.length) throw new BadRequestException('ต้องมีหัวข้อ หรือเลือกคลิป/โพสต์ต้นทางอย่างน้อย 1 อย่าง');
    const words = dto?.wordCount ?? 900; const lang = b.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย';
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'web.content.write', role: 'content', requestId, promptVersion: WEB_PV.writer, resourceType: 'contentItem', resourceId: id }, {
      system: `คุณคือ Web Content Writer ของเอเจนซี่ เขียนบทความสำหรับเว็บไซต์ลูกค้า (WordPress) ภาษา${lang} น้ำเสียง ${b.toneOfVoice ?? 'มืออาชีพ เป็นกันเอง'} ความยาวประมาณ ${words} คำ โครงสร้าง: บทนำที่ตอบคำถามผู้อ่านทันที → หัวข้อย่อย h2/h3 → สรุป + CTA "${b.primaryCTA ?? 'ติดต่อเรา'}". ใช้ข้อเท็จจริงจากแหล่งที่ให้และข้อมูลแบรนด์เท่านั้น ห้ามแต่งราคา/โปร/เบอร์/ที่อยู่/สถิติ/รีวิว ถ้าจำเป็นให้เว้นเป็น [ต้องยืนยัน: ...] และใส่ใน missingInfo ห้ามคัดลอกสคริปต์/โพสต์คำต่อคำ (เขียนใหม่ให้เหมาะกับการอ่านบนเว็บ) ห้ามอ้างอันดับ/ปริมาณค้นหา SEO: ใช้คำค้นเป้าหมายอย่างเป็นธรรมชาติในชื่อ/บทนำ/หัวข้อย่อย 1–2 ครั้ง ไม่ยัดคำ bodyHtml เป็น HTML สะอาด (p, h2, h3, ul/ol/li, strong, a, blockquote เท่านั้น ห้าม script/style/iframe) ไม่ใส่ h1 (WordPress ใส่ให้จากชื่อเรื่อง)`,
      prompt: [`เว็บ ${s.name} (${s.url}) · ลูกค้า ${b.client.name} / แบรนด์ ${b.name} (${b.industry ?? '-'}) · กลุ่มเป้าหมาย ${b.targetAudience ?? '-'} · พื้นที่ ${b.serviceArea ?? '-'}`,
        b.knowledge.length ? `ข้อมูลแบรนด์ (ใช้ได้เฉพาะที่ระบุ):\n${b.knowledge.filter(k => k.type !== 'prohibited_claim').map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 400)}`).join('\n')}` : 'ข้อมูลแบรนด์: ยังไม่ได้กรอก — ห้ามแต่งข้อมูลธุรกิจใด ๆ',
        prohibited.length ? `ข้อห้ามกล่าวอ้าง:\n${prohibited.map(k => `- ${k.title}: ${k.content}`).join('\n')}` : 'ข้อห้ามทั่วไป: ห้ามอ้างผลทางการแพทย์/กฎหมาย/การเงิน ห้ามสัญญาผลลัพธ์',
        `หัวข้อ: ${topic || '(ให้ตั้งจากแหล่ง)'}${dto?.targetQuery ? ` · คำค้นเป้าหมาย: ${dto.targetQuery}` : c.webMeta?.targetQuery ? ` · คำค้นเป้าหมาย: ${c.webMeta.targetQuery}` : ''}${dto?.notes ? `\nโน้ต: ${dto.notes}` : ''}`,
        yt.length ? `แหล่ง YouTube (เขียนใหม่ ห้ามคัดลอก):\n${yt.map(v => `- "${v.youtubeMeta?.title ?? v.title}"${v.externalPostId ? ` https://www.youtube.com/watch?v=${v.externalPostId}` : ''}\n  hook: ${v.youtubeMeta?.hook ?? '-'}\n  สาระ: ${(v.youtubeMeta?.script ?? v.youtubeMeta?.description ?? '').slice(0, 3500)}`).join('\n')}` : '',
        fb.length ? `แหล่ง Facebook:\n${fb.map(p => `- ${(p.message ?? '').slice(0, 1200)}${p.permalink ? ` (${p.permalink})` : ''}`).join('\n')}` : '',
        topQueries.length ? `คำค้นที่พาคนเข้าเว็บ 28 วัน (Search Console): ${topQueries.join(' | ')}` : 'ยังไม่มีข้อมูล Search Console — ห้ามอ้างคำค้นจริง',
        ideas.length ? `ไอเดียจาก SEO Analyst: ${ideas.map(i => `${i.topic}${i.targetQuery ? ` [${i.targetQuery}]` : ''}`).join(' | ')}` : ''].filter(Boolean).join('\n\n').slice(0, 16000),
      schemaDescription: `{ "title": string, "slug": string, "excerpt": string, "metaTitle": string, "metaDescription": string, "targetQuery": string|null, "outline": [{ "heading": string, "points": string[] }], "bodyHtml": string, "tags": string[], "categories": string[], "internalLinkIdeas": string[], "missingInfo": string[], "aiInterpretation": string[] }`,
      validate: v => { const o = v as Record<string, unknown>; if (typeof o.bodyHtml !== 'string' || o.bodyHtml.length < 200) throw new Error('bodyHtml สั้นเกินไป'); if (typeof o.title !== 'string' || !o.title) throw new Error('title หาย'); return { title: String(o.title).slice(0, 200), slug: String(o.slug ?? '').slice(0, 120), excerpt: String(o.excerpt ?? '').slice(0, 500), metaTitle: String(o.metaTitle ?? o.title).slice(0, 120), metaDescription: String(o.metaDescription ?? '').slice(0, 320), targetQuery: o.targetQuery ? String(o.targetQuery).slice(0, 200) : null, outline: Array.isArray(o.outline) ? o.outline : [], bodyHtml: sanitizeArticleHtml(String(o.bodyHtml)), tags: Array.isArray(o.tags) ? o.tags.map(String).slice(0, 15) : [], categories: Array.isArray(o.categories) ? o.categories.map(String).slice(0, 5) : [], internalLinkIdeas: Array.isArray(o.internalLinkIdeas) ? o.internalLinkIdeas.map(String) : [], missingInfo: Array.isArray(o.missingInfo) ? o.missingInfo.map(String) : [], aiInterpretation: Array.isArray(o.aiInterpretation) ? o.aiInterpretation.map(String) : [] }; }, maxTokens: 9000,
    });
    const r = out.result.data; const slug = slugify(r.slug || r.title);
    await this.prisma.contentItem.update({ where: { id }, data: { title: c.title ?? r.title, aiProvider: out.provider, aiModel: out.model, promptVersion: WEB_PV.writer, aiNotes: { ...((c.aiNotes as object) ?? {}), topic, missingInfo: r.missingInfo, aiInterpretation: r.aiInterpretation, internalLinkIdeas: r.internalLinkIdeas, needsHumanInput: r.missingInfo.length > 0 } as Prisma.InputJsonValue, revisions: { create: { version: c._count.revisions + 1, caption: r.bodyHtml, editedBy: 'ai', reason: 'ai draft' } }, webMeta: { upsert: { create: { title: r.title, slug, excerpt: r.excerpt, metaTitle: r.metaTitle, metaDescription: r.metaDescription, targetQuery: r.targetQuery, outline: r.outline as Prisma.InputJsonValue, bodyHtml: r.bodyHtml, tags: r.tags, categories: r.categories, sources: { youtubeContentIds: ytIds, facebookPostIds: fbIds, topic } as Prisma.InputJsonValue }, update: { title: r.title, slug, excerpt: r.excerpt, metaTitle: r.metaTitle, metaDescription: r.metaDescription, targetQuery: r.targetQuery, outline: r.outline as Prisma.InputJsonValue, bodyHtml: r.bodyHtml, tags: r.tags, categories: r.categories, sources: { youtubeContentIds: ytIds, facebookPostIds: fbIds, topic } as Prisma.InputJsonValue } } } } });
    for (const v of yt) await this.prisma.contentRelation.upsert({ where: { parentContentId_childContentId_relationType: { parentContentId: v.id, childContentId: id, relationType: 'REPURPOSED_FROM' } }, create: { parentContentId: v.id, childContentId: id, relationType: 'REPURPOSED_FROM' }, update: {} });
    if (['IDEA', 'PLANNED'].includes(c.status)) await this.transition(workspaceId, userId, id, 'DRAFT', requestId);
    if (['NEEDS_REVISION', 'REJECTED'].includes(c.status)) await this.transition(workspaceId, userId, id, 'DRAFT', requestId);
    await this.audit.log({ workspaceId, userId, action: 'WEB_CONTENT_GENERATED', resourceType: 'contentItem', resourceId: id, after: { costUsd: out.costUsd, model: out.model, missingInfo: r.missingInfo.length, sources: { yt: ytIds.length, fb: fbIds.length } }, requestId });
    return { ...(await this.load(workspaceId, id)), costUsd: out.costUsd };
  }

  // ---------- Review / approval (§25, §29) ----------
  private async review(workspaceId: string, userId: string, id: string, requestId: string) {
    try { await this.ai.resolve(workspaceId, 'fast'); } catch { return null; }
    const c = await this.load(workspaceId, id); const s = await this.site(workspaceId, c.siteId!); const m = c.webMeta!;
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'web.content.review', role: 'fast', requestId, promptVersion: WEB_PV.review, resourceType: 'contentItem', resourceId: id }, {
      system: 'คุณคือ Reviewer ตรวจบทความเว็บก่อนเผยแพร่: ข้อเท็จจริงต้องมาจากข้อมูลแบรนด์/แหล่ง, ข้อห้ามกล่าวอ้าง, ราคา/เบอร์/ที่อยู่ที่ไม่มีในข้อมูลแบรนด์ = BLOCKED, มี [ต้องยืนยัน] ค้าง = NEEDS_REVISION, ชื่อเรื่องตรงเนื้อหา, ภาษา, CTA, HTML ไม่มี script. PASS เมื่อพร้อม',
      prompt: `ข้อมูลแบรนด์: ${s.brand.knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.slice(0, 200)}`).join(' | ') || '-'}\n\nชื่อ: ${m.title}\nmeta: ${m.metaDescription ?? '-'}\nเนื้อหา: ${(m.bodyHtml ?? '').slice(0, 6000)}`,
      schemaDescription: `{ "result": "PASS"|"NEEDS_REVISION"|"BLOCKED", "summary": string, "issues": [{ "type": string, "detail": string, "severity": "low"|"medium"|"high" }] }`,
      validate: v => { const o = v as { result?: string; summary?: string; issues?: { type?: string; detail?: string; severity?: string }[] }; if (!['PASS', 'NEEDS_REVISION', 'BLOCKED'].includes(o.result ?? '')) throw new Error('result ไม่ถูกต้อง'); return { result: o.result!, summary: String(o.summary ?? ''), issues: (o.issues ?? []).map(i => ({ type: String(i.type ?? 'other'), detail: String(i.detail ?? ''), severity: ['low', 'medium', 'high'].includes(i.severity ?? '') ? i.severity! : 'medium' })) }; }, maxTokens: 2000,
    });
    return out.result.data;
  }
  async submit(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id); const m = c.webMeta;
    if (!m?.title || !m.bodyHtml) throw new UnprocessableEntityException('ต้องมีชื่อเรื่องและเนื้อหาก่อนส่งขออนุมัติ');
    if (!['DRAFT', 'NEEDS_REVISION', 'IDEA', 'PLANNED'].includes(c.status)) throw new ConflictException(`สถานะ ${c.status} ส่งอนุมัติไม่ได้`);
    if (c.status !== 'DRAFT') await this.transition(workspaceId, userId, id, 'DRAFT', requestId);
    const pending = m.bodyHtml.includes('[ต้องยืนยัน') ? ((c.aiNotes as { missingInfo?: string[] } | null)?.missingInfo ?? ['มีข้อความ [ต้องยืนยัน] ค้างในบทความ']) : [];
    let review: { result: string; summary: string; issues: { type: string; detail: string; severity: string }[] } | null = null;
    try { review = await this.review(workspaceId, userId, id, requestId); } catch (e) { review = { result: 'SKIPPED', summary: `ข้ามการตรวจโดย AI: ${e instanceof Error ? e.message : String(e)}`, issues: [] }; }
    if (pending.length) review = { result: 'NEEDS_REVISION', summary: 'ยังมีข้อความ [ต้องยืนยัน] ค้างในบทความ', issues: [...pending.map(d => ({ type: 'missing_info', detail: d, severity: 'high' })), ...(review?.issues ?? [])] };
    if (review && (review.result === 'NEEDS_REVISION' || review.result === 'BLOCKED')) {
      await this.transition(workspaceId, userId, id, 'AI_REVIEW', requestId, { reviewResult: review as unknown as Prisma.InputJsonValue }, 'WEB_CONTENT_REVIEWED');
      await this.transition(workspaceId, userId, id, 'NEEDS_REVISION', requestId, {}, 'WEB_CONTENT_REVIEWED');
      return this.load(workspaceId, id);
    }
    await this.transition(workspaceId, userId, id, 'READY_FOR_APPROVAL', requestId, { reviewResult: (review ?? { result: 'SKIPPED', issues: [] }) as unknown as Prisma.InputJsonValue }, 'WEB_CONTENT_SUBMITTED');
    await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await this.prisma.approvalRequest.create({ data: { workspaceId, resourceType: 'contentItem', resourceId: id, contentId: id, requestedById: userId } });
    await this.notifications.notify(workspaceId, { type: 'approval_required', severity: 'warn', title: `รออนุมัติ (บทความเว็บ): ${m.title}`, body: `เว็บ ${c.site!.name}`, href: '/web/content', resourceType: 'contentItem', resourceId: id, dedupeKey: `approval:${id}` });
    return this.load(workspaceId, id);
  }
  private async decide(workspaceId: string, userId: string, id: string, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED', comment: string | undefined, requestId: string) {
    const c = await this.load(workspaceId, id); if (c.status !== 'READY_FOR_APPROVAL') throw new ConflictException('บทความนี้ไม่ได้อยู่ในคิวรออนุมัติ');
    await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: decision, reviewedById: userId, reviewedAt: new Date(), reviewerComment: comment ?? null } });
    await this.transition(workspaceId, userId, id, decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'NEEDS_REVISION', requestId, {}, `WEB_CONTENT_${decision}`);
    return this.load(workspaceId, id);
  }
  approve(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'APPROVED', comment, rid); }
  reject(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'REJECTED', comment, rid); }
  requestChanges(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'CHANGES_REQUESTED', comment, rid); }
  async reopen(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id);
    if (c.status === 'SCHEDULED') { await this.queue.cancelWebPublish(id); await this.transition(workspaceId, userId, id, 'APPROVED', requestId, { scheduledAt: null, scheduledLocal: null, scheduledTz: null }); return this.load(workspaceId, id); }
    if (c.status === 'PUBLISH_FAILED') { await this.transition(workspaceId, userId, id, 'APPROVED', requestId); return this.load(workspaceId, id); }
    await this.transition(workspaceId, userId, id, 'DRAFT', requestId, {}, 'WEB_CONTENT_REOPENED'); return this.load(workspaceId, id);
  }
  async cancel(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id); if (c.status === 'SCHEDULED') await this.queue.cancelWebPublish(id);
    await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await this.transition(workspaceId, userId, id, 'CANCELLED', requestId, {}, 'WEB_CONTENT_CANCELLED'); return this.load(workspaceId, id);
  }

  // ---------- Publish (§47–48) ----------
  async schedule(workspaceId: string, userId: string, id: string, dto: { scheduledLocal: string; timezone?: string }, requestId: string) {
    const c = await this.load(workspaceId, id);
    const tz = dto.timezone ?? (await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } })).timezone;
    if (!isValidTimeZone(tz)) throw new BadRequestException('เขตเวลาไม่ถูกต้อง');
    const at = localToUtc(dto.scheduledLocal, tz); const mins = (at.getTime() - Date.now()) / 60_000;
    if (mins < 10 || mins > 90 * 1440) throw new BadRequestException('ตั้งเวลาต้องล่วงหน้า 10 นาที ถึง 90 วัน');
    const blocked = await webPublishBlockReason(this.pub, id); if (blocked && !blocked.startsWith('สถานะ')) throw new UnprocessableEntityException(blocked);
    if (c.status === 'PUBLISH_FAILED' || c.status === 'SCHEDULED') await this.transition(workspaceId, userId, id, 'APPROVED', requestId);
    await this.transition(workspaceId, userId, id, 'SCHEDULED', requestId, { scheduledLocal: dto.scheduledLocal, scheduledTz: tz, scheduledAt: at, lastError: null }, 'WEB_CONTENT_SCHEDULED');
    const jobId = await this.queue.scheduleWebPublish(id, at, requestId);
    await this.audit.log({ workspaceId, userId, action: 'WEB_CONTENT_SCHEDULE_JOB', resourceType: 'contentItem', resourceId: id, after: { jobId, scheduledAt: at, tz }, requestId });
    return this.load(workspaceId, id);
  }
  async publishNow(workspaceId: string, userId: string, id: string, asDraft: boolean, requestId: string): Promise<{ outcome: WebPublishOutcome; content: Awaited<ReturnType<WebContentService['load']>> }> {
    const c = await this.load(workspaceId, id);
    if (!['APPROVED', 'PUBLISH_FAILED', 'SCHEDULED'].includes(c.status)) throw new ConflictException('ต้องอนุมัติก่อนจึงโพสต์ขึ้นเว็บได้');
    if (c.status === 'SCHEDULED') await this.queue.cancelWebPublish(id);
    const outcome = await publishWebContent(this.pub, id, { requestId, asDraft });
    await this.audit.log({ workspaceId, userId, action: 'WEB_CONTENT_PUBLISH', resourceType: 'contentItem', resourceId: id, after: outcome as unknown as Prisma.InputJsonValue, requestId });
    if (outcome.status === 'FAILED') await this.notifications.notify(workspaceId, { type: 'publish_failed', severity: 'bad', title: `โพสต์ขึ้นเว็บไม่สำเร็จ: ${c.webMeta?.title ?? ''}`, body: outcome.error, href: '/web/content', resourceType: 'contentItem', resourceId: id, dedupeKey: `webpublish_failed:${id}` });
    if (outcome.status === 'SKIPPED') throw new UnprocessableEntityException(outcome.reason);
    return { outcome, content: await this.load(workspaceId, id) };
  }
  async updatePublished(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id); if (c.status !== 'PUBLISHED' && c.status !== 'ANALYZED') throw new ConflictException('ใช้ได้กับบทความที่เผยแพร่แล้วเท่านั้น');
    const outcome = await updatePublishedWebContent(this.pub, id);
    await this.audit.log({ workspaceId, userId, action: 'WEB_CONTENT_WP_UPDATED', resourceType: 'contentItem', resourceId: id, after: outcome as unknown as Prisma.InputJsonValue, requestId });
    if (outcome.status !== 'PUBLISHED') throw new UnprocessableEntityException(outcome.status === 'SKIPPED' ? outcome.reason : outcome.error);
    return { outcome, content: await this.load(workspaceId, id) };
  }
  async jobState(workspaceId: string, id: string) { await this.load(workspaceId, id); return this.queue.webPublishJobState(id); }

  // ---------- WordPress connection ----------
  async connectWordPress(workspaceId: string, userId: string, siteId: string, dto: ConnectWpDto, requestId: string) {
    const s = await this.site(workspaceId, siteId); if (s.disconnectedAt) throw new ForbiddenException('เว็บไซต์นี้ถูกปิดการดูแลแล้ว');
    if (!s.url.startsWith('https://') && !this.pub.wpAllowInsecure) throw new BadRequestException('เชื่อม WordPress ได้เฉพาะเว็บ https:// (รหัสผ่านถูกส่งใน header)');
    await this.prisma.site.update({ where: { id: siteId }, data: { wpUsername: dto.username, wpAppPasswordEnc: encryptSecret(dto.appPassword, this.pub.authSecret), wpStatus: 'UNKNOWN', wpLastError: null } });
    const v = await verifyWordPress(this.pub, siteId);
    await this.audit.log({ workspaceId, userId, action: v.status === 'OK' ? 'WEB_WP_CONNECTED' : 'WEB_WP_CONNECT_FAILED', resourceType: 'site', resourceId: siteId, after: { username: dto.username, status: v.status, userName: v.userName, roles: v.roles }, requestId });
    if (v.status !== 'OK') throw new UnprocessableEntityException(v.error ?? 'เชื่อม WordPress ไม่สำเร็จ');
    return { status: v.status, userName: v.userName, roles: v.roles };
  }
  async verifyWp(workspaceId: string, siteId: string) { await this.site(workspaceId, siteId); return verifyWordPress(this.pub, siteId); }
  async disconnectWordPress(workspaceId: string, userId: string, siteId: string, requestId: string) {
    await this.site(workspaceId, siteId);
    await this.prisma.site.update({ where: { id: siteId }, data: { wpUsername: null, wpAppPasswordEnc: null, wpStatus: 'UNKNOWN', wpUserName: null, wpLastError: null } });
    await this.audit.log({ workspaceId, userId, action: 'WEB_WP_DISCONNECTED', resourceType: 'site', resourceId: siteId, requestId });
    return { ok: true };
  }
  /** แหล่งที่เลือกได้สำหรับร่างบทความ: คลิป YouTube และโพสต์ FB ล่าสุดของแบรนด์เดียวกับเว็บ */
  async sources(workspaceId: string, siteId: string) {
    const s = await this.site(workspaceId, siteId);
    const [yt, fb] = await Promise.all([
      this.prisma.contentItem.findMany({ where: { platform: 'YOUTUBE', youtubeChannel: { brandId: s.brandId }, youtubeMeta: { isNot: null } }, orderBy: { updatedAt: 'desc' }, take: 30, select: { id: true, title: true, status: true, externalPostId: true, youtubeMeta: { select: { title: true } } } }),
      this.prisma.facebookPost.findMany({ where: { page: { brandId: s.brandId } }, orderBy: { publishedAt: 'desc' }, take: 30, select: { id: true, message: true, publishedAt: true, permalink: true } }),
    ]);
    return { youtube: yt.map(v => ({ id: v.id, title: v.youtubeMeta?.title ?? v.title, status: v.status, videoId: v.externalPostId })), facebook: fb.map(p => ({ id: p.id, message: (p.message ?? '').slice(0, 140), publishedAt: p.publishedAt, permalink: p.permalink })) };
  }
}
