import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PRISMA } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';

async function build(prismaOk: boolean, redisOk: boolean) {
  const mod = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PRISMA, useValue: { $queryRaw: prismaOk ? async () => [{ '?column?': 1 }] : async () => { throw new Error('connect ECONNREFUSED'); } } },
      { provide: REDIS, useValue: { status: 'ready', connect: async () => undefined, ping: redisOk ? async () => 'PONG' : async () => { throw new Error('redis down'); } } },
    ],
  }).compile();
  return mod.get(HealthController);
}

describe('GET /health', () => {
  it('reports ok when both dependencies respond', async () => {
    const r = await (await build(true, true)).get();
    expect(r.status).toBe('ok');
    expect(r.checks.map(c => c.name).sort()).toEqual(['postgres', 'redis']);
  });
  it('reports degraded and keeps the error message when redis is down', async () => {
    const r = await (await build(true, false)).get();
    expect(r.status).toBe('degraded');
    expect(r.checks.find(c => c.name === 'redis')?.error).toMatch(/redis down/);
  });
  it('never throws — dashboards must be able to render failures', async () => {
    await expect((await build(false, false)).get()).resolves.toMatchObject({ status: 'degraded' });
  });
});
