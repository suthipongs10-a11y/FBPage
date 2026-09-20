import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { AiSettingsService } from './settings.service';
import { CommandService } from './command.service';
import { AnalystService } from './analyst.service';
import { analyzeSchema, commandSchema, createConnectionSchema, putRolesSchema, tasksQuerySchema, updateConnectionSchema, type AnalyzeDto, type CommandDto, type CreateConnectionDto, type PutRolesDto, type TasksQueryDto, type UpdateConnectionDto } from './dto';

@ApiTags('ai')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class AiController {
  constructor(@Inject(AiSettingsService) private readonly settings: AiSettingsService, @Inject(CommandService) private readonly cmd: CommandService, @Inject(AnalystService) private readonly analyst: AnalystService) {}

  // ---------- ตั้งค่า (§41, §42) ----------
  @Get('ai/connections') @RequirePermission('ai.use')
  connections(@Tenant() t: TenantContext) { return this.settings.connections(t.workspaceId); }

  @Post('ai/connections') @HttpCode(201) @RequirePermission('ai.configure')
  createConnection(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createConnectionSchema)) dto: CreateConnectionDto, @RequestId() rid: string) {
    return this.settings.createConnection(t.workspaceId, u.id, dto, rid);
  }

  @Patch('ai/connections/:id') @RequirePermission('ai.configure')
  updateConnection(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateConnectionSchema)) dto: UpdateConnectionDto, @RequestId() rid: string) {
    return this.settings.updateConnection(t.workspaceId, u.id, id, dto, rid);
  }

  @Delete('ai/connections/:id') @RequirePermission('ai.configure')
  removeConnection(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.settings.removeConnection(t.workspaceId, u.id, id, rid); }

  @Post('ai/connections/:id/validate') @HttpCode(200) @RequirePermission('ai.configure')
  validateConnection(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.settings.validateConnection(t.workspaceId, u.id, id, rid); }

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
