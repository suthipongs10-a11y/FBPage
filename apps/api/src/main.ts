import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // ล้มเร็วถ้าค่าตั้งผิด (ก่อนสร้าง Nest app)
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });

  // ทุก request มี correlation id (AGENTS.md §79) — ใช้ต่อใน audit log และ AI task log
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    (req as Request & { requestId: string }).requestId = id;
    res.setHeader('x-request-id', id);
    next();
  });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.enableCors({ origin: env.APP_URL, credentials: true });
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Facebook AI Page Manager API')
    .setDescription('Internal REST API — see AGENTS.md §45')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  await app.listen(env.API_PORT, '0.0.0.0');
  new Logger('bootstrap').log(`API listening on :${env.API_PORT} (env=${env.APP_ENV}) · OpenAPI at /docs`);
}

bootstrap().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
