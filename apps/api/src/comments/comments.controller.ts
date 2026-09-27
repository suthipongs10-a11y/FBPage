import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { CommentsService } from './comments.service';
import { commentAutomationSchema, privateReplySchema, type CommentAutomationDto, type PrivateReplyDto, classifySchema, insightsSchema, listCommentsSchema, listLeadsSchema, replySchema, syncCommentsSchema, updateCommentSchema, updateLeadSchema, type ClassifyDto, type InsightsDto, type ListCommentsDto, type ListLeadsDto, type ReplyDto, type SyncCommentsDto, type UpdateCommentDto, type UpdateLeadDto } from './dto';

@ApiTags('comments')
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, TenantGuard)
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly svc: CommentsService) {}

  @Get('comments') @RequirePermission('comments.read')
  list(@Tenant() t: TenantContext, @Query(new ZodPipe(listCommentsSchema)) q: ListCommentsDto) { return this.svc.list(t.workspaceId, q); }

  @Get('comments/insights') @RequirePermission('comments.read')
  insights(@Tenant() t: TenantContext, @Query(new ZodPipe(insightsSchema)) q: InsightsDto) { return this.svc.insights(t.workspaceId, q); }

  @Post('pages/:pageId/comments/sync') @HttpCode(200) @RequirePermission('comments.read')
  sync(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(syncCommentsSchema)) dto: SyncCommentsDto, @RequestId() rid: string) { return this.svc.runSync(t.workspaceId, u.id, pageId, dto?.days, rid); }

  @Post('comments/classify') @HttpCode(200) @RequirePermission('comments.read', 'ai.use')
  classify(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(classifySchema)) dto: ClassifyDto, @RequestId() rid: string) { return this.svc.classify(t.workspaceId, u.id, dto, rid); }

  @Patch('comments/:id') @RequirePermission('comments.reply')
  update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateCommentSchema)) dto: UpdateCommentDto, @RequestId() rid: string) { return this.svc.update(t.workspaceId, u.id, id, dto, rid); }

  @Post('comments/:id/reply') @HttpCode(200) @RequirePermission('comments.reply')
  reply(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(replySchema)) dto: ReplyDto, @RequestId() rid: string) { return this.svc.sendReply(t.workspaceId, u.id, id, dto.message, rid); }

  @Post('comments/:id/like') @HttpCode(200) @RequirePermission('comments.reply')
  like(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.svc.like(t.workspaceId, u.id, id, rid); }

  @Post('comments/:id/private-reply') @HttpCode(200) @RequirePermission('comments.reply')
  privateReply(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(privateReplySchema)) dto: PrivateReplyDto, @RequestId() rid: string) { return this.svc.sendPrivateReply(t.workspaceId, u.id, id, dto, rid); }

  @Get('pages/:pageId/comment-automation') @RequirePermission('comments.read')
  automation(@Tenant() t: TenantContext, @Param('pageId') pageId: string) { return this.svc.getAutomation(t.workspaceId, pageId); }

  @Put('pages/:pageId/comment-automation') @RequirePermission('comments.reply', 'ai.use')
  setAutomation(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @Body(new ZodPipe(commentAutomationSchema)) dto: CommentAutomationDto, @RequestId() rid: string) { return this.svc.setAutomation(t.workspaceId, u.id, pageId, dto, rid); }

  @Post('pages/:pageId/comment-automation/run') @HttpCode(200) @RequirePermission('comments.reply', 'ai.use')
  runAutomation(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('pageId') pageId: string, @RequestId() rid: string) { return this.svc.runAutomation(t.workspaceId, pageId, rid, { userId: u.id, forceSync: true }); }

  @Post('comments/:id/hide') @HttpCode(200) @RequirePermission('comments.reply')
  hide(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.svc.hide(t.workspaceId, u.id, id, true, rid); }

  @Post('comments/:id/unhide') @HttpCode(200) @RequirePermission('comments.reply')
  unhide(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.svc.hide(t.workspaceId, u.id, id, false, rid); }

  @Get('leads') @RequirePermission('leads.read')
  leads(@Tenant() t: TenantContext, @Query(new ZodPipe(listLeadsSchema)) q: ListLeadsDto) { return this.svc.listLeads(t.workspaceId, q); }

  @Patch('leads/:id') @RequirePermission('leads.read')
  updateLead(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateLeadSchema)) dto: UpdateLeadDto, @RequestId() rid: string) { return this.svc.updateLead(t.workspaceId, u.id, id, dto, rid); }
}
