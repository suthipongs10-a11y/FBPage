import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { NotificationsService } from './notifications.service';

const webhookSchema = z.object({ url: z.string().trim().url().max(500).nullable() });
const listSchema = z.object({ unread: z.enum(['1', '0']).optional(), limit: z.coerce.number().int().min(1).max(200).optional() });

@ApiTags('notifications')
@Controller('workspaces/:workspaceId/notifications')
@UseGuards(AuthGuard, TenantGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly svc: NotificationsService) {}
  @Get() list(@Tenant() t: TenantContext, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) { return this.svc.list(t.workspaceId, q.unread === '1', q.limit); }
  @Post(':id/read') @HttpCode(200) read(@Tenant() t: TenantContext, @Param('id') id: string) { return this.svc.markRead(t.workspaceId, id); }
  @Post('read-all') @HttpCode(200) readAll(@Tenant() t: TenantContext) { return this.svc.markAllRead(t.workspaceId); }
  @Get('webhook') @RequirePermission('workspace.manage') webhook(@Tenant() t: TenantContext) { return this.svc.webhookSettings(t.workspaceId); }
  @Put('webhook') @RequirePermission('workspace.manage') setWebhook(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(webhookSchema)) dto: z.infer<typeof webhookSchema>, @RequestId() rid: string) { return this.svc.setWebhook(t.workspaceId, u.id, dto.url, rid); }
  @Post('webhook/test') @HttpCode(200) @RequirePermission('workspace.manage') test(@Tenant() t: TenantContext) { return this.svc.testWebhook(t.workspaceId); }
}
