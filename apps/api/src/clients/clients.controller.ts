import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { ClientsService } from './clients.service';
import { createClientSchema, updateClientSchema, type CreateClientDto, type UpdateClientDto } from './dto';

@ApiTags('clients')
@Controller('workspaces/:workspaceId/clients')
@UseGuards(AuthGuard, TenantGuard)
export class ClientsController {
  constructor(@Inject(ClientsService) private readonly clients: ClientsService) {}

  @Get() @RequirePermission('client.read')
  list(@Tenant() t: TenantContext) { return this.clients.list(t.workspaceId); }

  @Get(':clientId') @RequirePermission('client.read')
  get(@Tenant() t: TenantContext, @Param('clientId') id: string) { return this.clients.get(t.workspaceId, id); }

  @Post() @RequirePermission('client.manage')
  create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createClientSchema)) dto: CreateClientDto, @RequestId() rid: string) {
    return this.clients.create(t.workspaceId, u.id, dto, rid);
  }

  @Patch(':clientId') @RequirePermission('client.manage')
  update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('clientId') id: string, @Body(new ZodPipe(updateClientSchema)) dto: UpdateClientDto, @RequestId() rid: string) {
    return this.clients.update(t.workspaceId, u.id, id, dto, rid);
  }

  @Delete(':clientId') @RequirePermission('client.manage')
  remove(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('clientId') id: string, @RequestId() rid: string) {
    return this.clients.remove(t.workspaceId, u.id, id, rid);
  }
}
