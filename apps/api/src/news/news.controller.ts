/** ห้องข่าว — ใต้ workspaces/:workspaceId (แหล่งข่าวผูกกับแบรนด์) */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { NewsService } from './news.service';
import { createSourceSchema, draftSchema, listItemsSchema, searchProviderSchema, shortlistSchema, updateItemSchema, updateSourceSchema, type CreateSourceDto, type DraftDto, type ListItemsDto, type SearchProviderDto, type ShortlistDto, type UpdateSourceDto } from './dto';

@ApiTags('news')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class NewsController {
  constructor(@Inject(NewsService) private readonly news: NewsService) {}

  // ---- คีย์ค้นเว็บ ----
  @Get('news/search-provider') @RequirePermission('content.read')
  provider(@Tenant() t: TenantContext) { return this.news.getProvider(t.workspaceId); }
  @Put('news/search-provider') @RequirePermission('ai.configure')
  setProvider(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(searchProviderSchema)) dto: SearchProviderDto, @RequestId() rid: string) { return this.news.setProvider(t.workspaceId, u.id, dto, rid); }
  @Delete('news/search-provider') @RequirePermission('ai.configure')
  removeProvider(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @RequestId() rid: string) { return this.news.removeProvider(t.workspaceId, u.id, rid); }

  // ---- แหล่งข่าว ----
  @Get('brands/:brandId/news/sources') @RequirePermission('content.read')
  sources(@Tenant() t: TenantContext, @Param('brandId') brandId: string) { return this.news.listSources(t.workspaceId, brandId); }
  @Post('brands/:brandId/news/sources') @RequirePermission('content.create')
  createSource(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(createSourceSchema)) dto: CreateSourceDto, @RequestId() rid: string) { return this.news.createSource(t.workspaceId, u.id, brandId, dto, rid); }
  @Patch('news/sources/:id') @RequirePermission('content.create')
  updateSource(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateSourceSchema)) dto: UpdateSourceDto, @RequestId() rid: string) { return this.news.updateSource(t.workspaceId, u.id, id, dto, rid); }
  @Delete('news/sources/:id') @RequirePermission('content.create')
  deleteSource(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.news.deleteSource(t.workspaceId, u.id, id, rid); }
  @Post('brands/:brandId/news/fetch') @HttpCode(200) @RequirePermission('content.create')
  fetch(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @RequestId() rid: string) { return this.news.fetchBrand(t.workspaceId, u.id, brandId, rid); }

  // ---- กล่องข่าว ----
  @Get('news/items') @RequirePermission('content.read')
  items(@Tenant() t: TenantContext, @Query(new ZodPipe(listItemsSchema)) q: ListItemsDto) { return this.news.listItems(t.workspaceId, q); }
  @Patch('news/items/:id') @RequirePermission('content.create')
  updateItem(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateItemSchema)) b: z.infer<typeof updateItemSchema>, @RequestId() rid: string) { return this.news.updateItem(t.workspaceId, u.id, id, b.status, rid); }
  @Post('brands/:brandId/news/shortlist') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  shortlist(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(shortlistSchema)) dto: ShortlistDto, @RequestId() rid: string) { return this.news.shortlist(t.workspaceId, u.id, brandId, dto, rid); }
  @Post('news/items/:id/draft') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  draft(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(draftSchema)) dto: DraftDto, @RequestId() rid: string) { return this.news.draft(t.workspaceId, u.id, id, dto, rid); }
}
