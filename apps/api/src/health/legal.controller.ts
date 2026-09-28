import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENV, type Env } from '../config/env';

/** ข้อมูลติดต่อสำหรับหน้า Privacy Policy / Data deletion (สาธารณะ ไม่ต้องล็อกอิน) — มีแค่ค่าที่ตั้งใจเปิดเผย */
@ApiTags('public')
@Controller('public')
export class LegalController {
  constructor(@Inject(ENV) private readonly env: Env) {}
  @Get('legal')
  @ApiOperation({ summary: 'Contact details shown on /privacy and /data-deletion' })
  legal() {
    return { contactEmail: this.env.LEGAL_CONTACT_EMAIL ?? null, operatorName: this.env.LEGAL_OPERATOR_NAME ?? null };
  }
}
