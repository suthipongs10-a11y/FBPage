import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { MessengerService } from './messenger.service';
const settingsSchema = z.object({ dailyLimit: z.number().int().min(1).max(10000) }).strict();
const pageSchema = z.object({ enabled: z.boolean(), instructions: z.string().trim().max(5000), fallbackMessage: z.string().trim().min(1).max(1800) }).strict();
const previewSchema = z.object({ text: z.string().trim().min(1).max(6000) }).strict();
const modeSchema = z.object({ mode: z.enum(['AUTO', 'HUMAN']) }).strict();
@ApiTags('messenger')
@Controller('workspaces/:workspaceId/messenger')
@UseGuards(AuthGuard, TenantGuard)
export class MessengerController {
  constructor(@Inject(MessengerService) private readonly service: MessengerService) {}
  @Get('settings') @RequirePermission('messenger.read') settings(@Tenant() t: TenantContext) { return this.service.settings(t.workspaceId); }
  @Patch('settings') @RequirePermission('ai.configure', 'messenger.manage') saveSettings(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>, @RequestId() rid: string) { return this.service.saveSettings(t.workspaceId, u.id, b, rid); }
  @Get('pages') @RequirePermission('messenger.read') pages(@Tenant() t: TenantContext) { return this.service.pages(t.workspaceId); }
  @Patch('pages/:id') @RequirePermission('messenger.manage') savePage(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(pageSchema)) b: z.infer<typeof pageSchema>, @RequestId() rid: string) { return this.service.savePage(t.workspaceId, u.id, id, b, rid); }
  @Post('pages/:id/subscribe') @HttpCode(200) @RequirePermission('messenger.manage', 'page.connect') subscribe(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.service.subscribe(t.workspaceId, u.id, id, rid); }
  @Post('pages/:id/preview') @HttpCode(200) @RequirePermission('messenger.manage', 'ai.use') preview(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(previewSchema)) b: z.infer<typeof previewSchema>, @RequestId() rid: string) { return this.service.preview(t.workspaceId, u.id, id, b.text, rid); }
  @Get('conversations') @RequirePermission('messenger.read') conversations(@Tenant() t: TenantContext, @Query('pageId', new ZodPipe(z.string().min(1))) pageId: string) { return this.service.conversations(t.workspaceId, pageId); }
  @Get('conversations/:id') @RequirePermission('messenger.read') conversation(@Tenant() t: TenantContext, @Param('id') id: string) { return this.service.conversation(t.workspaceId, id); }
  @Patch('conversations/:id/mode') @RequirePermission('messenger.reply') mode(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(modeSchema)) b: z.infer<typeof modeSchema>, @RequestId() rid: string) { return this.service.mode(t.workspaceId, u.id, id, b.mode, rid); }
}
