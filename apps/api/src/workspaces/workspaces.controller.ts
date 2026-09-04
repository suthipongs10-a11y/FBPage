import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { InvitesService } from '../auth/invites.service';
import { z } from 'zod';
import { WORKSPACE_ROLES } from '@fbpm/shared';
import { TenantGuard } from './tenant.guard';
import { RequirePermission } from './permissions';
import { WorkspacesService } from './workspaces.service';
import { addMemberSchema, createWorkspaceSchema, updateMemberSchema, updateWorkspaceSchema, type AddMemberDto, type CreateWorkspaceDto, type UpdateMemberDto, type UpdateWorkspaceDto } from './dto';

@ApiTags('workspaces')
@Controller('workspaces')
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(
    @Inject(WorkspacesService) private readonly ws: WorkspacesService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InvitesService) private readonly invites: InvitesService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createWorkspaceSchema)) dto: CreateWorkspaceDto, @RequestId() rid: string) {
    return this.ws.create(user.id, dto, rid);
  }

  @Get(':workspaceId')
  @UseGuards(TenantGuard)
  get(@Tenant() t: TenantContext) { return this.ws.get(t.workspaceId).then(w => ({ ...w, role: t.role, permissions: t.permissions })); }

  @Patch(':workspaceId')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(updateWorkspaceSchema)) dto: UpdateWorkspaceDto, @RequestId() rid: string) {
    return this.ws.update(t.workspaceId, u.id, dto, rid);
  }

  @Get(':workspaceId/members')
  @UseGuards(TenantGuard)
  members(@Tenant() t: TenantContext) { return this.ws.members(t.workspaceId); }

  @Post(':workspaceId/members')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  addMember(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(addMemberSchema)) dto: AddMemberDto, @RequestId() rid: string) {
    return this.ws.addMember(t.workspaceId, u.id, dto, rid);
  }

  @Patch(':workspaceId/members/:userId')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  updateMember(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('userId') userId: string, @Body(new ZodPipe(updateMemberSchema)) dto: UpdateMemberDto, @RequestId() rid: string) {
    return this.ws.updateMember(t.workspaceId, u.id, userId, dto, rid);
  }

  @Delete(':workspaceId/members/:userId')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  removeMember(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('userId') userId: string, @RequestId() rid: string) {
    return this.ws.removeMember(t.workspaceId, u.id, userId, rid);
  }

  @Get(':workspaceId/invites')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  listInvites(@Tenant() t: TenantContext) { return this.invites.list(t.workspaceId); }

  @Post(':workspaceId/invites')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  createInvite(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ role: z.enum(WORKSPACE_ROLES), email: z.string().trim().toLowerCase().email().optional() }))) dto: { role: (typeof WORKSPACE_ROLES)[number]; email?: string }, @RequestId() rid: string) {
    return this.invites.create(t.workspaceId, u.id, dto.role, dto.email, rid);
  }

  @Delete(':workspaceId/invites/:inviteId')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  revokeInvite(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('inviteId') id: string, @RequestId() rid: string) { return this.invites.revoke(t.workspaceId, u.id, id, rid); }

  @Post(':workspaceId/members/:userId/reset-link')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  resetLink(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('userId') userId: string, @RequestId() rid: string) { return this.invites.createResetLink(t.workspaceId, u.id, userId, rid); }

  @Get(':workspaceId/audit')
  @UseGuards(TenantGuard) @RequirePermission('workspace.manage')
  auditLog(@Tenant() t: TenantContext, @Query('limit') limit?: string) { return this.audit.list(t.workspaceId, Number(limit) || 50); }
}
