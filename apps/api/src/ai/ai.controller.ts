import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { AiSettingsService } from './settings.service';
import { CommandService } from './command.service';
import { AnalystService } from './analyst.service';
import { analyzeSchema, commandSchema, providerParam, putRolesSchema, tasksQuerySchema, upsertProviderKeySchema, type AnalyzeDto, type CommandDto, type PutRolesDto, type TasksQueryDto, type UpsertProviderKeyDto } from './dto';
import type { AiProviderId } from '@fbpm/ai-core';

@ApiTags('ai')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class AiController {
  constructor(@Inject(AiSettingsService) private readonly settings: AiSettingsService, @Inject(CommandService) private readonly cmd: CommandService, @Inject(AnalystService) private readonly analyst: AnalystService) {}

  // ---------- ตั้งค่า (§41, §42) ----------
  @Get('ai/providers') @RequirePermission('ai.use')
  providers(@Tenant() t: TenantContext) { return this.settings.providers(t.workspaceId); }

  @Put('ai/providers/:provider') @RequirePermission('ai.configure')
  upsertKey(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('provider', new ZodPipe(providerParam)) p: AiProviderId, @Body(new ZodPipe(upsertProviderKeySchema)) dto: UpsertProviderKeyDto, @RequestId() rid: string) {
    return this.settings.upsertKey(t.workspaceId, u.id, p, dto, rid);
  }

  @Delete('ai/providers/:provider') @RequirePermission('ai.configure')
  removeKey(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('provider', new ZodPipe(providerParam)) p: AiProviderId, @RequestId() rid: string) { return this.settings.removeKey(t.workspaceId, u.id, p, rid); }

  @Post('ai/providers/:provider/validate') @HttpCode(200) @RequirePermission('ai.configure')
  validateKey(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('provider', new ZodPipe(providerParam)) p: AiProviderId, @RequestId() rid: string) { return this.settings.validateKey(t.workspaceId, u.id, p, rid); }

  @Get('ai/roles') @RequirePermission('ai.use')
  roles(@Tenant() t: TenantContext) { return this.settings.roles(t.workspaceId); }

  @Put('ai/roles') @RequirePermission('ai.configure')
  putRoles(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(putRolesSchema)) dto: PutRolesDto, @RequestId() rid: string) { return this.settings.putRoles(t.workspaceId, u.id, dto, rid); }

  @Get('ai/usage') @RequirePermission('ai.use')
  usage(@Tenant() t: TenantContext) { return this.settings.usage(t.workspaceId); }

  @Get('ai/tasks') @RequirePermission('ai.use')
  tasks(@Tenant() t: TenantContext, @Query(new ZodPipe(tasksQuerySchema)) q: TasksQueryDto) { return this.settings.tasks(t.workspaceId, q.limit); }

  @Get('ai/tools') @RequirePermission('ai.use')
  tools(@Tenant() t: TenantContext) { return this.cmd.listTools(t.permissions); }

  // ---------- AI Command Center (§37) ----------
  @Post('ai/command') @HttpCode(200) @RequirePermission('ai.use')
  command(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(commandSchema)) dto: CommandDto, @RequestId() rid: string) { return this.cmd.command(t.workspaceId, u.id, t.permissions, dto, rid); }

  // ---------- Analyst (§19) ----------
  @Post('analytics/pages/:pageId/analyze') @HttpCode(200) @RequirePermission('analytics.read', 'ai.use')
  analyze(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(analyzeSchema)) dto: AnalyzeDto, @RequestId() rid: string) { return this.analyst.analyzePage(t.workspaceId, u.id, pageId, dto?.days ?? 90, rid); }

  @Get('analytics/pages/:pageId/analyses') @RequirePermission('analytics.read')
  analyses(@Tenant() t: TenantContext, @Param('pageId') pageId: string) { return this.analyst.latest(t.workspaceId, pageId); }
}
