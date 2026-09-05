/**
 * Progressive channel sync (§17, §22, §123, §125) ใช้ร่วม API/worker — ต้องส่ง prisma มา (server-side เท่านั้น)
 * - auth ของช่อง: OAuth (refresh อัตโนมัติ) หรือ API key (อ่านสาธารณะ) — ไม่มี = NO_ACCESS
 */
import type { Prisma, PrismaClient } from '@fbpm/database';
import { decryptSecret, encryptSecret } from '@fbpm/database';
import { GoogleAuth } from './google-auth';
import { YouTubeAnalyticsService } from './analytics.service';
import { YouTubeService } from './youtube.service';
import { VIDEO_CLASSIFIER_VERSION, YT_METRIC_SET_VERSION, ageWindow, classifyVideoType, fromDataApiStats, toYtSnapshot } from './metrics';
import { YouTubeApiError, type YtAuth } from './types';

export interface YtDeps { prisma: PrismaClient; yt: YouTubeService; analytics: YouTubeAnalyticsService; google: GoogleAuth | null; authSecret: string; apiKey?: string; uploadEnabled: boolean; mediaDir?: string }
export class ChannelNotAccessible extends Error { constructor(msg: string, public readonly reason: 'NO_ACCESS' | 'DISCONNECTED' | 'RECONNECT') { super(msg); this.name = 'ChannelNotAccessible'; } }

/** คืน auth ที่ใช้ได้ของช่อง — OAuth refresh เมื่อใกล้หมดอายุ; invalid_grant → เปลี่ยนสถานะ connection แล้วโยน RECONNECT */
export async function channelAuth(d: YtDeps, channelId: string, opts: { requireOAuth?: boolean } = {}): Promise<{ auth: YtAuth; channel: { id: string; youtubeChannelId: string; uploadsPlaylistId: string | null; accessMode: string; brandId: string; workspaceId: string } }> {
  const ch = await d.prisma.youTubeChannel.findUnique({ where: { id: channelId }, select: { id: true, youtubeChannelId: true, uploadsPlaylistId: true, accessMode: true, brandId: true, disconnectedAt: true, brand: { select: { client: { select: { workspaceId: true } } } }, connection: { select: { id: true, status: true, accessTokenEncrypted: true, refreshTokenEncrypted: true, tokenExpiresAt: true } } } });
  if (!ch) throw new ChannelNotAccessible('ไม่พบช่อง', 'DISCONNECTED');
  if (ch.disconnectedAt) throw new ChannelNotAccessible('ช่องถูกตัดการเชื่อมต่อแล้ว', 'DISCONNECTED');
  const base = { id: ch.id, youtubeChannelId: ch.youtubeChannelId, uploadsPlaylistId: ch.uploadsPlaylistId, accessMode: ch.accessMode, brandId: ch.brandId, workspaceId: ch.brand.client.workspaceId };
  const conn = ch.connection;
  if (conn && conn.status === 'ACTIVE' && conn.accessTokenEncrypted) {
    let access = decryptSecret(conn.accessTokenEncrypted, d.authSecret);
    const expiring = !conn.tokenExpiresAt || conn.tokenExpiresAt.getTime() < Date.now() + 120_000;
    if (expiring) {
      if (!conn.refreshTokenEncrypted || !d.google) { await d.prisma.googleConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: 'ไม่มี refresh token — เชื่อมต่อใหม่' } }); throw new ChannelNotAccessible('การอนุญาต Google หมดอายุ — เชื่อมต่อใหม่', 'RECONNECT'); }
      try {
        const t = await d.google.refresh(decryptSecret(conn.refreshTokenEncrypted, d.authSecret));
        access = t.accessToken;
        await d.prisma.googleConnection.update({ where: { id: conn.id }, data: { accessTokenEncrypted: encryptSecret(t.accessToken, d.authSecret), tokenExpiresAt: t.expiresAt, lastRefreshedAt: new Date(), lastError: null, ...(t.scopes.length && { scopes: t.scopes }) } });
      } catch (e) {
        if (e instanceof YouTubeApiError && e.needsReconnect) { await d.prisma.googleConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: e.userMessage } }); throw new ChannelNotAccessible(e.userMessage, 'RECONNECT'); }
        throw e;
      }
    }
    return { auth: { kind: 'oauth', accessToken: access }, channel: base };
  }
  if (opts.requireOAuth) throw new ChannelNotAccessible('การกระทำนี้ต้องเชื่อมต่อด้วย Google OAuth ของเจ้าของช่อง', conn ? 'RECONNECT' : 'NO_ACCESS');
  if (d.apiKey) return { auth: { kind: 'apiKey', apiKey: d.apiKey }, channel: base };
  throw new ChannelNotAccessible('ไม่มีทางเข้าถึงช่อง: ต้องมี Google OAuth หรือ YOUTUBE_API_KEY', 'NO_ACCESS');
}

async function run<T>(d: YtDeps, channelId: string, type: string, fn: (update: (patch: Partial<{ processed: number; totalExpected: number; errors: number; cursorState: unknown }>) => Promise<void>) => Promise<T>): Promise<T> {
  const r = await d.prisma.youTubeSyncRun.create({ data: { channelId, type }, select: { id: true } });
  const update = (patch: Partial<{ processed: number; totalExpected: number; errors: number; cursorState: unknown }>) => d.prisma.youTubeSyncRun.update({ where: { id: r.id }, data: { ...patch, cursorState: patch.cursorState as Prisma.InputJsonValue | undefined } }).then(() => undefined);
  try { const out = await fn(update); await d.prisma.youTubeSyncRun.update({ where: { id: r.id }, data: { status: 'OK', completedAt: new Date() } }); return out; }
  catch (e) { await d.prisma.youTubeSyncRun.update({ where: { id: r.id }, data: { status: 'ERROR', completedAt: new Date(), message: (e instanceof YouTubeApiError ? e.userMessage : (e as Error).message).slice(0, 500) } }); throw e; }
}

/** ขั้น 1: snapshot ช่อง (channels.list = 1 unit) */
export async function syncChannelSnapshot(d: YtDeps, channelId: string): Promise<void> {
  const { auth, channel } = await channelAuth(d, channelId);
  await run(d, channelId, 'QUICK', async () => {
    const c = auth.kind === 'oauth' && channel.accessMode === 'OAUTH' ? await d.yt.getMyChannel(auth) : await d.yt.getChannel(auth, channel.youtubeChannelId);
    if (!c) throw new YouTubeApiError('ไม่พบช่อง', 'notFound', 404);
    await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { title: c.title, customUrl: c.customUrl, description: c.description, country: c.country, defaultLanguage: c.defaultLanguage, thumbnailUrl: c.thumbnailUrl, publishedAt: c.publishedAt ? new Date(c.publishedAt) : null, uploadsPlaylistId: c.uploadsPlaylistId, subscriberCount: c.subscriberCount, videoCount: c.videoCount, viewCount: c.viewCount === null ? null : BigInt(c.viewCount), lastSyncedAt: new Date(), syncStatus: 'OK', syncError: null } });
    await d.prisma.youTubeChannelMetricSnapshot.create({ data: { channelId, metricsJson: { subscribers: { value: c.subscriberCount, unit: 'COUNT', sourceMetric: 'statistics.subscriberCount', source: 'DATA_API' }, videos: { value: c.videoCount, unit: 'COUNT', sourceMetric: 'statistics.videoCount', source: 'DATA_API' }, views: { value: c.viewCount, unit: 'COUNT', sourceMetric: 'statistics.viewCount', source: 'DATA_API' } } as Prisma.InputJsonValue, metricSetVersion: YT_METRIC_SET_VERSION, source: 'DATA_API' } });
  });
}

/** ขั้น 2–3: วิดีโอผ่าน uploads playlist (§22) — maxVideos จำกัด quota; incremental: หยุดเมื่อพบวิดีโอที่มีอยู่แล้วและไม่ใช่ full */
export async function syncVideos(d: YtDeps, channelId: string, opts: { maxVideos?: number; full?: boolean } = {}): Promise<{ imported: number; updated: number; scanned: number }> {
  const { auth, channel } = await channelAuth(d, channelId);
  if (!channel.uploadsPlaylistId) await syncChannelSnapshot(d, channelId);
  const uploads = (await d.prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channelId }, select: { uploadsPlaylistId: true } })).uploadsPlaylistId;
  if (!uploads) throw new YouTubeApiError('ช่องไม่มี uploads playlist', 'notFound', 404);
  const max = opts.maxVideos ?? 30;
  return run(d, channelId, opts.full ? 'HISTORY' : 'VIDEOS', async update => {
    let imported = 0; let updated = 0; let scanned = 0; let pageToken: string | undefined; let stop = false;
    await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { syncStatus: 'SYNCING' } });
    do {
      const page = await d.yt.listUploadIds(auth, uploads, pageToken);
      await update({ totalExpected: page.totalResults ?? undefined, cursorState: { pageToken } });
      const ids = page.items.map(i => i.videoId).slice(0, max - scanned);
      if (!ids.length) break;
      const existing = new Set((await d.prisma.youTubeVideo.findMany({ where: { channelId, youtubeVideoId: { in: ids } }, select: { youtubeVideoId: true } })).map(v => v.youtubeVideoId));
      const videos = await d.yt.getVideos(auth, ids);
      const capturedAt = new Date();
      for (const v of videos) {
        const videoType = classifyVideoType(v);
        const data = { title: v.title, description: v.description, publishedAt: v.publishedAt ? new Date(v.publishedAt) : null, scheduledPublishAt: v.scheduledPublishAt ? new Date(v.scheduledPublishAt) : null, privacyStatus: v.privacyStatus, uploadStatus: v.uploadStatus, durationSeconds: v.durationSeconds, categoryId: v.categoryId, defaultLanguage: v.defaultLanguage, defaultAudioLanguage: v.defaultAudioLanguage, tags: v.tags, thumbnailUrl: v.thumbnailUrl, madeForKids: v.madeForKids, liveBroadcastContent: v.liveBroadcastContent, videoType, classifierVersion: VIDEO_CLASSIFIER_VERSION, availability: 'AVAILABLE', commentsDisabled: v.commentsDisabled, viewCount: v.viewCount === null ? null : BigInt(v.viewCount), likeCount: v.likeCount, commentCount: v.commentCount, rawData: v.raw as Prisma.InputJsonValue, lastSyncedAt: capturedAt };
        const row = existing.has(v.id)
          ? await d.prisma.youTubeVideo.update({ where: { channelId_youtubeVideoId: { channelId, youtubeVideoId: v.id } }, data, select: { id: true } })
          : await d.prisma.youTubeVideo.create({ data: { channelId, youtubeVideoId: v.id, ...data }, select: { id: true } });
        if (existing.has(v.id)) updated++; else imported++;
        await d.prisma.youTubeVideoMetricSnapshot.create({ data: { videoId: row.id, metricsJson: toYtSnapshot(fromDataApiStats(v, capturedAt)) as Prisma.InputJsonValue, metricSetVersion: YT_METRIC_SET_VERSION, source: 'DATA_API', window: v.publishedAt ? ageWindow(new Date(v.publishedAt), capturedAt) : 'LIFETIME' } });
      }
      // วิดีโอที่หายจากรายการ (ลบ/ส่วนตัว) → ทำเครื่องหมาย ไม่ลบ (§127)
      const missing = ids.filter(id => !videos.some(v => v.id === id));
      if (missing.length) await d.prisma.youTubeVideo.updateMany({ where: { channelId, youtubeVideoId: { in: missing } }, data: { availability: 'UNAVAILABLE' } });
      scanned += ids.length; await update({ processed: scanned });
      if (!opts.full && ids.every(id => existing.has(id)) && scanned >= 10) stop = true;   // incremental: ถึงส่วนที่มีแล้ว
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && scanned < max && !stop);
    await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { syncStatus: 'OK', lastSyncedAt: new Date(), syncError: null } });
    return { imported, updated, scanned };
  }).catch(async e => { await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { syncStatus: e instanceof ChannelNotAccessible ? 'NO_ACCESS' : 'ERROR', syncError: (e instanceof YouTubeApiError ? e.userMessage : (e as Error).message).slice(0, 500) } }); throw e; });
}

/** ขั้น 4: Analytics backfill (OAuth เท่านั้น) — ต่อวิดีโอ (dimensions=video) + สรุปช่อง */
export async function syncAnalytics(d: YtDeps, channelId: string, opts: { days?: number } = {}): Promise<{ videos: number; channel: boolean; unavailable: string[] } | { skipped: string }> {
  let a: Awaited<ReturnType<typeof channelAuth>>;
  try { a = await channelAuth(d, channelId, { requireOAuth: true }); } catch (e) { if (e instanceof ChannelNotAccessible) { await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { analyticsStatus: 'NO_ACCESS' } }); return { skipped: e.message }; } throw e; }
  const days = opts.days ?? 28; const end = new Date(); const start = new Date(end.getTime() - days * 86_400_000);
  const range = { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  return run(d, channelId, 'ANALYTICS', async update => {
    try {
      const summary = await d.analytics.channelSummary(a.auth, range);
      await d.prisma.youTubeChannelMetricSnapshot.create({ data: { channelId, rangeStart: start, rangeEnd: end, metricsJson: toYtSnapshot(summary.metrics) as Prisma.InputJsonValue, metricSetVersion: YT_METRIC_SET_VERSION, source: 'ANALYTICS_API' } });
      const vids = await d.prisma.youTubeVideo.findMany({ where: { channelId, availability: 'AVAILABLE' }, orderBy: { publishedAt: 'desc' }, take: 200, select: { id: true, youtubeVideoId: true, publishedAt: true } });
      await update({ totalExpected: vids.length });
      const cmp = await d.analytics.videoComparison(a.auth, vids.map(v => v.youtubeVideoId), range);
      let n = 0; const capturedAt = new Date();
      for (const v of vids) {
        const ms = cmp[v.youtubeVideoId]; if (!ms) continue;
        await d.prisma.youTubeVideoMetricSnapshot.create({ data: { videoId: v.id, metricsJson: toYtSnapshot(ms) as Prisma.InputJsonValue, metricSetVersion: YT_METRIC_SET_VERSION, source: 'ANALYTICS_API', window: 'RANGE', dateRangeStart: start, dateRangeEnd: end, capturedAt } });
        n++;
      }
      await update({ processed: n });
      await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { analyticsStatus: 'OK' } });
      return { videos: n, channel: true, unavailable: summary.unavailable };
    } catch (e) {
      if (e instanceof YouTubeApiError && (e.code === 'insufficientPermissions' || e.code === 'forbidden')) { await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { analyticsStatus: 'NO_ACCESS' } }); return { skipped: 'ไม่มีสิทธิ์ Analytics — เชื่อมต่อใหม่พร้อม scope yt-analytics.readonly' }; }
      await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { analyticsStatus: 'ERROR' } });
      throw e;
    }
  });
}

/** เก็บ metric ของวิดีโอเดียว ณ checkpoint (§94) — Data API เสมอ + Analytics เมื่อมี OAuth */
export async function collectVideoMetrics(d: YtDeps, videoId: string, window?: string): Promise<{ ok: boolean }> {
  const v = await d.prisma.youTubeVideo.findUnique({ where: { id: videoId }, select: { id: true, channelId: true, youtubeVideoId: true, publishedAt: true } });
  if (!v) return { ok: false };
  const { auth } = await channelAuth(d, v.channelId);
  const [dto] = await d.yt.getVideos(auth, [v.youtubeVideoId]);
  if (!dto) { await d.prisma.youTubeVideo.update({ where: { id: v.id }, data: { availability: 'UNAVAILABLE' } }); return { ok: false }; }
  const capturedAt = new Date(); const win = window ?? (v.publishedAt ? ageWindow(v.publishedAt, capturedAt) : 'LIFETIME');
  await d.prisma.youTubeVideo.update({ where: { id: v.id }, data: { viewCount: dto.viewCount === null ? null : BigInt(dto.viewCount), likeCount: dto.likeCount, commentCount: dto.commentCount, lastSyncedAt: capturedAt } });
  await d.prisma.youTubeVideoMetricSnapshot.create({ data: { videoId: v.id, metricsJson: toYtSnapshot(fromDataApiStats(dto, capturedAt)) as Prisma.InputJsonValue, metricSetVersion: YT_METRIC_SET_VERSION, source: 'DATA_API', window: win, capturedAt } });
  if (auth.kind === 'oauth' && v.publishedAt) {
    try { const ms = await d.analytics.videoAnalytics(auth, v.youtubeVideoId, { start: v.publishedAt.toISOString().slice(0, 10), end: capturedAt.toISOString().slice(0, 10) }); await d.prisma.youTubeVideoMetricSnapshot.create({ data: { videoId: v.id, metricsJson: toYtSnapshot(ms) as Prisma.InputJsonValue, metricSetVersion: YT_METRIC_SET_VERSION, source: 'ANALYTICS_API', window: win, dateRangeStart: v.publishedAt, dateRangeEnd: capturedAt, capturedAt } }); } catch { /* analytics อาจยังไม่พร้อม (§94 lag) */ }
  }
  return { ok: true };
}

/** ขั้น 5: คอมเมนต์ (§47–48) — comments disabled → ทำเครื่องหมายเฉพาะวิดีโอ ไม่ถือเป็น sync failure (§128) */
export async function syncComments(d: YtDeps, channelId: string, opts: { videoIds?: string[]; maxVideos?: number } = {}): Promise<{ videos: number; imported: number; updated: number; disabled: number }> {
  const { auth } = await channelAuth(d, channelId);
  const vids = await d.prisma.youTubeVideo.findMany({ where: { channelId, availability: 'AVAILABLE', ...(opts.videoIds && { id: { in: opts.videoIds } }) }, orderBy: { publishedAt: 'desc' }, take: opts.maxVideos ?? 20, select: { id: true, youtubeVideoId: true } });
  return run(d, channelId, 'COMMENTS', async update => {
    let imported = 0; let updated = 0; let disabled = 0;
    await update({ totalExpected: vids.length });
    for (const [i, v] of vids.entries()) {
      let pageToken: string | undefined;
      try {
        do {
          const page = await d.yt.listCommentThreads(auth, v.youtubeVideoId, pageToken);
          for (const t of page.items) {
            const all = [t, ...(t.totalReplyCount > t.replies.length ? await d.yt.listReplies(auth, t.id) : t.replies)];
            for (const c of all) {
              const data = { videoId: v.id, parentCommentId: c.parentId, authorChannelId: c.authorChannelId, authorDisplayName: c.authorDisplayName, text: c.text, likeCount: c.likeCount, publishedAt: new Date(c.publishedAt), updatedAt: c.updatedAt ? new Date(c.updatedAt) : null, isReply: !!c.parentId, rawData: c.raw as Prisma.InputJsonValue, lastSyncedAt: new Date() };
              const ex = await d.prisma.youTubeComment.findUnique({ where: { channelId_youtubeCommentId: { channelId, youtubeCommentId: c.id } }, select: { id: true } });
              if (ex) { await d.prisma.youTubeComment.update({ where: { id: ex.id }, data }); updated++; } else { await d.prisma.youTubeComment.create({ data: { channelId, youtubeCommentId: c.id, ...data } }); imported++; }
            }
          }
          pageToken = page.nextPageToken ?? undefined;
        } while (pageToken);
        await d.prisma.youTubeVideo.update({ where: { id: v.id }, data: { commentsDisabled: false } });
      } catch (e) {
        if (e instanceof YouTubeApiError && e.code === 'commentsDisabled') { disabled++; await d.prisma.youTubeVideo.update({ where: { id: v.id }, data: { commentsDisabled: true } }); }
        else throw e;
      }
      await update({ processed: i + 1 });
    }
    await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { commentsStatus: 'OK' } });
    return { videos: vids.length, imported, updated, disabled };
  }).catch(async e => { if (e instanceof YouTubeApiError && (e.code === 'insufficientPermissions' || e.code === 'forbidden')) await d.prisma.youTubeChannel.update({ where: { id: channelId }, data: { commentsStatus: 'NO_ACCESS' } }); throw e; });
}

export async function syncPlaylists(d: YtDeps, channelId: string): Promise<{ playlists: number }> {
  const { auth, channel } = await channelAuth(d, channelId);
  return run(d, channelId, 'PLAYLISTS', async () => {
    const lists = await d.yt.listPlaylists(auth, auth.kind === 'oauth' && channel.accessMode === 'OAUTH' ? 'mine' : channel.youtubeChannelId);
    for (const p of lists) {
      const row = await d.prisma.youTubePlaylist.upsert({ where: { channelId_youtubePlaylistId: { channelId, youtubePlaylistId: p.id } }, create: { channelId, youtubePlaylistId: p.id, title: p.title, description: p.description, privacyStatus: p.privacyStatus, itemCount: p.itemCount, rawData: p.raw as Prisma.InputJsonValue }, update: { title: p.title, description: p.description, privacyStatus: p.privacyStatus, itemCount: p.itemCount, lastSyncedAt: new Date() }, select: { id: true } });
      const ids = await d.yt.listPlaylistVideoIds(auth, p.id);
      const vids = await d.prisma.youTubeVideo.findMany({ where: { channelId, youtubeVideoId: { in: ids } }, select: { id: true, youtubeVideoId: true } });
      await d.prisma.youTubePlaylistItem.deleteMany({ where: { playlistId: row.id } });
      await d.prisma.youTubePlaylistItem.createMany({ data: vids.map(v => ({ playlistId: row.id, videoId: v.id, position: ids.indexOf(v.youtubeVideoId) })), skipDuplicates: true });
    }
    return { playlists: lists.length };
  });
}
