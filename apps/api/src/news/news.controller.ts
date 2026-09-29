/** ห้องข่าว — ใต้ workspaces/:workspaceId (แหล่งข่าวผูกกับแบรนด์) */
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { NewsService } from './news.service';
import { NewsAutomationService } from './automation.service';
import { ContentImportService } from './import.service';
import { ResearchService } from './research.service';
import { PageScoutService } from './scout.service';
import { chatPromptSchema, type ChatPromptDto, scoutWriteSchema, type ScoutWriteDto, scoutCheckSchema, scoutIdeasSchema, scoutResearchSchema, type ScoutCheckDto, type ScoutIdeasDto, type ScoutResearchDto, researchSchema, researchWriteSchema, type ResearchDto, type ResearchWriteDto, importCheckSchema, importSchema, inboxSchema, uploadQuerySchema, type ImportCheckDto, type ImportDto, type InboxDto, automationSchema, providerQuerySchema, suggestSourcesSchema, type SuggestSourcesDto, nextSlotSchema, type AutomationDto, createSourceSchema, draftSchema, listItemsSchema, searchProviderSchema, shortlistSchema, updateItemSchema, updateSourceSchema, type CreateSourceDto, type DraftDto, type ListItemsDto, type SearchProviderDto, type ShortlistDto, type UpdateSourceDto } from './dto';

@ApiTags('news')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class NewsController {
  constructor(@Inject(NewsService) private readonly news: NewsService, @Inject(NewsAutomationService) private readonly auto: NewsAutomationService, @Inject(ContentImportService) private readonly imports: ContentImportService, @Inject(ResearchService) private readonly research: ResearchService, @Inject(PageScoutService) private readonly scout: PageScoutService) {}

  // ---- คีย์ค้นเว็บ ----
  @Get('news/search-provider') @RequirePermission('content.read')
  provider(@Tenant() t: TenantContext, @Query(new ZodPipe(providerQuerySchema)) q: z.infer<typeof providerQuerySchema>) { return this.news.getProvider(t.workspaceId, q.provider); }
  @Put('news/search-provider') @RequirePermission('ai.configure')
  setProvider(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(searchProviderSchema)) dto: SearchProviderDto, @RequestId() rid: string) { return this.news.setProvider(t.workspaceId, u.id, dto, rid); }
  @Delete('news/search-provider') @RequirePermission('ai.configure')
  removeProvider(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Query(new ZodPipe(providerQuerySchema)) q: z.infer<typeof providerQuerySchema>, @RequestId() rid: string) { return this.news.removeProvider(t.workspaceId, u.id, q.provider, rid); }

  // ---- แหล่งข่าว ----
  @Get('brands/:brandId/news/sources') @RequirePermission('content.read')
  sources(@Tenant() t: TenantContext, @Param('brandId') brandId: string) { return this.news.listSources(t.workspaceId, brandId); }
  @Post('brands/:brandId/news/sources') @RequirePermission('content.create')
  createSource(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(createSourceSchema)) dto: CreateSourceDto, @RequestId() rid: string) { return this.news.createSource(t.workspaceId, u.id, brandId, dto, rid); }
  @Post('brands/:brandId/news/sources/suggest') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  suggestSources(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(suggestSourcesSchema)) dto: SuggestSourcesDto, @RequestId() rid: string) { return this.news.suggestSources(t.workspaceId, u.id, brandId, dto, rid); }
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

  // ---- อัตโนมัติ (N-4) ----
  @Get('brands/:brandId/news/automation') @RequirePermission('content.read')
  automation(@Tenant() t: TenantContext, @Param('brandId') brandId: string) { return this.auto.get(t.workspaceId, brandId); }
  @Put('brands/:brandId/news/automation') @RequirePermission('content.create', 'ai.use')
  setAutomation(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(automationSchema)) dto: AutomationDto, @RequestId() rid: string) { return this.auto.set(t.workspaceId, u.id, brandId, dto, rid); }
  @Post('brands/:brandId/news/automation/run') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  runAutomation(@Tenant() t: TenantContext, @Param('brandId') brandId: string) { return this.auto.runOne(t.workspaceId, brandId); }
  @Get('news/next-slot') @RequirePermission('content.read')
  nextSlot(@Tenant() t: TenantContext, @Query(new ZodPipe(nextSlotSchema)) q: z.infer<typeof nextSlotSchema>) { return this.auto.nextSlot(t.workspaceId, q.pageId); }

  // ---- นำเข้าแพ็กเกจจาก AI ภายนอก (fbpm-content-v1) ----
  @Get('brands/:brandId/news/import/template') @RequirePermission('content.read')
  importTemplate(@Tenant() t: TenantContext, @Param('brandId') brandId: string) { return this.imports.template(t.workspaceId, brandId); }
  @Post('brands/:brandId/news/import/chat-prompt') @HttpCode(200) @RequirePermission('content.read')
  chatPrompt(@Tenant() t: TenantContext, @Param('brandId') brandId: string, @Body(new ZodPipe(chatPromptSchema)) b: ChatPromptDto) { return this.imports.chatPrompt(t.workspaceId, brandId, b); }
  @Get('brands/:brandId/news/import/page-keywords') @RequirePermission('content.read')
  pageKeywords(@Tenant() t: TenantContext, @Param('brandId') brandId: string, @Query('pageId', new ZodPipe(z.string().min(1))) pageId: string) { return this.imports.pageKeywords(t.workspaceId, brandId, pageId); }
  @Get('brands/:brandId/news/inbox') @RequirePermission('content.read')
  inbox(@Tenant() t: TenantContext, @Param('brandId') brandId: string) { return this.imports.getInbox(t.workspaceId, brandId); }
  @Put('brands/:brandId/news/inbox') @RequirePermission('ai.configure')
  setInbox(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(inboxSchema)) dto: InboxDto, @RequestId() rid: string) { return this.imports.setInbox(t.workspaceId, u.id, brandId, dto, rid); }
  @Post('brands/:brandId/news/inbox/key') @HttpCode(200) @RequirePermission('ai.configure')
  rotateKey(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @RequestId() rid: string) { return this.imports.rotateKey(t.workspaceId, u.id, brandId, rid); }
  @Delete('brands/:brandId/news/inbox/key') @RequirePermission('ai.configure')
  revokeKey(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @RequestId() rid: string) { return this.imports.revokeKey(t.workspaceId, u.id, brandId, rid); }
  @Post('brands/:brandId/news/inbox/drive/poll') @HttpCode(200) @RequirePermission('content.create')
  pollDrive(@Tenant() t: TenantContext, @Param('brandId') brandId: string, @RequestId() rid: string) { return this.imports.pollDriveOne(t.workspaceId, brandId, rid); }
  /** อัปโหลดรูปแนบแพ็กเกจ — body เป็นไบต์ของรูปตรง ๆ (content-type image/*) ≤ 12 MB */
  @Post('news/import/files') @RequirePermission('content.create')
  async uploadFile(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Query(new ZodPipe(uploadQuerySchema)) q: z.infer<typeof uploadQuerySchema>, @Req() req: Request) { return this.imports.upload(t.workspaceId, u.id, q.name, await readRaw(req, 12 * 1024 * 1024)); }
  @Post('brands/:brandId/news/import/check') @HttpCode(200) @RequirePermission('content.create')
  checkImport(@Tenant() t: TenantContext, @Param('brandId') brandId: string, @Body(new ZodPipe(importCheckSchema)) dto: ImportCheckDto) { return this.imports.check(t.workspaceId, brandId, dto); }
  @Post('brands/:brandId/news/import') @HttpCode(200) @RequirePermission('content.create')
  importPackage(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(importSchema)) dto: ImportDto, @RequestId() rid: string) { return this.imports.importPaste(t.workspaceId, u.id, brandId, dto, rid); }
  @Get('brands/:brandId/news/imports') @RequirePermission('content.read')
  importsList(@Tenant() t: TenantContext, @Param('brandId') brandId: string) { return this.imports.list(t.workspaceId, brandId); }
  @Post('news/imports/:id/draft') @HttpCode(200) @RequirePermission('content.create')
  draftImport(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.imports.draftImport(t.workspaceId, u.id, id, rid); }
  @Delete('news/imports/:id') @RequirePermission('content.create')
  dismissImport(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.imports.dismiss(t.workspaceId, u.id, id, rid); }

  // ---- โต๊ะค้นคว้า ----
  @Get('news/research/capabilities') @RequirePermission('content.read')
  researchCaps(@Tenant() t: TenantContext) { return this.research.capabilities(t.workspaceId); }
  @Post('brands/:brandId/news/research') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  startResearch(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('brandId') brandId: string, @Body(new ZodPipe(researchSchema)) dto: ResearchDto, @RequestId() rid: string) { return this.research.research(t.workspaceId, u.id, brandId, dto, rid); }
  @Get('brands/:brandId/news/research') @RequirePermission('content.read')
  researchList(@Tenant() t: TenantContext, @Param('brandId') brandId: string) { return this.research.list(t.workspaceId, brandId); }
  @Post('news/research/:id/write') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  researchWrite(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(researchWriteSchema)) dto: ResearchWriteDto, @RequestId() rid: string) { return this.research.write(t.workspaceId, u.id, id, dto, rid); }
  @Delete('news/research/:id') @RequirePermission('content.create')
  researchDelete(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.research.remove(t.workspaceId, u.id, id, rid); }

  // ---- ผู้ช่วยหาเรื่องโพสต์ต่อเพจ ----
  @Get('pages/:pageId/scout') @RequirePermission('content.read')
  scoutGet(@Tenant() t: TenantContext, @Param('pageId') pageId: string) { return this.scout.get(t.workspaceId, pageId); }
  @Post('pages/:pageId/scout/check') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  scoutCheck(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(scoutCheckSchema)) dto: ScoutCheckDto, @RequestId() rid: string) { return this.scout.check(t.workspaceId, u.id, pageId, dto, rid); }
  @Post('pages/:pageId/scout/ideas') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  scoutIdeas(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(scoutIdeasSchema)) dto: ScoutIdeasDto, @RequestId() rid: string) { return this.scout.ideas(t.workspaceId, u.id, pageId, dto, rid); }
  @Post('pages/:pageId/scout/ideas/:index/write') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  scoutWrite(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Param('index') index: string, @Body(new ZodPipe(scoutWriteSchema)) dto: ScoutWriteDto, @RequestId() rid: string) { return this.scout.writeIdea(t.workspaceId, u.id, pageId, Number(index) || 0, dto, rid); }
  @Post('pages/:pageId/scout/ideas/:index/research') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  scoutResearch(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Param('index') index: string, @Body(new ZodPipe(scoutResearchSchema)) dto: ScoutResearchDto, @RequestId() rid: string) { return this.scout.researchIdea(t.workspaceId, u.id, pageId, Number(index) || 0, dto, rid); }
}

/** อ่าน body ดิบ (รูป/ข้อความ) พร้อมเพดาน — ใช้กับ content-type ที่ Nest ไม่ parse ให้ */
export async function readRaw(req: Request, max: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  const len = Number(req.headers['content-length'] ?? 0);
  if (len > max) throw new BadRequestException(`ไฟล์ใหญ่เกิน ${Math.round(max / 1048576)} MB`);
  const chunks: Buffer[] = []; let total = 0;
  for await (const c of req) { total += (c as Buffer).byteLength; if (total > max) throw new BadRequestException(`ไฟล์ใหญ่เกิน ${Math.round(max / 1048576)} MB`); chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}
