import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ShareService } from './share.service';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { ReportsService } from './reports.service';
import { generateReportSchema, type GenerateReportDto } from './dto';

export const shareSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).optional();

@ApiTags('reports')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService, @Inject(ShareService) private readonly share: ShareService) {}

  @Post('pages/:pageId/reports') @HttpCode(200) @RequirePermission('analytics.read')
  generate(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(generateReportSchema)) dto: GenerateReportDto, @RequestId() rid: string) { return this.reports.generate(t.workspaceId, u.id, pageId, dto, rid); }

  @Get('pages/:pageId/trends') @RequirePermission('analytics.read')
  trends(@Tenant() t: TenantContext, @Param('pageId') pageId: string, @Query('weeks') weeks?: string) { return this.reports.trends(t.workspaceId, pageId, Number(weeks) || 12); }

  @Get('pages/:pageId/reports') @RequirePermission('analytics.read')
  list(@Tenant() t: TenantContext, @Param('pageId') pageId: string) { return this.reports.list(t.workspaceId, pageId); }

  @Get('reports/:id') @RequirePermission('analytics.read')
  get(@Tenant() t: TenantContext, @Param('id') id: string) { return this.reports.get(t.workspaceId, id); }

  @Get('reports/:id/pdf') @RequirePermission('analytics.read')
  async pdf(@Tenant() t: TenantContext, @Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.share.pdf('facebook', id, t.workspaceId);
    res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(fileName)}"`); res.end(buffer);
  }
  /** ลิงก์แชร์ให้ลูกค้า (อ่านอย่างเดียว, หมดอายุ) */
  @Post('reports/:id/share') @HttpCode(200) @RequirePermission('analytics.read')
  shareLink(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(shareSchema)) b: z.infer<typeof shareSchema>, @RequestId() rid: string) { return this.share.createLink(t.workspaceId, u.id, 'facebook', id, b?.days ?? 30, rid); }
}
