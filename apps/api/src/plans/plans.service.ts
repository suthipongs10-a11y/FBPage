/**
 * แพ็กเกจลูกค้า + โควต้าโพสต์ต่อเดือน + ภาพรวมทุกเพจ — docs/PLANS_QUOTA.md
 * นับเฉพาะโพสต์ Facebook ที่ออกจากระบบ (ContentItem) ในรอบบิลของแต่ละเพจ · ตั้งเวลาไว้ในรอบ = นับว่า "ลงไว้แล้ว"
 * โควต้าเป็นตัวบอกงาน ไม่ได้บล็อกการตั้งเวลา/โพสต์ (ทีมตัดสินใจเองว่าจะให้เกินได้ไหม)
 */
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { pageInWorkspace } from '@fbpm/database';
import { billingCycle, quotaStatus, type BillingCycle, type QuotaStatus } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';

const PLAN_SELECT = { id: true, name: true, description: true, priceMonthly: true, postsPerMonth: true, reelsPerMonth: true, features: true, active: true, sortOrder: true, createdAt: true, updatedAt: true } as const;
const DONE = ['PUBLISHED', 'ANALYZED'];
const QUEUED = ['SCHEDULED', 'PUBLISHING'];
const STALE_DAYS = 7;
const UPCOMING_DAYS = 3;
export interface PlanDto { name: string; description?: string | null; priceMonthly?: number | null; postsPerMonth?: number | null; reelsPerMonth?: number | null; features?: string[]; active?: boolean; sortOrder?: number }

interface PageLite { id: string; name: string; pictureUrl: string | null; fanCount: number | null; tokenStatus: string; publishingPaused: boolean; timezone: string | null; billingDay: number; planStartedAt: Date | null; brand: { id: string; name: string; client: { id: string; name: string } }; servicePlan: { id: string; name: string; priceMonthly: number | null; postsPerMonth: number | null; reelsPerMonth: number | null; features: string[] } | null }
export interface PageQuota {
  cycle: BillingCycle; quota: QuotaStatus; scheduled: number;
  reels: { limit: number | null; planned: number; remaining: number | null };
  pagePosts: number;   // โพสต์บนเพจในรอบ (รวมที่โพสต์นอกระบบ — จากการซิงก์ อาจช้ากว่าจริง)
}

@Injectable()
export class PlansService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AuditService) private readonly audit: AuditService) {}

  // ---------- แพ็กเกจ ----------
  async list(workspaceId: string) {
    const [plans, counts] = await Promise.all([
      this.prisma.servicePlan.findMany({ where: { workspaceId }, orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { priceMonthly: 'asc' }, { name: 'asc' }], select: PLAN_SELECT }),
      this.prisma.facebookPage.groupBy({ by: ['servicePlanId'], where: { ...pageInWorkspace(workspaceId), disconnectedAt: null, servicePlanId: { not: null } }, _count: { _all: true } }),
    ]);
    const n = new Map(counts.map(c => [c.servicePlanId, c._count._all]));
    return plans.map(p => ({ ...p, pages: n.get(p.id) ?? 0 }));
  }
  async create(workspaceId: string, userId: string, dto: PlanDto, requestId: string) {
    try {
      const p = await this.prisma.servicePlan.create({ data: { workspaceId, ...dto, features: dto.features ?? [] }, select: PLAN_SELECT });
      await this.audit.log({ workspaceId, userId, action: 'plan.create', resourceType: 'servicePlan', resourceId: p.id, after: dto as unknown as Prisma.InputJsonValue, requestId });
      return p;
    } catch (e) { if ((e as { code?: string }).code === 'P2002') throw new ConflictException('มีแพ็กเกจชื่อนี้แล้ว'); throw e; }
  }
  async update(workspaceId: string, userId: string, id: string, dto: Partial<PlanDto>, requestId: string) {
    const before = await this.prisma.servicePlan.findFirst({ where: { id, workspaceId }, select: PLAN_SELECT });
    if (!before) throw new NotFoundException('ไม่พบแพ็กเกจ');
    try {
      const p = await this.prisma.servicePlan.update({ where: { id }, data: dto, select: PLAN_SELECT });
      await this.audit.log({ workspaceId, userId, action: 'plan.update', resourceType: 'servicePlan', resourceId: id, before: before as unknown as Prisma.InputJsonValue, after: dto as unknown as Prisma.InputJsonValue, requestId });
      return p;
    } catch (e) { if ((e as { code?: string }).code === 'P2002') throw new ConflictException('มีแพ็กเกจชื่อนี้แล้ว'); throw e; }
  }
  /** ลบได้เฉพาะแพ็กเกจที่ไม่มีเพจใช้อยู่ — มีเพจใช้ให้ปิด (active=false) แทน เพื่อไม่ให้ประวัติราคาหาย */
  async remove(workspaceId: string, userId: string, id: string, requestId: string) {
    const p = await this.prisma.servicePlan.findFirst({ where: { id, workspaceId }, select: { id: true, name: true, _count: { select: { pages: true } } } });
    if (!p) throw new NotFoundException('ไม่พบแพ็กเกจ');
    if (p._count.pages > 0) throw new ConflictException(`มีเพจใช้แพ็กเกจนี้อยู่ ${p._count.pages} เพจ — ย้ายเพจไปแพ็กเกจอื่น หรือกดปิดแพ็กเกจแทนการลบ`);
    await this.prisma.servicePlan.delete({ where: { id } });
    await this.audit.log({ workspaceId, userId, action: 'plan.delete', resourceType: 'servicePlan', resourceId: id, before: { name: p.name }, requestId });
    return { ok: true };
  }

  /** กำหนดแพ็กเกจ/วันตัดรอบให้เพจ — servicePlanId null = ถอดแพ็กเกจ */
  async assign(workspaceId: string, userId: string, pageId: string, dto: { servicePlanId?: string | null; billingDay?: number }, requestId: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, servicePlanId: true, billingDay: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    if (dto.servicePlanId) {
      const plan = await this.prisma.servicePlan.findFirst({ where: { id: dto.servicePlanId, workspaceId }, select: { active: true } });
      if (!plan) throw new NotFoundException('ไม่พบแพ็กเกจ');
      if (!plan.active && dto.servicePlanId !== page.servicePlanId) throw new ConflictException('แพ็กเกจนี้ปิดรับแล้ว');
    }
    const changedPlan = dto.servicePlanId !== undefined && dto.servicePlanId !== page.servicePlanId;
    await this.prisma.facebookPage.update({ where: { id: pageId }, data: { ...(dto.servicePlanId !== undefined && { servicePlanId: dto.servicePlanId }), ...(dto.billingDay !== undefined && { billingDay: dto.billingDay }), ...(changedPlan && { planStartedAt: dto.servicePlanId ? new Date() : null }) } });
    await this.audit.log({ workspaceId, userId, action: 'page.plan.assign', resourceType: 'facebookPage', resourceId: pageId, before: { servicePlanId: page.servicePlanId, billingDay: page.billingDay }, after: dto as Prisma.InputJsonValue, requestId });
    return (await this.portfolio(workspaceId, true, [pageId])).rows[0];
  }

  // ---------- โควต้า ----------
  private async pages(workspaceId: string, ids?: string[]): Promise<PageLite[]> {
    return this.prisma.facebookPage.findMany({
      where: { ...pageInWorkspace(workspaceId), disconnectedAt: null, ...(ids && { id: { in: ids } }) }, orderBy: { name: 'asc' },
      select: { id: true, name: true, pictureUrl: true, fanCount: true, tokenStatus: true, publishingPaused: true, timezone: true, billingDay: true, planStartedAt: true, brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } }, servicePlan: { select: { id: true, name: true, priceMonthly: true, postsPerMonth: true, reelsPerMonth: true, features: true } } },
    });
  }

  /** โควต้าของหลายเพจในคำขอเดียว — ดึงคอนเทนต์ตั้งแต่ต้นรอบที่เก่าที่สุดแล้วแยกนับตามรอบของแต่ละเพจ */
  async quotas(pages: Pick<PageLite, 'id' | 'timezone' | 'billingDay' | 'servicePlan'>[], workspaceTz: string, now = new Date()): Promise<Map<string, PageQuota>> {
    const out = new Map<string, PageQuota>(); if (!pages.length) return out;
    const cycles = new Map(pages.map(p => [p.id, billingCycle(now, p.billingDay, p.timezone ?? workspaceTz)]));
    const minStart = new Date(Math.min(...[...cycles.values()].map(c => c.start.getTime())));
    const ids = pages.map(p => p.id);
    const [items, posts] = await Promise.all([
      this.prisma.contentItem.findMany({ where: { pageId: { in: ids }, platform: 'FACEBOOK', OR: [{ status: { in: DONE as never }, publishedAt: { gte: minStart } }, { status: { in: QUEUED as never }, scheduledAt: { gte: minStart } }] }, select: { pageId: true, status: true, contentType: true, publishedAt: true, scheduledAt: true } }),
      this.prisma.facebookPost.findMany({ where: { pageId: { in: ids }, publishedAt: { gte: minStart } }, select: { pageId: true, publishedAt: true } }),
    ]);
    for (const p of pages) {
      const c = cycles.get(p.id)!; const inCycle = (d: Date | null) => !!d && d >= c.start && d < c.end;
      const mine = items.filter(i => i.pageId === p.id);
      const done = mine.filter(i => DONE.includes(i.status) && inCycle(i.publishedAt));
      const queued = mine.filter(i => QUEUED.includes(i.status) && inCycle(i.scheduledAt));
      const plan = p.servicePlan;
      const quota = quotaStatus({ hasPlan: !!plan, limit: plan?.postsPerMonth, used: done.length, scheduled: queued.length, elapsed: c.elapsed });
      const reelsPlanned = [...done, ...queued].filter(i => i.contentType === 'reel').length;
      const reelLimit = plan?.reelsPerMonth ?? null;
      out.set(p.id, { cycle: c, quota, scheduled: queued.length, reels: { limit: reelLimit, planned: reelsPlanned, remaining: reelLimit === null ? null : reelLimit - reelsPlanned }, pagePosts: posts.filter(x => x.pageId === p.id && inCycle(x.publishedAt)).length });
    }
    return out;
  }

  async pageQuota(workspaceId: string, pageId: string) {
    const [page] = await this.pages(workspaceId, [pageId]); if (!page) throw new NotFoundException('ไม่พบเพจ');
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
    const q = (await this.quotas([page], ws.timezone)).get(pageId)!;
    return { pageId, plan: page.servicePlan && { id: page.servicePlan.id, name: page.servicePlan.name, postsPerMonth: page.servicePlan.postsPerMonth, reelsPerMonth: page.servicePlan.reelsPerMonth }, billingDay: page.billingDay, ...q };
  }

  /** ภาพรวมทุกเพจ — ราคา/รายได้แสดงเฉพาะคนที่มีสิทธิ์ client.manage */
  async portfolio(workspaceId: string, showMoney: boolean, onlyIds?: string[], now = new Date()) {
    const [pages, ws] = await Promise.all([this.pages(workspaceId, onlyIds), this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } })]);
    const ids = pages.map(p => p.id); const where = { pageId: { in: ids } };
    const [quotas, lastPosts, lastApp, next, pendingApproval, approved, failed, comments, chats, leads] = await Promise.all([
      this.quotas(pages, ws.timezone, now),
      this.prisma.facebookPost.groupBy({ by: ['pageId'], where: { ...where, publishedAt: { not: null } }, _max: { publishedAt: true } }),
      this.prisma.contentItem.groupBy({ by: ['pageId'], where: { ...where, platform: 'FACEBOOK', publishedAt: { not: null } }, _max: { publishedAt: true } }),
      this.prisma.contentItem.groupBy({ by: ['pageId'], where: { ...where, platform: 'FACEBOOK', status: 'SCHEDULED', scheduledAt: { gte: now } }, _min: { scheduledAt: true } }),
      this.prisma.contentItem.groupBy({ by: ['pageId'], where: { ...where, platform: 'FACEBOOK', status: 'READY_FOR_APPROVAL' }, _count: { _all: true } }),
      this.prisma.contentItem.groupBy({ by: ['pageId'], where: { ...where, platform: 'FACEBOOK', status: 'APPROVED' }, _count: { _all: true } }),
      this.prisma.contentItem.groupBy({ by: ['pageId'], where: { ...where, platform: 'FACEBOOK', status: 'PUBLISH_FAILED' }, _count: { _all: true } }),
      this.prisma.pageComment.groupBy({ by: ['pageId'], where: { ...where, resolvedAt: null, replyStatus: { not: 'SENT' }, isHidden: false }, _count: { _all: true } }),
      this.prisma.messengerConversation.groupBy({ by: ['pageId'], where: { ...where, needsAttention: true }, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['pageId'], where: { workspaceId, ...where, status: 'NEW' }, _count: { _all: true } }),
    ]);
    const count = (rows: { pageId: string | null; _count: { _all: number } }[]) => new Map(rows.map(r => [r.pageId, r._count._all]));
    const [cPending, cApproved, cFailed, cComments, cChats, cLeads] = [pendingApproval, approved, failed, comments, chats, leads].map(r => count(r as never)) as [Map<string | null, number>, Map<string | null, number>, Map<string | null, number>, Map<string | null, number>, Map<string | null, number>, Map<string | null, number>];
    const maxOf = (rows: { pageId: string | null; _max: { publishedAt: Date | null } }[]) => new Map(rows.map(r => [r.pageId, r._max.publishedAt]));
    const mPost = maxOf(lastPosts as never); const mApp = maxOf(lastApp as never);
    const nextAt = new Map((next as { pageId: string | null; _min: { scheduledAt: Date | null } }[]).map(r => [r.pageId, r._min.scheduledAt]));

    const rows = pages.map(p => {
      const q = quotas.get(p.id)!;
      const last = [mPost.get(p.id), mApp.get(p.id)].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const daysSinceLastPost = last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null;
      const nextScheduledAt = nextAt.get(p.id) ?? null;
      const activity = { lastPostAt: last, daysSinceLastPost, nextScheduledAt, pendingApproval: cPending.get(p.id) ?? 0, approvedUnscheduled: cApproved.get(p.id) ?? 0, failed: cFailed.get(p.id) ?? 0, commentsPending: cComments.get(p.id) ?? 0, chatsNeedAttention: cChats.get(p.id) ?? 0, newLeads: cLeads.get(p.id) ?? 0 };
      const attention: string[] = [];
      if (p.tokenStatus !== 'VALID') attention.push('TOKEN');
      if (p.publishingPaused) attention.push('PAUSED');
      if (activity.failed) attention.push('FAILED');
      if (q.quota.pace === 'BEHIND') attention.push('BEHIND');
      if (q.quota.pace === 'OVER') attention.push('OVER');
      if (q.reels.remaining !== null && q.reels.remaining < 0) attention.push('REELS_OVER');
      if (!p.servicePlan) attention.push('NO_PLAN');
      const wantsMore = q.quota.remaining === null ? !!p.servicePlan : q.quota.remaining > 0;
      if (wantsMore && (!nextScheduledAt || nextScheduledAt.getTime() - now.getTime() > UPCOMING_DAYS * 86_400_000)) attention.push('NO_UPCOMING');
      if (daysSinceLastPost === null || daysSinceLastPost >= STALE_DAYS) attention.push('STALE');
      if (activity.pendingApproval) attention.push('APPROVAL');
      const plan = p.servicePlan && { id: p.servicePlan.id, name: p.servicePlan.name, postsPerMonth: p.servicePlan.postsPerMonth, reelsPerMonth: p.servicePlan.reelsPerMonth, features: p.servicePlan.features, ...(showMoney && { priceMonthly: p.servicePlan.priceMonthly }) };
      return { page: { id: p.id, name: p.name, pictureUrl: p.pictureUrl, fanCount: p.fanCount, tokenStatus: p.tokenStatus, publishingPaused: p.publishingPaused }, brand: { id: p.brand.id, name: p.brand.name }, client: p.brand.client, plan, billingDay: p.billingDay, planStartedAt: p.planStartedAt, ...q, activity, attention };
    });

    const withPlan = rows.filter(r => r.plan);
    const byPlan = new Map<string, { id: string; name: string; pages: number; revenue: number | null }>();
    for (const r of withPlan) { const b = byPlan.get(r.plan!.id) ?? { id: r.plan!.id, name: r.plan!.name, pages: 0, revenue: showMoney ? 0 : null }; b.pages++; if (showMoney && b.revenue !== null) b.revenue += (r.plan as { priceMonthly?: number | null }).priceMonthly ?? 0; byPlan.set(b.id, b); }
    const limited = rows.filter(r => r.quota.limit !== null);
    const summary = {
      pages: rows.length, withPlan: withPlan.length,
      monthlyRevenue: showMoney ? withPlan.reduce((n, r) => n + ((r.plan as { priceMonthly?: number | null }).priceMonthly ?? 0), 0) : null,
      postsUsed: rows.reduce((n, r) => n + r.quota.used, 0), postsPlanned: rows.reduce((n, r) => n + r.quota.planned, 0),
      quotaTotal: limited.reduce((n, r) => n + (r.quota.limit ?? 0), 0), quotaPlannedOfLimited: limited.reduce((n, r) => n + Math.min(r.quota.planned, r.quota.limit ?? 0), 0),
      behind: rows.filter(r => r.quota.pace === 'BEHIND').length, full: rows.filter(r => r.quota.pace === 'FULL').length, over: rows.filter(r => r.quota.pace === 'OVER').length,
      needsAttention: rows.filter(r => r.attention.some(a => a !== 'NO_PLAN' && a !== 'APPROVAL')).length,
      pendingApproval: rows.reduce((n, r) => n + r.activity.pendingApproval, 0), commentsPending: rows.reduce((n, r) => n + r.activity.commentsPending, 0), newLeads: rows.reduce((n, r) => n + r.activity.newLeads, 0),
      byPlan: [...byPlan.values()].sort((a, b) => b.pages - a.pages),
    };
    return { generatedAt: now, showMoney, summary, rows };
  }
}
