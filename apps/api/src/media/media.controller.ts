import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { MediaService } from './media.service';
import { MediaGenService } from './media-gen.service';
import { attachVideoSchema, aiCardSchema, aiImageSchema, aiMediaConfigSchema, renderCardSchema, type AiCardDto, type AiImageDto, type AiMediaConfigDto, type RenderCardDto } from './dto';

@ApiTags('media')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService, @Inject(MediaGenService) private readonly gen: MediaGenService) {}

  @Get('media/capabilities') @RequirePermission('content.read')
  capabilities() { return this.media.capabilities(); }

  @Get('media') @RequirePermission('content.read')
  list(@Tenant() t: TenantContext, @Query('contentId') contentId?: string) { return this.media.list(t.workspaceId, contentId || undefined); }

  /** อัปโหลดคลิป Reels (body = ไฟล์ดิบ, content-type video/mp4 หรือ video/quicktime) — สตรีมลงดิสก์ */
  @Post('media/videos') @RequirePermission('content.create')
  uploadVideo(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Query('name') name: string | undefined, @Req() req: Request) {
    return this.media.uploadVideo(t.workspaceId, u.id, (name ?? 'clip.mp4').slice(0, 200), req, Number(req.headers['content-length'] ?? 0));
  }

  @Post('content/:contentId/video') @HttpCode(200) @RequirePermission('content.edit')
  attachVideo(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('contentId') contentId: string, @Body(new ZodPipe(attachVideoSchema)) b: { assetId: string }, @RequestId() rid: string) { return this.media.attachVideo(t.workspaceId, u.id, contentId, b.assetId, rid); }

  @Get('media/:id/file') @RequirePermission('content.read')
  async file(@Tenant() t: TenantContext, @Param('id') id: string, @Res() res: Response) {
    const v = await this.media.filePath(t.workspaceId, id);
    if (v.mimeType.startsWith('video/')) { res.setHeader('cache-control', 'private, max-age=3600'); return res.sendFile(v.path, { headers: { 'content-type': v.mimeType } }); }
    const f = await this.media.file(t.workspaceId, id);
    res.setHeader('content-type', f.mimeType); res.setHeader('cache-control', 'private, max-age=3600'); res.end(f.buffer);
  }

  @Post('content/:contentId/media/card') @HttpCode(200) @RequirePermission('content.edit')
  renderCard(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('contentId') contentId: string, @Body(new ZodPipe(renderCardSchema)) dto: RenderCardDto, @RequestId() rid: string) { return this.media.renderCard(t.workspaceId, u.id, contentId, dto, rid); }

  @Post('content/:contentId/media/card/ai') @HttpCode(200) @RequirePermission('content.edit', 'ai.use')
  aiCard(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('contentId') contentId: string, @Body(new ZodPipe(aiCardSchema)) dto: AiCardDto, @RequestId() rid: string) { return this.media.aiCard(t.workspaceId, u.id, contentId, dto, rid); }

  // ---- ภาพจาก AI (N-3) ----
  @Get('media/ai-config') @RequirePermission('content.read')
  aiConfig(@Tenant() t: TenantContext) { return this.gen.getConfig(t.workspaceId); }
  @Put('media/ai-config') @RequirePermission('ai.configure')
  setAiConfig(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(aiMediaConfigSchema)) dto: AiMediaConfigDto, @RequestId() rid: string) { return this.gen.setConfig(t.workspaceId, u.id, dto, rid); }
  @Post('media/ai-image') @HttpCode(200) @RequirePermission('content.edit', 'ai.use')
  aiImage(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(aiImageSchema)) dto: AiImageDto, @RequestId() rid: string) { return this.gen.generate(t.workspaceId, u.id, { contentId: dto.contentId ?? null, prompt: dto.prompt, attach: dto.attach, override: dto.modelOverride ?? null, idempotencyKey: dto.idempotencyKey }, rid); }

  @Delete('media/:id') @RequirePermission('content.edit')
  remove(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.media.remove(t.workspaceId, u.id, id, rid); }
}
