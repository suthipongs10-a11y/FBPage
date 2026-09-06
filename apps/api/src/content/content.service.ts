/**
 * Content domain (§28, §29, §47, §48, §55) — state machine ชัดเจน, approval บันทึกทุกครั้ง, ตั้งเวลาฝั่งเซิร์ฟเวอร์, เผยแพร่ผ่าน publisher กันซ้ำ
 */
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { contentInWorkspace, pageInWorkspace } from '@fbpm/database';
import { publishBlockReason, publishContent, type PublishOutcome } from '@fbpm/facebook-core';
import { canTransitionContent, type ContentStatus } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../jobs/queue.service';
import { SyncService } from '../facebook/sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isValidTimeZone, localToUtc } from './tz';
import type { CalendarDto, CreateContentDto, ListContentDto, ScheduleDto, UpdateContentDto } from './dto';

export const CONTENT_SELECT = {
  id: true, pageId: true, platform: true, ytStatus: true, youtubeChannel: { select: { id: true, title: true } }, youtubeMeta: { select: { title: true, format: true, privacyStatus: true, scheduledPublishAt: true } }, siteId: true, site: { select: { id: true, name: true, url: true } }, webMeta: { select: { title: true, slug: true, wpLink: true, wpStatus: true } }, status: true, contentType: true, title: true, caption: true, cta: true, hashtags: true, mediaBrief: true, mediaPaths: true, objective: true, contentPillar: true,
  scheduledLocal: true, scheduledTz: true, scheduledAt: true, retryCount: true, createdById: true, aiProvider: true, aiModel: true, promptVersion: true, editedByHuman: true,
  publishedPostId: true, externalPostId: true, publishedAt: true, planId: true, aiNotes: true, reviewResult: true, lastError: true, createdAt: true, updatedAt: true,
  page: { select: { id: true, name: true, pictureUrl: true, timezone: true, automationLevel: true, publishingPaused: true, tokenStatus: true, brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } } } },
  approvals: { orderBy: { requestedAt: 'desc' as const }, take: 5, select: { id: true, status: true, requestedAt: true, reviewedAt: true, reviewerComment: true, requestedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } } },
  _count: { select: { revisions: true } },
} as const;

@Injectable()
export class ContentService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  private async load(workspaceId: string, id: string) {
    const c = await this.prisma.contentItem.findFirst({ where: { id, ...contentInWorkspace(workspaceId) }, select: CONTENT_SELECT });
    if (!c) throw new NotFoundException('ไม่พบคอนเทนต์');
    return c;
  }

  /** เปลี่ยนสถานะตาม state machine (§28) — ห้ามข้าม */
  private async transition(workspaceId: string, userId: string | null, id: string, to: ContentStatus, requestId: string, extra: Prisma.ContentItemUpdateInput = {}, action = 'content.transition') {
    const c = await this.load(workspaceId, id);
    if (!canTransitionContent(c.status as ContentStatus, to)) throw new ConflictException(`เปลี่ยนสถานะจาก ${c.status} → ${to} ไม่ได้`);
    const out = await this.prisma.contentItem.update({ where: { id }, data: { status: to, ...extra }, select: CONTENT_SELECT });
    await this.audit.log({ workspaceId, userId, action, resourceType: 'contentItem', resourceId: id, before: { status: c.status }, after: { status: to }, requestId });
    return out;
  }

  list(workspaceId: string, q: ListContentDto) {
    return this.prisma.contentItem.findMany({ where: { ...contentInWorkspace(workspaceId), ...(q.pageId && { pageId: q.pageId }), ...(q.status && { status: q.status }) }, orderBy: [{ updatedAt: 'desc' }], take: q.limit ?? 200, select: CONTENT_SELECT });
  }

  get(workspaceId: string, id: string) { return this.load(workspaceId, id); }

  async revisions(workspaceId: string, id: string) {
    await this.load(workspaceId, id);
    return this.prisma.contentRevision.findMany({ where: { contentId: id }, orderBy: { version: 'desc' }, select: { version: true, caption: true, editedBy: true, reason: true, createdAt: true } });
  }

  async create(workspaceId: string, userId: string, dto: CreateContentDto, requestId: string, ai?: { provider: string; model: string; promptVersion: string; notes?: unknown; planId?: string; status?: ContentStatus }) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: dto.pageId, ...pageInWorkspace(workspaceId) }, select: { id: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    const c = await this.prisma.contentItem.create({
      data: { ...dto, status: ai?.status ?? 'DRAFT', createdById: userId, aiProvider: ai?.provider ?? null, aiModel: ai?.model ?? null, promptVersion: ai?.promptVersion ?? null, aiNotes: (ai?.notes as Prisma.InputJsonValue) ?? undefined, planId: ai?.planId ?? null, revisions: dto.caption ? { create: { version: 1, caption: dto.caption, editedBy: ai ? 'ai' : userId, reason: ai ? 'ai draft' : 'created' } } : undefined },
      select: CONTENT_SELECT,
    });
    await this.audit.log({ workspaceId, userId, action: ai ? 'content.create.ai' : 'content.create', resourceType: 'contentItem', resourceId: c.id, after: { pageId: dto.pageId, title: dto.title, status: c.status }, requestId });
    return c;
  }

  /** แก้ไขโดยคน (§55) — เก็บ revision ทุกครั้งที่ caption เปลี่ยน; แก้ได้เฉพาะก่อน APPROVED */
  async update(workspaceId: string, userId: string, id: string, dto: UpdateContentDto, requestId: string) {
    const c = await this.load(workspaceId, id);
    if (['PUBLISHING', 'PUBLISHED', 'ANALYZED', 'CANCELLED'].includes(c.status)) throw new ConflictException(`แก้ไขคอนเทนต์สถานะ ${c.status} ไม่ได้`);
    const { reason, ...fields } = dto;
    const captionChanged = fields.caption !== undefined && fields.caption !== c.caption;
    // แก้หลังอนุมัติ/ตั้งเวลา → ต้องกลับไปขออนุมัติใหม่ (§29)
    const backToDraft = ['APPROVED', 'SCHEDULED', 'READY_FOR_APPROVAL', 'PUBLISH_FAILED'].includes(c.status) && (captionChanged || fields.mediaPaths !== undefined || fields.hashtags !== undefined);
    if (backToDraft && c.status === 'SCHEDULED') await this.queue.cancelPublish(id);
    const out = await this.prisma.contentItem.update({
      where: { id },
      data: { ...fields, editedByHuman: true, ...(backToDraft && { status: 'DRAFT', scheduledAt: null, scheduledLocal: null, scheduledTz: null, reviewResult: undefined }), ...(captionChanged && { revisions: { create: { version: c._count.revisions + 1, caption: fields.caption ?? null, editedBy: userId, reason: reason ?? 'human edit' } } }) },
      select: CONTENT_SELECT,
    });
    await this.audit.log({ workspaceId, userId, action: 'content.update', resourceType: 'contentItem', resourceId: id, before: { status: c.status, caption: c.caption?.slice(0, 200) }, after: { ...fields, caption: fields.caption?.slice(0, 200), status: out.status }, requestId });
    return out;
  }

  /** ส่งขออนุมัติ — สร้าง ApprovalRequest PENDING (§29). ผลรีวิว AI (ถ้ามี) ถูกบันทึกไว้ก่อนเรียก */
  async submit(workspaceId: string, userId: string, id: string, requestId: string, review?: { result: string; issues: unknown[] }) {
    const c = await this.load(workspaceId, id);
    if (!c.caption && !c.mediaPaths.length) throw new UnprocessableEntityException('ต้องมีข้อความหรือรูปก่อนส่งขออนุมัติ');
    if (review?.result === 'NEEDS_REVISION' || review?.result === 'BLOCKED') {
      return this.transition(workspaceId, userId, id, c.status === 'DRAFT' ? 'AI_REVIEW' : 'NEEDS_REVISION', requestId, { reviewResult: review as unknown as Prisma.InputJsonValue }, 'content.review').then(x => x.status === 'AI_REVIEW' ? this.transition(workspaceId, userId, id, 'NEEDS_REVISION', requestId, {}, 'content.review') : x);
    }
    if (c.status === 'NEEDS_REVISION') await this.transition(workspaceId, userId, id, 'DRAFT', requestId);
    const out = await this.transition(workspaceId, userId, id, 'READY_FOR_APPROVAL', requestId, { reviewResult: review ? (review as unknown as Prisma.InputJsonValue) : undefined }, 'content.submit');
    await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await this.prisma.approvalRequest.create({ data: { workspaceId, resourceType: 'contentItem', resourceId: id, contentId: id, requestedById: userId } });
    await this.notifications.notify(workspaceId, { type: 'approval_required', severity: 'warn', title: `รออนุมัติ: ${c.title ?? (c.caption ?? '').slice(0, 40)}`, body: c.page ? `เพจ ${c.page.name}` : 'YouTube', href: '/content', resourceType: 'contentItem', resourceId: id, dedupeKey: `approval:${id}` });
    return this.load(workspaceId, out.id);
  }

  private async decide(workspaceId: string, userId: string, id: string, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED', comment: string | undefined, requestId: string) {
    const c = await this.load(workspaceId, id);
    if (c.status !== 'READY_FOR_APPROVAL') throw new ConflictException('คอนเทนต์นี้ไม่ได้อยู่ในคิวรออนุมัติ');
    if (decision === 'APPROVED' && c.createdById === userId && !c.aiProvider) {
      // คนสร้างเองอนุมัติเองได้ (ทีมเล็ก) แต่บันทึกไว้ให้เห็นใน audit
      await this.audit.log({ workspaceId, userId, action: 'content.approve.self', resourceType: 'contentItem', resourceId: id, requestId });
    }
    await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: decision, reviewedById: userId, reviewedAt: new Date(), reviewerComment: comment ?? null } });
    const to: ContentStatus = decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'NEEDS_REVISION';
    await this.transition(workspaceId, userId, id, to, requestId, {}, `content.${decision.toLowerCase()}`);
    return this.load(workspaceId, id);
  }
  approve(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'APPROVED', comment, rid); }
  reject(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'REJECTED', comment, rid); }
  requestChanges(ws: string, u: string, id: string, comment: string | undefined, rid: string) { return this.decide(ws, u, id, 'CHANGES_REQUESTED', comment, rid); }

  async backToDraft(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id);
    if (c.status === 'SCHEDULED') await this.queue.cancelPublish(id);
    if (c.status === 'SCHEDULED' || c.status === 'PUBLISH_FAILED') { await this.transition(workspaceId, userId, id, 'APPROVED', requestId, { scheduledAt: null, scheduledLocal: null, scheduledTz: null }); return this.load(workspaceId, id); }
    return this.transition(workspaceId, userId, id, 'DRAFT', requestId, {}, 'content.reopen');
  }

  async cancel(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.load(workspaceId, id);
    if (c.status === 'SCHEDULED') await this.queue.cancelPublish(id);
    await this.prisma.approvalRequest.updateMany({ where: { contentId: id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    return this.transition(workspaceId, userId, id, 'CANCELLED', requestId, {}, 'content.cancel');
  }

  /** ตั้งเวลา (§47): เก็บเวลา local + โซน + UTC แล้ว enqueue งานเผยแพร่ฝั่งเซิร์ฟเวอร์ */
  async schedule(workspaceId: string, userId: string, id: string, dto: ScheduleDto, requestId: string) {
    const c = await this.load(workspaceId, id);
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
    const tz = dto.timezone ?? c.page?.timezone ?? ws.timezone;
    if (!isValidTimeZone(tz)) throw new BadRequestException('เขตเวลาไม่ถูกต้อง');
    const at = localToUtc(dto.scheduledLocal, tz);
    const mins = (at.getTime() - Date.now()) / 60_000;
    if (mins < 10 || mins > 75 * 1440) throw new BadRequestException('ตั้งเวลาต้องล่วงหน้า 10 นาที ถึง 75 วัน');
    const blocked = await publishBlockReason(this.prisma, id);
    if (blocked && !blocked.startsWith('สถานะ')) throw new UnprocessableEntityException(blocked);
    if (c.status === 'PUBLISH_FAILED') await this.transition(workspaceId, userId, id, 'APPROVED', requestId);
    else if (c.status === 'SCHEDULED') await this.transition(workspaceId, userId, id, 'APPROVED', requestId);
    await this.transition(workspaceId, userId, id, 'SCHEDULED', requestId, { scheduledLocal: dto.scheduledLocal, scheduledTz: tz, scheduledAt: at, lastError: null }, 'content.schedule');
    const jobId = await this.queue.schedulePublish(id, at, requestId);
    await this.audit.log({ workspaceId, userId, action: 'content.schedule.job', resourceType: 'contentItem', resourceId: id, after: { jobId, scheduledAt: at, tz }, requestId });
    return this.load(workspaceId, id);
  }

  /** โพสต์ตอนนี้ (ต้อง APPROVED) — รัน publisher ทันทีในคำขอนี้เพื่อให้ผู้ใช้เห็นผลเลย */
  async publishNow(workspaceId: string, userId: string, id: string, requestId: string): Promise<{ outcome: PublishOutcome; content: Awaited<ReturnType<ContentService['load']>> }> {
    const c = await this.load(workspaceId, id);
    if (!['APPROVED', 'PUBLISH_FAILED', 'SCHEDULED'].includes(c.status)) throw new ConflictException('ต้องอนุมัติก่อนจึงโพสต์ได้');
    if (c.status === 'SCHEDULED') await this.queue.cancelPublish(id);
    const outcome = await publishContent(this.sync.deps, id, { requestId });
    await this.audit.log({ workspaceId, userId, action: 'content.publish', resourceType: 'contentItem', resourceId: id, after: outcome as unknown as Prisma.InputJsonValue, requestId });
    if (outcome.status === 'PUBLISHED') await this.queue.scheduleMetricCollection(outcome.postId, requestId).catch(() => undefined);
    if (outcome.status === 'FAILED') await this.notifications.notify(workspaceId, { type: 'publish_failed', severity: 'bad', title: `โพสต์ไม่สำเร็จ: ${c.title ?? (c.caption ?? '').slice(0, 40)}`, body: outcome.error, href: '/content', resourceType: 'contentItem', resourceId: id, dedupeKey: `publish_failed:${id}` });
    return { outcome, content: await this.load(workspaceId, id) };
  }

  async jobState(workspaceId: string, id: string) { await this.load(workspaceId, id); return this.queue.publishJobState(id); }

  /** ปฏิทิน (§39): รายการที่มีเวลา (ตั้งเวลา/เผยแพร่แล้ว) ในช่วง */
  calendar(workspaceId: string, q: CalendarDto) {
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86_400_000);
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 30 * 86_400_000);
    return this.prisma.contentItem.findMany({
      where: { ...contentInWorkspace(workspaceId), ...(q.pageId && { pageId: q.pageId }), OR: [{ scheduledAt: { gte: from, lte: to } }, { publishedAt: { gte: from, lte: to } }] },
      orderBy: [{ scheduledAt: 'asc' }], select: CONTENT_SELECT,
    });
  }

  async pendingApprovals(workspaceId: string) {
    return this.prisma.approvalRequest.findMany({ where: { workspaceId, status: 'PENDING' }, orderBy: { requestedAt: 'asc' }, select: { id: true, requestedAt: true, requestedBy: { select: { name: true } }, content: { select: CONTENT_SELECT } } });
  }
}
