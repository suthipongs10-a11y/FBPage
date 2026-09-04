import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { ReportsService } from './reports.service';
import { generateReportSchema, type GenerateReportDto } from './dto';

@ApiTags('reports')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post('pages/:pageId/reports') @HttpCode(200) @RequirePermission('analytics.read')
  generate(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(generateReportSchema)) dto: GenerateReportDto, @RequestId() rid: string) { return this.reports.generate(t.workspaceId, u.id, pageId, dto, rid); }

  @Get('pages/:pageId/reports') @RequirePermission('analytics.read')
  list(@Tenant() t: TenantContext, @Param('pageId') pageId: string) { return this.reports.list(t.workspaceId, pageId); }

  @Get('reports/:id') @RequirePermission('analytics.read')
  get(@Tenant() t: TenantContext, @Param('id') id: string) { return this.reports.get(t.workspaceId, id); }
}
