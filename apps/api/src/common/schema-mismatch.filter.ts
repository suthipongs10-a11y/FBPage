import { ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/** P2021 = ตารางไม่มี, P2022 = คอลัมน์ไม่มี — โค้ดใหม่กว่าฐานข้อมูล (อัปเดตแล้วลืม migrate) */
export const isSchemaMismatch = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return (e as Error | null)?.name === 'PrismaClientKnownRequestError' && (code === 'P2021' || code === 'P2022');
};

export const SCHEMA_MISMATCH_MESSAGE = 'ฐานข้อมูลยังไม่ได้อัปเดตตามโค้ดเวอร์ชันนี้ — ผู้ดูแลระบบต้องรัน migrate (deploy/update.sh หรือ docker compose --profile maintenance run --rm migrate)';

/** แทน "Internal server error" ที่ไม่บอกอะไรด้วยข้อความที่บอกวิธีแก้ — ข้อผิดพลาดอื่นส่งต่อให้ตัวจัดการเดิมของ Nest */
@Catch()
export class SchemaMismatchFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('database');
  override catch(e: unknown, host: ArgumentsHost): void {
    if (!isSchemaMismatch(e) || host.getType() !== 'http') { super.catch(e, host); return; }
    this.logger.error(`${(e as Error).message.split('\n').pop()?.trim() ?? 'schema mismatch'} → run migrate`);
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'DB_MIGRATION_PENDING', message: SCHEMA_MISMATCH_MESSAGE });
  }
}
