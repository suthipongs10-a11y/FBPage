import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { CurrentUser, RequestId, Tenant, type AppRequest, type AuthUser, type TenantContext } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { TikTokService } from './tiktok.service';
import { TikTokContentService } from './content.service';
import * as d from './dto';
const pauseSchema = z.object({ paused: z.boolean() });
@ApiTags('tiktok')
@Controller('workspaces/:workspaceId/tiktok')
@UseGuards(AuthGuard, TenantGuard)
export class TikTokController {
  constructor(@Inject(TikTokService) readonly accounts: TikTokService, @Inject(TikTokContentService) readonly content: TikTokContentService) {}
  @Get('health') @RequirePermission('tiktok.read') health() { return this.accounts.health(); }
  @Get('accounts') @RequirePermission('tiktok.read') list(@Tenant() t: TenantContext) { return this.accounts.list(t.workspaceId); }
  @Post('oauth/start') @HttpCode(200) @RequirePermission('tiktok.connect') connect(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Req() req: AppRequest, @Body(new ZodPipe(d.connectSchema)) b: z.infer<typeof d.connectSchema>) { return this.accounts.connect(t.workspaceId, u.id, req.sessionId!, b); }
  @Delete('accounts/:id') @RequirePermission('tiktok.connect') disconnect(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.accounts.disconnect(t.workspaceId, u.id, id, rid); }
  @Patch('accounts/:id/pause') @RequirePermission('tiktok.connect') pause(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(pauseSchema)) b: z.infer<typeof pauseSchema>, @RequestId() rid: string) { return this.accounts.pause(t.workspaceId, u.id, id, b.paused, rid); }
  @Post('accounts/:id/sync') @HttpCode(200) @RequirePermission('tiktok.read') sync(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.accounts.sync(t.workspaceId, u.id, id, rid); }
  @Get('accounts/:id/videos') @RequirePermission('tiktok.read') videos(@Tenant() t: TenantContext, @Param('id') id: string) { return this.accounts.videos(t.workspaceId, id); }
  @Get('accounts/:id/analytics') @RequirePermission('tiktok.read') analytics(@Tenant() t: TenantContext, @Param('id') id: string) { return this.accounts.analytics(t.workspaceId, id); }
  @Post('accounts/:id/analyze') @HttpCode(200) @RequirePermission('tiktok.read', 'ai.use') analyze(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.analyze(t.workspaceId, u.id, id, rid); }
  @Post('accounts/:id/studio') @HttpCode(200) @RequirePermission('tiktok.content.create', 'ai.use') studio(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.studioSchema)) b: z.infer<typeof d.studioSchema>, @RequestId() rid: string) { return this.content.studio(t.workspaceId, u.id, id, b, rid); }
  @Get('content') @RequirePermission('tiktok.read') drafts(@Tenant() t: TenantContext) { return this.content.list(t.workspaceId); }
  @Get('brands') @RequirePermission('tiktok.read') brands(@Tenant() t: TenantContext) { return this.content.brands(t.workspaceId); }
  @Get('brands/:id/sources') @RequirePermission('tiktok.content.create', 'content.read') sources(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.sources(t.workspaceId, id); }
  @Post('brands/:id/studio') @HttpCode(200) @RequirePermission('tiktok.content.create', 'ai.use') brandStudio(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.studioSchema)) b: z.infer<typeof d.studioSchema>, @RequestId() rid: string) { return this.content.studio(t.workspaceId, u.id, undefined, b, rid, id); }
  @Get('content/:id/export') @RequirePermission('tiktok.read') exportDraft(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.exportDraft(t.workspaceId, id); }
  @Patch('content/:id/account') @RequirePermission('tiktok.content.create') assign(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.assignSchema)) b: z.infer<typeof d.assignSchema>, @RequestId() rid: string) { return this.content.assign(t.workspaceId, u.id, id, b.accountId, rid); }
  @Post('content') @RequirePermission('tiktok.content.create') create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(d.draftSchema)) b: z.infer<typeof d.draftSchema>, @RequestId() rid: string) { return this.content.create(t.workspaceId, u.id, b, rid); }
  @Patch('content/:id') @RequirePermission('tiktok.content.create') update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.editSchema)) b: z.infer<typeof d.editSchema>, @RequestId() rid: string) { return this.content.update(t.workspaceId, u.id, id, b, rid); }
  @Post('content/:id/submit') @HttpCode(200) @RequirePermission('tiktok.content.create') submit(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.submitSchema)) _b: z.infer<typeof d.submitSchema>, @RequestId() rid: string) { return this.content.submit(t.workspaceId, u.id, id, rid); }
  @Post('content/:id/decision') @HttpCode(200) @RequirePermission('tiktok.content.approve') decide(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.approvalSchema)) b: z.infer<typeof d.approvalSchema>, @RequestId() rid: string) { return this.content.decide(t.workspaceId, u.id, id, b.approve, b.comment, rid); }
  @Post('content/:id/send') @HttpCode(200) @RequirePermission('tiktok.upload') send(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.sendSchema)) b: z.infer<typeof d.sendSchema>, @RequestId() rid: string) { return this.content.send(t.workspaceId, u.id, id, rid, b.scheduledLocal, b.timezone); }
  @Post('content/:id/poll') @HttpCode(200) @RequirePermission('tiktok.read') poll(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.poll(t.workspaceId, id); }
  @Delete('content/:id') @RequirePermission('tiktok.content.create') cancel(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.cancel(t.workspaceId, u.id, id, rid); }
}
@Controller('tiktok/oauth')
@UseGuards(AuthGuard)
export class TikTokCallbackController {
  constructor(@Inject(TikTokService) readonly service: TikTokService) {}
  @Get('callback') async callback(@Req() req: AppRequest, @Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    const target = await this.service.callback(req.user!.id, req.sessionId!, typeof code === 'string' ? code : undefined, typeof state === 'string' ? state : undefined, typeof error === 'string' ? error : undefined);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.redirect(target);
  }
}
