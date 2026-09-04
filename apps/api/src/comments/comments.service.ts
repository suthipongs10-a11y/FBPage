/**
 * Comment intelligence (§23, §24, §33): ซิงก์ → จำแนกด้วย Community agent → ตรวจลีด → ร่างตอบ → คนอนุมัติ/ส่ง (FULL_AUTO เท่านั้นที่ส่งเอง)
 */
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { pageInWorkspace } from '@fbpm/database';
import { CommentsPermissionError, syncComments, type FacebookService } from '@fbpm/facebook-core';
import { COMMENT_CLASSES, toolAllowedWithoutApproval, type CommentClass } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FACEBOOK } from '../facebook/facebook.provider';
import { SyncService } from '../facebook/sync.service';
import { AiGatewayService } from '../ai/gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ClassifyDto, InsightsDto, ListCommentsDto, ListLeadsDto, UpdateCommentDto, UpdateLeadDto } from './dto';

export const COMMUNITY_PROMPT_VERSION = 'community-v1';
const COMMENT_SELECT = {
  id: true, pageId: true, postId: true, facebookCommentId: true, parentCommentId: true, fromName: true, message: true, createdTime: true, permalink: true, classification: true, sentiment: true, riskFlag: true, aiSummary: true, draftReply: true, replyStatus: true, replyExternalId: true, repliedAt: true, resolvedAt: true, isHidden: true, createdAt: true,
  page: { select: { id: true, name: true, automationLevel: true, commentsStatus: true } }, post: { select: { id: true, message: true, permalink: true } }, lead: { select: { id: true, leadScore: true, status: true } },
} as const;
const LEAD_SELECT = { id: true, pageId: true, commentId: true, source: true, name: true, intent: true, product: true, service: true, quantity: true, requestedDate: true, location: true, budget: true, phone: true, urgency: true, leadScore: true, confidence: true, status: true, notes: true, createdAt: true, updatedAt: true, page: { select: { id: true, name: true } }, comment: { select: { message: true, fromName: true, permalink: true } } } as const;
const AUTO_REPLY_CLASSES: CommentClass[] = ['QUESTION', 'PRICE_QUERY', 'LOCATION_QUERY', 'SERVICE_QUERY', 'PRAISE'];

interface Classified { id: string; classification: CommentClass; sentiment: 'positive' | 'neutral' | 'negative'; risk: boolean; summary: string; draftReply: string | null; lead: { intent: string | null; product: string | null; service: string | null; quantity: string | null; requestedDate: string | null; location: string | null; budget: string | null; phone: string | null; urgency: string | null; leadScore: number; confidence: number } | null }
function validateBatch(v: unknown): Classified[] {
  const o = v as { comments?: unknown[] };
  if (!Array.isArray(o.comments)) throw new Error('comments ต้องเป็น array');
  return o.comments.map(raw => {
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== 'string') throw new Error('id หาย');
    if (!(COMMENT_CLASSES as readonly string[]).includes(c.classification as string)) throw new Error(`classification ไม่ถูกต้อง: ${String(c.classification)}`);
    const l = c.lead as Record<string, unknown> | null | undefined;
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : typeof x === 'number' ? String(x) : null);
    return { id: c.id, classification: c.classification as CommentClass, sentiment: (['positive', 'neutral', 'negative'].includes(c.sentiment as string) ? c.sentiment : 'neutral') as Classified['sentiment'], risk: c.risk === true, summary: String(c.summary ?? ''), draftReply: str(c.draftReply),
      lead: l && typeof l === 'object' && Number(l.leadScore) > 0 ? { intent: str(l.intent), product: str(l.product), service: str(l.service), quantity: str(l.quantity), requestedDate: str(l.requestedDate), location: str(l.location), budget: str(l.budget), phone: str(l.phone), urgency: str(l.urgency), leadScore: Math.max(0, Math.min(100, Math.round(Number(l.leadScore)))), confidence: Math.max(0, Math.min(1, Number(l.confidence ?? 0.5))) } : null };
  });
}

@Injectable()
export class CommentsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(FACEBOOK) private readonly fb: FacebookService, @Inject(SyncService) private readonly sync: SyncService, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  private async page(workspaceId: string, pageId: string) {
    const p = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, name: true, automationLevel: true, commentsStatus: true, brand: { select: { name: true, toneOfVoice: true, primaryCTA: true, preferredLanguage: true, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
    if (!p) throw new NotFoundException('ไม่พบเพจ');
    return p;
  }

  list(workspaceId: string, q: ListCommentsDto) {
    return this.prisma.pageComment.findMany({ where: { page: pageInWorkspace(workspaceId), ...(q.pageId && { pageId: q.pageId }), ...(q.classification && { classification: q.classification }), ...(q.replyStatus && { replyStatus: q.replyStatus }), ...(q.unresolved === '1' && { resolvedAt: null }), ...(q.unclassified === '1' && { classification: null }) }, orderBy: { createdTime: 'desc' }, take: q.limit ?? 200, select: COMMENT_SELECT });
  }

  async runSync(workspaceId: string, userId: string, pageId: string, days: number | undefined, requestId: string) {
    await this.page(workspaceId, pageId);
    const r = await syncComments(this.sync.deps, pageId, { days: days ?? 30 });
    await this.audit.log({ workspaceId, userId, action: 'comments.sync', resourceType: 'facebookPage', resourceId: pageId, after: r as unknown as Prisma.InputJsonValue, requestId });
    if (r.status === 'NO_PERMISSION') {
      await this.notifications.notify(workspaceId, { type: 'comments_permission', severity: 'warn', title: 'อ่านคอมเมนต์ไม่ได้ — token ยังไม่มีสิทธิ์ pages_read_user_content', body: 'ขอสิทธิ์เพิ่มใน Graph API Explorer/App Review แล้ววาง token ใหม่ที่หน้าเพจ', href: '/pages', dedupeKey: `comments_permission:${pageId}` });
      throw new UnprocessableEntityException(r.error ?? 'ไม่มีสิทธิ์อ่านคอมเมนต์');
    }
    if (r.status === 'ERROR') throw new UnprocessableEntityException(r.error ?? 'ซิงก์คอมเมนต์ไม่สำเร็จ');
    return r;
  }

  /** Community + Lead Detector: จำแนกเป็นชุด (สูงสุด 20/ครั้ง) → บันทึก classification/draft/lead; FULL_AUTO → ส่งตอบให้เองเฉพาะกลุ่มปลอดภัย */
  async classify(workspaceId: string, userId: string, dto: ClassifyDto, requestId: string) {
    const where: Prisma.PageCommentWhereInput = { page: pageInWorkspace(workspaceId), ...(dto?.pageId && { pageId: dto.pageId }), ...(dto?.commentIds ? { id: { in: dto.commentIds } } : { classification: null }) };
    const comments = await this.prisma.pageComment.findMany({ where, orderBy: { createdTime: 'desc' }, take: dto?.limit ?? 20, select: { id: true, pageId: true, fromName: true, message: true, parentCommentId: true, post: { select: { message: true } } } });
    if (!comments.length) return { classified: 0, leads: 0, autoReplied: 0, items: [] };
    const pageIds = [...new Set(comments.map(c => c.pageId))];
    const results: Classified[] = []; let leads = 0; let autoReplied = 0; let costUsd = 0;
    for (const pageId of pageIds) {
      const page = await this.page(workspaceId, pageId);
      const batch = comments.filter(c => c.pageId === pageId);
      const kb = page.brand.knowledge.map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 300)}`).join('\n');
      const out = await this.ai.structured({ workspaceId, userId, taskType: 'comments.classify', role: 'community', requestId, promptVersion: COMMUNITY_PROMPT_VERSION, resourceType: 'facebookPage', resourceId: pageId }, {
        system: `คุณคือ Community Manager + Lead Detector ของเพจ "${page.name}" (แบรนด์ ${page.brand.name}) น้ำเสียง: ${page.brand.toneOfVoice ?? 'สุภาพ เป็นกันเอง'} ภาษา ${page.brand.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย'}\nจำแนกคอมเมนต์เป็น ${COMMENT_CLASSES.join('|')} ประเมิน sentiment และ risk (true เมื่อเป็นข้อร้องเรียนรุนแรง/กฎหมาย/สุขภาพ/ดราม่า ต้องให้คนดู) เขียน draftReply สั้น สุภาพ ตามข้อมูลแบรนด์เท่านั้น ไม่มีข้อมูล (ราคา/เวลา/ที่อยู่) ให้ชวนทักแชท/ทิ้งเบอร์แทนการเดา SPAM ไม่ต้องร่างตอบ (null)\nlead: ใส่เมื่อมีเจตนาซื้อ/จอง/สอบถามบริการ leadScore 0-100 confidence 0-1 ห้ามแต่งข้อมูลติดต่อ ค่าที่ไม่รู้เป็น null\nข้อมูลแบรนด์:\n${kb || '(ยังไม่มี)'}\nCTA หลัก: ${page.brand.primaryCTA ?? '-'}`,
        prompt: `คอมเมนต์ ${batch.length} รายการ:\n${JSON.stringify(batch.map(c => ({ id: c.id, from: c.fromName, message: c.message, isReply: !!c.parentCommentId, post: (c.post?.message ?? '').slice(0, 160) })))}`,
        schemaDescription: `{ "comments": [{ "id": string, "classification": ${COMMENT_CLASSES.map(x => `"${x}"`).join('|')}, "sentiment": "positive"|"neutral"|"negative", "risk": boolean, "summary": string, "draftReply": string|null, "lead": null | { "intent": string|null, "product": string|null, "service": string|null, "quantity": string|null, "requestedDate": string|null, "location": string|null, "budget": string|null, "phone": string|null, "urgency": string|null, "leadScore": number, "confidence": number } }] }`,
        validate: validateBatch, maxTokens: 6000,
      });
      costUsd += out.costUsd ?? 0;
      for (const r of out.result.data) {
        const c = batch.find(x => x.id === r.id); if (!c) continue;
        results.push(r);
        await this.prisma.pageComment.update({ where: { id: c.id }, data: { classification: r.classification, sentiment: r.sentiment, riskFlag: r.risk, aiSummary: r.summary, ...(r.draftReply && { draftReply: r.draftReply, replyStatus: 'DRAFTED' }), ...(r.classification === 'SPAM' && { replyStatus: 'SKIPPED' }) } });
        if (r.lead && r.lead.leadScore >= 40) {
          const lead = await this.prisma.lead.upsert({ where: { commentId: c.id }, create: { workspaceId, pageId, commentId: c.id, name: c.fromName, ...r.lead, data: r as unknown as Prisma.InputJsonValue }, update: { ...r.lead, data: r as unknown as Prisma.InputJsonValue }, select: { id: true } });
          leads++;
          if (r.lead.leadScore >= 70) await this.notifications.notify(workspaceId, { type: 'hot_lead', severity: 'warn', title: `ลีดร้อน (${r.lead.leadScore}): ${c.fromName ?? 'ลูกค้า'} — ${r.lead.intent ?? r.lead.service ?? ''}`, body: (c.message ?? '').slice(0, 140), href: '/leads', resourceType: 'lead', resourceId: lead.id, dedupeKey: `lead:${lead.id}` });
        }
        // Level 4 เท่านั้น (§27): ตอบเองเฉพาะกลุ่มปลอดภัย ไม่มี risk
        if (r.draftReply && !r.risk && AUTO_REPLY_CLASSES.includes(r.classification) && toolAllowedWithoutApproval('PUBLISH', page.automationLevel)) {
          try { await this.sendReply(workspaceId, null, c.id, r.draftReply, requestId, true); autoReplied++; } catch { /* บันทึกเป็น FAILED แล้วใน sendReply */ }
        }
      }
    }
    await this.audit.log({ workspaceId, userId, action: 'comments.classify', resourceType: 'pageComment', after: { classified: results.length, leads, autoReplied, costUsd }, requestId });
    return { classified: results.length, leads, autoReplied, costUsd, items: await this.prisma.pageComment.findMany({ where: { id: { in: results.map(r => r.id) } }, select: COMMENT_SELECT }) };
  }

  async update(workspaceId: string, userId: string, id: string, dto: UpdateCommentDto, requestId: string) {
    const c = await this.prisma.pageComment.findFirst({ where: { id, page: pageInWorkspace(workspaceId) }, select: { id: true, replyStatus: true } });
    if (!c) throw new NotFoundException('ไม่พบคอมเมนต์');
    const out = await this.prisma.pageComment.update({ where: { id }, data: { ...(dto.draftReply !== undefined && { draftReply: dto.draftReply, replyStatus: dto.draftReply ? (c.replyStatus === 'SENT' ? 'SENT' : 'APPROVED') : 'NONE' }), ...(dto.resolved !== undefined && { resolvedAt: dto.resolved ? new Date() : null }), ...(dto.classification && { classification: dto.classification }) }, select: COMMENT_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'comments.update', resourceType: 'pageComment', resourceId: id, after: dto, requestId });
    return out;
  }

  /** ส่งคำตอบจริง — คนกดเอง (PUBLISH risk แต่เป็นการกระทำของมนุษย์) หรือ auto ใน FULL_AUTO */
  async sendReply(workspaceId: string, userId: string | null, id: string, message: string | undefined, requestId: string, auto = false) {
    const c = await this.prisma.pageComment.findFirst({ where: { id, page: pageInWorkspace(workspaceId) }, select: { id: true, pageId: true, facebookCommentId: true, draftReply: true, replyStatus: true, page: { select: { publishingPaused: true, brand: { select: { client: { select: { workspace: { select: { automationPaused: true } } } } } } } } } });
    if (!c) throw new NotFoundException('ไม่พบคอมเมนต์');
    if (c.replyStatus === 'SENT') throw new ConflictException('ตอบคอมเมนต์นี้ไปแล้ว');
    const text = (message ?? c.draftReply ?? '').trim();
    if (!text) throw new UnprocessableEntityException('ไม่มีข้อความตอบ');
    if (c.page.publishingPaused || c.page.brand.client.workspace.automationPaused) throw new ForbiddenException('การโพสต์ของเพจ/workspace ถูกหยุดไว้ (สวิตช์ฉุกเฉิน)');
    const { token } = await this.sync.pageToken(workspaceId, c.pageId);
    try {
      const r = await this.fb.replyToComment(c.facebookCommentId, token, text);
      const out = await this.prisma.pageComment.update({ where: { id }, data: { draftReply: text, replyStatus: 'SENT', replyExternalId: r.externalId, repliedAt: new Date(), resolvedAt: new Date() }, select: COMMENT_SELECT });
      await this.audit.log({ workspaceId, userId, action: auto ? 'comments.reply.auto' : 'comments.reply', resourceType: 'pageComment', resourceId: id, after: { externalId: r.externalId, text: text.slice(0, 200) }, requestId });
      return out;
    } catch (e) {
      const msg = e instanceof CommentsPermissionError ? 'ตอบไม่ได้ — token ต้องมีสิทธิ์ pages_manage_engagement' : e instanceof Error ? e.message : String(e);
      await this.prisma.pageComment.update({ where: { id }, data: { replyStatus: 'FAILED', aiSummary: msg.slice(0, 300) } });
      throw new UnprocessableEntityException(msg);
    }
  }

  async hide(workspaceId: string, userId: string, id: string, hidden: boolean, requestId: string) {
    const c = await this.prisma.pageComment.findFirst({ where: { id, page: pageInWorkspace(workspaceId) }, select: { id: true, pageId: true, facebookCommentId: true } });
    if (!c) throw new NotFoundException('ไม่พบคอมเมนต์');
    const { token } = await this.sync.pageToken(workspaceId, c.pageId);
    try { await this.fb.hideComment(c.facebookCommentId, token, hidden); } catch (e) { throw new UnprocessableEntityException(e instanceof CommentsPermissionError ? 'ซ่อนไม่ได้ — ต้องมีสิทธิ์ pages_manage_engagement' : (e as Error).message); }
    const out = await this.prisma.pageComment.update({ where: { id }, data: { isHidden: hidden, ...(hidden && { resolvedAt: new Date() }) }, select: COMMENT_SELECT });
    await this.audit.log({ workspaceId, userId, action: hidden ? 'comments.hide' : 'comments.unhide', resourceType: 'pageComment', resourceId: id, requestId });
    return out;
  }

  /** §33: สัดส่วนประเภทคำถาม → คำแนะนำคอนเทนต์ (กฎง่ายๆ ไม่ใช้ AI) */
  async insights(workspaceId: string, q: InsightsDto) {
    const since = new Date(Date.now() - q.days * 86_400_000);
    const rows = await this.prisma.pageComment.groupBy({ by: ['classification'], where: { page: pageInWorkspace(workspaceId), ...(q.pageId && { pageId: q.pageId }), createdTime: { gte: since }, classification: { not: null } }, _count: { _all: true } });
    const total = rows.reduce((n, r) => n + r._count._all, 0);
    const dist = rows.map(r => ({ classification: r.classification!, count: r._count._all, share: total ? Math.round((r._count._all / total) * 100) : 0 })).sort((a, b) => b.count - a.count);
    const pct = (k: string) => dist.find(d => d.classification === k)?.share ?? 0;
    const recommendations: string[] = [];
    if (pct('PRICE_QUERY') >= 25) recommendations.push('คำถามเรื่องราคาเกิน 25% — ทำโพสต์ FAQ ราคา/แพ็กเกจ และปักหมุด');
    if (pct('LOCATION_QUERY') >= 15) recommendations.push('มีคำถามพื้นที่ให้บริการบ่อย — ทำโพสต์แผนที่/พื้นที่ที่ไปถึง และเติมที่อยู่ในข้อมูลเพจ');
    if (pct('SERVICE_QUERY') >= 20) recommendations.push('คำถามเรื่องบริการเยอะ — ทำโพสต์อธิบายขั้นตอนบริการ/สิ่งที่รวมในราคา');
    if (pct('COMPLAINT') >= 10) recommendations.push('ข้อร้องเรียนเกิน 10% — ตอบเร็วและทบทวนคุณภาพบริการก่อนโปรโมทเพิ่ม');
    if (pct('SPAM') >= 30) recommendations.push('สแปมสูง — เปิดตัวกรองคำในหน้าเพจ และซ่อนคอมเมนต์สแปม');
    const [unresolved, drafted, leadsNew, unclassified] = await Promise.all([
      this.prisma.pageComment.count({ where: { page: pageInWorkspace(workspaceId), ...(q.pageId && { pageId: q.pageId }), resolvedAt: null, classification: { notIn: ['SPAM', 'PRAISE'] } } }),
      this.prisma.pageComment.count({ where: { page: pageInWorkspace(workspaceId), ...(q.pageId && { pageId: q.pageId }), replyStatus: { in: ['DRAFTED', 'APPROVED'] } } }),
      this.prisma.lead.count({ where: { workspaceId, ...(q.pageId && { pageId: q.pageId }), status: 'NEW' } }),
      this.prisma.pageComment.count({ where: { page: pageInWorkspace(workspaceId), ...(q.pageId && { pageId: q.pageId }), classification: null } }),
    ]);
    return { days: q.days, total, distribution: dist, recommendations, unresolved, drafted, leadsNew, unclassified };
  }

  // ---------- Leads ----------
  listLeads(workspaceId: string, q: ListLeadsDto) { return this.prisma.lead.findMany({ where: { workspaceId, ...(q.status && { status: q.status }), ...(q.pageId && { pageId: q.pageId }) }, orderBy: [{ status: 'asc' }, { leadScore: 'desc' }, { createdAt: 'desc' }], take: q.limit ?? 200, select: LEAD_SELECT }); }
  async updateLead(workspaceId: string, userId: string, id: string, dto: UpdateLeadDto, requestId: string) {
    const l = await this.prisma.lead.findFirst({ where: { id, workspaceId }, select: { id: true, status: true } });
    if (!l) throw new NotFoundException('ไม่พบลีด');
    const out = await this.prisma.lead.update({ where: { id }, data: dto, select: LEAD_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'leads.update', resourceType: 'lead', resourceId: id, before: { status: l.status }, after: dto, requestId });
    return out;
  }
}
