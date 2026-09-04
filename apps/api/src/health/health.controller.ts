import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';
import type { PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';

export interface HealthCheck { name: string; status: 'up' | 'down'; latencyMs: number; error?: string }
export interface HealthReport { status: 'ok' | 'degraded'; version: string; uptimeSec: number; checks: HealthCheck[] }

async function probe(name: string, fn: () => Promise<unknown>): Promise<HealthCheck> {
  const t0 = Date.now();
  try { await fn(); return { name, status: 'up', latencyMs: Date.now() - t0 }; }
  catch (e) { return { name, status: 'down', latencyMs: Date.now() - t0, error: (e as Error).message.slice(0, 200) }; }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + dependency checks (PostgreSQL, Redis)' })
  async get(): Promise<HealthReport> {
    const checks = await Promise.all([
      probe('postgres', () => this.prisma.$queryRaw`SELECT 1`),
      probe('redis', async () => { if (this.redis.status === 'wait') await this.redis.connect(); return this.redis.ping(); }),
    ]);
    return {
      status: checks.every(c => c.status === 'up') ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSec: Math.round(process.uptime()),
      checks,
    };
  }
}
