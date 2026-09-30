import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PLAN_FEATURES } from '@fbpm/shared';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { PlansService } from './plans.service';

const count = z.number().int().min(0).max(1000).nullable();
export const planSchema = z.object({
  name: z.string().trim().min(1).max(80), description: z.string().trim().max(1000).nullable().optional(),
  priceMonthly: z.number().int().min(0).max(10_000_000).nullable().optional(), postsPerMonth: count.optional(), reelsPerMonth: count.optional(),
  features: z.array(z.enum(PLAN_FEATURES)).max(PLAN_FEATURES.length).optional(), active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional(),
}).refine(p => p.reelsPerMonth == null || p.postsPerMonth == null || p.reelsPerMonth <= p.postsPerMonth, { message: 'โควต้า Reels ต้องไม่เกินโควต้าโพสต์ทั้งหมด (Reels นับรวมในโพสต์)', path: ['reelsPerMonth'] });
export const planUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(1000).nullable().optional(),
  priceMonthly: z.number().int().min(0).max(10_000_000).nullable().optional(), postsPerMonth: count.optional(), reelsPerMonth: count.optional(),
  features: z.array(z.enum(PLAN_FEATURES)).max(PLAN_FEATURES.length).optional(), active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional(),
}).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export const assignSchema = z.object({ servicePlanId: z.string().min(1).max(40).nullable().optional(), billingDay: z.number().int().min(1).max(28).optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');

@ApiTags('plans')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class PlansController {
  constructor(@Inject(PlansService) private readonly svc: PlansService) {}
  private money = (t: TenantContext) => t.permissions.includes('client.manage');

  @Get('plans') @RequirePermission('client.read')
  async list(@Tenant() t: TenantContext) { const rows = await this.svc.list(t.workspaceId); return this.money(t) ? rows : rows.map(({ priceMonthly: _p, ...r }) => r); }
  @Post('plans') @RequirePermission('client.manage')
  create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(planSchema)) b: z.infer<typeof planSchema>, @RequestId() rid: string) { return this.svc.create(t.workspaceId, u.id, b, rid); }
  @Patch('plans/:id') @RequirePermission('client.manage')
  update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(planUpdateSchema)) b: z.infer<typeof planUpdateSchema>, @RequestId() rid: string) { return this.svc.update(t.workspaceId, u.id, id, b, rid); }
  @Delete('plans/:id') @RequirePermission('client.manage')
  remove(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.svc.remove(t.workspaceId, u.id, id, rid); }

  @Patch('pages/:pageId/plan') @RequirePermission('client.manage')
  assign(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(assignSchema)) b: z.infer<typeof assignSchema>, @RequestId() rid: string) { return this.svc.assign(t.workspaceId, u.id, pageId, b, rid); }
  @Get('pages/:pageId/quota') @RequirePermission('page.read')
  quota(@Tenant() t: TenantContext, @Param('pageId') pageId: string) { return this.svc.pageQuota(t.workspaceId, pageId); }
  @Get('portfolio') @RequirePermission('page.read')
  portfolio(@Tenant() t: TenantContext) { return this.svc.portfolio(t.workspaceId, this.money(t)); }
}
