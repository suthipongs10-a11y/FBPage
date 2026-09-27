/**
 * Comment intelligence (§23, §24, §33): ซิงก์ → จำแนกด้วย Community agent → ตรวจลีด → ร่างตอบ → คนอนุมัติ/ส่ง (FULL_AUTO เท่านั้นที่ส่งเอง)
 */
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { pageInWorkspace } from '@fbpm/database';
import { CommentsPermissionError, MessagingPermissionError, syncComments, type FacebookService } from '@fbpm/facebook-core';
import { COMMENT_CLASSES, toolAllowedWithoutApproval, type CommentClass } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FACEBOOK } from '../facebook/facebook.provider';
import { SyncService } from '../facebook/sync.service';
import { AiGatewayService } from '../ai/gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ClassifyDto, CommentAutomationDto, InsightsDto, ListCommentsDto, ListLeadsDto, PrivateReplyDto, UpdateCommentDto, UpdateLeadDto } from './dto';

export const COMMUNITY_PROMPT_VERSION = 'community-v1';
const COMMENT_SELECT = {
  id: true, pageId: true, postId: true, facebookCommentId: true, parentCommentId: true, fromName: true, message: true, createdTime: true, permalink: true, classification: true, sentiment: true, riskFlag: true, aiSummary: true, draftReply: true, replyStatus: true, replyExternalId: true, repliedAt: true, resolvedAt: true, isHidden: true, createdAt: true, fromId: true,
  likedAt: true, privateReplyText: true, privateReplyStatus: true, privateReplyAt: true, privateReplyError: true, autoHandledAt: true,
  page: { select: { id: true, name: true, automationLevel: true, commentsStatus: true } }, post: { select: { id: true, message: true, permalink: true } }, lead: { select: { id: true, leadScore: true, status: true } },
} as const;
const LEAD_SELECT = { id: true, pageId: true, commentId: true, source: true, name: true, intent: true, product: true, service: true, quantity: true, requestedDate: true, location: true, budget: true, phone: true, urgency: true, leadScore: true, confidence: true, status: true, notes: true, createdAt: true, updatedAt: true, page: { select: { id: true, name: true } }, comment: { select: { message: true, fromName: true, permalink: true } } } as const;
const AUTO_REPLY_CLASSES: CommentClass[] = ['QUESTION', 'PRICE_QUERY', 'LOCATION_QUERY', 'SERVICE_QUERY', 'PRAISE'];
/** กลุ่มที่ส่งรายละเอียดเข้าอินบ็อกซ์ได้ (สนใจซื้อ/ถามราคา/ถามบริการ) */
const DM_CLASSES: CommentClass[] = ['LEAD', 'PRICE_QUERY', 'SERVICE_QUERY', 'QUESTION'];
/** กลุ่มที่กดไลค์อัตโนมัติได้ — ไม่ไลค์ร้องเรียน/สแปม/เชิงลบ */
const LIKE_CLASSES: CommentClass[] = ['PRAISE', 'QUESTION', 'LEAD', 'PRICE_QUERY', 'SERVICE_QUERY', 'LOCATION_QUERY', 'OTHER'];
/** Meta ให้ส่ง private reply ได้ภายใน 7 วันหลังคอมเมนต์ */
const DM_WINDOW_MS = 7 * 86_400_000;
export const DEFAULT_ACK = 'ส่งรายละเอียดให้ทางแชทแล้วนะคะ 😊 เช็คกล่องข้อความได้เลยค่ะ';
const AUTOMATION_SELECT = { pageId: true, enabled: true, enabledAt: true, autoLike: true, autoReply: true, autoPrivateReply: true, publicAckText: true, maxPerRun: true, lastRunAt: true, lastResult: true, lastError: true, updatedAt: true } as const;

interface Classified { id: string; classification: CommentClass; sentiment: 'positive' | 'neutral' | 'negative'; risk: boolean; summary: string; draftReply: string | null; privateReply: string | null; lead: { intent: string | null; product: string | null; service: string | null; quantity: string | null; requestedDate: string | null; location: string | null; budget: string | null; phone: string | null; urgency: string | null; leadScore: number; confidence: number } | null }
function validateBatch(v: unknown): Classified[] {
  const o = v as { comments?: unknown[] };
  if (!Array.isArray(o.comments)) throw new Error('comments ต้องเป็น array');
  return o.comments.map(raw => {
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== 'string') throw new Error('id หาย');
    if (!(COMMENT_CLASSES as readonly string[]).includes(c.classification as string)) throw new Error(`classification ไม่ถูกต้อง: ${String(c.classification)}`);
    const l = c.lead as Record<string, unknown> | null | undefined;
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : typeof x === 'number' ? String(x) : null);
    return { id: c.id, classification: c.classification as CommentClass, sentiment: (['positive', 'neutral', 'negative'].includes(c.sentiment as string) ? c.sentiment : 'neutral') as Classified['sentiment'], risk: c.risk === true, summary: String(c.summary ?? ''), draftReply: str(c.draftReply)?.slice(0, 2000) ?? null, privateReply: str(c.privateReply)?.slice(0, 1900) ?? null,
      lead: l && typeof l === 'object' && Number(l.leadScore) > 0 ? { intent: str(l.intent), product: str(l.product), service: str(l.service), quantity: str(l.quantity), requestedDate: str(l.requestedDate), location: str(l.location), budget: str(l.budget), phone: str(l.phone), urgency: str(l.urgency), leadScore: Math.max(0, Math.min(100, Math.round(Number(l.leadScore)))), confidence: Math.max(0, Math.min(1, Number(l.confidence ?? 0.5))) } : null };
  });
}

@Injectable()
export class CommentsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(FACEBOOK) private readonly fb: FacebookService, @Inject(SyncService) private readonly sync: SyncService, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  private async page(workspaceId: string, pageId: string) {
    const p = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, name: true, facebookPageId: true, automationLevel: true, commentsStatus: true, brand: { select: { name: true, toneOfVoice: true, primaryCTA: true, preferredLanguage: true, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
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
  async classify(workspaceId: string, userId: string, dto: ClassifyDto, requestId: string, opts: { createdAfter?: Date | null } = {}) {
    const where: Prisma.PageCommentWhereInput = { page: pageInWorkspace(workspaceId), ...(dto?.pageId && { pageId: dto.pageId }), ...(dto?.commentIds ? { id: { in: dto.commentIds } } : { classification: null }), ...(opts.createdAfter && { createdTime: { gte: opts.createdAfter } }) };
    const all = await this.prisma.pageComment.findMany({ where, orderBy: { createdTime: 'desc' }, take: dto?.limit ?? 20, select: { id: true, pageId: true, fromId: true, fromName: true, message: true, parentCommentId: true, post: { select: { message: true } }, page: { select: { facebookPageId: true } } } });
    // คอมเมนต์ของเพจเอง (คำตอบของเรา) ไม่ต้องจำแนก/ตอบ/ไลค์ — ปิดไว้ไม่ให้ถูกหยิบซ้ำ
    const own = all.filter(c => c.fromId && c.fromId === c.page.facebookPageId);
    if (own.length) await this.prisma.pageComment.updateMany({ where: { id: { in: own.map(c => c.id) } }, data: { classification: 'OTHER', replyStatus: 'SKIPPED', autoHandledAt: new Date() } });
    const comments = all.filter(c => !own.includes(c));
    if (!comments.length) return { classified: 0, leads: 0, autoReplied: 0, auto: null, items: [] };
    const pageIds = [...new Set(comments.map(c => c.pageId))];
    const results: Classified[] = []; let leads = 0; let autoReplied = 0; let costUsd = 0;
    for (const pageId of pageIds) {
      const page = await this.page(workspaceId, pageId);
      const batch = comments.filter(c => c.pageId === pageId);
      const kb = page.brand.knowledge.map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 300)}`).join('\n');
      const out = await this.ai.structured({ workspaceId, userId, taskType: 'comments.classify', role: 'community', requestId, promptVersion: COMMUNITY_PROMPT_VERSION, resourceType: 'facebookPage', resourceId: pageId }, {
        system: `คุณคือ Community Manager + Lead Detector ของเพจ "${page.name}" (แบรนด์ ${page.brand.name}) น้ำเสียง: ${page.brand.toneOfVoice ?? 'สุภาพ เป็นกันเอง'} ภาษา ${page.brand.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย'}\nจำแนกคอมเมนต์เป็น ${COMMENT_CLASSES.join('|')} ประเมิน sentiment และ risk (true เมื่อเป็นข้อร้องเรียนรุนแรง/กฎหมาย/สุขภาพ/ดราม่า ต้องให้คนดู) เขียน draftReply สั้น สุภาพ ตามข้อมูลแบรนด์เท่านั้น ไม่มีข้อมูล (ราคา/เวลา/ที่อยู่) ให้ชวนทักแชท/ทิ้งเบอร์แทนการเดา SPAM ไม่ต้องร่างตอบ (null)\nprivateReply = ข้อความส่งเข้าอินบ็อกซ์ของคนที่สนใจซื้อ/ถามราคา/ถามบริการ (LEAD, PRICE_QUERY, SERVICE_QUERY, QUESTION ที่เกี่ยวกับสินค้า/บริการ) ทักทายด้วยชื่อ ให้รายละเอียดจากข้อมูลแบรนด์เท่านั้น (ราคา โปร วิธีสั่ง/จอง) แล้วถามข้อมูลที่ต้องใช้ต่อ 1–2 ข้อ ห้ามแต่งราคา/สต็อก/โปรที่ไม่มีในข้อมูล ไม่ใช่กลุ่มนี้ให้เป็น null\nlead: ใส่เมื่อมีเจตนาซื้อ/จอง/สอบถามบริการ leadScore 0-100 confidence 0-1 ห้ามแต่งข้อมูลติดต่อ ค่าที่ไม่รู้เป็น null\nข้อมูลแบรนด์:\n${kb || '(ยังไม่มี)'}\nCTA หลัก: ${page.brand.primaryCTA ?? '-'}`,
        prompt: `คอมเมนต์ ${batch.length} รายการ:\n${JSON.stringify(batch.map(c => ({ id: c.id, from: c.fromName, message: c.message, isReply: !!c.parentCommentId, post: (c.post?.message ?? '').slice(0, 160) })))}`,
        schemaDescription: `{ "comments": [{ "id": string, "classification": ${COMMENT_CLASSES.map(x => `"${x}"`).join('|')}, "sentiment": "positive"|"neutral"|"negative", "risk": boolean, "summary": string, "draftReply": string|null, "privateReply": string|null, "lead": null | { "intent": string|null, "product": string|null, "service": string|null, "quantity": string|null, "requestedDate": string|null, "location": string|null, "budget": string|null, "phone": string|null, "urgency": string|null, "leadScore": number, "confidence": number } }] }`,
        validate: validateBatch, maxTokens: 6000,
      });
      costUsd += out.costUsd ?? 0;
      for (const r of out.result.data) {
        const c = batch.find(x => x.id === r.id); if (!c) continue;
        results.push(r);
        const dm = r.privateReply && !r.risk && DM_CLASSES.includes(r.classification) ? r.privateReply : null;
        await this.prisma.pageComment.update({ where: { id: c.id }, data: { classification: r.classification, sentiment: r.sentiment, riskFlag: r.risk, aiSummary: r.summary, ...(r.draftReply && { draftReply: r.draftReply, replyStatus: 'DRAFTED' }), ...(r.classification === 'SPAM' && { replyStatus: 'SKIPPED' }), ...(dm && { privateReplyText: dm, privateReplyStatus: 'DRAFTED' }) } });
        if (r.lead && r.lead.leadScore >= 40) {
          const lead = await this.prisma.lead.upsert({ where: { commentId: c.id }, create: { workspaceId, pageId, commentId: c.id, name: c.fromName, ...r.lead, data: r as unknown as Prisma.InputJsonValue }, update: { ...r.lead, data: r as unknown as Prisma.InputJsonValue }, select: { id: true } });
          leads++;
          if (r.lead.leadScore >= 70) await this.notifications.notify(workspaceId, { type: 'hot_lead', severity: 'warn', title: `ลีดร้อน (${r.lead.leadScore}): ${c.fromName ?? 'ลูกค้า'} — ${r.lead.intent ?? r.lead.service ?? ''}`, body: (c.message ?? '').slice(0, 140), href: '/leads', resourceType: 'lead', resourceId: lead.id, dedupeKey: `lead:${lead.id}` });
        }

      }
    }
    // ตอบ/ไลค์/ส่งแชทอัตโนมัติตามสวิตช์ของเพจ (หรือระดับ FULL_AUTO เดิม) — เฉพาะคอมเมนต์ที่เพิ่งจำแนก
    const auto = await this.autoHandle(workspaceId, pageIds, results.map(r => r.id), requestId);
    autoReplied = auto.replied + auto.privateReplied;
    await this.audit.log({ workspaceId, userId, action: 'comments.classify', resourceType: 'pageComment', after: { classified: results.length, leads, autoReplied, auto, costUsd }, requestId });
    return { classified: results.length, leads, autoReplied, auto, costUsd, items: await this.prisma.pageComment.findMany({ where: { id: { in: results.map(r => r.id) } }, select: COMMENT_SELECT }) };
  }

  async update(workspaceId: string, userId: string, id: string, dto: UpdateCommentDto, requestId: string) {
    const c = await this.prisma.pageComment.findFirst({ where: { id, page: pageInWorkspace(workspaceId) }, select: { id: true, replyStatus: true, privateReplyStatus: true } });
    if (!c) throw new NotFoundException('ไม่พบคอมเมนต์');
    if (dto.privateReplyText !== undefined && c.privateReplyStatus === 'SENT') throw new ConflictException('ส่งข้อความเข้าอินบ็อกซ์ของคอมเมนต์นี้ไปแล้ว');
    const out = await this.prisma.pageComment.update({ where: { id }, data: { ...(dto.draftReply !== undefined && { draftReply: dto.draftReply, replyStatus: dto.draftReply ? (c.replyStatus === 'SENT' ? 'SENT' : 'APPROVED') : 'NONE' }), ...(dto.resolved !== undefined && { resolvedAt: dto.resolved ? new Date() : null }), ...(dto.classification && { classification: dto.classification }), ...(dto.privateReplyText !== undefined && { privateReplyText: dto.privateReplyText || null, privateReplyStatus: dto.privateReplyText ? 'DRAFTED' : 'NONE' }) }, select: COMMENT_SELECT });
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


  // ---------- ไลค์ / ส่งแชทจากคอมเมนต์ / ระบบอัตโนมัติ ----------
  private async commentForAction(workspaceId: string, id: string) {
    const c = await this.prisma.pageComment.findFirst({ where: { id, page: pageInWorkspace(workspaceId) }, select: { id: true, pageId: true, facebookCommentId: true, fromId: true, createdTime: true, likedAt: true, replyStatus: true, privateReplyText: true, privateReplyStatus: true, page: { select: { facebookPageId: true, publishingPaused: true, disconnectedAt: true, commentAutomation: { select: { publicAckText: true } }, brand: { select: { client: { select: { workspace: { select: { automationPaused: true } } } } } } } } } });
    if (!c) throw new NotFoundException('ไม่พบคอมเมนต์');
    if (c.fromId && c.fromId === c.page.facebookPageId) throw new UnprocessableEntityException('นี่คือคอมเมนต์ของเพจเอง');
    return c;
  }

  /** กดไลค์คอมเมนต์ในนามเพจ (ทำซ้ำได้ไม่เป็นไร — ไลค์แล้วข้าม) */
  async like(workspaceId: string, userId: string | null, id: string, requestId: string, auto = false) {
    const c = await this.commentForAction(workspaceId, id);
    if (c.likedAt) return this.prisma.pageComment.findUniqueOrThrow({ where: { id }, select: COMMENT_SELECT });
    if (auto && (c.page.publishingPaused || c.page.brand.client.workspace.automationPaused)) throw new ForbiddenException('ระบบอัตโนมัติของเพจ/workspace ถูกหยุดไว้');
    const { token } = await this.sync.pageToken(workspaceId, c.pageId);
    try { await this.fb.likeComment(c.facebookCommentId, token); }
    catch (e) { throw new UnprocessableEntityException(e instanceof CommentsPermissionError ? 'ไลค์ไม่ได้ — token ต้องมีสิทธิ์ pages_manage_engagement' : (e as Error).message); }
    const out = await this.prisma.pageComment.update({ where: { id }, data: { likedAt: new Date() }, select: COMMENT_SELECT });
    await this.audit.log({ workspaceId, userId, action: auto ? 'comments.like.auto' : 'comments.like', resourceType: 'pageComment', resourceId: id, requestId });
    return out;
  }

  /**
   * ส่งรายละเอียดเข้าอินบ็อกซ์ของคนที่คอมเมนต์ (private reply) แล้วตอบใต้คอมเมนต์สั้น ๆ ว่าส่งทางแชทแล้ว
   * Meta: ครั้งเดียวต่อคอมเมนต์ ภายใน 7 วัน · ต้องมีสิทธิ์ pages_messaging · ลูกค้าตอบกลับ → เข้าระบบแชทตามปกติ
   * publicAck: undefined = ใช้ข้อความของเพจ · null = ไม่ตอบใต้คอมเมนต์
   */
  async sendPrivateReply(workspaceId: string, userId: string | null, id: string, dto: PrivateReplyDto, requestId: string, auto = false) {
    const c = await this.commentForAction(workspaceId, id);
    if (c.privateReplyStatus === 'SENT') throw new ConflictException('ส่งข้อความเข้าอินบ็อกซ์ของคอมเมนต์นี้ไปแล้ว (Meta ให้ส่งได้ครั้งเดียวต่อคอมเมนต์)');
    const text = (dto.message ?? c.privateReplyText ?? '').trim();
    if (!text) throw new UnprocessableEntityException('ไม่มีข้อความที่จะส่ง — ให้ AI จำแนกคอมเมนต์ก่อน หรือพิมพ์ข้อความเอง');
    if (Date.now() - c.createdTime.getTime() > DM_WINDOW_MS) throw new UnprocessableEntityException('คอมเมนต์นี้เกิน 7 วันแล้ว — Meta ไม่ให้ส่งข้อความจากคอมเมนต์ ให้ตอบใต้คอมเมนต์แทน');
    if (c.page.disconnectedAt) throw new UnprocessableEntityException('เพจถูกตัดการเชื่อมต่อแล้ว');
    if (c.page.publishingPaused || c.page.brand.client.workspace.automationPaused) throw new ForbiddenException('การโพสต์ของเพจ/workspace ถูกหยุดไว้ (สวิตช์ฉุกเฉิน)');
    const { token } = await this.sync.pageToken(workspaceId, c.pageId);
    try {
      const r = await this.fb.privateReply(c.page.facebookPageId, c.facebookCommentId, token, text);
      await this.prisma.pageComment.update({ where: { id }, data: { privateReplyText: text, privateReplyStatus: 'SENT', privateReplyAt: new Date(), privateMessageId: r.messageId, privateReplyError: null } });
    } catch (e) {
      const msg = e instanceof MessagingPermissionError ? e.message : e instanceof Error ? e.message : String(e);
      await this.prisma.pageComment.update({ where: { id }, data: { privateReplyText: text, privateReplyStatus: 'FAILED', privateReplyError: msg.slice(0, 300) } });
      await this.audit.log({ workspaceId, userId, action: auto ? 'comments.private_reply.auto_failed' : 'comments.private_reply_failed', resourceType: 'pageComment', resourceId: id, after: { error: msg.slice(0, 200) }, requestId });
      throw new UnprocessableEntityException(msg);
    }
    await this.audit.log({ workspaceId, userId, action: auto ? 'comments.private_reply.auto' : 'comments.private_reply', resourceType: 'pageComment', resourceId: id, after: { text: text.slice(0, 200) }, requestId });
    // ตอบใต้คอมเมนต์ให้คนอื่นเห็นว่าเพจดูแลแล้ว — ส่งแชทสำเร็จแล้ว ตอบใต้คอมเมนต์ไม่ได้ก็ไม่ถือว่าล้มทั้งงาน
    let publicAckError: string | null = null;
    const ack = dto.publicAck === null ? null : (dto.publicAck ?? c.page.commentAutomation?.publicAckText ?? DEFAULT_ACK).trim();
    if (ack && c.replyStatus !== 'SENT') {
      try { await this.sendReply(workspaceId, userId, id, ack, requestId, auto); } catch (e) { publicAckError = (e as Error).message; }
    }
    return { comment: await this.prisma.pageComment.findUniqueOrThrow({ where: { id }, select: COMMENT_SELECT }), publicAckError };
  }

  /**
   * หลังจำแนก: ทำตามสวิตช์ของเพจ — ส่งแชท (+ตอบใต้คอมเมนต์ว่าส่งแล้ว) / ตอบใต้คอมเมนต์ / ไลค์
   * ไม่แตะคอมเมนต์เสี่ยง ร้องเรียน สแปม เชิงลบ หรือของเพจเอง · สวิตช์ใหม่ใช้กับคอมเมนต์ที่เข้ามาหลังเปิดเท่านั้น
   * ระดับ FULL_AUTO เดิมยังตอบใต้คอมเมนต์กลุ่มปลอดภัยให้เหมือนเดิม
   */
  async autoHandle(workspaceId: string, pageIds: string[], commentIds: string[], requestId: string) {
    const out = { liked: 0, replied: 0, privateReplied: 0, skipped: 0, errors: [] as string[] };
    if (!commentIds.length) return out;
    for (const pageId of pageIds) {
      const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, facebookPageId: true, automationLevel: true, publishingPaused: true, disconnectedAt: true, commentAutomation: { select: AUTOMATION_SELECT }, brand: { select: { client: { select: { workspace: { select: { automationPaused: true } } } } } } } });
      if (!page || page.disconnectedAt) continue;
      const on = page.commentAutomation?.enabled ? page.commentAutomation : null;
      const legacyReply = toolAllowedWithoutApproval('PUBLISH', page.automationLevel);
      if (!legacyReply && !on?.autoReply && !on?.autoLike && !on?.autoPrivateReply) continue;
      if (page.publishingPaused || page.brand.client.workspace.automationPaused) { out.skipped += commentIds.length; continue; }
      const comments = await this.prisma.pageComment.findMany({ where: { id: { in: commentIds }, pageId, autoHandledAt: null, isHidden: false }, orderBy: { createdTime: 'asc' }, select: { id: true, fromId: true, createdTime: true, classification: true, sentiment: true, riskFlag: true, draftReply: true, replyStatus: true, privateReplyText: true, privateReplyStatus: true, likedAt: true } });
      for (const c of comments) {
        const cls = c.classification as CommentClass | null;
        const fresh = !on?.enabledAt || c.createdTime >= on.enabledAt;
        const safe = !!cls && !c.riskFlag && c.sentiment !== 'negative' && !(c.fromId && c.fromId === page.facebookPageId);
        if (!safe) { out.skipped++; await this.prisma.pageComment.update({ where: { id: c.id }, data: { autoHandledAt: new Date() } }); continue; }
        let replied = c.replyStatus === 'SENT';
        const note = (what: string, e: unknown) => out.errors.push(`${what}: ${(e as Error).message}`.slice(0, 200));
        if (on?.autoPrivateReply && fresh && c.privateReplyText && c.privateReplyStatus === 'DRAFTED' && DM_CLASSES.includes(cls) && Date.now() - c.createdTime.getTime() < DM_WINDOW_MS) {
          try { const r = await this.sendPrivateReply(workspaceId, null, c.id, {}, requestId, true); out.privateReplied++; replied = r.comment.replyStatus === 'SENT'; } catch (e) { note('ส่งแชท', e); }
        }
        if (!replied && c.draftReply && AUTO_REPLY_CLASSES.includes(cls) && (legacyReply || (on?.autoReply && fresh))) {
          try { await this.sendReply(workspaceId, null, c.id, c.draftReply, requestId, true); out.replied++; } catch (e) { note('ตอบ', e); }
        }
        if (on?.autoLike && fresh && !c.likedAt && LIKE_CLASSES.includes(cls)) {
          try { await this.like(workspaceId, null, c.id, requestId, true); out.liked++; } catch (e) { note('ไลค์', e); }
        }
        await this.prisma.pageComment.update({ where: { id: c.id }, data: { autoHandledAt: new Date() } });
      }
    }
    return out;
  }

  // ---------- ตั้งค่าดูแลคอมเมนต์อัตโนมัติต่อเพจ ----------
  async getAutomation(workspaceId: string, pageId: string) {
    const p = await this.page(workspaceId, pageId);
    const row = await this.prisma.commentAutomation.findUnique({ where: { pageId }, select: AUTOMATION_SELECT });
    return { ...(row ?? { pageId, enabled: false, enabledAt: null, autoLike: false, autoReply: false, autoPrivateReply: false, publicAckText: DEFAULT_ACK, maxPerRun: 20, lastRunAt: null, lastResult: null, lastError: null, updatedAt: null }), commentsStatus: p.commentsStatus, automationLevel: p.automationLevel };
  }

  async setAutomation(workspaceId: string, userId: string, pageId: string, dto: CommentAutomationDto, requestId: string) {
    await this.page(workspaceId, pageId);
    const before = await this.prisma.commentAutomation.findUnique({ where: { pageId }, select: AUTOMATION_SELECT });
    // เปิดใหม่ = เริ่มนับจากตอนนี้ ไม่ย้อนไปตอบ/ไลค์คอมเมนต์เก่า
    const turningOn = dto.enabled === true && !before?.enabled;
    const data = { ...dto, ...(turningOn && { enabledAt: new Date() }) };
    const row = await this.prisma.commentAutomation.upsert({ where: { pageId }, create: { workspaceId, pageId, createdById: userId, ...data, ...(dto.enabled && { enabledAt: new Date() }) }, update: { ...data, createdById: userId }, select: AUTOMATION_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'comments.automation.update', resourceType: 'facebookPage', resourceId: pageId, before: before ? { enabled: before.enabled, autoLike: before.autoLike, autoReply: before.autoReply, autoPrivateReply: before.autoPrivateReply } : undefined, after: dto, requestId });
    return this.getAutomation(workspaceId, pageId).then(v => ({ ...v, ...row }));
  }

  /** หนึ่งรอบ: ซิงก์คอมเมนต์ (ถ้าเก่ากว่า 5 นาทีหรือสั่งเอง) → จำแนกคอมเมนต์ใหม่หลังเปิด → ไลค์/ตอบ/ส่งแชทตามสวิตช์ */
  async runAutomation(workspaceId: string, pageId: string, requestId: string, o: { userId?: string; forceSync?: boolean } = {}) {
    const cfg = await this.prisma.commentAutomation.findUnique({ where: { pageId }, select: { ...AUTOMATION_SELECT, createdById: true, page: { select: { commentsSyncedAt: true, commentsStatus: true, disconnectedAt: true, brand: { select: { client: { select: { workspaceId: true } } } } } } } });
    if (!cfg || cfg.page.brand.client.workspaceId !== workspaceId) throw new NotFoundException('ยังไม่ได้ตั้งค่าดูแลคอมเมนต์ของเพจนี้');
    if (!cfg.enabled) throw new UnprocessableEntityException('ยังไม่ได้เปิดดูแลคอมเมนต์อัตโนมัติของเพจนี้');
    const result: Record<string, unknown> = {};
    try {
      if (o.forceSync || !cfg.page.commentsSyncedAt || Date.now() - cfg.page.commentsSyncedAt.getTime() > 5 * 60_000) {
        const s = await syncComments(this.sync.deps, pageId, { days: 3 });
        result.sync = { status: s.status, imported: s.imported };
        if (s.status === 'NO_PERMISSION') throw new UnprocessableEntityException('อ่านคอมเมนต์ไม่ได้ — token ต้องมีสิทธิ์ pages_read_user_content');
      }
      const c = await this.classify(workspaceId, o.userId ?? cfg.createdById, { pageId, limit: cfg.maxPerRun }, requestId, { createdAfter: cfg.enabledAt });
      // คอมเมนต์ที่จำแนกไว้แล้วแต่ยังไม่ถูกจัดการ (เช่นเปิดสวิตช์ทีหลัง) ก็เก็บตกในรอบนี้
      const leftover = await this.prisma.pageComment.findMany({ where: { pageId, autoHandledAt: null, classification: { not: null }, ...(cfg.enabledAt && { createdTime: { gte: cfg.enabledAt } }) }, take: cfg.maxPerRun, select: { id: true } });
      const more = leftover.length ? await this.autoHandle(workspaceId, [pageId], leftover.map(x => x.id), requestId) : null;
      Object.assign(result, { classified: c.classified, leads: c.leads, auto: c.auto, leftover: more });
      await this.prisma.commentAutomation.update({ where: { pageId }, data: { lastRunAt: new Date(), lastResult: result as Prisma.InputJsonValue, lastError: null } });
      return result;
    } catch (e) {
      const msg = (e as Error & { response?: { message?: string } }).response?.message ?? (e as Error).message;
      await this.prisma.commentAutomation.update({ where: { pageId }, data: { lastRunAt: new Date(), lastError: String(msg).slice(0, 300) } });
      throw e;
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
