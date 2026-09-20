import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { ConnectionsService } from './connections.service';
import { PagesService } from './pages.service';
import { connectPageSchema, connectTokenSchema, postsQuerySchema, syncSchema, updatePageSchema, type ConnectPageDto, type ConnectTokenDto, type PostsQueryDto, type SyncDto, type UpdatePageDto } from './dto';

@ApiTags('facebook')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class FacebookController {
  constructor(@Inject(ConnectionsService) private readonly conns: ConnectionsService, @Inject(PagesService) private readonly pages: PagesService) {}

  // ---------- การเชื่อมบัญชี ----------
  @Get('facebook/connections') @RequirePermission('page.read')
  listConnections(@Tenant() t: TenantContext) { return this.conns.list(t.workspaceId); }

  @Post('facebook/connections/token') @RequirePermission('page.connect')
  connectToken(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(connectTokenSchema)) dto: ConnectTokenDto, @RequestId() rid: string) {
    return this.conns.connectWithToken(t.workspaceId, u.id, dto.accessToken, rid);
  }

  @Get('facebook/connections/:connectionId/pages') @RequirePermission('page.connect')
  availablePages(@Tenant() t: TenantContext, @Param('connectionId') id: string) { return this.conns.availablePages(t.workspaceId, id); }

  @Delete('facebook/connections/:connectionId') @RequirePermission('page.manage')
  revoke(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('connectionId') id: string, @RequestId() rid: string) { return this.conns.revoke(t.workspaceId, u.id, id, rid); }

  @Get('facebook/oauth/start') @RequirePermission('page.connect')
  oauthStart(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Query('messenger') messenger?: string) { return this.conns.oauthStartUrl(t.workspaceId, u.id, messenger === 'true'); }

  // ---------- เพจ ----------
  @Post('brands/:brandId/pages/connect') @RequirePermission('page.connect')
  connectPage(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(connectPageSchema)) dto: ConnectPageDto, @RequestId() rid: string) {
    return this.pages.connect(t.workspaceId, u.id, brandId, dto, rid);
  }

  @Get('pages') @RequirePermission('page.read')
  list(@Tenant() t: TenantContext) { return this.pages.list(t.workspaceId); }

  @Get('pages/:pageId') @RequirePermission('page.read')
  get(@Tenant() t: TenantContext, @Param('pageId') id: string) { return this.pages.get(t.workspaceId, id); }

  @Patch('pages/:pageId') @RequirePermission('page.manage')
  update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') id: string, @Body(new ZodPipe(updatePageSchema)) dto: UpdatePageDto, @RequestId() rid: string) {
    return this.pages.update(t.workspaceId, u.id, id, dto, rid);
  }

  @Post('pages/:pageId/validate') @HttpCode(200) @RequirePermission('page.read')
  validate(@Tenant() t: TenantContext, @Param('pageId') id: string) { return this.pages.validate(t.workspaceId, id); }

  @Post('pages/:pageId/sync') @HttpCode(200) @RequirePermission('page.manage')
  sync(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') id: string, @Body(new ZodPipe(syncSchema)) dto: SyncDto, @RequestId() rid: string) {
    return this.pages.runSync(t.workspaceId, u.id, id, dto?.days, rid);
  }

  @Delete('pages/:pageId') @RequirePermission('page.manage')
  disconnect(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') id: string, @RequestId() rid: string) { return this.pages.disconnect(t.workspaceId, u.id, id, rid); }

  @Get('pages/:pageId/posts') @RequirePermission('analytics.read')
  posts(@Tenant() t: TenantContext, @Param('pageId') id: string, @Query(new ZodPipe(postsQuerySchema)) q: PostsQueryDto) { return this.pages.posts(t.workspaceId, id, q.limit); }
}

/** callback ของ Meta OAuth — เส้นทางสาธารณะ (ผู้ใช้ถูกพากลับมาจาก facebook.com) ตัวตนยืนยันด้วย state ที่เซ็นไว้ */
@ApiTags('facebook')
@Controller('facebook/oauth')
export class OAuthCallbackController {
  constructor(@Inject(ConnectionsService) private readonly conns: ConnectionsService) {}

  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    const { redirectTo } = await this.conns.oauthCallback(code, state, error);
    res.redirect(302, redirectTo);
  }
}
