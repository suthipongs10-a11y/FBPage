import type { Job, Queue } from 'bullmq';
import { pollContent, reconcileStalledUploads, syncAccount, uploadContent, type TikTokDeps } from '@fbpm/tiktok-core';
export async function handleTikTok(d: TikTokDeps, job: Pick<Job, 'name' | 'data'>) {
  if (job.name === 'upload') return uploadContent(d, job.data.workspaceId, job.data.contentId, job.data.requestId);
  if (job.name === 'sync') {
    const rows = await d.prisma.tikTokAccount.findMany({ where: { status: 'ACTIVE', brand: { client: { workspace: { status: 'ACTIVE', automationPaused: false } } } }, select: { id: true, workspaceId: true } });
    for (const a of rows) try { await syncAccount(d, a.workspaceId, a.id, 2); } catch { /* account error saved by adapter; continue other tenants */ }
    await d.prisma.tikTokOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return { accounts: rows.length };
  }
  if (job.name === 'poll') {
    await reconcileStalledUploads(d);
    const rows = await d.prisma.contentItem.findMany({ where: { platform: 'TIKTOK', tiktokMeta: { publishId: { not: null }, uploadStatus: { in: ['PUBLISH_PENDING', 'UPLOADED'] } }, tiktokAccount: { status: 'ACTIVE' } }, select: { id: true, tiktokAccount: { select: { workspaceId: true } } }, take: 100 });
    for (const c of rows) try { await pollContent(d, c.tiktokAccount!.workspaceId, c.id); } catch { /* retry at next poll, no upload initialization */ }
    return { checked: rows.length };
  }
  return { skipped: job.name };
}
export async function registerTikTok(queue: Queue) {
  await queue.upsertJobScheduler('tiktok-sync-6h', { every: 6 * 3_600_000 }, { name: 'sync', data: {} });
  await queue.upsertJobScheduler('tiktok-status-5m', { every: 5 * 60_000 }, { name: 'poll', data: {} });
}
