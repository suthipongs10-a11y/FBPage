/** Worker integration — publish job ผ่าน handlePublish กับ mock Graph (ต้องมี DATABASE_URL + REDIS_URL) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue, type Job } from 'bullmq';
import { PrismaClient, encryptSecret } from '@fbpm/database';
import { startMockGraph } from '@fbpm/facebook-core';
import { JOBS, QUEUES } from '@fbpm/shared';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;

run('worker publish job', () => {
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let prisma: PrismaClient; let mod: typeof import('./main'); let analytics: Queue;
  const SECRET = 'worker-test-secret-at-least-32-characters!!';
  let ws = ''; let contentId = ''; let userId = '';
  beforeAll(async () => {
    graph = await startMockGraph();
    process.env.META_GRAPH_BASE_URL = graph.url; process.env.AUTH_SECRET = SECRET;
    mod = await import('./main');
    prisma = new PrismaClient();
    const u = new URL(process.env.REDIS_URL!); analytics = new Queue(QUEUES.analytics, { connection: { host: u.hostname, port: Number(u.port) || 6379 } });
    const user = await prisma.user.create({ data: { email: `worker-${Date.now()}@test.local`, name: 'W', passwordHash: 'x' } }); userId = user.id;
    const w = await prisma.workspace.create({ data: { name: 'W', slug: `w-${Date.now()}` } }); ws = w.id;
    const client = await prisma.client.create({ data: { workspaceId: ws, name: 'C' } });
    const brand = await prisma.brand.create({ data: { clientId: client.id, name: 'B' } });
    const conn = await prisma.facebookConnection.create({ data: { workspaceId: ws, userId, providerUserId: 'U1', encryptedAccessToken: encryptSecret('USER_OK', SECRET) } });
    const page = await prisma.facebookPage.create({ data: { brandId: brand.id, connectionId: conn.id, facebookPageId: '111', name: 'P', pageAccessTokenEncrypted: encryptSecret('PAGE_111', SECRET), tasks: ['CREATE_CONTENT'], tokenStatus: 'VALID' } });
    const c = await prisma.contentItem.create({ data: { pageId: page.id, status: 'SCHEDULED', caption: 'จาก worker', hashtags: ['w'], scheduledAt: new Date(), createdById: userId } }); contentId = c.id;
  }, 30_000);
  afterAll(async () => { await analytics.close(); await prisma.workspace.deleteMany({ where: { id: ws } }); await prisma.user.deleteMany({ where: { id: userId } }); await prisma.$disconnect(); graph.server.close(); delete process.env.META_GRAPH_BASE_URL; });

  const job = (data: Record<string, unknown>, name = JOBS.publishContent) => ({ id: 'j1', name, data, attemptsMade: 0 } as unknown as Job<{ contentId: string; requestId?: string }>);

  it('publishes a SCHEDULED item exactly once and enqueues metric collection', async () => {
    const before = graph.state.published.length;
    const r = await mod.handlePublish(job({ contentId })) as { status: string; postId: string };
    expect(r.status).toBe('PUBLISHED'); expect(graph.state.published.length).toBe(before + 1);
    expect(graph.state.published.at(-1)!.body.message).toContain('#w');
    const c = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentId } }); expect(c.status).toBe('PUBLISHED'); expect(c.externalPostId).toBeTruthy();
    const j24 = await analytics.getJob(`metrics-${r.postId}-24h`); expect(j24).toBeTruthy(); expect(await j24!.getState()).toBe('delayed');
    await j24!.remove(); await (await analytics.getJob(`metrics-${r.postId}-72h`))!.remove();
    const again = await mod.handlePublish(job({ contentId })) as { skipped?: string };
    expect(again.skipped).toMatch(/PUBLISHED/); expect(graph.state.published.length).toBe(before + 1);
  });

  it('kill switch inside the job: paused page → SKIPPED without hitting Facebook, job does not throw', async () => {
    const page = await prisma.facebookPage.findFirstOrThrow({ where: { brand: { client: { workspaceId: ws } } } });
    const c2 = await prisma.contentItem.create({ data: { pageId: page.id, status: 'SCHEDULED', caption: 'paused', scheduledAt: new Date() } });
    await prisma.facebookPage.update({ where: { id: page.id }, data: { publishingPaused: true } });
    const before = graph.state.published.length;
    const r = await mod.handlePublish(job({ contentId: c2.id })) as { status: string; reason: string };
    expect(r.status).toBe('SKIPPED'); expect(r.reason).toMatch(/หยุดการโพสต์/); expect(graph.state.published.length).toBe(before);
  });

  it('sync-all enqueues one sync job per connected page; sync-page runs a sync', async () => {
    const u = new URL(process.env.REDIS_URL!); const syncQ = new Queue(QUEUES.facebookSync, { connection: { host: u.hostname, port: Number(u.port) || 6379 } });
    await prisma.facebookPage.updateMany({ where: { brand: { client: { workspaceId: ws } } }, data: { publishingPaused: false } });
    const r = await mod.handleSync(job({}, JOBS.syncAllPages) as never) as { enqueued: number };
    expect(r.enqueued).toBeGreaterThanOrEqual(1);
    const page = await prisma.facebookPage.findFirstOrThrow({ where: { brand: { client: { workspaceId: ws } } } });
    const s = await mod.handleSync(job({ pageId: page.id, days: 7 }, JOBS.syncPage) as never) as { total: number };
    expect(s.total).toBeGreaterThanOrEqual(2);
    for (const j of await syncQ.getJobs(['delayed', 'waiting', 'prioritized'])) if (j.data?.pageId === page.id) await j.remove();
    await syncQ.close();
  });
});
