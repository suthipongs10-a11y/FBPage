/** Worker integration — web-monitor / web-daily กับ mock เว็บลูกค้า (ต้องมี DATABASE_URL + REDIS_URL) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue, type Job } from 'bullmq';
import { PrismaClient } from '@fbpm/database';
import { startMockWeb } from '@fbpm/web-core';
import { WEB_JOBS, WEB_QUEUES } from '@fbpm/shared';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;

run('worker web jobs', () => {
  let web: Awaited<ReturnType<typeof startMockWeb>>; let prisma: PrismaClient; let mod: typeof import('./main'); let monitorQ: Queue; let dailyQ: Queue;
  const SECRET = 'worker-web-test-secret-at-least-32-characters!!';
  let ws = ''; let userId = ''; let siteId = '';
  const job = <T,>(data: T, name: string) => ({ id: `j-${Math.random().toString(36).slice(2)}`, name, data, attemptsMade: 0, opts: {} } as unknown as Job<T>);
  beforeAll(async () => {
    web = await startMockWeb();
    Object.assign(process.env, { WEB_MOCK_BASE_URL: web.url, WEB_ALLOW_PRIVATE_TARGETS: 'true', PAGESPEED_API_KEY: 'PSI_OK', AUTH_SECRET: SECRET });
    mod = await import('./main'); prisma = new PrismaClient();
    const u = new URL(process.env.REDIS_URL!); const connection = { host: u.hostname, port: Number(u.port) || 6379 };
    monitorQ = new Queue(WEB_QUEUES.monitor, { connection }); dailyQ = new Queue(WEB_QUEUES.daily, { connection });
    const user = await prisma.user.create({ data: { email: `webworker-${Date.now()}@test.local`, name: 'W', passwordHash: 'x' } }); userId = user.id;
    const w = await prisma.workspace.create({ data: { name: 'W', slug: `webw-${Date.now()}` } }); ws = w.id;
    const client = await prisma.client.create({ data: { workspaceId: ws, name: 'C' } });
    const brand = await prisma.brand.create({ data: { clientId: client.id, name: 'B' } });
    const s = await prisma.site.create({ data: { brandId: brand.id, url: web.siteUrl, name: 'mock', expectedText: 'ภูเก็ต', checkIntervalMin: 15 } }); siteId = s.id;
  }, 30_000);
  afterAll(async () => {
    for (const q of [monitorQ, dailyQ]) { await q.drain(true).catch(() => undefined); await q.close(); }
    await prisma.workspace.deleteMany({ where: { id: ws } }); await prisma.user.deleteMany({ where: { id: userId } }); await prisma.$disconnect(); web.server.close();
  });

  it('check-all enqueues due sites once per slot; check-site records UPTIME and updates the site', async () => {
    const r = await mod.web.handleMonitor(job({}, WEB_JOBS.checkAll)) as { siteIds: string[] }; expect(r.siteIds).toContain(siteId);
    const again = await mod.web.handleMonitor(job({}, WEB_JOBS.checkAll)) as { siteIds: string[] }; expect(again.siteIds).toContain(siteId);   // jobId เดิม → BullMQ ไม่สร้างซ้ำ
    const jobs = await monitorQ.getJobs(['waiting', 'delayed']); expect(jobs.filter(j => j.data.siteId === siteId)).toHaveLength(1);
    const c = await mod.web.handleMonitor(job({ siteId }, WEB_JOBS.checkSite)) as { status: string }; expect(c.status).toBe('UP');
    const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } }); expect(site.lastStatus).toBe('UP'); expect(site.lastCheckedAt).not.toBeNull();
    const due = await mod.web.handleMonitor(job({}, WEB_JOBS.checkAll)) as { siteIds: string[] }; expect(due.siteIds).not.toContain(siteId);   // เพิ่งตรวจ ยังไม่ถึงรอบ
  });

  it('two consecutive failures open a DOWN incident and notify; recovery resolves + notifies', async () => {
    web.state.down = true;
    await mod.web.handleMonitor(job({ siteId }, WEB_JOBS.checkSite));
    const r = await mod.web.handleMonitor(job({ siteId }, WEB_JOBS.checkSite)) as { status: string; events: number }; expect(r.status).toBe('DOWN'); expect(r.events).toBe(1);
    expect(await prisma.notification.findFirst({ where: { workspaceId: ws, title: { contains: 'ล่ม' } } })).not.toBeNull();
    web.state.down = false;
    const up = await mod.web.handleMonitor(job({ siteId }, WEB_JOBS.checkSite)) as { status: string; events: number }; expect(up.status).toBe('UP'); expect(up.events).toBe(1);
    expect((await prisma.siteIncident.findFirstOrThrow({ where: { siteId, kind: 'DOWN' } })).resolvedAt).not.toBeNull();
  });

  it('daily job runs SSL/SEO/LINKS/PAGESPEED and skips Search Console when not connected', async () => {
    const all = await mod.web.handleDaily(job({}, WEB_JOBS.dailyAll)) as { siteIds: string[] }; expect(all.siteIds).toContain(siteId);
    const r = await mod.web.handleDaily(job({ siteId }, WEB_JOBS.dailySite)) as { results: Record<string, { status: string }>; search: unknown };
    expect(r.results.SSL!.status).toBe('SKIPPED'); expect(r.results.SEO!.status).toBe('WARN'); expect(r.results.LINKS!.status).toBe('WARN'); expect(r.results.PAGESPEED!.status).toBe('WARN'); expect(r.search).toBeNull();
    expect(await prisma.siteCheck.count({ where: { siteId, kind: 'PAGESPEED' } })).toBe(1);
  });
});
