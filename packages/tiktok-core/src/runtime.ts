import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, decryptSecret, encryptSecret } from '@fbpm/database';
import { TikTokClient, TikTokError, type Tokens } from './client';
import { validateMediaUrl } from './metrics';

export interface TikTokDeps { prisma: PrismaClient; client: TikTokClient; secret: string; publishingEnabled: boolean; mediaPrefixes: string[] }
export const accountScope = (workspaceId: string) => ({ workspaceId, brand: { client: { workspaceId } } });
export const contentScope = (workspaceId: string) => ({ platform: 'TIKTOK', OR: [{ tiktokAccount: accountScope(workspaceId) }, { tiktokAccountId: null, tiktokBrand: { client: { workspaceId } } }] });
export function encryptedTokens(t: Tokens, secret: string) {
  return { accessTokenEncrypted: encryptSecret(t.access_token, secret), refreshTokenEncrypted: encryptSecret(t.refresh_token, secret), tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshExpiresAt: new Date(Date.now() + t.refresh_expires_in * 1000), scopes: t.scope.split(',').map(s => s.trim()).filter(Boolean) };
}
/** Database lock serializes refresh across API and workers; rotated credentials are committed together. */
export async function accessToken(d: TikTokDeps, workspaceId: string, accountId: string) {
  try {
    return await d.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))::text`;
      const a = await tx.tikTokAccount.findFirst({ where: { id: accountId, ...accountScope(workspaceId) } });
      if (!a || a.status !== 'ACTIVE') throw new TikTokError('token_expired', 409);
      if (a.tokenExpiresAt.getTime() > Date.now() + 60_000) return { token: decryptSecret(a.accessTokenEncrypted, d.secret), scopes: a.scopes };
      if (a.refreshExpiresAt.getTime() <= Date.now()) throw new TikTokError('token_expired', 409);
      const t = await d.client.refresh(decryptSecret(a.refreshTokenEncrypted, d.secret));
      if (t.open_id !== a.openId) throw new TikTokError('invalid_grant', 409);
      const updated = encryptedTokens(t, d.secret);
      await tx.tikTokAccount.update({ where: { id: a.id }, data: { ...updated, lastError: null } });
      return { token: t.access_token, scopes: updated.scopes };
    }, { timeout: 25_000, maxWait: 25_000 });
  } catch (e) { await markAccountError(d, workspaceId, accountId, e); throw e; }
}
export async function markAccountError(d: TikTokDeps, workspaceId: string, id: string, e: unknown) {
  if (e instanceof TikTokError) await d.prisma.tikTokAccount.updateMany({ where: { id, ...accountScope(workspaceId), status: 'ACTIVE' }, data: { ...(e.needsReconnect && { status: 'RECONNECT_REQUIRED' }), lastError: e.message } });
}
export async function syncAccount(d: TikTokDeps, workspaceId: string, id: string, maxPages = 5) {
  const auth = await accessToken(d, workspaceId, id);
  try {
    const p = await d.client.profile(auth.token, auth.scopes);
    await d.prisma.tikTokAccount.updateMany({ where: { id, ...accountScope(workspaceId), status: 'ACTIVE' }, data: { displayName: p.display_name ?? '', username: p.username ?? null, avatarUrl: p.avatar_url, followers: p.follower_count, following: p.following_count, likes: p.likes_count, videoCount: p.video_count } });
    let imported = 0; let cursor: number | undefined; let hasMore = false; const seen = new Set<number>();
    if (auth.scopes.includes('video.list')) {
      for (let page = 0; page < Math.min(10, Math.max(1, maxPages)); page++) {
        const response = await d.client.videos(auth.token, cursor);
        await d.prisma.$transaction(async tx => {
          const active = await tx.tikTokAccount.findFirst({ where: { id, ...accountScope(workspaceId), status: 'ACTIVE' } });
          if (!active) throw new TikTokError('token_expired', 409);
          for (const v of response.videos) {
            const data = { title: v.title, description: v.video_description, thumbnailUrl: v.cover_image_url, shareUrl: v.share_url, publishedAt: v.create_time === null ? null : new Date(v.create_time * 1000), durationSeconds: v.duration };
            const video = await tx.tikTokVideo.upsert({ where: { accountId_externalId: { accountId: id, externalId: v.id } }, create: { ...data, accountId: id, externalId: v.id }, update: data });
            await tx.contentMetricSnapshot.create({ data: { tiktokVideoId: video.id, views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count } });
            imported++;
          }
        });
        hasMore = response.has_more;
        if (!hasMore) break;
        if (seen.has(response.cursor)) throw new TikTokError('invalid_pagination');
        seen.add(response.cursor); cursor = response.cursor;
      }
    }
    await d.prisma.tikTokAccount.updateMany({ where: { id, ...accountScope(workspaceId), status: 'ACTIVE' }, data: { lastSyncedAt: new Date(), lastError: null } });
    return { imported, hasMore, videoAccess: auth.scopes.includes('video.list') };
  } catch (e) { await markAccountError(d, workspaceId, id, e); throw e; }
}

/** One operation per content version. Uncertain writes are never automatically reinitialized. */
export async function uploadContent(d: TikTokDeps, workspaceId: string, id: string, requestId: string) {
  const c = await d.prisma.contentItem.findFirst({ where: { id, ...contentScope(workspaceId) }, include: { tiktokMeta: true, tiktokAccount: { include: { brand: { include: { client: { include: { workspace: true } } } } } } } });
  if (!c?.tiktokAccount || !c.tiktokMeta) throw new TikTokError('content_not_found', 404);
  if (c.tiktokMeta.publishId) return { status: c.tiktokMeta.uploadStatus, alreadySubmitted: true };
  if (!d.publishingEnabled) return { status: 'DISABLED', endpoint: '/v2/post/publish/inbox/video/init/', accountId: c.tiktokAccountId };
  if (c.tiktokAccount.status !== 'ACTIVE' || c.tiktokAccount.uploadsPaused || c.tiktokAccount.brand.client.workspace.status !== 'ACTIVE' || c.tiktokAccount.brand.client.workspace.automationPaused) throw new TikTokError('automation_paused', 409);
  if (!c.tiktokMeta.confirmedAt || !c.tiktokMeta.confirmedById || !['APPROVED', 'SCHEDULED'].includes(c.status)) throw new TikTokError('approval_required', 409);
  if (c.scheduledAt && c.scheduledAt.getTime() > Date.now() + 1000) throw new TikTokError('not_due', 409);
  if (!c.tiktokMeta.sourceUrl) throw new TikTokError('media_required', 422);
  let videoUrl: string;
  try { videoUrl = validateMediaUrl(c.tiktokMeta.sourceUrl, d.mediaPrefixes); } catch { throw new TikTokError('verified_media_url_required', 422); }
  const auth = await accessToken(d, workspaceId, c.tiktokAccount.id);
  if (!auth.scopes.includes('video.upload')) throw new TikTokError('scope_not_authorized', 403);
  const key = `tiktok-inbox-${id}`;
  const requestHash = createHash('sha256').update(videoUrl).digest('hex');
  const claimed = await d.prisma.$transaction(async tx => {
    if (await tx.externalOperation.findUnique({ where: { idempotencyKey: key } })) return false;
    const active = await tx.tikTokAccount.findFirst({ where: { id: c.tiktokAccountId!, ...accountScope(workspaceId), status: 'ACTIVE', uploadsPaused: false, brand: { client: { workspaceId, workspace: { status: 'ACTIVE', automationPaused: false } } } } });
    if (!active) throw new TikTokError('automation_paused', 409);
    const changed = await tx.contentItem.updateMany({ where: { id, ...contentScope(workspaceId), status: { in: ['APPROVED', 'SCHEDULED'] }, updatedAt: c.updatedAt }, data: { status: 'PUBLISHING' } });
    if (!changed.count) return false;
    await tx.externalOperation.create({ data: { workspaceId, provider: 'TIKTOK', operationType: 'INBOX_UPLOAD', idempotencyKey: key, requestHash, status: 'PENDING' } });
    await tx.tikTokContentMetadata.update({ where: { contentId: id }, data: { uploadStatus: 'UPLOADING' } });
    return true;
  });
  if (!claimed) return { status: 'RECONCILIATION_REQUIRED', alreadySubmitted: true };
  try {
    const publishId = await d.client.uploadInbox(auth.token, videoUrl);
    await d.prisma.$transaction([
      d.prisma.externalOperation.update({ where: { idempotencyKey: key }, data: { externalId: publishId, status: 'SUBMITTED' } }),
      d.prisma.tikTokContentMetadata.update({ where: { contentId: id }, data: { publishId, uploadStatus: 'PUBLISH_PENDING' } }),
      d.prisma.auditLog.create({ data: { workspaceId, action: 'tiktok.upload.submitted', resourceType: 'contentItem', resourceId: id, requestId, after: { status: 'PUBLISH_PENDING' } } }),
    ]);
    return { status: 'PUBLISH_PENDING', alreadySubmitted: false };
  } catch (e) {
    const uncertain = !(e instanceof TikTokError) || e.ambiguous;
    const message = e instanceof TikTokError ? e.message : 'ไม่ทราบผลการส่ง กรุณาตรวจใน TikTok ก่อนทำรายการใหม่';
    await d.prisma.$transaction([
      d.prisma.externalOperation.update({ where: { idempotencyKey: key }, data: { status: uncertain ? 'UNKNOWN' : 'FAILED', error: message } }),
      d.prisma.contentItem.update({ where: { id }, data: { status: 'PUBLISH_FAILED', lastError: message } }),
      d.prisma.tikTokContentMetadata.update({ where: { contentId: id }, data: { uploadStatus: uncertain ? 'RECONCILIATION_REQUIRED' : 'FAILED' } }),
    ]);
    await markAccountError(d, workspaceId, c.tiktokAccount.id, e);
    return { status: uncertain ? 'RECONCILIATION_REQUIRED' : 'FAILED', error: message };
  }
}
export async function pollContent(d: TikTokDeps, workspaceId: string, id: string) {
  const c = await d.prisma.contentItem.findFirst({ where: { id, ...contentScope(workspaceId) }, include: { tiktokMeta: true } });
  if (!c?.tiktokMeta?.publishId || !c.tiktokAccountId) throw new TikTokError('no_upload', 409);
  const m = c.tiktokMeta;
  if (['PUBLISHED', 'FAILED'].includes(m.uploadStatus) || (m.lastPolledAt && Date.now() - m.lastPolledAt.getTime() < 30_000)) return { status: m.uploadStatus };
  const auth = await accessToken(d, workspaceId, c.tiktokAccountId);
  try {
    const r = await d.client.postStatus(auth.token, m.publishId!);
    const status = r.status === 'SEND_TO_USER_INBOX' ? 'UPLOADED' : r.status === 'PUBLISH_COMPLETE' ? 'PUBLISHED' : r.status === 'FAILED' ? 'FAILED' : 'PUBLISH_PENDING';
    const changed = await d.prisma.$transaction(async tx => {
      const claim = await tx.contentItem.updateMany({ where: { id, ...contentScope(workspaceId), updatedAt: c.updatedAt }, data: { ...(status === 'PUBLISHED' ? { status: 'PUBLISHED', publishedAt: new Date() } : status === 'FAILED' ? { status: 'PUBLISH_FAILED', lastError: r.failReason ?? 'TikTok processing failed' } : {}), updatedAt: new Date() } });
      if (!claim.count) return false;
      await tx.tikTokContentMetadata.update({ where: { contentId: id }, data: { uploadStatus: status, lastPolledAt: new Date() } });
      await tx.externalOperation.updateMany({ where: { idempotencyKey: `tiktok-inbox-${id}` }, data: { status: status === 'PUBLISHED' ? 'SUCCEEDED' : status === 'FAILED' ? 'FAILED' : 'SUBMITTED' } });
      return true;
    });
    return { status: changed ? status : (await d.prisma.tikTokContentMetadata.findUniqueOrThrow({ where: { contentId: id } })).uploadStatus };
  } catch (e) { await markAccountError(d, workspaceId, c.tiktokAccountId, e); throw e; }
}

/** A process may stop after claiming or after TikTok accepts a write. Never initialize it again. */
export async function reconcileStalledUploads(d: TikTokDeps) {
  const rows = await d.prisma.contentItem.findMany({ where: { platform: 'TIKTOK', status: 'PUBLISHING', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) }, tiktokMeta: { uploadStatus: 'UPLOADING', publishId: null } }, select: { id: true, updatedAt: true }, take: 100 });
  for (const c of rows) await d.prisma.$transaction(async tx => {
    const message = 'ไม่ทราบผลการส่งหลังระบบหยุดทำงาน กรุณาตรวจใน TikTok ก่อนทำรายการใหม่';
    const claimed = await tx.contentItem.updateMany({ where: { id: c.id, updatedAt: c.updatedAt, status: 'PUBLISHING' }, data: { status: 'PUBLISH_FAILED', lastError: message } });
    if (!claimed.count) return;
    await tx.tikTokContentMetadata.update({ where: { contentId: c.id }, data: { uploadStatus: 'RECONCILIATION_REQUIRED' } });
    await tx.externalOperation.updateMany({ where: { idempotencyKey: `tiktok-inbox-${c.id}`, externalId: null }, data: { status: 'UNKNOWN', error: message } });
  });
  return rows.length;
}

export const jsonValue = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
