import { Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { ContentService } from './content.service';
import { ContentAgentsService } from './agents.service';
import { approveScheduleSchema, calendarSchema, createContentSchema, generateSchema, listContentSchema, planSchema, reviewCommentSchema, scheduleSchema, updateContentSchema, type ApproveScheduleDto, type CalendarDto, type CreateContentDto, type GenerateDto, type ListContentDto, type PlanDto, type ReviewCommentDto, type ScheduleDto, type UpdateContentDto } from './dto';

@ApiTags('content')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class ContentController {
  constructor(@Inject(ContentService) private readonly content: ContentService, @Inject(ContentAgentsService) private readonly agents: ContentAgentsService) {}

  @Get('content') @RequirePermission('content.read')
  list(@Tenant() t: TenantContext, @Query(new ZodPipe(listContentSchema)) q: ListContentDto) { return this.content.list(t.workspaceId, q); }

  @Get('content/calendar') @RequirePermission('content.read')
  calendar(@Tenant() t: TenantContext, @Query(new ZodPipe(calendarSchema)) q: CalendarDto) { return this.content.calendar(t.workspaceId, q); }

  @Get('approvals') @RequirePermission('content.read')
  approvals(@Tenant() t: TenantContext) { return this.content.pendingApprovals(t.workspaceId); }

  @Post('content') @RequirePermission('content.create')
  create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createContentSchema)) dto: CreateContentDto, @RequestId() rid: string) { return this.content.create(t.workspaceId, u.id, dto, rid); }

  @Get('content/:id') @RequirePermission('content.read')
  get(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.get(t.workspaceId, id); }

  @Get('content/:id/revisions') @RequirePermission('content.read')
  revisions(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.revisions(t.workspaceId, id); }

  @Get('content/:id/job') @RequirePermission('content.read')
  job(@Tenant() t: TenantContext, @Param('id') id: string) { return this.content.jobState(t.workspaceId, id); }

  @Patch('content/:id') @RequirePermission('content.edit')
  update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateContentSchema)) dto: UpdateContentDto, @RequestId() rid: string) { return this.content.update(t.workspaceId, u.id, id, dto, rid); }

  /** ส่งขออนุมัติ — รัน Reviewer ก่อนถ้ามี AI */
  @Post('content/:id/submit') @HttpCode(200) @RequirePermission('content.edit')
  async submit(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) {
    // Reviewer ล้ม (AI ล่ม/งบหมด) ต้องไม่ล็อกทีมไว้ — บันทึกว่าข้ามการตรวจแล้วให้คนตัดสินต่อ
    const review = await this.agents.review(t.workspaceId, u.id, id, rid).catch((e: unknown) => ({ result: 'SKIPPED', issues: [], summary: `ข้ามการตรวจโดย AI: ${e instanceof Error ? (e as Error & { response?: { message?: string } }).response?.message ?? e.message : String(e)}` }));
    return this.content.submit(t.workspaceId, u.id, id, rid, review ?? undefined);
  }

  @Post('content/:id/approve') @HttpCode(200) @RequirePermission('content.approve')
  approve(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.content.approve(t.workspaceId, u.id, id, dto.comment, rid); }

  @Post('content/:id/reject') @HttpCode(200) @RequirePermission('content.approve')
  reject(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.content.reject(t.workspaceId, u.id, id, dto.comment, rid); }

  @Post('content/:id/request-changes') @HttpCode(200) @RequirePermission('content.approve')
  requestChanges(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.content.requestChanges(t.workspaceId, u.id, id, dto.comment, rid); }

  @Post('content/:id/reopen') @HttpCode(200) @RequirePermission('content.edit')
  reopen(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.backToDraft(t.workspaceId, u.id, id, rid); }

  @Delete('content/:id') @RequirePermission('content.edit')
  cancel(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.cancel(t.workspaceId, u.id, id, rid); }

  @Post('content/:id/schedule') @HttpCode(200) @RequirePermission('content.publish')
  schedule(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(scheduleSchema)) dto: ScheduleDto, @RequestId() rid: string) { return this.content.schedule(t.workspaceId, u.id, id, dto, rid); }

  @Post('content/:id/approve-schedule') @HttpCode(200) @RequirePermission('content.approve', 'content.publish')
  approveSchedule(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(approveScheduleSchema)) dto: ApproveScheduleDto, @RequestId() rid: string) { return this.content.approveAndSchedule(t.workspaceId, u.id, id, dto, rid); }

  @Post('content/:id/publish') @HttpCode(200) @RequirePermission('content.publish')
  publish(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.content.publishNow(t.workspaceId, u.id, id, rid); }

  // ---------- agents ----------
  @Post('pages/:pageId/content/plan') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  plan(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(planSchema)) dto: PlanDto, @RequestId() rid: string) { return this.agents.plan(t.workspaceId, u.id, pageId, dto, rid); }

  @Post('pages/:pageId/content/generate') @HttpCode(200) @RequirePermission('content.create', 'ai.use')
  generate(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(generateSchema)) dto: GenerateDto, @RequestId() rid: string) { return this.agents.generate(t.workspaceId, u.id, pageId, dto, rid); }

  @Post('content/:id/generate') @HttpCode(200) @RequirePermission('content.edit', 'ai.use')
  async regenerate(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) {
    const c = await this.content.get(t.workspaceId, id);
    if (!c.pageId) throw new ConflictException('คอนเทนต์นี้เป็นของ YouTube — ใช้ Content Lab ของ YouTube');
    return this.agents.generate(t.workspaceId, u.id, c.pageId, undefined, rid, id);
  }
}
