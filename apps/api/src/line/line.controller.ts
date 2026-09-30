import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, RequestId, Tenant, type AuthUser, type TenantContext } from '../common/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { TenantGuard } from '../workspaces/tenant.guard';
import { RequirePermission } from '../workspaces/permissions';
import { LineService } from './line.service';

export const lineConfigSchema = z.object({ channelSecret: z.string().trim().min(10).max(200), accessToken: z.string().trim().min(20).max(1000) });
export const lineRecipientSchema = z.object({ active: z.boolean().optional(), types: z.array(z.string().max(40)).max(20).optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');

@ApiTags('line')
@Controller('workspaces/:workspaceId/line')
@UseGuards(AuthGuard, TenantGuard)
export class LineController {
  constructor(@Inject(LineService) private readonly svc: LineService) {}
  @Get() @RequirePermission('workspace.manage') status(@Tenant() t: TenantContext) { return this.svc.status(t.workspaceId); }
  @Put() @RequirePermission('workspace.manage') configure(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body(new ZodPipe(lineConfigSchema)) b: z.infer<typeof lineConfigSchema>, @RequestId() rid: string) { return this.svc.configure(t.workspaceId, u.id, b, rid); }
  @Delete() @RequirePermission('workspace.manage') remove(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @RequestId() rid: string) { return this.svc.remove(t.workspaceId, u.id, rid); }
  /** ทีมงานทุกคนผูก LINE ของตัวเองได้ (รับแจ้งเตือนของทุกลูกค้า) */
  @Post('link-code') @HttpCode(200) linkCode(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser) { return this.svc.createLinkCode(t.workspaceId, u.id, null); }
  @Patch('recipients/:id') @RequirePermission('workspace.manage') update(@Tenant() t: TenantContext, @Param('id') id: string, @Body(new ZodPipe(lineRecipientSchema)) b: z.infer<typeof lineRecipientSchema>) { return this.svc.updateRecipient(t.workspaceId, id, b); }
  @Delete('recipients/:id') @RequirePermission('workspace.manage') removeRecipient(@Tenant() t: TenantContext, @Param('id') id: string) { return this.svc.removeRecipient(t.workspaceId, id); }
  @Post('test') @HttpCode(200) @RequirePermission('workspace.manage') test(@Tenant() t: TenantContext) { return this.svc.test(t.workspaceId); }
}

/** LINE ส่ง event มาที่นี่ — ตั้ง Webhook URL ใน LINE Developers console ตามที่หน้าตั้งค่าแสดง
 *  ไม่ใช้ rate limit ของหน้า login (LINE ส่งจาก IP ชุดเดียวกันทุกผู้ใช้) — key สุ่ม 36 ตัว + ลายเซ็น HMAC กันของปลอม */
@ApiTags('line')
@Controller('line/webhook')
export class LineWebhookController {
  constructor(@Inject(LineService) private readonly svc: LineService) {}
  @Post(':key') @HttpCode(200)
  receive(@Param('key') key: string, @Req() req: Request & { rawBody?: Buffer }, @Headers('x-line-signature') sig: string | undefined, @Body() body: { events?: [] }) { return this.svc.webhook(key, req.rawBody, sig, body); }
}
