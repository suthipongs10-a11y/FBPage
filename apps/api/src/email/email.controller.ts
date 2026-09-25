/** W-4 routes — ใต้ workspaces/:workspaceId/email + เส้นทางสาธารณะ /email/u/:token (ยกเลิกรับ) และ /email/webhooks/:provider/:workspaceId */
import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { reviewCommentSchema, type ReviewCommentDto } from '../content/dto';
import { EmailService } from './email.service';
import { createCampaignSchema, createListSchema, generateCampaignSchema, importSubscribersSchema, listCampaignsSchema, listSubscribersSchema, providerConfigSchema, providerPauseSchema, scheduleCampaignSchema, subscriberStatusSchema, testSendSchema, updateCampaignSchema, updateListSchema, type CreateCampaignDto, type CreateListDto, type GenerateCampaignDto, type ImportSubscribersDto, type ListCampaignsDto, type ProviderConfigDto, type ScheduleCampaignDto, type UpdateCampaignDto, type UpdateListDto } from './dto';

@ApiTags('email')
@Controller('workspaces/:workspaceId/email')
@UseGuards(AuthGuard, TenantGuard)
export class EmailController {
  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  @Get('summary') @RequirePermission('email.read')
  summary(@Tenant() t: TenantContext) { return this.email.summary(t.workspaceId); }
  // ---- provider ----
  @Get('provider') @RequirePermission('email.read')
  provider(@Tenant() t: TenantContext) { return this.email.getProvider(t.workspaceId); }
  @Put('provider') @RequirePermission('email.manage')
  setProvider(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(providerConfigSchema)) dto: ProviderConfigDto, @RequestId() rid: string) { return this.email.setProvider(t.workspaceId, u.id, dto, rid); }
  @Post('provider/verify') @HttpCode(200) @RequirePermission('email.manage')
  verifyProvider(@Tenant() t: TenantContext) { return this.email.verifyProvider(t.workspaceId); }
  @Patch('provider/pause') @RequirePermission('email.manage')
  pause(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(providerPauseSchema)) b: z.infer<typeof providerPauseSchema>, @RequestId() rid: string) { return this.email.setProviderPaused(t.workspaceId, u.id, b.sendingPaused, rid); }
  @Delete('provider') @RequirePermission('email.manage')
  removeProvider(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @RequestId() rid: string) { return this.email.removeProvider(t.workspaceId, u.id, rid); }
  // ---- lists ----
  @Get('lists') @RequirePermission('email.read')
  lists(@Tenant() t: TenantContext) { return this.email.lists(t.workspaceId); }
  @Post('lists') @RequirePermission('email.manage')
  createList(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createListSchema)) dto: CreateListDto, @RequestId() rid: string) { return this.email.createList(t.workspaceId, u.id, dto, rid); }
  @Get('lists/:id') @RequirePermission('email.read')
  getList(@Tenant() t: TenantContext, @Param('id') id: string) { return this.email.getList(t.workspaceId, id); }
  @Patch('lists/:id') @RequirePermission('email.manage')
  updateList(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateListSchema)) dto: UpdateListDto, @RequestId() rid: string) { return this.email.updateList(t.workspaceId, u.id, id, dto, rid); }
  @Post('lists/:id/subscribers/import') @HttpCode(200) @RequirePermission('email.manage')
  importSubs(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(importSubscribersSchema)) dto: ImportSubscribersDto, @RequestId() rid: string) { return this.email.importSubscribers(t.workspaceId, u.id, id, dto, rid); }
  @Get('lists/:id/subscribers') @RequirePermission('email.read')
  subscribers(@Tenant() t: TenantContext, @Param('id') id: string, @Query(new ZodPipe(listSubscribersSchema)) q: z.infer<typeof listSubscribersSchema>) { return this.email.subscribers(t.workspaceId, id, q); }
  @Patch('lists/:id/subscribers/:sid') @RequirePermission('email.manage')
  subStatus(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Param('sid') sid: string, @Body(new ZodPipe(subscriberStatusSchema)) b: z.infer<typeof subscriberStatusSchema>, @RequestId() rid: string) { return this.email.setSubscriberStatus(t.workspaceId, u.id, id, sid, b.status, rid); }
  // ---- campaigns ----
  @Get('campaigns') @RequirePermission('email.read')
  campaigns(@Tenant() t: TenantContext, @Query(new ZodPipe(listCampaignsSchema)) q: ListCampaignsDto) { return this.email.campaigns(t.workspaceId, q); }
  @Post('campaigns') @RequirePermission('email.manage')
  createCampaign(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createCampaignSchema)) dto: CreateCampaignDto, @RequestId() rid: string) { return this.email.create(t.workspaceId, u.id, dto, rid); }
  @Get('campaigns/:id') @RequirePermission('email.read')
  getCampaign(@Tenant() t: TenantContext, @Param('id') id: string) { return this.email.get(t.workspaceId, id); }
  @Get('campaigns/:id/stats') @RequirePermission('email.read')
  stats(@Tenant() t: TenantContext, @Param('id') id: string) { return this.email.stats(t.workspaceId, id); }
  @Get('campaigns/:id/job') @RequirePermission('email.read')
  job(@Tenant() t: TenantContext, @Param('id') id: string) { return this.email.jobState(t.workspaceId, id); }
  @Patch('campaigns/:id') @RequirePermission('email.manage')
  updateCampaign(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateCampaignSchema)) dto: UpdateCampaignDto, @RequestId() rid: string) { return this.email.update(t.workspaceId, u.id, id, dto, rid); }
  @Post('campaigns/:id/generate') @HttpCode(200) @RequirePermission('email.manage', 'ai.use')
  generate(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(generateCampaignSchema)) dto: GenerateCampaignDto, @RequestId() rid: string) { return this.email.generate(t.workspaceId, u.id, id, dto, rid); }
  @Post('campaigns/:id/submit') @HttpCode(200) @RequirePermission('email.manage')
  submit(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.email.submit(t.workspaceId, u.id, id, rid); }
  @Post('campaigns/:id/approve') @HttpCode(200) @RequirePermission('email.approve')
  approve(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.email.approve(t.workspaceId, u.id, id, dto.comment, rid); }
  @Post('campaigns/:id/reject') @HttpCode(200) @RequirePermission('email.approve')
  reject(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.email.reject(t.workspaceId, u.id, id, dto.comment, rid); }
  @Post('campaigns/:id/request-changes') @HttpCode(200) @RequirePermission('email.approve')
  requestChanges(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewCommentSchema)) dto: ReviewCommentDto, @RequestId() rid: string) { return this.email.requestChanges(t.workspaceId, u.id, id, dto.comment, rid); }
  @Post('campaigns/:id/reopen') @HttpCode(200) @RequirePermission('email.manage')
  reopen(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.email.reopen(t.workspaceId, u.id, id, rid); }
  @Delete('campaigns/:id') @RequirePermission('email.manage')
  cancel(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.email.cancel(t.workspaceId, u.id, id, rid); }
  @Post('campaigns/:id/test-send') @HttpCode(200) @RequirePermission('email.manage')
  testSend(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(testSendSchema)) b: z.infer<typeof testSendSchema>, @RequestId() rid: string) { return this.email.testSend(t.workspaceId, u.id, id, b.to, rid); }
  @Post('campaigns/:id/schedule') @HttpCode(200) @RequirePermission('email.send')
  schedule(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(scheduleCampaignSchema)) dto: ScheduleCampaignDto, @RequestId() rid: string) { return this.email.schedule(t.workspaceId, u.id, id, dto, rid); }
  @Post('campaigns/:id/send') @HttpCode(200) @RequirePermission('email.send')
  send(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @RequestId() rid: string) { return this.email.sendNow(t.workspaceId, u.id, id, rid); }
}

const page = (title: string, body: string) => `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body style="margin:0;padding:40px 16px;background:#f5f7fb;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Thai',sans-serif;color:#1f2a3c"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;line-height:1.7;text-align:center"><h1 style="font-size:20px;margin:0 0 12px">${title}</h1><p style="margin:0;color:#475569">${body}</p></div></body></html>`;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** เส้นทางสาธารณะ (ไม่มี session): ยกเลิกรับอีเมล (GET/POST ตาม RFC 8058 one-click) และ webhook ผู้ให้บริการ */
@ApiTags('email-public')
@Controller('email')
export class EmailPublicController {
  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  @Get('u/:token') @Header('content-type', 'text/html; charset=utf-8') @Header('cache-control', 'no-store')
  async unsubscribeGet(@Param('token') token: string) { return this.render(token); }
  @Post('u/:token') @HttpCode(200) @Header('content-type', 'text/html; charset=utf-8') @Header('cache-control', 'no-store')
  async unsubscribePost(@Param('token') token: string) { return this.render(token); }
  private async render(token: string) {
    const r = await this.email.unsubscribeByToken(token);
    if (!r.ok) return page('ไม่พบลิงก์นี้', 'ลิงก์ยกเลิกรับอีเมลไม่ถูกต้องหรือถูกใช้กับรายชื่อที่ถูกลบแล้ว');
    return page(r.already ? 'คุณยกเลิกรับอีเมลไว้แล้ว' : 'ยกเลิกรับอีเมลเรียบร้อย', `${esc(r.email ?? '')} จะไม่ได้รับอีเมลข่าวสารจาก ${esc(r.brand ?? '')} อีก`);
  }

  /** Brevo: ตั้ง URL เป็น …/webhooks/brevo/<workspaceId>?token=<secret> · Resend: ตั้ง URL …/webhooks/resend/<workspaceId> แล้วใส่ signing secret (whsec_…) ในหน้าตั้งค่า */
  @Post('webhooks/:provider/:workspaceId') @HttpCode(200)
  webhook(@Param('provider') provider: string, @Param('workspaceId') workspaceId: string, @Query('token') token: string | undefined, @Req() req: Request & { rawBody?: Buffer }) {
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, ...(token && { 'x-webhook-token': token }) };
    return this.email.handleWebhook(provider, workspaceId, headers, req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {}));
  }
}
