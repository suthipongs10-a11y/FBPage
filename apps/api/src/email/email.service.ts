/**
 * W-4 Email marketing (AGENTS_WEB.md) — ผู้ให้บริการส่งจำนวนมาก (Brevo/Resend) ต่อ workspace, รายชื่อผู้รับต่อแบรนด์ + consent (PDPA) + unsubscribe token,
 * แคมเปญ: AI ร่าง (AiGatewayService role content) → Reviewer → อนุมัติ → ส่งผ่าน @fbpm/email-core (กันซ้ำต่อผู้รับ) · สถิติจาก webhook · ไม่ใช้ SMTP แจ้งเตือนภายในส่งจำนวนมาก
 * API key/webhook secret เข้ารหัสด้วย common/crypto ไม่อยู่ใน select/response/audit
 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { brandInWorkspace, decryptSecret, emailListInWorkspace, encryptSecret } from '@fbpm/database';
import { canTransitionCampaign, type EmailCampaignStatus, type EmailProviderId } from '@fbpm/shared';
import { EmailError, applyEmailEvents, createProvider, providerForAccount, renderEmail, sendBlockReason, sendCampaign, unsubscribeUrl, type EmailDeps, type SendOutcome } from '@fbpm/email-core';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../jobs/queue.service';
import { isValidTimeZone, localToUtc } from '../content/tz';
import { EMAIL } from './email.provider';
import type { CreateCampaignDto, CreateListDto, GenerateCampaignDto, ImportSubscribersDto, ListCampaignsDto, ProviderConfigDto, ScheduleCampaignDto, UpdateCampaignDto, UpdateListDto } from './dto';

export const EMAIL_PV = { writer: 'email-newsletter-writer-v1', review: 'email-reviewer-v1' };
const ACCOUNT_SELECT = { id: true, provider: true, keyHint: true, status: true, accountEmail: true, lastError: true, verifiedAt: true, sendingPaused: true, webhookSecretEnc: true, updatedAt: true } as const;
const LIST_SELECT = { id: true, brandId: true, name: true, description: true, fromEmail: true, fromName: true, replyTo: true, consentText: true, archivedAt: true, createdAt: true, brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } }, _count: { select: { campaigns: true } } } as const;
const CAMPAIGN_SELECT = { id: true, listId: true, name: true, subject: true, preheader: true, bodyHtml: true, bodyText: true, status: true, scheduledLocal: true, scheduledTz: true, scheduledAt: true, startedAt: true, sentAt: true, recipientCount: true, sentCount: true, failedCount: true, deliveredCount: true, openedCount: true, clickedCount: true, bouncedCount: true, complainedCount: true, unsubscribedCount: true, sourceContentId: true, createdById: true, aiProvider: true, aiModel: true, promptVersion: true, editedByHuman: true, reviewResult: true, aiNotes: true, lastError: true, createdAt: true, updatedAt: true, list: { select: { id: true, name: true, fromEmail: true, fromName: true, brand: { select: { id: true, name: true } } } } } as const;
const rethrow = (e: unknown): never => { if (e instanceof EmailError) { if (e.code === 'auth') throw new UnprocessableEntityException(e.message); if (e.code === 'invalid' || e.code === 'blocked') throw new BadRequestException(e.message); throw new UnprocessableEntityException(e.message); } throw e; };
const stripAccount = <T extends { webhookSecretEnc?: string | null }>(a: T) => { const { webhookSecretEnc, ...rest } = a; return { ...rest, webhookConfigured: !!webhookSecretEnc }; };

@Injectable()
export class EmailService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(EMAIL) private readonly deps: EmailDeps, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService, @Inject(QueueService) private readonly queue: QueueService) {}

  // ---------- Provider account ----------
  async getProvider(workspaceId: string) { const a = await this.prisma.emailProviderAccount.findUnique({ where: { workspaceId }, select: ACCOUNT_SELECT }); return { account: a ? stripAccount(a) : null, sendEnabled: this.deps.sendEnabled, webhookPath: a ? `/api/email/webhooks/${a.provider}/${workspaceId}` : null }; }
  async setProvider(workspaceId: string, userId: string, dto: ProviderConfigDto, requestId: string) {
    const hint = `…${dto.apiKey.slice(-4)}`;
    const a = await this.prisma.emailProviderAccount.upsert({ where: { workspaceId }, create: { workspaceId, provider: dto.provider, apiKeyEnc: encryptSecret(dto.apiKey, this.deps.authSecret), keyHint: hint, webhookSecretEnc: dto.webhookSecret ? encryptSecret(dto.webhookSecret, this.deps.authSecret) : null }, update: { provider: dto.provider, apiKeyEnc: encryptSecret(dto.apiKey, this.deps.authSecret), keyHint: hint, status: 'UNKNOWN', lastError: null, ...(dto.webhookSecret !== undefined && { webhookSecretEnc: dto.webhookSecret ? encryptSecret(dto.webhookSecret, this.deps.authSecret) : null }) }, select: { id: true } });
    const v = await this.verifyProvider(workspaceId);
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_PROVIDER_CONFIGURED', resourceType: 'emailProviderAccount', resourceId: a.id, after: { provider: dto.provider, keyHint: hint, status: v.account?.status }, requestId });
    return v;
  }
  async verifyProvider(workspaceId: string) {
    const a = await this.prisma.emailProviderAccount.findUnique({ where: { workspaceId }, select: { id: true, provider: true, apiKeyEnc: true } }); if (!a) throw new NotFoundException('ยังไม่ได้ตั้งค่าผู้ให้บริการ');
    try { const info = await providerForAccount(this.deps, a).verify(); await this.prisma.emailProviderAccount.update({ where: { id: a.id }, data: { status: 'OK', accountEmail: info.accountEmail, lastError: info.detail, verifiedAt: new Date() } }); }
    catch (e) { const err = e instanceof EmailError ? e : new EmailError(String(e), 'unknown'); await this.prisma.emailProviderAccount.update({ where: { id: a.id }, data: { status: err.code === 'auth' ? 'AUTH_FAILED' : 'ERROR', lastError: err.message.slice(0, 500), verifiedAt: new Date() } }); }
    return this.getProvider(workspaceId);
  }
  async setProviderPaused(workspaceId: string, userId: string, paused: boolean, requestId: string) {
    const r = await this.prisma.emailProviderAccount.updateMany({ where: { workspaceId }, data: { sendingPaused: paused } }); if (!r.count) throw new NotFoundException('ยังไม่ได้ตั้งค่าผู้ให้บริการ');
    await this.audit.log({ workspaceId, userId, action: paused ? 'EMAIL_SENDING_PAUSED' : 'EMAIL_SENDING_RESUMED', resourceType: 'emailProviderAccount', requestId }); return this.getProvider(workspaceId);
  }
  async removeProvider(workspaceId: string, userId: string, requestId: string) { await this.prisma.emailProviderAccount.deleteMany({ where: { workspaceId } }); await this.audit.log({ workspaceId, userId, action: 'EMAIL_PROVIDER_REMOVED', resourceType: 'emailProviderAccount', requestId }); return { ok: true }; }

  // ---------- Lists + subscribers ----------
  private async list(workspaceId: string, id: string) { const l = await this.prisma.emailList.findFirst({ where: { id, ...emailListInWorkspace(workspaceId) }, select: LIST_SELECT }); if (!l) throw new NotFoundException('ไม่พบรายชื่อผู้รับ'); return l; }
  private async withCounts<T extends { id: string }>(lists: T[]) {
    const rows = lists.length ? await this.prisma.emailSubscriber.groupBy({ by: ['listId', 'status'], where: { listId: { in: lists.map(l => l.id) } }, _count: { _all: true } }) : [];
    return lists.map(l => { const c = (st: string) => rows.filter(r => r.listId === l.id && r.status === st).reduce((a, r) => a + r._count._all, 0); return { ...l, counts: { subscribed: c('SUBSCRIBED'), unsubscribed: c('UNSUBSCRIBED'), bounced: c('BOUNCED'), complained: c('COMPLAINED') } }; });
  }
  async lists(workspaceId: string) { return this.withCounts(await this.prisma.emailList.findMany({ where: emailListInWorkspace(workspaceId), orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }], select: LIST_SELECT })); }
  async getList(workspaceId: string, id: string) { return (await this.withCounts([await this.list(workspaceId, id)]))[0]!; }
  async createList(workspaceId: string, userId: string, dto: CreateListDto, requestId: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id: dto.brandId, ...brandInWorkspace(workspaceId) }, select: { id: true } }); if (!brand) throw new NotFoundException('ไม่พบแบรนด์');
    const l = await this.prisma.emailList.create({ data: { brandId: dto.brandId, name: dto.name, description: dto.description ?? null, fromEmail: dto.fromEmail, fromName: dto.fromName, replyTo: dto.replyTo ?? null, consentText: dto.consentText ?? null }, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_LIST_CREATED', resourceType: 'emailList', resourceId: l.id, after: { name: dto.name, fromEmail: dto.fromEmail, brandId: dto.brandId }, requestId });
    return this.getList(workspaceId, l.id);
  }
  async updateList(workspaceId: string, userId: string, id: string, dto: UpdateListDto, requestId: string) {
    await this.list(workspaceId, id); const { archived, ...fields } = dto;
    await this.prisma.emailList.update({ where: { id }, data: { ...fields, ...(archived !== undefined && { archivedAt: archived ? new Date() : null }) } });
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_LIST_UPDATED', resourceType: 'emailList', resourceId: id, after: dto as Prisma.InputJsonValue, requestId }); return this.getList(workspaceId, id);
  }
  /** นำเข้าผู้รับที่ยินยอมแล้วเท่านั้น — คนที่ยกเลิกรับไปแล้วจะไม่ถูกเปิดกลับด้วยการ import */
  async importSubscribers(workspaceId: string, userId: string, listId: string, dto: ImportSubscribersDto, requestId: string) {
    const l = await this.list(workspaceId, listId); if (l.archivedAt) throw new ForbiddenException('รายชื่อนี้ถูกเก็บถาวรแล้ว');
    const seen = new Set<string>(); let added = 0, updated = 0, skippedUnsubscribed = 0, duplicates = 0;
    for (const s of dto.subscribers) {
      if (seen.has(s.email)) { duplicates++; continue; } seen.add(s.email);
      const existing = await this.prisma.emailSubscriber.findUnique({ where: { listId_email: { listId, email: s.email } }, select: { id: true, status: true } });
      const consentAt = s.consentAt ? new Date(s.consentAt) : new Date();
      if (!existing) { await this.prisma.emailSubscriber.create({ data: { listId, email: s.email, name: s.name ?? null, status: 'SUBSCRIBED', source: 'import', consentAt, consentSource: dto.consentSource, consentNote: dto.consentNote ?? null, unsubscribeToken: randomBytes(24).toString('base64url'), attributes: (s.attributes as Prisma.InputJsonValue) ?? undefined } }); added++; continue; }
      if (existing.status !== 'SUBSCRIBED') { skippedUnsubscribed++; continue; }
      await this.prisma.emailSubscriber.update({ where: { id: existing.id }, data: { name: s.name ?? undefined, attributes: (s.attributes as Prisma.InputJsonValue) ?? undefined } }); updated++;
    }
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_SUBSCRIBERS_IMPORTED', resourceType: 'emailList', resourceId: listId, after: { added, updated, skippedUnsubscribed, duplicates, consentSource: dto.consentSource }, requestId });
    return { added, updated, skippedUnsubscribed, duplicates, list: await this.getList(workspaceId, listId) };
  }
  async subscribers(workspaceId: string, listId: string, q: { status?: string; q?: string; limit?: number }) {
    await this.list(workspaceId, listId);
    return this.prisma.emailSubscriber.findMany({ where: { listId, ...(q.status && { status: q.status }), ...(q.q && { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] }) }, orderBy: { createdAt: 'desc' }, take: q.limit ?? 200, select: { id: true, email: true, name: true, status: true, source: true, consentAt: true, consentSource: true, unsubscribedAt: true, bouncedAt: true, createdAt: true } });
  }
  async setSubscriberStatus(workspaceId: string, userId: string, listId: string, subscriberId: string, status: 'SUBSCRIBED' | 'UNSUBSCRIBED', requestId: string) {
    await this.list(workspaceId, listId); const s = await this.prisma.emailSubscriber.findFirst({ where: { id: subscriberId, listId }, select: { id: true, status: true } }); if (!s) throw new NotFoundException('ไม่พบผู้รับ');
    if (status === 'SUBSCRIBED' && s.status !== 'UNSUBSCRIBED') throw new ConflictException(`ผู้รับสถานะ ${s.status} เปิดกลับไม่ได้ (bounce/complaint)`);
    await this.prisma.emailSubscriber.update({ where: { id: s.id }, data: { status, ...(status === 'UNSUBSCRIBED' ? { unsubscribedAt: new Date() } : { unsubscribedAt: null, consentAt: new Date(), consentSource: `manual re-subscribe by ${userId}` }) } });
    await this.audit.log({ workspaceId, userId, action: status === 'UNSUBSCRIBED' ? 'EMAIL_SUBSCRIBER_UNSUBSCRIBED' : 'EMAIL_SUBSCRIBER_RESUBSCRIBED', resourceType: 'emailSubscriber', resourceId: s.id, requestId }); return { ok: true };
  }
  /** ลิงก์ยกเลิกรับ (สาธารณะ ไม่ต้องล็อกอิน) — token เดียวต่อผู้รับ; idempotent */
  async unsubscribeByToken(token: string): Promise<{ ok: boolean; email: string | null; brand: string | null; already: boolean }> {
    const s = await this.prisma.emailSubscriber.findUnique({ where: { unsubscribeToken: token }, select: { id: true, email: true, status: true, list: { select: { brand: { select: { name: true } } } } } });
    if (!s) return { ok: false, email: null, brand: null, already: false };
    if (s.status === 'SUBSCRIBED') await this.prisma.emailSubscriber.update({ where: { id: s.id }, data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() } });
    return { ok: true, email: s.email, brand: s.list.brand.name, already: s.status !== 'SUBSCRIBED' };
  }

  // ---------- Campaigns ----------
  private async load(workspaceId: string, id: string) { const c = await this.prisma.emailCampaign.findFirst({ where: { id, workspaceId }, select: CAMPAIGN_SELECT }); if (!c) throw new NotFoundException('ไม่พบแคมเปญ'); return c; }
  private async transition(workspaceId: string, userId: string | null, id: string, to: EmailCampaignStatus, requestId: string, extra: Prisma.EmailCampaignUpdateInput = {}, action = 'EMAIL_CAMPAIGN_TRANSITION') {
    const c = await this.load(workspaceId, id);
    if (!canTransitionCampaign(c.status as EmailCampaignStatus, to)) throw new ConflictException(`เปลี่ยนสถานะจาก ${c.status} → ${to} ไม่ได้`);
    await this.prisma.emailCampaign.update({ where: { id }, data: { status: to, ...extra } });
    await this.audit.log({ workspaceId, userId, action, resourceType: 'emailCampaign', resourceId: id, before: { status: c.status }, after: { status: to }, requestId });
  }
  campaigns(workspaceId: string, q: ListCampaignsDto) { return this.prisma.emailCampaign.findMany({ where: { workspaceId, ...(q.listId && { listId: q.listId }), ...(q.status && { status: q.status }) }, orderBy: { updatedAt: 'desc' }, take: q.limit ?? 200, select: CAMPAIGN_SELECT }); }
  get(workspaceId: string, id: string) { return this.load(workspaceId, id); }
  async summary(workspaceId: string) {
    const [rows, lists, subs] = await Promise.all([this.prisma.emailCampaign.groupBy({ by: ['status'], where: { workspaceId }, _count: { _all: true } }), this.prisma.emailList.count({ where: { ...emailListInWorkspace(workspaceId), archivedAt: null } }), this.prisma.emailSubscriber.count({ where: { list: emailListInWorkspace(workspaceId), status: 'SUBSCRIBED' } })]);
    const n = (...st: string[]) => rows.filter(r => st.includes(r.status)).reduce((a, r) => a + r._count._all, 0);
    const sent = await this.prisma.emailCampaign.aggregate({ where: { workspaceId, status: 'SENT' }, _sum: { sentCount: true, openedCount: true, clickedCount: true }, _count: { _all: true } });
    return { lists, subscribers: subs, drafts: n('DRAFT', 'NEEDS_REVISION', 'AI_REVIEW'), pendingApproval: n('READY_FOR_APPROVAL'), scheduled: n('APPROVED', 'SCHEDULED'), sent: n('SENT'), failed: n('SEND_FAILED'), totals: { sent: sent._count._all ? sent._sum.sentCount : null, opened: sent._sum.openedCount, clicked: sent._sum.clickedCount } };
  }
  async create(workspaceId: string, userId: string, dto: CreateCampaignDto, requestId: string) {
    const l = await this.list(workspaceId, dto.listId); if (l.archivedAt) throw new ForbiddenException('รายชื่อนี้ถูกเก็บถาวรแล้ว');
    const c = await this.prisma.emailCampaign.create({ data: { workspaceId, listId: dto.listId, name: dto.name, subject: dto.subject, preheader: dto.preheader, bodyHtml: dto.bodyHtml, bodyText: dto.bodyText, sourceContentId: dto.sourceContentId, createdById: userId }, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_CAMPAIGN_CREATED', resourceType: 'emailCampaign', resourceId: c.id, after: { listId: dto.listId, name: dto.name }, requestId }); return this.load(workspaceId, c.id);
  }
  async update(workspaceId: string, userId: string, id: string, dto: UpdateCampaignDto, requestId: string) {
    const c = await this.load(workspaceId, id); if (['SENDING', 'SENT', 'CANCELLED'].includes(c.status)) throw new ConflictException(`แก้ไขแคมเปญสถานะ ${c.status} ไม่ได้`);
    const { reason: _reason, ...fields } = dto; void _reason;
    const changed = (fields.subject !== undefined && fields.subject !== c.subject) || (fields.bodyHtml !== undefined && fields.bodyHtml !== c.bodyHtml);
    const backToDraft = ['READY_FOR_APPROVAL', 'APPROVED', 'SCHEDULED', 'SEND_FAILED'].includes(c.status) && changed;
    if (backToDraft && c.status === 'SCHEDULED') await this.queue.cancelEmailSend(id);
    if (backToDraft) await this.prisma.approvalRequest.updateMany({ where: { resourceType: 'emailCampaign', resourceId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await this.prisma.emailCampaign.update({ where: { id }, data: { ...fields, editedByHuman: true, ...(backToDraft && { status: 'DRAFT', scheduledAt: null, scheduledLocal: null, scheduledTz: null, reviewResult: undefined }) } });
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_CAMPAIGN_UPDATED', resourceType: 'emailCampaign', resourceId: id, after: { fields: Object.keys(dto), backToDraft }, requestId }); return this.load(workspaceId, id);
  }
  /** Newsletter Writer (AI) — ใช้ข้อมูลแบรนด์ + คอนเทนต์ที่เผยแพร่แล้วของแบรนด์เท่านั้น ห้ามแต่งโปร/ราคา */
  async generate(workspaceId: string, userId: string, id: string, dto: GenerateCampaignDto, requestId: string) {
    const c = await this.load(workspaceId, id);
    const l = await this.prisma.emailList.findUniqueOrThrow({ where: { id: c.listId }, select: { name: true, fromName: true, brand: { select: { id: true, name: true, industry: true, targetAudience: true, toneOfVoice: true, preferredLanguage: true, primaryCTA: true, website: true, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
    const ids = dto?.sourceContentIds ?? (c.sourceContentId ? [c.sourceContentId] : []);
    const [recent, fbPosts] = await Promise.all([
      this.prisma.contentItem.findMany({ where: ids.length ? { id: { in: ids } } : { status: { in: ['PUBLISHED', 'ANALYZED'] }, OR: [{ page: { brandId: l.brand.id } }, { youtubeChannel: { brandId: l.brand.id } }, { site: { brandId: l.brand.id } }] }, orderBy: { publishedAt: 'desc' }, take: ids.length ? ids.length : 8, select: { id: true, platform: true, title: true, caption: true, externalPostId: true, youtubeMeta: { select: { title: true, description: true } }, webMeta: { select: { title: true, excerpt: true, wpLink: true } }, publishedPost: { select: { permalink: true } } } }),
      ids.length ? [] : this.prisma.facebookPost.findMany({ where: { page: { brandId: l.brand.id }, publishedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { publishedAt: 'desc' }, take: 6, select: { message: true, permalink: true } }),
    ]);
    const b = l.brand; const prohibited = b.knowledge.filter(k => k.type === 'prohibited_claim');
    const items = recent.map(r => `- [${r.platform}] ${r.webMeta?.title ?? r.youtubeMeta?.title ?? r.title ?? ''}: ${(r.webMeta?.excerpt ?? r.youtubeMeta?.description ?? r.caption ?? '').slice(0, 400)}${r.webMeta?.wpLink ? ` (${r.webMeta.wpLink})` : r.platform === 'YOUTUBE' && r.externalPostId ? ` (https://www.youtube.com/watch?v=${r.externalPostId})` : r.publishedPost?.permalink ? ` (${r.publishedPost.permalink})` : ''}`);
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'email.newsletter.write', role: 'content', requestId, promptVersion: EMAIL_PV.writer, resourceType: 'emailCampaign', resourceId: id }, {
      system: `คุณคือ Newsletter Writer ของเอเจนซี่ เขียนอีเมลการตลาดภาษา${b.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย'} น้ำเสียง ${dto?.tone ?? b.toneOfVoice ?? 'เป็นกันเอง มืออาชีพ'} สั้น อ่านบนมือถือ (200–450 คำ) โครง: หัวเรื่อง ≤ 60 ตัวอักษร (ไม่หลอก ไม่ตัวพิมพ์ใหญ่ทั้งหมด ไม่ใส่ "ฟรี!!!"), preheader ≤ 90, ทักทายด้วย {{name}}, เนื้อหา 2–4 ส่วนอิงคอนเทนต์ที่ให้ (สรุปใหม่ ห้ามคัดลอก), CTA 1 อันไป "${b.primaryCTA ?? 'ติดต่อเรา'}" (ใช้ลิงก์ที่มีในข้อมูลเท่านั้น) ห้ามแต่งราคา/โปร/ส่วนลด/ตัวเลข/รีวิว ถ้าต้องมีให้ใส่ [ต้องยืนยัน: ...] และลง missingInfo ต้องมี {{unsubscribe_url}} ในส่วนท้าย bodyHtml เป็น HTML สะอาด (p, h2, ul/li, a, strong) ห้าม script/style/รูปภายนอกที่ไม่มีในข้อมูล`,
      prompt: [`รายชื่อ "${l.name}" ผู้ส่ง ${l.fromName} · แบรนด์ ${b.name} (${b.industry ?? '-'}) กลุ่มเป้าหมาย ${b.targetAudience ?? '-'} เว็บ ${b.website ?? '-'}`, b.knowledge.length ? `ข้อมูลแบรนด์:\n${b.knowledge.filter(k => k.type !== 'prohibited_claim').map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 300)}`).join('\n')}` : 'ข้อมูลแบรนด์: ยังไม่ได้กรอก — ห้ามแต่งข้อมูลธุรกิจ', prohibited.length ? `ข้อห้ามกล่าวอ้าง:\n${prohibited.map(k => `- ${k.title}: ${k.content}`).join('\n')}` : '', `เป้าหมายฉบับนี้: ${dto?.goal ?? c.name}${dto?.notes ? `\nโน้ต: ${dto.notes}` : ''}`, items.length ? `คอนเทนต์ที่เผยแพร่แล้ว (ใช้เป็นสาระ):\n${items.join('\n')}` : 'ยังไม่มีคอนเทนต์ที่เผยแพร่ — เขียนจากข้อมูลแบรนด์เท่านั้น', fbPosts.length ? `โพสต์ Facebook 30 วัน:\n${fbPosts.map(p => `- ${(p.message ?? '').slice(0, 200)}${p.permalink ? ` (${p.permalink})` : ''}`).join('\n')}` : ''].filter(Boolean).join('\n\n').slice(0, 14000),
      schemaDescription: `{ "subject": string, "subjectAlternatives": string[], "preheader": string, "bodyHtml": string, "bodyText": string, "missingInfo": string[], "notes": string[] }`,
      validate: v => { const o = v as Record<string, unknown>; if (typeof o.subject !== 'string' || !o.subject) throw new Error('subject หาย'); if (typeof o.bodyHtml !== 'string' || o.bodyHtml.length < 80) throw new Error('bodyHtml สั้นเกินไป'); const html = String(o.bodyHtml).replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, '').replace(/\son[a-z]+="[^"]*"/gi, ''); return { subject: String(o.subject).slice(0, 200), subjectAlternatives: Array.isArray(o.subjectAlternatives) ? o.subjectAlternatives.map(String).slice(0, 5) : [], preheader: String(o.preheader ?? '').slice(0, 200), bodyHtml: html, bodyText: typeof o.bodyText === 'string' ? o.bodyText : undefined, missingInfo: Array.isArray(o.missingInfo) ? o.missingInfo.map(String) : [], notes: Array.isArray(o.notes) ? o.notes.map(String) : [] }; }, maxTokens: 5000,
    });
    const r = out.result.data;
    await this.prisma.emailCampaign.update({ where: { id }, data: { subject: r.subject, preheader: r.preheader, bodyHtml: r.bodyHtml, bodyText: r.bodyText ?? null, aiProvider: out.provider, aiModel: out.model, promptVersion: EMAIL_PV.writer, aiNotes: { subjectAlternatives: r.subjectAlternatives, missingInfo: r.missingInfo, notes: r.notes, sources: recent.map(x => x.id), needsHumanInput: r.missingInfo.length > 0 } as Prisma.InputJsonValue, ...(['NEEDS_REVISION', 'REJECTED'].includes(c.status) && { status: 'DRAFT' }) } });
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_CAMPAIGN_GENERATED', resourceType: 'emailCampaign', resourceId: id, after: { costUsd: out.costUsd, model: out.model, missingInfo: r.missingInfo.length }, requestId });
    return { ...(await this.load(workspaceId, id)), costUsd: out.costUsd };
  }
  private async review(workspaceId: string, userId: string, id: string, requestId: string) {
    try { await this.ai.resolve(workspaceId, 'fast'); } catch { return null; }
    const c = await this.load(workspaceId, id); const l = await this.prisma.emailList.findUniqueOrThrow({ where: { id: c.listId }, select: { brand: { select: { knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'email.review', role: 'fast', requestId, promptVersion: EMAIL_PV.review, resourceType: 'emailCampaign', resourceId: id }, {
      system: 'คุณคือ Reviewer ตรวจอีเมลการตลาดก่อนส่ง: ข้อเท็จจริง/ราคา/โปรต้องมาจากข้อมูลแบรนด์ (ไม่มี = BLOCKED), [ต้องยืนยัน] ค้าง = NEEDS_REVISION, หัวเรื่องไม่หลอก, มีลิงก์ยกเลิกรับ ({{unsubscribe_url}} หรือระบบเติมให้), ภาษาสุภาพ, CTA ชัด. PASS เมื่อพร้อม',
      prompt: `ข้อมูลแบรนด์: ${l.brand.knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.slice(0, 200)}`).join(' | ') || '-'}\n\nหัวเรื่อง: ${c.subject}\npreheader: ${c.preheader ?? '-'}\nเนื้อหา: ${(c.bodyHtml ?? '').slice(0, 5000)}`,
      schemaDescription: `{ "result": "PASS"|"NEEDS_REVISION"|"BLOCKED", "summary": string, "issues": [{ "type": string, "detail": string, "severity": "low"|"medium"|"high" }] }`,
      validate: v => { const o = v as { result?: string; summary?: string; issues?: { type?: string; detail?: string; severity?: string }[] }; if (!['PASS', 'NEEDS_REVISION', 'BLOCKED'].includes(o.result ?? '')) throw new Error('result ไม่ถูกต้อง'); return { result: o.result!, summary: String(o.summary ?? ''), issues: (o.issues ?? []).map(i => ({ type: String(i.type ?? 'other'), detail: String(i.detail ?? ''), severity: ['low', 'medium', 'high'].includes(i.severity ?? '') ? i.severity! : 'medium' })) }; }, maxTokens: 1500,
    });
    return out.result.data;
  }
  async submit(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id); if (!c.subject || !c.bodyHtml) throw new UnprocessableEntityException('ต้องมีหัวเรื่องและเนื้อหาก่อนส่งขออนุมัติ');
    if (!['DRAFT', 'NEEDS_REVISION'].includes(c.status)) throw new ConflictException(`สถานะ ${c.status} ส่งอนุมัติไม่ได้`);
    if (c.status === 'NEEDS_REVISION') await this.transition(workspaceId, userId, id, 'DRAFT', requestId);
    let review: { result: string; summary: string; issues: { type: string; detail: string; severity: string }[] } | null = null;
    try { review = await this.review(workspaceId, userId, id, requestId); } catch (e) { review = { result: 'SKIPPED', summary: `ข้ามการตรวจโดย AI: ${e instanceof Error ? e.message : String(e)}`, issues: [] }; }
    if (c.bodyHtml.includes('[ต้องยืนยัน')) review = { result: 'NEEDS_REVISION', summary: 'ยังมีข้อความ [ต้องยืนยัน] ค้าง', issues: [{ type: 'missing_info', detail: 'ยังมีข้อความ [ต้องยืนยัน] ในเนื้อหา', severity: 'high' }, ...(review?.issues ?? [])] };
    if (review && (review.result === 'NEEDS_REVISION' || review.result === 'BLOCKED')) { await this.transition(workspaceId, userId, id, 'AI_REVIEW', requestId, { reviewResult: review as unknown as Prisma.InputJsonValue }, 'EMAIL_CAMPAIGN_REVIEWED'); await this.transition(workspaceId, userId, id, 'NEEDS_REVISION', requestId); return this.load(workspaceId, id); }
    await this.transition(workspaceId, userId, id, 'READY_FOR_APPROVAL', requestId, { reviewResult: (review ?? { result: 'SKIPPED', issues: [] }) as unknown as Prisma.InputJsonValue }, 'EMAIL_CAMPAIGN_SUBMITTED');
    await this.prisma.approvalRequest.updateMany({ where: { resourceType: 'emailCampaign', resourceId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await this.prisma.approvalRequest.create({ data: { workspaceId, resourceType: 'emailCampaign', resourceId: id, requestedById: userId } });
    const subs = await this.prisma.emailSubscriber.count({ where: { listId: c.listId, status: 'SUBSCRIBED' } });
    await this.notifications.notify(workspaceId, { type: 'approval_required', severity: 'warn', title: `รออนุมัติ (อีเมล): ${c.subject}`, body: `รายชื่อ ${c.list.name} · ผู้รับ ${subs} คน`, href: '/email', resourceType: 'emailCampaign', resourceId: id, dedupeKey: `approval:email:${id}` });
    return this.load(workspaceId, id);
  }
  private async decide(workspaceId: string, userId: string, id: string, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED', comment: string | undefined, requestId: string) {
    const c = await this.load(workspaceId, id); if (c.status !== 'READY_FOR_APPROVAL') throw new ConflictException('แคมเปญนี้ไม่ได้อยู่ในคิวรออนุมัติ');
    await this.prisma.approvalRequest.updateMany({ where: { resourceType: 'emailCampaign', resourceId: id, status: 'PENDING' }, data: { status: decision, reviewedById: userId, reviewedAt: new Date(), reviewerComment: comment ?? null } });
    await this.transition(workspaceId, userId, id, decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'NEEDS_REVISION', requestId, {}, `EMAIL_CAMPAIGN_${decision}`); return this.load(workspaceId, id);
  }
  approve(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'APPROVED', comment, rid); }
  reject(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'REJECTED', comment, rid); }
  requestChanges(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'CHANGES_REQUESTED', comment, rid); }
  async reopen(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id);
    if (c.status === 'SCHEDULED') { await this.queue.cancelEmailSend(id); await this.transition(workspaceId, userId, id, 'APPROVED', requestId, { scheduledAt: null, scheduledLocal: null, scheduledTz: null }); return this.load(workspaceId, id); }
    if (c.status === 'SEND_FAILED') { await this.transition(workspaceId, userId, id, 'APPROVED', requestId); return this.load(workspaceId, id); }
    await this.transition(workspaceId, userId, id, 'DRAFT', requestId, {}, 'EMAIL_CAMPAIGN_REOPENED'); return this.load(workspaceId, id);
  }
  async cancel(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id); if (c.status === 'SCHEDULED') await this.queue.cancelEmailSend(id);
    await this.prisma.approvalRequest.updateMany({ where: { resourceType: 'emailCampaign', resourceId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await this.transition(workspaceId, userId, id, 'CANCELLED', requestId, {}, 'EMAIL_CAMPAIGN_CANCELLED'); return this.load(workspaceId, id);
  }
  /** ส่งทดสอบถึงอีเมลของสมาชิก workspace เท่านั้น (ไม่ผ่านคิว ไม่นับสถิติ) */
  async testSend(workspaceId: string, userId: string, id: string, to: string, requestId: string) {
    const c = await this.load(workspaceId, id); if (!c.subject || !c.bodyHtml) throw new UnprocessableEntityException('ต้องมีหัวเรื่องและเนื้อหาก่อน');
    const member = await this.prisma.workspaceMember.findFirst({ where: { workspaceId, user: { email: to } }, select: { userId: true } }); if (!member) throw new ForbiddenException('ส่งทดสอบได้เฉพาะอีเมลของสมาชิกใน workspace นี้');
    const acc = await this.prisma.emailProviderAccount.findUnique({ where: { workspaceId }, select: { id: true, provider: true, apiKeyEnc: true, sendingPaused: true } }); if (!acc) throw new UnprocessableEntityException('ยังไม่ได้ตั้งค่าผู้ให้บริการส่งอีเมล');
    if (!this.deps.sendEnabled) throw new UnprocessableEntityException('ระบบยังไม่เปิดให้ส่งอีเมล (EMAIL_SEND_ENABLED)');
    const r = renderEmail({ bodyHtml: c.bodyHtml, bodyText: c.bodyText, subject: `[ทดสอบ] ${c.subject}`, preheader: c.preheader, subscriber: { email: to, name: 'ผู้ทดสอบ' }, unsubscribeUrl: unsubscribeUrl(this.deps.appUrl, 'test'), fromName: c.list.fromName, brandName: c.list.brand.name });
    try { const out = await providerForAccount(this.deps, acc).send({ to: { email: to }, from: { email: c.list.fromEmail, name: c.list.fromName }, subject: r.subject, html: r.html, text: r.text, campaignId: id, sendId: `test-${userId}`, listUnsubscribeUrl: unsubscribeUrl(this.deps.appUrl, 'test') }); await this.audit.log({ workspaceId, userId, action: 'EMAIL_TEST_SENT', resourceType: 'emailCampaign', resourceId: id, after: { to, messageId: out.messageId }, requestId }); return { ok: true, messageId: out.messageId }; }
    catch (e) { rethrow(e); }
  }
  async schedule(workspaceId: string, userId: string, id: string, dto: ScheduleCampaignDto, requestId: string) {
    const c = await this.load(workspaceId, id);
    const tz = dto.timezone ?? (await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } })).timezone; if (!isValidTimeZone(tz)) throw new BadRequestException('เขตเวลาไม่ถูกต้อง');
    const at = localToUtc(dto.scheduledLocal, tz); const mins = (at.getTime() - Date.now()) / 60_000; if (mins < 10 || mins > 60 * 1440) throw new BadRequestException('ตั้งเวลาต้องล่วงหน้า 10 นาที ถึง 60 วัน');
    const blocked = await sendBlockReason(this.deps, id); if (blocked && !blocked.startsWith('สถานะ')) throw new UnprocessableEntityException(blocked);
    if (c.status === 'SEND_FAILED' || c.status === 'SCHEDULED') await this.transition(workspaceId, userId, id, 'APPROVED', requestId);
    await this.transition(workspaceId, userId, id, 'SCHEDULED', requestId, { scheduledLocal: dto.scheduledLocal, scheduledTz: tz, scheduledAt: at, lastError: null }, 'EMAIL_CAMPAIGN_SCHEDULED');
    const jobId = await this.queue.scheduleEmailSend(id, at, requestId);
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_CAMPAIGN_SCHEDULE_JOB', resourceType: 'emailCampaign', resourceId: id, after: { jobId, scheduledAt: at, tz }, requestId }); return this.load(workspaceId, id);
  }
  /** ส่งตอนนี้ — รันในคำขอ (รายชื่อเล็ก) เพื่อให้เห็นผลทันที; รายชื่อใหญ่ควรตั้งเวลาให้ worker */
  async sendNow(workspaceId: string, userId: string, id: string, requestId: string): Promise<{ outcome: SendOutcome; campaign: Awaited<ReturnType<EmailService['load']>> }> {
    const c = await this.load(workspaceId, id); if (!['APPROVED', 'SEND_FAILED', 'SCHEDULED'].includes(c.status)) throw new ConflictException('ต้องอนุมัติก่อนจึงส่งได้');
    if (c.status === 'SCHEDULED') await this.queue.cancelEmailSend(id);
    const outcome = await sendCampaign(this.deps, id, { requestId });
    await this.audit.log({ workspaceId, userId, action: 'EMAIL_CAMPAIGN_SENT', resourceType: 'emailCampaign', resourceId: id, after: outcome as unknown as Prisma.InputJsonValue, requestId });
    if (outcome.status === 'SKIPPED') throw new UnprocessableEntityException(outcome.reason);
    if (outcome.status === 'FAILED') await this.notifications.notify(workspaceId, { type: 'publish_failed', severity: 'bad', title: `ส่งอีเมลไม่สำเร็จ: ${c.subject}`, body: outcome.reason ?? `ส่งไม่ครบ ${outcome.failed} ฉบับ`, href: '/email', resourceType: 'emailCampaign', resourceId: id, dedupeKey: `email_failed:${id}` });
    return { outcome, campaign: await this.load(workspaceId, id) };
  }
  async stats(workspaceId: string, id: string) {
    const c = await this.load(workspaceId, id);
    const [sends, events] = await Promise.all([this.prisma.emailSend.groupBy({ by: ['status'], where: { campaignId: id }, _count: { _all: true } }), this.prisma.emailEvent.findMany({ where: { campaignId: id }, orderBy: { occurredAt: 'desc' }, take: 50, select: { type: true, email: true, occurredAt: true, provider: true } })]);
    return { campaign: c, sends: Object.fromEntries(sends.map(s => [s.status, s._count._all])), events, limitations: ['สถิติเปิด/คลิกมาจาก webhook ของผู้ให้บริการ — ต้องตั้ง webhook ชี้มาที่ระบบก่อน มิฉะนั้นจะเป็น "ไม่มีข้อมูล" ไม่ใช่ 0', 'อัตราเปิดต่ำกว่าจริงได้ (ผู้รับปิดโหลดรูป) และสูงกว่าจริงได้ (Apple Mail Privacy)'] };
  }
  async jobState(workspaceId: string, id: string) { await this.load(workspaceId, id); return this.queue.emailSendJobState(id); }

  // ---------- Webhook (สาธารณะ — ตรวจลายเซ็น/secret) ----------
  async handleWebhook(provider: string, workspaceId: string, headers: Record<string, string | string[] | undefined>, rawBody: string) {
    const acc = await this.prisma.emailProviderAccount.findUnique({ where: { workspaceId }, select: { provider: true, webhookSecretEnc: true } });
    if (!acc || acc.provider !== provider) throw new NotFoundException('ไม่พบการตั้งค่า webhook');
    // ไม่มี secret = ปิด webhook ไว้ (ไม่งั้นใครก็ยิงสถิติปลอมเข้ามาได้) — ตั้ง secret ในหน้าตั้งค่าก่อน
    if (!acc.webhookSecretEnc) throw new ForbiddenException('ยังไม่ได้ตั้ง webhook secret สำหรับ workspace นี้ — ตั้งในหน้าอีเมลก่อนจึงจะรับสถิติได้');
    const secret = decryptSecret(acc.webhookSecretEnc, this.deps.authSecret);
    let events; try { events = createProvider(provider as EmailProviderId, { apiKey: 'unused' }).parseWebhook(headers, rawBody, secret); } catch (e) { if (e instanceof EmailError && e.code === 'auth') throw new ForbiddenException(e.message); if (e instanceof EmailError) throw new BadRequestException(e.message); throw e; }
    const r = await applyEmailEvents(this.prisma, provider, events);
    return { received: events.length, ...r };
  }
}
