import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { BrandsService } from './brands.service';
import {
  createBrandSchema, createKnowledgeSchema, updateBrandSchema, updateKnowledgeSchema,
  type CreateBrandDto, type CreateKnowledgeDto, type UpdateBrandDto, type UpdateKnowledgeDto,
} from './dto';

@ApiTags('brands')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class BrandsController {
  constructor(@Inject(BrandsService) private readonly brands: BrandsService) {}

  @Get('clients/:clientId/brands') @RequirePermission('client.read')
  listByClient(@Tenant() t: TenantContext, @Param('clientId') clientId: string) { return this.brands.listByClient(t.workspaceId, clientId); }

  @Post('clients/:clientId/brands') @RequirePermission('client.manage')
  create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Body(new ZodPipe(createBrandSchema)) dto: CreateBrandDto, @RequestId() rid: string) {
    return this.brands.create(t.workspaceId, u.id, clientId, dto, rid);
  }

  @Get('brands/:brandId') @RequirePermission('client.read')
  get(@Tenant() t: TenantContext, @Param('brandId') id: string) { return this.brands.get(t.workspaceId, id); }

  @Patch('brands/:brandId') @RequirePermission('client.manage')
  update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') id: string, @Body(new ZodPipe(updateBrandSchema)) dto: UpdateBrandDto, @RequestId() rid: string) {
    return this.brands.update(t.workspaceId, u.id, id, dto, rid);
  }

  @Delete('brands/:brandId') @RequirePermission('client.manage')
  remove(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') id: string, @RequestId() rid: string) {
    return this.brands.remove(t.workspaceId, u.id, id, rid);
  }

  @Get('brands/:brandId/knowledge') @RequirePermission('client.read')
  listKnowledge(@Tenant() t: TenantContext, @Param('brandId') id: string) { return this.brands.listKnowledge(t.workspaceId, id); }

  @Post('brands/:brandId/knowledge') @RequirePermission('client.manage')
  addKnowledge(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') id: string, @Body(new ZodPipe(createKnowledgeSchema)) dto: CreateKnowledgeDto, @RequestId() rid: string) {
    return this.brands.addKnowledge(t.workspaceId, u.id, id, dto, rid);
  }

  @Patch('brands/:brandId/knowledge/:itemId') @RequirePermission('client.manage')
  updateKnowledge(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') id: string, @Param('itemId') itemId: string, @Body(new ZodPipe(updateKnowledgeSchema)) dto: UpdateKnowledgeDto, @RequestId() rid: string) {
    return this.brands.updateKnowledge(t.workspaceId, u.id, id, itemId, dto, rid);
  }

  @Delete('brands/:brandId/knowledge/:itemId') @RequirePermission('client.manage')
  removeKnowledge(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') id: string, @Param('itemId') itemId: string, @RequestId() rid: string) {
    return this.brands.removeKnowledge(t.workspaceId, u.id, id, itemId, rid);
  }
}
