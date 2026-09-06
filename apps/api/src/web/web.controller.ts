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
import { connectGscSchema, connectWpSchema, createSiteSchema, createWebContentSchema, generateWebContentSchema, listWebContentSchema, publishWebSchema, runChecksSchema, syncGscSchema, updateSiteSchema, updateWebContentSchema, type ConnectWpDto, type CreateSiteDto, type CreateWebContentDto, type GenerateWebContentDto, type ListWebContentDto, type UpdateSiteDto, type UpdateWebContentDto } from './dto';
import { reviewCommentSchema, scheduleSchema, type ReviewCommentDto, type ScheduleDto } from '../content/dto';
import { WebContentService } from './web-content.service';

@ApiTags('web')
@Controller('workspaces/:workspaceId/web')
@UseGuards(AuthGuard, TenantGuard)
export class WebController {
  constructor(@Inject(SitesService) private readonly sites: SitesService, @Inject(WebContentService) private readonly content: WebContentService) {}

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

  // ---- W-3 WordPress connection (credential เข้ารหัส ไม่คืนกลับ) ----
  @Post('sites/:id/wordpress') @HttpCode(200) @RequirePermission('web.manage')
  connectWp(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(connectWpSchema)) dto: ConnectWpDto, @RequestId() rid: string) { return this.content.connectWordPress(t.workspaceId, u.id, id, dto, rid); }
  @Post('sites/:id/wordpress/verify') @HttpCode(200) @RequirePermission('web.manage')
  verifyWp(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.verifyWp(t.workspaceId, id); }
  @Delete('sites/:id/wordpress') @RequirePermission('web.manage')
  disconnectWp(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.disconnectWordPress(t.workspaceId, u.id, id, rid); }
  @Get('sites/:id/content-sources') @RequirePermission('web.content.create')
  sources(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.sources(t.workspaceId, id); }

  // ---- W-3 Web content (บทความ) ----
  @Get('content/summary') @RequirePermission('web.read')
  contentSummary(@Tenant() t: TenantContext) { return this.content.summary(t.workspaceId); }
  @Get('content') @RequirePermission('web.read')
  listContent(@Tenant() t: TenantContext, @Query(new ZodPipe(listWebContentSchema)) q: ListWebContentDto) { return this.content.list(t.workspaceId, q); }
  @Post('content') @RequirePermission('web.content.create')
  createContent(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createWebContentSchema)) dto: CreateWebContentDto, @RequestId() rid: string) { return this.content.create(t.workspaceId, u.id, dto, rid); }
  @Get('content/:id') @RequirePermission('web.read')
  getContent(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.get(t.workspaceId, id); }
  @Patch('content/:id') @RequirePermission('web.content.edit')
  updateContent(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateWebContentSchema)) dto: UpdateWebContentDto, @RequestId() rid: string) { return this.content.update(t.workspaceId, u.id, id, dto, rid); }
  @Post('content/:id/generate') @HttpCode(200) @RequirePermission('web.content.edit', 'ai.use')
  generate(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(generateWebContentSchema)) dto: GenerateWebContentDto, @RequestId() rid: string) { return this.content.generate(t.workspaceId, u.id, id, dto, rid); }
  @Post('content/:id/submit') @HttpCode(200) @RequirePermission('web.content.edit')
  submit(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.submit(t.workspaceId, u.id, id, rid); }
  @Post('content/:id/approve') @HttpCode(200) @RequirePermission('web.content.approve')
  approve(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.content.approve(t.workspaceId, u.id, id, dto.comment, rid); }
  @Post('content/:id/reject') @HttpCode(200) @RequirePermission('web.content.approve')
  reject(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.content.reject(t.workspaceId, u.id, id, dto.comment, rid); }
  @Post('content/:id/request-changes') @HttpCode(200) @RequirePermission('web.content.approve')
  requestChanges(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.content.requestChanges(t.workspaceId, u.id, id, dto.comment, rid); }
  @Post('content/:id/reopen') @HttpCode(200) @RequirePermission('web.content.edit')
  reopen(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.reopen(t.workspaceId, u.id, id, rid); }
  @Delete('content/:id') @RequirePermission('web.content.edit')
  cancelContent(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.cancel(t.workspaceId, u.id, id, rid); }
  @Post('content/:id/schedule') @HttpCode(200) @RequirePermission('web.content.publish')
  schedule(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(scheduleSchema)) dto: ScheduleDto, @RequestId() rid: string) { return this.content.schedule(t.workspaceId, u.id, id, dto, rid); }
  @Post('content/:id/publish') @HttpCode(200) @RequirePermission('web.content.publish')
  publish(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(publishWebSchema)) b: z.infer<typeof publishWebSchema>, @RequestId() rid: string) { return this.content.publishNow(t.workspaceId, u.id, id, b?.asDraft ?? false, rid); }
  @Post('content/:id/wordpress-update') @HttpCode(200) @RequirePermission('web.content.publish')
  wpUpdate(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.updatePublished(t.workspaceId, u.id, id, rid); }
  @Get('content/:id/job') @RequirePermission('web.read')
  job(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.jobState(t.workspaceId, id); }
}
