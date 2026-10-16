import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get, NotFoundException, type INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma } from '@fbpm/database';
import { SchemaMismatchFilter, isSchemaMismatch } from './schema-mismatch.filter';

/** สิ่งที่ Prisma โยนจริงเมื่อโค้ดใหม่เรียกคอลัมน์ที่ฐานข้อมูลยังไม่มี (อัปเดตแล้วลืม migrate) */
const missingColumn = () => new Prisma.PrismaClientKnownRequestError('Invalid `prisma.facebookPage.update()` invocation:\n\nThe column `FacebookPage.servicePlanId` does not exist in the current database.', { code: 'P2022', clientVersion: 'test', meta: { column: 'FacebookPage.servicePlanId' } });

@Controller('t')
class Boom {
  @Get('column') column(): never { throw missingColumn(); }
  @Get('table') table(): never { throw new Prisma.PrismaClientKnownRequestError('The table `public.ServicePlan` does not exist in the current database.', { code: 'P2021', clientVersion: 'test' }); }
  @Get('unique') unique(): never { throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }); }
  @Get('plain') plain(): never { throw new Error('boom'); }
  @Get('http') http(): never { throw new NotFoundException('ไม่พบเพจ'); }
}

describe('SchemaMismatchFilter', () => {
  let app: INestApplication; let base = '';
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [Boom] }).compile();
    app = mod.createNestApplication({ logger: false });
    app.useGlobalFilters(new SchemaMismatchFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => { await app.close(); });
  const get = async (p: string) => { const r = await fetch(`${base}/t/${p}`); return { status: r.status, json: await r.json() as { message: string; code?: string } }; };

  it('turns a missing column/table into a 503 that says to run migrate, not "Internal server error"', async () => {
    for (const p of ['column', 'table']) {
      const r = await get(p);
      expect(r.status).toBe(503);
      expect(r.json.code).toBe('DB_MIGRATION_PENDING');
      expect(r.json.message).toMatch(/migrate/);
      expect(r.json.message).not.toMatch(/servicePlanId|prisma\./);   // ไม่เผยรายละเอียดภายในให้หน้าเว็บ
    }
  });
  it('leaves every other error to Nest exactly as before', async () => {
    expect(await get('plain')).toEqual({ status: 500, json: { statusCode: 500, message: 'Internal server error' } });
    expect((await get('unique')).status).toBe(500);
    expect(await get('http')).toMatchObject({ status: 404, json: { message: 'ไม่พบเพจ' } });
  });
  it('recognises only Prisma schema errors', () => {
    expect(isSchemaMismatch(missingColumn())).toBe(true);
    expect(isSchemaMismatch(Object.assign(new Error('x'), { code: 'P2022' }))).toBe(false);
    expect(isSchemaMismatch(null)).toBe(false);
  });
});
