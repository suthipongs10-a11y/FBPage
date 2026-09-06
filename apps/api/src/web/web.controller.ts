/** Website Care routes (AGENTS_WEB.md §4) — ใต้ workspaces/:workspaceId/web */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { SitesService } from './sites.service';
import { connectGscSchema, createSiteSchema, runChecksSchema, syncGscSchema, updateSiteSchema, type CreateSiteDto, type UpdateSiteDto } from './dto';

@ApiTags('web')
@Controller('workspaces/:workspaceId/web')
@UseGuards(AuthGuard, TenantGuard)
export class WebController {
  constructor(@Inject(SitesService) private readonly sites: SitesService) {}

  @Get('overview') @RequirePermission('web.read')
  overview(@Tenant() t: TenantContext) { return this.sites.overview(t.workspaceId); }
  @Get('sites') @RequirePermission('web.read')
  list(@Tenant() t: TenantContext) { return this.sites.list(t.workspaceId); }
  @Post('sites') @RequirePermission('web.manage')
  create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createSiteSchema)) dto: CreateSiteDto, @RequestId() rid: string) { return this.sites.create(t.workspaceId, u.id, dto, rid); }
  @Get('sites/:id') @RequirePermission('web.read')
  get(@Tenant() t: TenantContext, @Param('id') id: string) { return this.sites.get(t.workspaceId, id); }
  @Patch('sites/:id') @RequirePermission('web.manage')
  update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateSiteSchema)) dto: UpdateSiteDto, @RequestId() rid: string) { return this.sites.update(t.workspaceId, u.id, id, dto, rid); }
  @Delete('sites/:id') @RequirePermission('web.manage')
  remove(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.sites.remove(t.workspaceId, u.id, id, rid); }
  @Post('sites/:id/check') @HttpCode(200) @RequirePermission('web.read')
  check(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(runChecksSchema)) b: z.infer<typeof runChecksSchema>, @RequestId() rid: string) { return this.sites.runChecks(t.workspaceId, u.id, id, b?.kinds ?? ['UPTIME', 'SSL', 'SEO'], rid); }
  @Get('sites/:id/trends') @RequirePermission('web.analytics.read')
  trends(@Tenant() t: TenantContext, @Param('id') id: string, @Query('weeks') weeks?: string) { return this.sites.trends(t.workspaceId, id, Number(weeks) || 12); }

  // ---- Search Console (W-2) ----
  @Get('search-console/properties') @RequirePermission('web.manage')
  properties(@Tenant() t: TenantContext, @Query('connectionId') connectionId: string) { return this.sites.listProperties(t.workspaceId, connectionId ?? ''); }
  @Post('sites/:id/search-console') @HttpCode(200) @RequirePermission('web.manage')
  connectGsc(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(connectGscSchema)) b: z.infer<typeof connectGscSchema>, @RequestId() rid: string) { return this.sites.connectSearchConsole(t.workspaceId, u.id, id, b.connectionId, b.property, rid); }
  @Post('sites/:id/search-console/sync') @HttpCode(200) @RequirePermission('web.analytics.read')
  syncGsc(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(syncGscSchema)) b: z.infer<typeof syncGscSchema>, @RequestId() rid: string) { return this.sites.syncSearch(t.workspaceId, u.id, id, b?.days ?? 28, rid); }

  // ---- SEO Analyst ----
  @Post('sites/:id/analyze') @HttpCode(200) @RequirePermission('web.analytics.read', 'ai.use')
  analyze(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.sites.analyze(t.workspaceId, u.id, id, rid); }
  @Get('sites/:id/analyses') @RequirePermission('web.analytics.read')
  analyses(@Tenant() t: TenantContext, @Param('id') id: string) { return this.sites.analyses(t.workspaceId, id); }
}
