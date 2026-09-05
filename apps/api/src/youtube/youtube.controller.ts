/** YouTube module routes (AGENTS_YOUTUBE §92) — ทุกเส้นทางใต้ workspaces/:workspaceId/youtube ยกเว้น OAuth callback (สาธารณะ ยืนยันด้วย state ที่เซ็น) */
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ScopeFeature } from '@fbpm/youtube-core';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { YtChannelsService } from './channels.service';
import { YtVideosService } from './videos.service';
import { YtCommentsService } from './comments.service';
import { YtContentLabService } from './content-lab.service';
import { YtReportsService } from './reports.service';
import { YtPlaylistsService } from './playlists.service';
import { ShareService } from '../reports/share.service';
import { shareSchema } from '../reports/reports.controller';
import * as d from './dto';

const featuresSchema = z.object({ features: z.string().optional() });
const listContentSchema = z.object({ channelId: z.string().optional(), ytStatus: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
const calendarSchema = z.object({ from: z.string().datetime(), to: z.string().datetime(), platform: z.enum(['FACEBOOK', 'YOUTUBE']).optional() });
const recsSchema = z.object({ channelId: z.string().optional(), status: z.enum(['OPEN', 'ACCEPTED', 'IGNORED', 'DONE']).optional() });
const insightStatusSchema = z.object({ status: z.enum(['OPEN', 'APPLIED', 'DISMISSED']) });
const reviewSchema = z.object({ comment: z.string().trim().max(2000).optional() }).optional();
const uploadSchema = z.object({ inline: z.boolean().optional() }).optional();
const assetKindSchema = z.enum(['video', 'thumbnail']);

@ApiTags('youtube')
@Controller('workspaces/:workspaceId/youtube')
@UseGuards(AuthGuard, TenantGuard)
export class YoutubeController {
  constructor(@Inject(YtChannelsService) private readonly channels: YtChannelsService, @Inject(YtVideosService) private readonly videos: YtVideosService, @Inject(YtCommentsService) private readonly comments: YtCommentsService, @Inject(YtContentLabService) private readonly lab: YtContentLabService, @Inject(YtReportsService) private readonly reports: YtReportsService, @Inject(YtPlaylistsService) private readonly playlists: YtPlaylistsService, @Inject(ShareService) private readonly share: ShareService) {}

  // ---------- health / connections (YT-1) ----------
  @Get('health') @RequirePermission('youtube.read')
  health(@Tenant() t: TenantContext) { return this.channels.health(t.workspaceId); }
  @Get('overview') @RequirePermission('youtube.read')
  overview(@Tenant() t: TenantContext) { return this.channels.overview(t.workspaceId); }
  @Get('quota') @RequirePermission('youtube.read')
  quota(@Tenant() t: TenantContext) { return this.channels.quotaUsage(t.workspaceId); }
  @Get('connections') @RequirePermission('youtube.read')
  connections(@Tenant() t: TenantContext) { return this.channels.listConnections(t.workspaceId); }
  @Post('connections/oauth/start') @HttpCode(200) @RequirePermission('youtube.connect')
  oauthStart(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(featuresSchema)) b: z.infer<typeof featuresSchema>) { return this.channels.oauthStart(t.workspaceId, u.id, (b.features?.split(',').map(s => s.trim()).filter(Boolean) ?? []) as ScopeFeature[]); }
  @Post('connections/token') @HttpCode(200) @RequirePermission('youtube.connect')
  paste(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(d.pasteTokenSchema)) b: z.infer<typeof d.pasteTokenSchema>, @RequestId() rid: string) { return this.channels.pasteRefreshToken(t.workspaceId, u.id, b.refreshToken, rid); }
  @Get('connections/:id/channel') @RequirePermission('youtube.connect')
  discover(@Tenant() t: TenantContext, @Param('id') id: string, @RequestId() rid: string) { return this.channels.discoverChannel(t.workspaceId, id, rid); }
  @Delete('connections/:id') @RequirePermission('youtube.connect')
  revoke(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.channels.revoke(t.workspaceId, u.id, id, rid); }

  // ---------- channels ----------
  @Get('channels') @RequirePermission('youtube.read')
  listChannels(@Tenant() t: TenantContext) { return this.channels.list(t.workspaceId); }
  @Post('channels') @RequirePermission('youtube.connect')
  connect(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(d.connectChannelSchema)) dto: d.ConnectChannelDto, @RequestId() rid: string) { return this.channels.connect(t.workspaceId, u.id, dto, rid); }
  @Get('channels/:id') @RequirePermission('youtube.read')
  getChannel(@Tenant() t: TenantContext, @Param('id') id: string) { return this.channels.get(t.workspaceId, id); }
  @Patch('channels/:id') @RequirePermission('youtube.settings.manage')
  updateChannel(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.updateChannelSchema)) dto: d.UpdateChannelDto, @RequestId() rid: string) { return this.channels.update(t.workspaceId, u.id, id, dto, rid); }
  @Delete('channels/:id') @RequirePermission('youtube.connect')
  disconnect(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.channels.disconnect(t.workspaceId, u.id, id, rid); }
  @Post('channels/:id/sync') @HttpCode(200) @RequirePermission('youtube.read')
  sync(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.syncSchema)) dto: d.SyncDto, @RequestId() rid: string) { return this.channels.runSync(t.workspaceId, u.id, id, dto, rid); }
  @Get('channels/:id/trends') @RequirePermission('youtube.analytics.read')
  trends(@Tenant() t: TenantContext, @Param('id') id: string, @Query('weeks') weeks?: string) { return this.videos.trends(t.workspaceId, id, Number(weeks) || 12); }
  @Get('channels/:id/baselines') @RequirePermission('youtube.analytics.read')
  async baselines(@Tenant() t: TenantContext, @Param('id') id: string, @Query('type') type?: string) { await this.channels.get(t.workspaceId, id); return this.videos.baselines(id, type || undefined); }
  @Post('channels/:id/analyze') @HttpCode(200) @RequirePermission('youtube.analytics.read', 'ai.use')
  analyze(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.analyzeSchema)) dto: z.infer<typeof d.analyzeSchema>, @RequestId() rid: string) { return this.videos.analyzeChannel(t.workspaceId, u.id, id, dto?.days ?? 90, rid); }
  @Get('channels/:id/analyses') @RequirePermission('youtube.analytics.read')
  analyses(@Tenant() t: TenantContext, @Param('id') id: string) { return this.videos.latestAnalyses(t.workspaceId, id); }
  @Post('channels/:id/revival') @HttpCode(200) @RequirePermission('youtube.analytics.read')
  revival(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.videos.findRevivalCandidates(t.workspaceId, u.id, id, rid); }

  // ---------- videos (YT-2, YT-3) ----------
  @Get('videos') @RequirePermission('youtube.read')
  listVideos(@Tenant() t: TenantContext, @Query(new ZodPipe(d.listVideosSchema)) q: d.ListVideosDto) { return this.videos.list(t.workspaceId, q); }
  @Get('videos/:id') @RequirePermission('youtube.read')
  getVideo(@Tenant() t: TenantContext, @Param('id') id: string) { return this.videos.get(t.workspaceId, id); }
  @Patch('videos/:id/metadata') @RequirePermission('youtube.metadata.edit')
  updateMeta(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.updateVideoMetaSchema)) dto: d.UpdateVideoMetaDto, @RequestId() rid: string) { return this.videos.updateMetadata(t.workspaceId, u.id, id, dto, rid); }
  @Patch('videos/:id/pillar') @RequirePermission('youtube.content.edit')
  setPillar(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.setPillarSchema)) b: z.infer<typeof d.setPillarSchema>, @RequestId() rid: string) { return this.videos.setPillar(t.workspaceId, u.id, id, b.contentPillar, rid); }
  @Get('recommendations') @RequirePermission('youtube.read')
  recs(@Tenant() t: TenantContext, @Query(new ZodPipe(recsSchema)) q: z.infer<typeof recsSchema>) { return this.videos.listRecommendations(t.workspaceId, q.channelId, q.status ?? 'OPEN'); }
  @Patch('recommendations/:id') @RequirePermission('youtube.content.edit')
  recStatus(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.recStatusSchema)) b: z.infer<typeof d.recStatusSchema>, @RequestId() rid: string) { return this.videos.setRecommendationStatus(t.workspaceId, u.id, id, b.status, b.outcome, rid); }

  // ---------- playlists (§45) ----------
  @Get('channels/:id/playlists') @RequirePermission('youtube.read')
  listPlaylists(@Tenant() t: TenantContext, @Param('id') id: string) { return this.playlists.list(t.workspaceId, id); }
  @Post('channels/:id/playlists/plan') @HttpCode(200) @RequirePermission('youtube.playlists.manage', 'ai.use')
  planPlaylists(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.playlists.plan(t.workspaceId, u.id, id, rid); }
  @Post('recommendations/:id/apply') @HttpCode(200) @RequirePermission('youtube.playlists.manage')
  applyRec(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.playlists.apply(t.workspaceId, u.id, id, rid); }

  // ---------- comments (YT-6) ----------
  @Get('comments') @RequirePermission('youtube.comments.read')
  listComments(@Tenant() t: TenantContext, @Query(new ZodPipe(d.listYtCommentsSchema)) q: d.ListYtCommentsDto) { return this.comments.list(t.workspaceId, q); }
  @Post('channels/:id/comments/sync') @HttpCode(200) @RequirePermission('youtube.comments.read')
  syncComments(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.comments.sync(t.workspaceId, u.id, id, rid); }
  @Post('comments/classify') @HttpCode(200) @RequirePermission('youtube.comments.read', 'ai.use')
  classify(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(d.classifyYtSchema)) dto: d.ClassifyYtDto, @RequestId() rid: string) { return this.comments.classify(t.workspaceId, u.id, dto, rid); }
  @Post('channels/:id/comments/cluster') @HttpCode(200) @RequirePermission('youtube.comments.read', 'ai.use')
  cluster(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.comments.cluster(t.workspaceId, u.id, id, rid); }
  @Get('comments/clusters') @RequirePermission('youtube.comments.read')
  clusters(@Tenant() t: TenantContext, @Query('channelId') channelId?: string) { return this.comments.listClusters(t.workspaceId, channelId || undefined); }
  @Get('comments/insights') @RequirePermission('youtube.comments.read')
  commentInsights(@Tenant() t: TenantContext, @Query(new ZodPipe(d.daysSchema)) q: z.infer<typeof d.daysSchema>) { return this.comments.insights(t.workspaceId, q.channelId, q.days); }
  @Patch('comments/:id') @RequirePermission('youtube.comments.read')
  updateComment(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.updateYtCommentSchema)) dto: d.UpdateYtCommentDto, @RequestId() rid: string) { return this.comments.update(t.workspaceId, u.id, id, dto, rid); }
  @Post('comments/:id/reply') @HttpCode(200) @RequirePermission('youtube.comments.reply')
  reply(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.replyYtSchema)) b: z.infer<typeof d.replyYtSchema>, @RequestId() rid: string) { return this.comments.reply(t.workspaceId, u.id, id, b.message, rid); }
  @Post('comments/clusters/:id/idea') @HttpCode(200) @RequirePermission('youtube.content.create', 'ai.use')
  ideaFromCluster(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.lab.ideaFromCluster(t.workspaceId, u.id, id, rid); }

  // ---------- content lab (YT-4, YT-5) ----------
  @Get('content') @RequirePermission('youtube.read')
  listContent(@Tenant() t: TenantContext, @Query(new ZodPipe(listContentSchema)) q: z.infer<typeof listContentSchema>) { return this.lab.list(t.workspaceId, q); }
  @Get('content/calendar') @RequirePermission('youtube.read')
  calendar(@Tenant() t: TenantContext, @Query(new ZodPipe(calendarSchema)) q: z.infer<typeof calendarSchema>) { return this.lab.calendar(t.workspaceId, new Date(q.from), new Date(q.to), q.platform); }
  @Post('content') @RequirePermission('youtube.content.create')
  createContent(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(d.createYtContentSchema)) dto: d.CreateYtContentDto, @RequestId() rid: string) { return this.lab.create(t.workspaceId, u.id, dto, rid); }
  @Post('channels/:id/ideas') @HttpCode(200) @RequirePermission('youtube.content.create', 'ai.use')
  ideas(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.ideasSchema)) dto: d.IdeasDto, @RequestId() rid: string) { return this.lab.ideas(t.workspaceId, u.id, id, dto, rid); }
  @Get('content/:id') @RequirePermission('youtube.read')
  getContent(@Tenant() t: TenantContext, @Param('id') id: string) { return this.lab.get(t.workspaceId, id); }
  @Patch('content/:id') @RequirePermission('youtube.content.edit')
  updateContent(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.updateYtContentSchema)) dto: d.UpdateYtContentDto, @RequestId() rid: string) { return this.lab.update(t.workspaceId, u.id, id, dto, rid); }
  @Post('content/:id/status') @HttpCode(200) @RequirePermission('youtube.content.edit')
  setStatus(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.ytTransitionSchema)) b: z.infer<typeof d.ytTransitionSchema>, @RequestId() rid: string) { return this.lab.setStatus(t.workspaceId, u.id, id, b.to, rid); }
  @Post('content/:id/script') @HttpCode(200) @RequirePermission('youtube.content.edit', 'ai.use')
  script(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.scriptSchema)) dto: d.ScriptDto, @RequestId() rid: string) { return this.lab.script(t.workspaceId, u.id, id, dto, rid); }
  @Post('content/:id/titles') @HttpCode(200) @RequirePermission('youtube.content.edit', 'ai.use')
  titles(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.titlesSchema)) b: z.infer<typeof d.titlesSchema>, @RequestId() rid: string) { return this.lab.titles(t.workspaceId, u.id, id, b?.count ?? 5, rid); }
  @Post('content/:id/thumbnail-brief') @HttpCode(200) @RequirePermission('youtube.content.edit', 'ai.use')
  thumbnailBrief(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.lab.thumbnailBrief(t.workspaceId, u.id, id, rid); }
  @Post('content/:id/metadata') @HttpCode(200) @RequirePermission('youtube.content.edit', 'ai.use')
  metadata(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.lab.metadata(t.workspaceId, u.id, id, rid); }
  /** รับไฟล์เป็น raw stream: header x-file-name + content-type (video/* หรือ image/jpeg|png|webp) */
  @Post('content/:id/assets/:kind') @HttpCode(201) @RequirePermission('youtube.content.edit')
  uploadAsset(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Param('kind', new ZodPipe(assetKindSchema)) kind: 'video' | 'thumbnail', @Headers('x-file-name') fileName: string | undefined, @Headers('content-type') contentType: string | undefined, @Req() req: Request, @RequestId() rid: string) {
    return this.lab.storeAsset(t.workspaceId, u.id, id, kind, decodeURIComponent(fileName || `${kind}.bin`), (contentType ?? 'application/octet-stream').split(';')[0]!.trim(), req, rid);
  }
  @Post('content/:id/submit') @HttpCode(200) @RequirePermission('youtube.content.edit')
  submit(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.lab.submit(t.workspaceId, u.id, id, rid); }
  @Post('content/:id/approve') @HttpCode(200) @RequirePermission('youtube.content.approve')
  approve(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewSchema)) b: z.infer<typeof reviewSchema>, @RequestId() rid: string) { return this.lab.approve(t.workspaceId, u.id, id, b?.comment, rid); }
  @Post('content/:id/reject') @HttpCode(200) @RequirePermission('youtube.content.approve')
  reject(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewSchema)) b: z.infer<typeof reviewSchema>, @RequestId() rid: string) { return this.lab.reject(t.workspaceId, u.id, id, b?.comment, rid); }
  @Post('content/:id/request-changes') @HttpCode(200) @RequirePermission('youtube.content.approve')
  requestChanges(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewSchema)) b: z.infer<typeof reviewSchema>, @RequestId() rid: string) { return this.lab.requestChanges(t.workspaceId, u.id, id, b?.comment, rid); }
  @Post('content/:id/upload') @HttpCode(200) @RequirePermission('youtube.upload')
  upload(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(uploadSchema)) b: z.infer<typeof uploadSchema>, @RequestId() rid: string) { return this.lab.requestUpload(t.workspaceId, u.id, id, rid, !!b?.inline); }
  @Post('content/:id/check-processing') @HttpCode(200) @RequirePermission('youtube.read')
  checkProcessing(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.lab.checkProcessing(t.workspaceId, u.id, id, rid); }
  @Post('content/:id/repurpose') @HttpCode(200) @RequirePermission('youtube.read', 'content.create', 'ai.use')
  repurpose(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.repurposeSchema)) dto: d.RepurposeDto, @RequestId() rid: string) { return this.lab.repurposeToFacebook(t.workspaceId, u.id, id, dto, rid); }

  // ---------- cross-platform insights (YT-7) ----------
  @Get('insights') @RequirePermission('youtube.read')
  insights(@Tenant() t: TenantContext, @Query('brandId') brandId?: string) { return this.lab.listInsights(t.workspaceId, brandId || undefined); }
  @Patch('insights/:id') @RequirePermission('youtube.content.edit')
  setInsight(@Tenant() t: TenantContext, @Param('id') id: string, @Body(new ZodPipe(insightStatusSchema)) b: z.infer<typeof insightStatusSchema>) { return this.lab.setInsightStatus(t.workspaceId, id, b.status); }

  // ---------- reports (YT-7) ----------
  @Post('channels/:id/reports') @HttpCode(200) @RequirePermission('youtube.analytics.read')
  generateReport(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(d.reportSchema)) dto: z.infer<typeof d.reportSchema>, @RequestId() rid: string) { return this.reports.generate(t.workspaceId, u.id, id, dto, rid); }
  @Get('reports') @RequirePermission('youtube.analytics.read')
  listReports(@Tenant() t: TenantContext, @Query('channelId') channelId?: string) { return this.reports.list(t.workspaceId, channelId || undefined); }
  @Get('reports/:id') @RequirePermission('youtube.analytics.read')
  getReport(@Tenant() t: TenantContext, @Param('id') id: string) { return this.reports.get(t.workspaceId, id); }
  @Get('reports/:id/pdf') @RequirePermission('youtube.analytics.read')
  async reportPdf(@Tenant() t: TenantContext, @Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.share.pdf('youtube', id, t.workspaceId);
    res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(fileName)}"`); res.end(buffer);
  }
  @Post('reports/:id/share') @HttpCode(200) @RequirePermission('youtube.analytics.read')
  shareReport(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(shareSchema)) b: z.infer<typeof shareSchema>, @RequestId() rid: string) { return this.share.createLink(t.workspaceId, u.id, 'youtube', id, b?.days ?? 30, rid); }
}

/** callback ของ Google OAuth — เส้นทางสาธารณะ ตัวตนยืนยันด้วย state ที่เซ็นไว้ */
@ApiTags('youtube')
@Controller('youtube/oauth')
export class GoogleOAuthCallbackController {
  constructor(@Inject(YtChannelsService) private readonly channels: YtChannelsService) {}
  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    const { redirectTo } = await this.channels.oauthCallback(code, state, error);
    res.redirect(302, redirectTo);
  }
}
