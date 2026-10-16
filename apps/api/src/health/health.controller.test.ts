import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PRISMA } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';

async function build(prismaOk: boolean, redisOk: boolean, pending: string[] | null = []) {
  const mod = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PRISMA, useValue: { $queryRaw: prismaOk ? async () => [{ '?column?': 1 }] : async () => { throw new Error('connect ECONNREFUSED'); } } },
      { provide: REDIS, useValue: { status: 'ready', connect: async () => undefined, ping: redisOk ? async () => 'PONG' : async () => { throw new Error('redis down'); } } },
    ],
  }).compile();
  const c = mod.get(HealthController); c.pending = async () => pending; return c;
}

describe('GET /health', () => {
  it('reports ok when both dependencies respond', async () => {
    const r = await (await build(true, true)).get();
    expect(r.status).toBe('ok');
    expect(r.checks.map(c => c.name).sort()).toEqual(['migrations', 'postgres', 'redis']);
  });
  it('reports degraded and keeps the error message when redis is down', async () => {
    const r = await (await build(true, false)).get();
    expect(r.status).toBe('degraded');
    expect(r.checks.find(c => c.name === 'redis')?.error).toMatch(/redis down/);
  });
  it('reports degraded and names the migrations when the code is newer than the database', async () => {
    const r = await (await build(true, true, ['20261001120000_service_plans'])).get();
    expect(r.status).toBe('degraded');
    expect(r.checks.find(c => c.name === 'migrations')).toMatchObject({ status: 'down', error: expect.stringMatching(/20261001120000_service_plans/) });
    expect((await (await build(true, true, null)).get()).status).toBe('ok');   // ตรวจไม่ได้ ≠ พัง
  });
  it('never throws — dashboards must be able to render failures', async () => {
    await expect((await build(false, false)).get()).resolves.toMatchObject({ status: 'degraded' });
  });
});
