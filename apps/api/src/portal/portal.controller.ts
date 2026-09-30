import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { LEAD_STATUSES } from '@fbpm/shared';
import { ZodPipe } from '../common/zod.pipe';
import { parseCookies, serializeCookie } from '../common/cookies';
import { AuthRateLimitGuard } from '../common/rate-limit.guard';
import { CurrentUser, RequestId, Tenant, type AppRequest, type AuthUser, type TenantContext } from '../common/request-context';
import { ENV, type Env } from '../config/env';
import { AuthGuard, SESSION_COOKIE } from '../auth/auth.guard';
import { AuthService, SESSION_TTL_SEC } from '../auth/auth.service';
import { acceptInviteSchema, type AcceptInviteDto } from '../auth/dto';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { lineRecipientSchema } from '../line/line.controller';
import { PortalService } from './portal.service';

export const portalInviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200).optional(), canReply: z.boolean().default(true), canApprove: z.boolean().default(true) });
export const portalMemberSchema = z.object({ canReply: z.boolean().optional(), canApprove: z.boolean().optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
const commentsQuery = z.object({ view: z.enum(['pending', 'all']).optional(), pageId: z.string().max(40).optional() });
const replySchema = z.object({ message: z.string().trim().min(1).max(2000) });
const resolveSchema = z.object({ resolved: z.boolean() });
const sendSchema = z.object({ text: z.string().trim().min(1).max(1800), messageId: z.string().min(1).optional(), resumeAi: z.boolean().optional() }).strict();
const leadSchema = z.object({ status: z.enum(LEAD_STATUSES).optional(), notes: z.string().trim().max(2000).optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
const decisionSchema = z.object({ comment: z.string().trim().max(1000).optional() });
const changesSchema = z.object({ comment: z.string().trim().min(1, 'บอกทีมงานว่าอยากให้แก้อะไร').max(1000) });

/** ทีมงาน: เชิญเจ้าของธุรกิจเข้าพอร์ทัล / ปรับสิทธิ์ / ถอดสิทธิ์ */
@ApiTags('portal')
@Controller('workspaces/:workspaceId/clients/:clientId/portal')
@UseGuards(AuthGuard, TenantGuard)
export class PortalTeamController {
  constructor(@Inject(PortalService) private readonly svc: PortalService) {}
  @Get() @RequirePermission('client.read') get(@Tenant() t: TenantContext, @Param('clientId') c: string) { return this.svc.teamOverview(t.workspaceId, c); }
  @Post('invites') @RequirePermission('client.manage') invite(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('clientId') c: string, @Body(new ZodPipe(portalInviteSchema)) b: z.infer<typeof portalInviteSchema>, @RequestId() rid: string) { return this.svc.createInvite(t.workspaceId, u.id, c, b, rid); }
  @Delete('invites/:id') @RequirePermission('client.manage') revoke(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @RequestId() rid: string) { return this.svc.revokeInvite(t.workspaceId, u.id, c, id, rid); }
  @Patch('members/:id') @RequirePermission('client.manage') update(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @Body(new ZodPipe(portalMemberSchema)) b: z.infer<typeof portalMemberSchema>, @RequestId() rid: string) { return this.svc.updateMember(t.workspaceId, u.id, c, id, b, rid); }
  @Delete('members/:id') @RequirePermission('client.manage') remove(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @RequestId() rid: string) { return this.svc.removeMember(t.workspaceId, u.id, c, id, rid); }
}

/** คำเชิญพอร์ทัล (สาธารณะ — ตัวตนอยู่ใน token ของลิงก์) */
@ApiTags('portal')
@Controller('portal/invites')
@UseGuards(AuthRateLimitGuard)
export class PortalInviteController {
  constructor(@Inject(PortalService) private readonly svc: PortalService, @Inject(AuthService) private readonly auth: AuthService, @Inject(ENV) private readonly env: Env) {}
  @Get(':token') inspect(@Param('token') token: string) { return this.svc.inspectInvite(token); }
  @Post(':token/accept') @HttpCode(200)
  async accept(@Param('token') token: string, @Body(new ZodPipe(acceptInviteSchema)) dto: AcceptInviteDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const current = cookie ? await this.auth.resolveSession(cookie) : null;
    const meta = { ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined, userAgent: req.headers['user-agent'], requestId: req.requestId };
    const r = await this.svc.acceptInvite(token, current?.user.id ?? null, dto, meta);
    if (r.token) res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, r.token, { maxAgeSec: SESSION_TTL_SEC, secure: this.env.APP_ENV === 'production', sameSite: 'Lax' }));
    return { clientId: r.clientId, clientName: r.clientName };
  }
}

/** เจ้าของธุรกิจ: ดู/ตอบคอมเมนต์ แชท ลีด อนุมัติโพสต์ รายงาน และผูก LINE — เฉพาะลูกค้าของตัวเอง */
@ApiTags('portal')
@Controller('portal/clients/:clientId')
@UseGuards(AuthGuard)
export class PortalController {
  constructor(@Inject(PortalService) private readonly svc: PortalService) {}
  private a(u: AuthUser, c: string) { return this.svc.access(u.id, c); }
  @Get() async overview(@CurrentUser() u: AuthUser, @Param('clientId') c: string) { return this.svc.overview(await this.a(u, c)); }

  @Get('comments') async comments(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Query(new ZodPipe(commentsQuery)) q: z.infer<typeof commentsQuery>) { return this.svc.listComments(await this.a(u, c), q); }
  @Post('comments/:id/reply') @HttpCode(200) async reply(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>, @RequestId() rid: string) { return this.svc.replyComment(await this.a(u, c), u.id, id, b.message, rid); }
  @Post('comments/:id/resolve') @HttpCode(200) async resolve(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @Body(new ZodPipe(resolveSchema)) b: z.infer<typeof resolveSchema>, @RequestId() rid: string) { return this.svc.resolveComment(await this.a(u, c), u.id, id, b.resolved, rid); }

  @Get('conversations') async conversations(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Query('pageId') pageId?: string) { return this.svc.conversations(await this.a(u, c), pageId); }
  @Get('conversations/:id') async conversation(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string) { return this.svc.conversation(await this.a(u, c), id); }
  @Post('conversations/:id/send') @HttpCode(200) async send(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @Body(new ZodPipe(sendSchema)) b: z.infer<typeof sendSchema>, @RequestId() rid: string) { return this.svc.sendMessage(await this.a(u, c), u.id, id, b, rid); }

  @Get('leads') async leads(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Query('status') status?: string) { return this.svc.leads(await this.a(u, c), (LEAD_STATUSES as readonly string[]).includes(status ?? '') ? status : undefined); }
  @Patch('leads/:id') async lead(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @Body(new ZodPipe(leadSchema)) b: z.infer<typeof leadSchema>, @RequestId() rid: string) { return this.svc.updateLead(await this.a(u, c), u.id, id, b, rid); }

  @Get('approvals') async approvals(@CurrentUser() u: AuthUser, @Param('clientId') c: string) { return this.svc.approvals(await this.a(u, c)); }
  @Post('approvals/:id/approve') @HttpCode(200) async approve(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @Body(new ZodPipe(decisionSchema)) b: z.infer<typeof decisionSchema>, @RequestId() rid: string) { return this.svc.decide(await this.a(u, c), u.id, id, 'approve', b?.comment, rid); }
  @Post('approvals/:id/request-changes') @HttpCode(200) async changes(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @Body(new ZodPipe(changesSchema)) b: z.infer<typeof changesSchema>, @RequestId() rid: string) { return this.svc.decide(await this.a(u, c), u.id, id, 'changes', b.comment, rid); }
  @Get('media/:assetId') async media(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('assetId') id: string, @Res() res: Response) {
    const f = await this.svc.mediaFile(await this.a(u, c), id);
    res.setHeader('cache-control', 'private, max-age=3600'); res.sendFile(f.path, { headers: { 'content-type': f.mimeType } });
  }

  @Get('reports') async reports(@CurrentUser() u: AuthUser, @Param('clientId') c: string) { return this.svc.reports(await this.a(u, c)); }
  @Post('reports/:id/link') @HttpCode(200) async reportLink(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @RequestId() rid: string) { return this.svc.reportLink(await this.a(u, c), u.id, id, rid); }

  @Get('line') async line(@CurrentUser() u: AuthUser, @Param('clientId') c: string) { return this.svc.lineStatus(await this.a(u, c), u.id); }
  @Post('line/link-code') @HttpCode(200) async lineCode(@CurrentUser() u: AuthUser, @Param('clientId') c: string) { return this.svc.lineLinkCode(await this.a(u, c), u.id); }
  @Patch('line/recipients/:id') async lineUpdate(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string, @Body(new ZodPipe(lineRecipientSchema)) b: z.infer<typeof lineRecipientSchema>) { return this.svc.lineUpdate(await this.a(u, c), u.id, id, b); }
  @Delete('line/recipients/:id') async lineRemove(@CurrentUser() u: AuthUser, @Param('clientId') c: string, @Param('id') id: string) { return this.svc.lineRemove(await this.a(u, c), u.id, id); }
}
