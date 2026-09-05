/** ลิงก์แชร์รายงานสำหรับลูกค้า — สาธารณะ อ่านอย่างเดียว ยืนยันด้วย token ที่เซ็น (ไม่มี session) */
import { Controller, Get, Inject, Param, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthRateLimitGuard } from '../common/rate-limit.guard';
import { ShareService } from './share.service';

@ApiTags('reports')
@Controller('share/reports')
@UseGuards(AuthRateLimitGuard)
export class ShareController {
  constructor(@Inject(ShareService) private readonly share: ShareService) {}
  @Get(':token')
  get(@Param('token') token: string) { return this.share.resolve(token); }
  @Get(':token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Response) {
    const { buffer, fileName } = await this.share.pdfByToken(token);
    res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(fileName)}"`); res.end(buffer);
  }
}
