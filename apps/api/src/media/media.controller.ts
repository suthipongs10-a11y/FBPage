import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { MediaService } from './media.service';
import { aiCardSchema, renderCardSchema, type AiCardDto, type RenderCardDto } from './dto';

@ApiTags('media')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get('media/capabilities') @RequirePermission('content.read')
  capabilities() { return this.media.capabilities(); }

  @Get('media') @RequirePermission('content.read')
  list(@Tenant() t: TenantContext, @Query('contentId') contentId?: string) { return this.media.list(t.workspaceId, contentId || undefined); }

  @Get('media/:id/file') @RequirePermission('content.read')
  async file(@Tenant() t: TenantContext, @Param('id') id: string, @Res() res: Response) {
    const f = await this.media.file(t.workspaceId, id);
    res.setHeader('content-type', f.mimeType); res.setHeader('cache-control', 'private, max-age=3600'); res.end(f.buffer);
  }

  @Post('content/:contentId/media/card') @HttpCode(200) @RequirePermission('content.edit')
  renderCard(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('contentId') contentId: string, @Body(new ZodPipe(renderCardSchema)) dto: RenderCardDto, @RequestId() rid: string) { return this.media.renderCard(t.workspaceId, u.id, contentId, dto, rid); }

  @Post('content/:contentId/media/card/ai') @HttpCode(200) @RequirePermission('content.edit', 'ai.use')
  aiCard(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('contentId') contentId: string, @Body(new ZodPipe(aiCardSchema)) dto: AiCardDto, @RequestId() rid: string) { return this.media.aiCard(t.workspaceId, u.id, contentId, dto, rid); }

  @Delete('media/:id') @RequirePermission('content.edit')
  remove(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.media.remove(t.workspaceId, u.id, id, rid); }
}
