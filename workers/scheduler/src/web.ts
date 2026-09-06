/**
 * Website Care queues (AGENTS_WEB.md §4)
 * - web-monitor: ทุก 5 นาที หาเว็บที่ถึงรอบตรวจ (lastCheckedAt + checkIntervalMin) → งาน UPTIME ต่อเว็บ (jobId ต่อเว็บต่อช่วง 5 นาที กันซ้ำ)
 * - web-daily: วันละครั้ง SSL/SEO/LINKS/PAGESPEED + Search Console ต่อเว็บ (กระจายเวลาด้วย delay)
 * แจ้งเตือนเมื่อ incident เปิด/ปิด — ไม่ใช้ AI ใน worker
 */
import type { Queue, Job } from 'bullmq';
import { PrismaClient, notify } from '@fbpm/database';
import { GoogleAuth } from '@fbpm/youtube-core';
import { SearchConsoleClient, incidentNotification, publishWebContent, runSiteChecks, syncSearchConsole, type WebDeps, type WebPublishDeps } from '@fbpm/web-core';
import { WEB_JOBS } from '@fbpm/shared';

/** W-3: deps สำหรับโพสต์ขึ้น WordPress — เปิดจริงเมื่อ WEB_PUBLISH_ENABLED=true */
export function buildWorkerWebPublishDeps(prisma: PrismaClient, authSecret: string, env: NodeJS.ProcessEnv = process.env): WebPublishDeps {
  const on = (v?: string) => (v ?? '').toLowerCase() === 'true' || v === '1';
  return { prisma, authSecret, webPublishEnabled: on(env.WEB_PUBLISH_ENABLED), wpAllowInsecure: on(env.WEB_WP_ALLOW_INSECURE) };
}

export function buildWorkerWebDeps(prisma: PrismaClient, authSecret: string, env: NodeJS.ProcessEnv = process.env): WebDeps {
  const ytMock = env.YOUTUBE_MOCK_BASE_URL?.replace(/\/+$/, ''); const mock = env.WEB_MOCK_BASE_URL?.replace(/\/+$/, '');
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI
    ? new GoogleAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI, ...(ytMock && { authBaseUrl: `${ytMock}/auth`, tokenUrl: `${ytMock}/token`, tokenInfoUrl: `${ytMock}/tokeninfo`, revokeUrl: `${ytMock}/revoke` }) }) : null;
  return { prisma, google, authSecret, pagespeedKey: env.PAGESPEED_API_KEY || undefined, pagespeedBaseUrl: mock ? `${mock}/pagespeed` : undefined, searchConsole: new SearchConsoleClient({ baseUrl: mock ? `${mock}/webmasters/v3` : undefined }), check: { allowPrivate: (env.WEB_ALLOW_PRIVATE_TARGETS ?? '').toLowerCase() === 'true', timeoutMs: 15_000 }, linkDelayMs: mock ? 0 : 1000 };
}

export interface WebWorkerContext { prisma: PrismaClient; deps: WebDeps; publish?: WebPublishDeps; authSecret: string; queues: { monitor: Queue; daily: Queue }; log: (msg: string, extra?: Record<string, unknown>) => void }

export function createWebHandlers(ctx: WebWorkerContext) {
  const { prisma, deps, authSecret, queues, log } = ctx; const publish = ctx.publish ?? buildWorkerWebPublishDeps(prisma, authSecret);
  const activeSites = () => prisma.site.findMany({ where: { disconnectedAt: null, monitorEnabled: true }, select: { id: true, checkIntervalMin: true, lastCheckedAt: true, googleConnectionId: true, searchConsoleProperty: true } });

  async function handleMonitor(job: Job<{ siteId?: string }>): Promise<unknown> {
    if (job.name === WEB_JOBS.checkAll) {
      const now = Date.now(); const slot = Math.floor(now / 300_000); const siteIds: string[] = [];
      for (const s of await activeSites()) {
        const due = !s.lastCheckedAt || s.lastCheckedAt.getTime() + s.checkIntervalMin * 60_000 <= now + 30_000;
        if (!due) continue;
        await queues.monitor.add(WEB_JOBS.checkSite, { siteId: s.id }, { jobId: `webcheck-${s.id}-${slot}`, attempts: 1 }); siteIds.push(s.id);
      }
      return { enqueued: siteIds.length, siteIds };
    }
    if (!job.data.siteId) return { skipped: 'no siteId' };
    try {
      const r = await runSiteChecks(deps, job.data.siteId, ['UPTIME']);
      for (const ev of r.events) await notify(prisma, authSecret, r.site.workspaceId, incidentNotification(ev, r.site)).catch(() => undefined);
      log('site checked', { siteId: job.data.siteId, status: r.status, events: r.events.length });
      return { status: r.status, results: r.results, events: r.events.length };
    } catch (e) { return { skipped: (e as Error).message }; }
  }

  async function handleDaily(job: Job<{ siteId?: string }>): Promise<unknown> {
    if (job.name === WEB_JOBS.dailyAll) {
      const day = new Date().toISOString().slice(0, 10); const siteIds: string[] = [];
      for (const [i, s] of (await activeSites()).entries()) { await queues.daily.add(WEB_JOBS.dailySite, { siteId: s.id }, { jobId: `webdaily-${s.id}-${day}`, delay: i * 20_000, attempts: 2, backoff: { type: 'exponential', delay: 600_000 } }); siteIds.push(s.id); }
      return { enqueued: siteIds.length, siteIds };
    }
    if (!job.data.siteId) return { skipped: 'no siteId' };
    try {
      const r = await runSiteChecks(deps, job.data.siteId, ['SSL', 'SEO', 'LINKS', 'PAGESPEED']);
      for (const ev of r.events) await notify(prisma, authSecret, r.site.workspaceId, incidentNotification(ev, r.site)).catch(() => undefined);
      const site = await prisma.site.findUnique({ where: { id: job.data.siteId }, select: { googleConnectionId: true, searchConsoleProperty: true, name: true, url: true } });
      let search: unknown = null;
      if (site?.googleConnectionId && site.searchConsoleProperty) {
        search = await syncSearchConsole(deps, job.data.siteId, 28);
        if ((search as { status: string }).status === 'NO_ACCESS') { const inc = await prisma.siteIncident.findFirst({ where: { siteId: job.data.siteId, kind: 'GSC_ACCESS', resolvedAt: null }, select: { id: true } }); if (inc) await notify(prisma, authSecret, r.site.workspaceId, incidentNotification({ siteId: job.data.siteId, kind: 'GSC_ACCESS', opened: true, summary: (search as { error?: string }).error ?? '', incidentId: inc.id }, r.site)).catch(() => undefined); }
      }
      log('site daily', { siteId: job.data.siteId, results: r.results, search });
      return { results: r.results, events: r.events.length, search };
    } catch (e) { return { skipped: (e as Error).message }; }
  }
  /** web-publish: โพสต์บทความตามเวลา (idempotent ผ่าน ExternalOperation) */
  async function handlePublish(job: Job<{ contentId: string; requestId?: string }>): Promise<unknown> {
    if (job.name !== WEB_JOBS.publishContent) return { skipped: job.name };
    const { contentId, requestId = `job-${job.id}` } = job.data;
    const c = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { status: true, platform: true, webMeta: { select: { title: true } }, site: { select: { brand: { select: { client: { select: { workspaceId: true } } } } } } } });
    if (!c || c.platform !== 'WEB') return { skipped: 'content missing' };
    if (!['SCHEDULED', 'PUBLISHING', 'PUBLISH_FAILED'].includes(c.status)) return { skipped: `status ${c.status}` };
    const outcome = await publishWebContent(publish, contentId, { requestId, scheduledPublish: true });
    log('web publish outcome', { contentId, ...outcome, requestId, attempt: job.attemptsMade + 1 });
    if (outcome.status === 'FAILED') {
      const last = !outcome.retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (last && c.site) await notify(prisma, authSecret, c.site.brand.client.workspaceId, { type: 'publish_failed', severity: 'bad', title: `โพสต์ขึ้นเว็บตามเวลาไม่สำเร็จ: ${c.webMeta?.title ?? ''}`, body: outcome.error, href: '/web/content', resourceType: 'contentItem', resourceId: contentId, dedupeKey: `webpublish_failed:${contentId}` }).catch(() => undefined);
      if (outcome.retryable) throw new Error(outcome.error);
    }
    return outcome;
  }
  return { handleMonitor, handleDaily, handlePublish };
}

export async function registerWebSchedulers(monitor: Queue, daily: Queue): Promise<void> {
  await monitor.upsertJobScheduler('web-check-all-5m', { every: 5 * 60_000 }, { name: WEB_JOBS.checkAll, data: {} });
  await daily.upsertJobScheduler('web-daily-all', { pattern: '0 2 * * *' }, { name: WEB_JOBS.dailyAll, data: {} });
}
