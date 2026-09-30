/**
 * พอร์ทัลลูกค้า (เจ้าของธุรกิจ) — docs/LINE_PORTAL.md
 * เจ้าของธุรกิจไม่ใช่สมาชิก workspace: เข้าถึงได้เฉพาะลูกค้าที่ได้รับเชิญ (ClientPortalMember) ผ่าน endpoint portal/* เท่านั้น
 * ทุก endpoint ตรวจสมาชิกภาพ → ได้ workspaceId จากลูกค้า → กรองข้อมูลด้วย clientId เสมอ แล้วเรียก service เดิมของทีม (กฎ/audit เหมือนกัน)
 * ทีมงาน (สมาชิก workspace) เปิดดูแบบ "มุมมองลูกค้า" ได้ แต่อ่านอย่างเดียว
 */
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { InvitesService } from '../auth/invites.service';
import type { SessionMeta } from '../auth/auth.service';
import type { AcceptInviteDto } from '../auth/dto';
import { hashToken, newSessionToken } from '../auth/password';
import { CommentsService } from '../comments/comments.service';
import { MessengerService } from '../messenger/messenger.service';
import { ContentService } from '../content/content.service';
import { ShareService } from '../reports/share.service';
import { LineService } from '../line/line.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlansService } from '../plans/plans.service';

const INVITE_TTL_MS = 7 * 86_400_000;
export interface PortalAccess { clientId: string; clientName: string; workspaceId: string; workspaceName: string; canReply: boolean; canApprove: boolean; preview: boolean }

@Injectable()
export class PortalService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InvitesService) private readonly invites: InvitesService, @Inject(CommentsService) private readonly comments: CommentsService,
    @Inject(MessengerService) private readonly messenger: MessengerService, @Inject(ContentService) private readonly content: ContentService,
    @Inject(ShareService) private readonly share: ShareService, @Inject(LineService) private readonly line: LineService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService, @Inject(PlansService) private readonly plans: PlansService,
  ) {}

  // ---------- ฝั่งทีม: เชิญ/จัดการสมาชิกพอร์ทัลของลูกค้า ----------
  private async teamClient(workspaceId: string, clientId: string) {
    const c = await this.prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true, name: true } });
    if (!c) throw new NotFoundException('ไม่พบลูกค้า'); return c;
  }
  async teamOverview(workspaceId: string, clientId: string) {
    await this.teamClient(workspaceId, clientId);
    const [members, invites, line] = await Promise.all([
      this.prisma.clientPortalMember.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' }, select: { id: true, canReply: true, canApprove: true, createdAt: true, user: { select: { id: true, name: true, email: true } } } }),
      this.prisma.clientPortalInvite.findMany({ where: { clientId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, canReply: true, canApprove: true, expiresAt: true, createdAt: true } }),
      this.prisma.lineRecipient.findMany({ where: { workspaceId, clientId }, select: { userId: true, active: true } }),
    ]);
    return { members: members.map(m => ({ ...m, lineLinked: line.some(r => r.userId === m.user.id && r.active) })), invites, portalUrl: `${this.env.APP_URL.replace(/\/+$/, '')}/portal/${clientId}` };
  }
  async createInvite(workspaceId: string, userId: string, clientId: string, dto: { email?: string; canReply: boolean; canApprove: boolean }, requestId: string) {
    const c = await this.teamClient(workspaceId, clientId);
    const token = newSessionToken();
    const inv = await this.prisma.clientPortalInvite.create({ data: { clientId, email: dto.email ?? null, canReply: dto.canReply, canApprove: dto.canApprove, tokenHash: hashToken(token), invitedById: userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) }, select: { id: true, email: true, canReply: true, canApprove: true, expiresAt: true } });
    await this.audit.log({ workspaceId, userId, action: 'portal.invite.create', resourceType: 'client', resourceId: clientId, after: { inviteId: inv.id, email: dto.email ?? null, canReply: dto.canReply, canApprove: dto.canApprove }, requestId });
    return { ...inv, clientName: c.name, url: `${this.env.APP_URL.replace(/\/+$/, '')}/portal/join/${token}` };   // ลิงก์แสดงครั้งเดียว
  }
  async revokeInvite(workspaceId: string, userId: string, clientId: string, id: string, requestId: string) {
    await this.teamClient(workspaceId, clientId);
    const r = await this.prisma.clientPortalInvite.deleteMany({ where: { id, clientId, acceptedAt: null } });
    if (!r.count) throw new NotFoundException('ไม่พบคำเชิญ');
    await this.audit.log({ workspaceId, userId, action: 'portal.invite.revoke', resourceType: 'client', resourceId: clientId, after: { inviteId: id }, requestId });
    return { ok: true };
  }
  async updateMember(workspaceId: string, userId: string, clientId: string, id: string, dto: { canReply?: boolean; canApprove?: boolean }, requestId: string) {
    await this.teamClient(workspaceId, clientId);
    const m = await this.prisma.clientPortalMember.findFirst({ where: { id, clientId }, select: { id: true } }); if (!m) throw new NotFoundException('ไม่พบสมาชิก');
    const out = await this.prisma.clientPortalMember.update({ where: { id }, data: dto, select: { id: true, canReply: true, canApprove: true } });
    await this.audit.log({ workspaceId, userId, action: 'portal.member.update', resourceType: 'client', resourceId: clientId, after: { memberId: id, ...dto }, requestId });
    return out;
  }
  /** ถอดสิทธิ์ — ลบสมาชิก + เลิกส่ง LINE ของคนนั้นสำหรับลูกค้านี้ (บัญชีผู้ใช้ยังอยู่) */
  async removeMember(workspaceId: string, userId: string, clientId: string, id: string, requestId: string) {
    await this.teamClient(workspaceId, clientId);
    const m = await this.prisma.clientPortalMember.findFirst({ where: { id, clientId }, select: { id: true, userId: true } }); if (!m) throw new NotFoundException('ไม่พบสมาชิก');
    await this.prisma.$transaction([
      this.prisma.clientPortalMember.delete({ where: { id } }),
      this.prisma.lineRecipient.deleteMany({ where: { workspaceId, clientId, userId: m.userId } }),
      this.prisma.lineLinkCode.deleteMany({ where: { workspaceId, clientId, userId: m.userId } }),
    ]);
    await this.audit.log({ workspaceId, userId, action: 'portal.member.remove', resourceType: 'client', resourceId: clientId, after: { memberId: id, userId: m.userId }, requestId });
    return { ok: true };
  }

  // ---------- คำเชิญ (สาธารณะ) ----------
  private async validInvite(token: string) {
    const inv = await this.prisma.clientPortalInvite.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, clientId: true, email: true, canReply: true, canApprove: true, expiresAt: true, acceptedAt: true, client: { select: { name: true, workspaceId: true, status: true, workspace: { select: { name: true } } } } } });
    if (!inv || inv.acceptedAt || inv.expiresAt.getTime() < Date.now() || inv.client.status === 'ARCHIVED') return null;
    return inv;
  }
  async inspectInvite(token: string) {
    const inv = await this.validInvite(token);
    return inv ? { valid: true as const, clientName: inv.client.name, agencyName: inv.client.workspace.name, email: inv.email } : { valid: false as const };
  }
  async acceptInvite(token: string, currentUserId: string | null, dto: AcceptInviteDto, meta: SessionMeta) {
    const inv = await this.validInvite(token);
    if (!inv) throw new NotFoundException('คำเชิญไม่ถูกต้องหรือหมดอายุ');
    const { userId, sessionToken } = await this.invites.joinAs(currentUserId, dto, inv.email, meta);
    const existing = await this.prisma.clientPortalMember.findUnique({ where: { clientId_userId: { clientId: inv.clientId, userId } }, select: { id: true } });
    await this.prisma.$transaction([
      existing ? this.prisma.clientPortalMember.update({ where: { id: existing.id }, data: { canReply: inv.canReply, canApprove: inv.canApprove } })
        : this.prisma.clientPortalMember.create({ data: { clientId: inv.clientId, userId, canReply: inv.canReply, canApprove: inv.canApprove } }),
      this.prisma.clientPortalInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date(), acceptedById: userId } }),
    ]);
    await this.audit.log({ workspaceId: inv.client.workspaceId, userId, action: 'portal.member.join', resourceType: 'client', resourceId: inv.clientId, after: { inviteId: inv.id }, requestId: meta.requestId });
    return { clientId: inv.clientId, clientName: inv.client.name, token: sessionToken };
  }

  // ---------- สิทธิ์เข้าถึง ----------
  async access(userId: string, clientId: string): Promise<PortalAccess> {
    const c = await this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, status: true, workspaceId: true, workspace: { select: { name: true } } } });
    if (c && c.status !== 'ARCHIVED') {
      const base = { clientId: c.id, clientName: c.name, workspaceId: c.workspaceId, workspaceName: c.workspace.name };
      const m = await this.prisma.clientPortalMember.findUnique({ where: { clientId_userId: { clientId, userId } }, select: { canReply: true, canApprove: true } });
      if (m) return { ...base, canReply: m.canReply, canApprove: m.canApprove, preview: false };
      const wm = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: c.workspaceId, userId } }, select: { role: true } });
      if (wm) return { ...base, canReply: false, canApprove: false, preview: true };
    }
    throw new NotFoundException('ไม่พบลูกค้า');   // ไม่เผยว่ามีลูกค้านี้อยู่หรือไม่
  }
  private need(a: PortalAccess, what: 'reply' | 'approve') {
    if (a.preview) throw new ForbiddenException('มุมมองลูกค้า (ทีมงาน) อ่านอย่างเดียว — ทำรายการในหน้าของทีม');
    if (what === 'reply' && !a.canReply) throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์ตอบลูกค้า — ติดต่อทีมงาน');
    if (what === 'approve' && !a.canApprove) throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์อนุมัติโพสต์ — ติดต่อทีมงาน');
  }
  private pages = (a: PortalAccess): Prisma.FacebookPageWhereInput => ({ brand: { clientId: a.clientId, client: { workspaceId: a.workspaceId } } });

  async overview(a: PortalAccess) {
    const page = this.pages(a); const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [pages, pendingComments, needsAttention, newLeads, approvals, commentsWeek, leadsWeek] = await Promise.all([
      this.prisma.facebookPage.findMany({ where: { ...page, disconnectedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, pictureUrl: true, fanCount: true, tokenStatus: true, timezone: true, billingDay: true, servicePlan: { select: { id: true, name: true, priceMonthly: true, postsPerMonth: true, reelsPerMonth: true, features: true } } } }),
      this.prisma.pageComment.count({ where: { page, resolvedAt: null, replyStatus: { not: 'SENT' }, isHidden: false } }),
      this.prisma.messengerConversation.count({ where: { page, needsAttention: true } }),
      this.prisma.lead.count({ where: { workspaceId: a.workspaceId, page, status: 'NEW' } }),
      this.prisma.contentItem.count({ where: { platform: 'FACEBOOK', status: 'READY_FOR_APPROVAL', page } }),
      this.prisma.pageComment.count({ where: { page, createdTime: { gte: weekAgo } } }),
      this.prisma.lead.count({ where: { workspaceId: a.workspaceId, page, createdAt: { gte: weekAgo } } }),
    ]);
    // โควต้าโพสต์ของแพ็กเกจ (ไม่แสดงราคาให้เจ้าของ)
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { timezone: true } });
    const quotas = await this.plans.quotas(pages, ws.timezone);
    const pageRows = pages.map(({ timezone: _tz, billingDay: _bd, servicePlan, ...p }) => { const q = quotas.get(p.id)!; return { ...p, plan: servicePlan && { name: servicePlan.name, postsPerMonth: servicePlan.postsPerMonth, reelsPerMonth: servicePlan.reelsPerMonth, features: servicePlan.features }, cycle: { start: q.cycle.start, end: q.cycle.end, startDate: q.cycle.startDate, lastDate: q.cycle.lastDate, daysLeft: q.cycle.daysLeft }, quota: { limit: q.quota.limit, used: q.quota.used, planned: q.quota.planned, remaining: q.quota.remaining }, reels: q.reels }; });
    return { client: { id: a.clientId, name: a.clientName }, agencyName: a.workspaceName, canReply: a.canReply, canApprove: a.canApprove, preview: a.preview, pages: pageRows, counts: { pendingComments, needsAttention, newLeads, approvals, commentsWeek, leadsWeek } };
  }

  // ---------- คอมเมนต์ ----------
  listComments(a: PortalAccess, q: { view?: 'pending' | 'all'; pageId?: string }) {
    return this.prisma.pageComment.findMany({
      where: { page: this.pages(a), ...(q.pageId && { pageId: q.pageId }), ...(q.view !== 'all' && { resolvedAt: null, replyStatus: { not: 'SENT' }, isHidden: false }) },
      orderBy: { createdTime: 'desc' }, take: 150,
      select: { id: true, pageId: true, fromName: true, message: true, createdTime: true, permalink: true, classification: true, sentiment: true, riskFlag: true, draftReply: true, replyStatus: true, repliedAt: true, resolvedAt: true, parentCommentId: true, page: { select: { name: true } }, post: { select: { message: true, permalink: true } }, lead: { select: { id: true, leadScore: true, status: true } } },
    });
  }
  private async ownComment(a: PortalAccess, id: string) {
    const c = await this.prisma.pageComment.findFirst({ where: { id, page: this.pages(a) }, select: { id: true } });
    if (!c) throw new NotFoundException('ไม่พบคอมเมนต์');
  }
  async replyComment(a: PortalAccess, userId: string, id: string, message: string, requestId: string) {
    this.need(a, 'reply'); await this.ownComment(a, id);
    return this.comments.sendReply(a.workspaceId, userId, id, message, requestId);
  }
  async resolveComment(a: PortalAccess, userId: string, id: string, resolved: boolean, requestId: string) {
    this.need(a, 'reply'); await this.ownComment(a, id);
    await this.comments.update(a.workspaceId, userId, id, { resolved }, requestId);
    return { ok: true };
  }

  // ---------- แชท Messenger ----------
  async conversations(a: PortalAccess, pageId?: string) {
    const rows = await this.prisma.messengerConversation.findMany({ where: { page: this.pages(a), ...(pageId && { pageId }) }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, pageId: true, mode: true, needsAttention: true, lastCustomerAt: true, updatedAt: true, page: { select: { name: true } }, messages: { orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take: 1, select: { direction: true, text: true, status: true, occurredAt: true } } } });
    return rows.map(({ messages, ...r }) => ({ ...r, last: messages[0] ?? null }));
  }
  private async ownConversation(a: PortalAccess, id: string) {
    const c = await this.prisma.messengerConversation.findFirst({ where: { id, page: this.pages(a) }, select: { id: true, page: { select: { name: true } } } });
    if (!c) throw new NotFoundException('ไม่พบบทสนทนา'); return c;
  }
  async conversation(a: PortalAccess, id: string) {
    const c = await this.ownConversation(a, id);
    const full = await this.messenger.conversation(a.workspaceId, id);
    // ไม่ส่ง psid/รหัสภายในของ Meta ออกไป — เจ้าของเห็นเฉพาะข้อความ
    return { id: full.id, pageId: full.pageId, pageName: c.page.name, mode: full.mode, needsAttention: full.needsAttention, lastCustomerAt: full.lastCustomerAt, messages: full.messages.map(m => ({ id: m.id, direction: m.direction, text: m.text, status: m.status, replyText: m.replyText, occurredAt: m.occurredAt, sentAt: m.sentAt })) };
  }
  async sendMessage(a: PortalAccess, userId: string, id: string, b: { text: string; messageId?: string; resumeAi?: boolean }, requestId: string) {
    this.need(a, 'reply'); await this.ownConversation(a, id);
    return this.messenger.send(a.workspaceId, userId, id, b, requestId);
  }

  // ---------- ลีด ----------
  leads(a: PortalAccess, status?: string) {
    return this.prisma.lead.findMany({ where: { workspaceId: a.workspaceId, page: this.pages(a), ...(status && { status }) }, orderBy: [{ status: 'asc' }, { leadScore: 'desc' }, { createdAt: 'desc' }], take: 200, select: { id: true, name: true, intent: true, product: true, service: true, quantity: true, requestedDate: true, location: true, budget: true, phone: true, urgency: true, leadScore: true, status: true, notes: true, createdAt: true, page: { select: { name: true } }, comment: { select: { message: true, fromName: true, permalink: true } } } });
  }
  async updateLead(a: PortalAccess, userId: string, id: string, dto: { status?: string; notes?: string }, requestId: string) {
    this.need(a, 'reply');
    const l = await this.prisma.lead.findFirst({ where: { id, workspaceId: a.workspaceId, page: this.pages(a) }, select: { id: true } });
    if (!l) throw new NotFoundException('ไม่พบลีด');
    return this.comments.updateLead(a.workspaceId, userId, id, dto as Parameters<CommentsService['updateLead']>[3], requestId);
  }

  // ---------- อนุมัติโพสต์ (Facebook) ----------
  async approvals(a: PortalAccess) {
    const rows = await this.prisma.contentItem.findMany({ where: { platform: 'FACEBOOK', status: 'READY_FOR_APPROVAL', page: this.pages(a) }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, title: true, caption: true, hashtags: true, cta: true, contentType: true, scheduledLocal: true, mediaPaths: true, updatedAt: true, page: { select: { name: true } } } });
    const assets = await this.prisma.mediaAsset.findMany({ where: { contentId: { in: rows.map(r => r.id) }, workspaceId: a.workspaceId }, select: { id: true, contentId: true, path: true, mimeType: true } });
    return rows.map(({ mediaPaths, ...r }) => ({ ...r, media: assets.filter(m => m.contentId === r.id && mediaPaths.includes(m.path)).map(m => ({ id: m.id, mimeType: m.mimeType })) }));
  }
  private async ownContent(a: PortalAccess, id: string) {
    const c = await this.prisma.contentItem.findFirst({ where: { id, platform: 'FACEBOOK', page: this.pages(a) }, select: { id: true, title: true, caption: true } });
    if (!c) throw new NotFoundException('ไม่พบโพสต์'); return c;
  }
  async decide(a: PortalAccess, userId: string, id: string, decision: 'approve' | 'changes', comment: string | undefined, requestId: string) {
    this.need(a, 'approve'); const c = await this.ownContent(a, id);
    const out = decision === 'approve' ? await this.content.approve(a.workspaceId, userId, id, comment, requestId) : await this.content.requestChanges(a.workspaceId, userId, id, comment, requestId);
    const label = c.title ?? (c.caption ?? '').slice(0, 40);
    await this.notifications.notify(a.workspaceId, { type: 'client_decision', severity: decision === 'approve' ? 'info' : 'warn', title: decision === 'approve' ? `ลูกค้าอนุมัติแล้ว: ${label}` : `ลูกค้าขอแก้: ${label}`, body: comment ? `ความเห็น: ${comment.slice(0, 300)}` : undefined, href: '/content', resourceType: 'contentItem', resourceId: id, clientId: a.clientId });   // เจ้าของไม่ได้รับซ้ำ (client_decision ไม่อยู่ในชนิดของเจ้าของ)
    return { id: out.id, status: out.status };
  }
  async mediaFile(a: PortalAccess, assetId: string) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id: assetId, workspaceId: a.workspaceId }, select: { path: true, mimeType: true, contentId: true } });
    if (!m?.contentId) throw new NotFoundException('ไม่พบไฟล์');
    await this.ownContent(a, m.contentId);
    if (!existsSync(m.path)) throw new NotFoundException('ไม่พบไฟล์');
    return { path: resolve(m.path), mimeType: m.mimeType };
  }

  // ---------- รายงาน ----------
  reports(a: PortalAccess) {
    return this.prisma.report.findMany({ where: { page: this.pages(a) }, orderBy: { createdAt: 'desc' }, take: 24, select: { id: true, periodStart: true, periodEnd: true, createdAt: true, page: { select: { name: true } } } });
  }
  /** เปิดรายงานผ่านลิงก์แชร์ (หน้า /share/r/... เดิม ไม่มีข้อมูลภายใน) อายุ 7 วัน */
  async reportLink(a: PortalAccess, userId: string, id: string, requestId: string) {
    const r = await this.prisma.report.findFirst({ where: { id, page: this.pages(a) }, select: { id: true } });
    if (!r) throw new NotFoundException('ไม่พบรายงาน');
    return this.share.createLink(a.workspaceId, userId, 'facebook', id, 7, requestId);
  }

  // ---------- LINE ของเจ้าของธุรกิจ ----------
  async lineStatus(a: PortalAccess, userId: string) {
    const ch = await this.prisma.lineChannel.findUnique({ where: { workspaceId: a.workspaceId }, select: { botBasicId: true } });
    return { available: !!ch, recipients: a.preview ? [] : await this.line.recipientsFor(a.workspaceId, userId, a.clientId) };
  }
  lineLinkCode(a: PortalAccess, userId: string) {
    if (a.preview) throw new ConflictException('ทีมงานผูก LINE ได้ที่หน้าตั้งค่าของทีม');
    return this.line.createLinkCode(a.workspaceId, userId, a.clientId);
  }
  lineUpdate(a: PortalAccess, userId: string, id: string, dto: { active?: boolean; types?: string[] }) { return this.line.updateRecipient(a.workspaceId, id, dto, { userId, clientId: a.clientId }); }
  lineRemove(a: PortalAccess, userId: string, id: string) { return this.line.removeRecipient(a.workspaceId, id, { userId, clientId: a.clientId }); }
}
