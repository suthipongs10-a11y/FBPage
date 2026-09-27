/**
 * URL รับไฟล์สาธารณะ — ให้เครื่องมือภายนอก (ChatGPT GPT Actions, n8n/Make, สคริปต์) ส่งแพ็กเกจ fbpm-content-v1 เข้ากล่องของแบรนด์
 * ยืนยันตัวด้วย `Authorization: Bearer fbin_…` (คีย์ต่อแบรนด์ เก็บเป็น hash) · จำกัดอัตรา · ได้แค่ร่างรออนุมัติ ไม่มีทางโพสต์เอง
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequestId } from '../common/request-context';
import { ENV, type Env } from '../config/env';
import { ContentImportService } from './import.service';
import { readRaw } from './news.controller';
import { PACKAGE_FORMAT } from './import-format';

@ApiTags('inbox')
@Controller('inbox')
export class InboxController {
  constructor(@Inject(ContentImportService) private readonly imports: ContentImportService, @Inject(ENV) private readonly env: Env) {}

  @Post('content') @HttpCode(200)
  async receive(@Headers('authorization') auth: string | undefined, @Body() body: unknown, @Req() req: Request, @RequestId() rid: string) {
    const key = auth?.replace(/^Bearer\s+/i, '').trim();
    // JSON ถูก parse แล้ว · text/plain (ข้อความจากแชตที่มี ```json) อ่านดิบเอง
    const payload = body && typeof body === 'object' && Object.keys(body).length ? body : (await readRaw(req, 2 * 1024 * 1024)).toString('utf8');
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const r = await this.imports.receive(key, payload, ip, rid);
    if (!r) throw new UnauthorizedException('คีย์ไม่ถูกต้องหรือถูกยกเลิกแล้ว');
    return r;
  }

  /** สเปก OpenAPI สำหรับ ChatGPT (Custom GPT → Actions → Import from URL) */
  @Get('openapi.json')
  openapi() {
    const server = `${this.env.APP_URL.replace(/\/+$/, '')}/api`;
    return {
      openapi: '3.1.0',
      info: { title: 'Content inbox', version: '1.0.0', description: `ส่งโพสต์ที่ค้นและเรียบเรียงแล้วเข้ากล่องรออนุมัติ (${PACKAGE_FORMAT}) — ระบบตรวจแล้วสร้างร่าง ไม่โพสต์เอง` },
      servers: [{ url: server }],
      paths: { '/inbox/content': { post: {
        operationId: 'sendPosts', summary: 'ส่งแพ็กเกจโพสต์เข้ากล่องรออนุมัติ',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Package' } } } },
        responses: { '200': { description: 'ผลตรวจรายโพสต์ (PASS/WARN/FAIL) และร่างที่สร้าง' }, '401': { description: 'คีย์ไม่ถูกต้อง' } },
      } } },
      components: {
        securitySchemes: { inboxKey: { type: 'http', scheme: 'bearer' } },
        schemas: { Package: { type: 'object', required: ['posts'], properties: {
          format: { type: 'string', enum: [PACKAGE_FORMAT] },
          posts: { type: 'array', maxItems: 20, items: { type: 'object', required: ['caption'], properties: {
            type: { type: 'string', enum: ['news', 'original'] }, page: { type: 'string' }, title: { type: 'string' }, caption: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
            sources: { type: 'array', items: { type: 'object', required: ['url'], properties: { name: { type: 'string' }, url: { type: 'string' } } } },
            card: { type: 'object', required: ['headline'], properties: { kicker: { type: 'string' }, headline: { type: 'string' }, sub: { type: 'string' } } },
            images: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, credit: { type: 'string' } } } },
            photoQuery: { type: 'string' }, imagePrompt: { type: 'string' }, category: { type: 'string' }, scheduleAt: { type: 'string' },
            risk: { type: 'string', enum: ['LOW', 'HIGH'] }, riskReasons: { type: 'array', items: { type: 'string' } }, needsCheck: { type: 'array', items: { type: 'string' } },
          } } },
        } } },
      },
      security: [{ inboxKey: [] }],
    };
  }
}
