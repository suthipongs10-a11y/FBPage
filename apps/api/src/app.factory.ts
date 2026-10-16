import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { Logger, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { loadEnv, type Env } from './config/env';
import { SchemaMismatchFilter } from './common/schema-mismatch.filter';
import { PRISMA } from './database/prisma.service';
import { pendingMigrations } from './health/migrations';

/** สร้าง Nest app พร้อม middleware มาตรฐาน — ใช้ทั้ง main.ts และ integration tests */
export async function createApp(): Promise<{ app: INestApplication; env: Env }> {
  const env = loadEnv(); // ล้มเร็วถ้าค่าตั้งผิด (ก่อนสร้าง Nest app)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: env.APP_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'] });   // rawBody สำหรับตรวจลายเซ็น webhook (§14)
  // แพ็กเกจคอนเทนต์ที่นำเข้า (หลายโพสต์ภาษาไทย) เกินค่าเริ่มต้น 100 KB ได้ — nginx จำกัดทั้งคำขอที่ 10 MB อยู่แล้ว
  app.useBodyParser('json', { limit: '2mb' });

  // ทุก request มี correlation id (AGENTS.md §79) — ใช้ต่อใน audit log และ AI task log
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 100) ?? randomUUID();
    (req as Request & { requestId: string }).requestId = id;
    res.setHeader('x-request-id', id);
    next();
  });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('x-frame-options', 'DENY');
    next();
  });
  app.useGlobalFilters(new SchemaMismatchFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableCors({ origin: env.APP_URL, credentials: true });
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Facebook AI Page Manager API')
    .setDescription('Internal REST API — see AGENTS.md §45')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  // เตือนตั้งแต่เปิดระบบถ้าโค้ดใหม่กว่าฐานข้อมูล — ไม่ล้มระบบ เพราะหน้าที่ไม่แตะตารางใหม่ยังใช้ได้
  const pending = await pendingMigrations(app.get(PRISMA)).catch(() => null);
  if (pending?.length) new Logger('database').warn(`ยังไม่ได้ migrate ${pending.length} รายการ (${pending.join(', ')}) → deploy/update.sh หรือ docker compose --profile maintenance run --rm migrate`);
  return { app, env };
}
