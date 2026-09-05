/** YT-1 Connection (§6–11, §17, §122) + quota/health (§21, §147) */
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { brandInWorkspace, channelInWorkspace, decryptSecret, encryptSecret, signState, verifyState } from '@fbpm/database';
import { ChannelNotAccessible, YouTubeApiError, featuresFromScopes, quotaDayStart, quotaState, scopesForFeatures, syncAnalytics, syncChannelSnapshot, syncComments, syncPlaylists, syncVideos, type ScopeFeature, type YtDeps } from '@fbpm/youtube-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUOTA, QuotaLedger, YT } from './youtube.provider';
import { rethrowYt } from './errors';
import type { ConnectChannelDto, SyncDto, UpdateChannelDto } from './dto';

const CONN_SELECT = { id: true, providerUserId: true, email: true, scopes: true, status: true, tokenExpiresAt: true, lastRefreshedAt: true, lastValidatedAt: true, lastError: true, createdAt: true, user: { select: { id: true, name: true } }, _count: { select: { channels: true } } } as const;
export const CHANNEL_SELECT = {
  id: true, brandId: true, googleConnectionId: true, youtubeChannelId: true, accessMode: true, title: true, customUrl: true, description: true, country: true, defaultLanguage: true, thumbnailUrl: true, publishedAt: true, uploadsPlaylistId: true, subscriberCount: true, videoCount: true, viewCount: true, timezone: true,
  automationLevel: true, automationPaused: true, uploadsPaused: true, policy: true, connectedAt: true, lastSyncedAt: true, syncStatus: true, syncError: true, commentsStatus: true, analyticsStatus: true, status: true, disconnectedAt: true,
  brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } }, _count: { select: { videos: true, comments: true } },
} as const;
interface OAuthState { ws: string; uid: string; exp: number; n: string; f: ScopeFeature[] }
const serialize = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x))) as T;

@Injectable()
export class YtChannelsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(YT) private readonly yt: YtDeps, @Inject(QUOTA) private readonly quota: QuotaLedger, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  /** สถานะความพร้อมของโมดูล (§10, §147) */
  async health(workspaceId: string) {
    const since = quotaDayStart();
    const agg = await this.prisma.youTubeApiUsage.aggregate({ where: { workspaceId, calledAt: { gte: since } }, _sum: { quotaUnitsEstimated: true }, _count: { _all: true } });
    const failed = await this.prisma.youTubeApiUsage.count({ where: { workspaceId, calledAt: { gte: since }, success: false } });
    const conns = await this.prisma.googleConnection.groupBy({ by: ['status'], where: { workspaceId }, _count: { _all: true } });
    const q = quotaState(agg._sum.quotaUnitsEstimated ?? 0, this.env.YOUTUBE_QUOTA_SOFT_LIMIT);
    return { oauthConfigured: !!this.yt.google, apiKeyConfigured: !!this.yt.apiKey, uploadEnabled: this.yt.uploadEnabled, quota: { ...q, used: agg._sum.quotaUnitsEstimated ?? 0, calls: agg._count._all, failed, dayStart: since, softLimit: this.env.YOUTUBE_QUOTA_SOFT_LIMIT }, connections: Object.fromEntries(conns.map(c => [c.status, c._count._all])), pendingUploads: await this.prisma.youTubeUploadOperation.count({ where: { status: { in: ['PENDING', 'UPLOADING', 'PROCESSING'] }, content: { youtubeChannel: channelInWorkspace(workspaceId) } } }) };
  }

  // ---------- Google connections ----------
  listConnections(workspaceId: string) { return this.prisma.googleConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, select: CONN_SELECT }); }

  oauthStart(workspaceId: string, userId: string, features: ScopeFeature[]) {
    if (!this.yt.google) throw new ConflictException('ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI — เชื่อมแบบอ่านสาธารณะด้วย YOUTUBE_API_KEY ได้');
    const f = features.length ? features : ['read', 'analytics', 'manage', 'upload'] as ScopeFeature[];
    const state = signState({ ws: workspaceId, uid: userId, exp: Date.now() + 10 * 60_000, n: randomBytes(8).toString('hex'), f } satisfies OAuthState, this.env.AUTH_SECRET);
    return { url: this.yt.google.authUrl(state, scopesForFeatures(f)), scopes: scopesForFeatures(f) };
  }
  async oauthCallback(code: string | undefined, state: string | undefined, error: string | undefined): Promise<{ redirectTo: string }> {
    const back = (q: string) => ({ redirectTo: `${this.env.APP_URL}/youtube?${q}` });
    if (error) return back(`gError=${encodeURIComponent(error)}`);
    const st = verifyState<OAuthState>(state, this.env.AUTH_SECRET);
    if (!st || st.exp < Date.now() || !code || !this.yt.google) return back('gError=state');
    if (!(await this.prisma.workspaceMember.findFirst({ where: { workspaceId: st.ws, userId: st.uid }, select: { userId: true } }))) return back('gError=membership');
    try { const t = await this.yt.google.exchangeCode(code); const r = await this.storeTokens(st.ws, st.uid, t.accessToken, t.refreshToken, t.expiresAt, t.scopes, `oauth-${randomUUID()}`); return back(`gConnected=${r.id}`); }
    catch (e) { return back(`gError=${encodeURIComponent(e instanceof YouTubeApiError ? e.code : 'exchange')}`); }
  }
  /** ทางลัดเหมือน Facebook: วาง refresh token จาก OAuth Playground (client id/secret เดียวกับ env) */
  async pasteRefreshToken(workspaceId: string, userId: string, refreshToken: string, requestId: string) {
    if (!this.yt.google) throw new ConflictException('ต้องตั้งค่า GOOGLE_CLIENT_ID/SECRET ก่อน เพราะ refresh token ผูกกับ client');
    try { const t = await this.yt.google.refresh(refreshToken); return this.storeTokens(workspaceId, userId, t.accessToken, refreshToken, t.expiresAt, t.scopes, requestId); } catch (e) { rethrowYt(e); }
  }
  private async storeTokens(workspaceId: string, userId: string, accessToken: string, refreshToken: string | null, expiresAt: Date, scopes: string[], requestId: string) {
    const info = await this.yt.google!.tokenInfo(accessToken).catch(() => ({ sub: null, email: null, scopes: [] as string[] }));
    const providerUserId = info.sub ?? `google-${randomUUID()}`;
    const data = { userId, email: info.email, accessTokenEncrypted: encryptSecret(accessToken, this.env.AUTH_SECRET), ...(refreshToken && { refreshTokenEncrypted: encryptSecret(refreshToken, this.env.AUTH_SECRET) }), tokenExpiresAt: expiresAt, scopes: scopes.length ? scopes : info.scopes, status: 'ACTIVE', lastValidatedAt: new Date(), lastRefreshedAt: new Date(), lastError: null };
    const conn = await this.prisma.googleConnection.upsert({ where: { workspaceId_providerUserId: { workspaceId, providerUserId } }, create: { workspaceId, providerUserId, ...data }, update: data, select: CONN_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_CONNECTED', resourceType: 'googleConnection', resourceId: conn.id, after: { email: info.email, features: featuresFromScopes(conn.scopes) }, requestId });
    return conn;
  }
  /** ช่องที่ token นี้เป็นเจ้าของ (channels.list mine) */
  async discoverChannel(workspaceId: string, connectionId: string, requestId: string) {
    const conn = await this.prisma.googleConnection.findFirst({ where: { id: connectionId, workspaceId }, select: { id: true, accessTokenEncrypted: true, status: true } });
    if (!conn || conn.status !== 'ACTIVE') throw new NotFoundException('ไม่พบการเชื่อมต่อ Google ที่ใช้งานได้');
    // ใช้ channelAuth ผ่านช่องชั่วคราวไม่ได้ — ถอดรหัสตรง (refresh ทำใน connect เมื่อสร้างช่องแล้ว)
    const token = decryptSecret(conn.accessTokenEncrypted, this.env.AUTH_SECRET);
    try { const c = await this.quota.scope({ workspaceId, requestId }, () => this.yt.yt.getMyChannel({ kind: 'oauth', accessToken: token })); return c ? serialize({ id: c.id, title: c.title, customUrl: c.customUrl, thumbnailUrl: c.thumbnailUrl, subscriberCount: c.subscriberCount, videoCount: c.videoCount }) : null; }
    catch (e) { if (e instanceof YouTubeApiError && e.needsReconnect) { await this.prisma.googleConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: e.userMessage } }); } rethrowYt(e); }
  }
  async revoke(workspaceId: string, userId: string, connectionId: string, requestId: string) {
    const c = await this.prisma.googleConnection.findFirst({ where: { id: connectionId, workspaceId }, select: { id: true, accessTokenEncrypted: true, refreshTokenEncrypted: true } });
    if (!c) throw new NotFoundException('ไม่พบการเชื่อมต่อ');
    if (this.yt.google && c.refreshTokenEncrypted) await this.yt.google.revoke(decryptSecret(c.refreshTokenEncrypted, this.env.AUTH_SECRET));
    const ch = await this.prisma.youTubeChannel.updateMany({ where: { googleConnectionId: connectionId, disconnectedAt: null }, data: { status: 'DISCONNECTED', disconnectedAt: new Date(), uploadsPaused: true } });
    await this.prisma.googleConnection.update({ where: { id: connectionId }, data: { accessTokenEncrypted: '', refreshTokenEncrypted: null, status: 'REVOKED' } });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_DISCONNECTED', resourceType: 'googleConnection', resourceId: connectionId, after: { channelsDisconnected: ch.count }, requestId });
    return { ok: true, channelsDisconnected: ch.count };
  }

  // ---------- Channels ----------
  async list(workspaceId: string) { return serialize(await this.prisma.youTubeChannel.findMany({ where: channelInWorkspace(workspaceId), orderBy: [{ disconnectedAt: 'asc' }, { connectedAt: 'desc' }], select: CHANNEL_SELECT })); }
  async get(workspaceId: string, id: string) {
    const c = await this.prisma.youTubeChannel.findFirst({ where: { id, ...channelInWorkspace(workspaceId) }, select: CHANNEL_SELECT });
    if (!c) throw new NotFoundException('ไม่พบช่อง');
    const [runs, latest, connFeatures] = await Promise.all([
      this.prisma.youTubeSyncRun.findMany({ where: { channelId: id }, orderBy: { startedAt: 'desc' }, take: 8, select: { id: true, type: true, status: true, startedAt: true, completedAt: true, totalExpected: true, processed: true, errors: true, message: true } }),
      this.prisma.youTubeChannelMetricSnapshot.findFirst({ where: { channelId: id, source: 'ANALYTICS_API' }, orderBy: { capturedAt: 'desc' }, select: { metricsJson: true, rangeStart: true, rangeEnd: true, capturedAt: true } }),
      c.googleConnectionId ? this.prisma.googleConnection.findUnique({ where: { id: c.googleConnectionId }, select: { scopes: true, status: true, email: true } }) : null,
    ]);
    return serialize({ ...c, syncRuns: runs, latestAnalytics: latest, connection: connFeatures ? { ...connFeatures, features: featuresFromScopes(connFeatures.scopes) } : null, capabilities: { analytics: c.accessMode === 'OAUTH' && !!connFeatures?.scopes.some(s => s.includes('yt-analytics')), upload: c.accessMode === 'OAUTH' && !!connFeatures?.scopes.some(s => s.includes('youtube.upload')) && this.yt.uploadEnabled, uploadEnabledEnv: this.yt.uploadEnabled, manage: c.accessMode === 'OAUTH' && !!connFeatures?.scopes.some(s => s.includes('force-ssl')), publicRead: !!this.yt.apiKey || c.accessMode === 'OAUTH' } });
  }
  /** เชื่อมช่องเข้ากับแบรนด์ — OAUTH (mine) หรือ PUBLIC_API_KEY (id/@handle) แล้ว progressive sync ขั้น 1–2 ทันที (§17) */
  async connect(workspaceId: string, userId: string, dto: ConnectChannelDto, requestId: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id: dto.brandId, ...brandInWorkspace(workspaceId) }, select: { id: true } });
    if (!brand) throw new NotFoundException('ไม่พบแบรนด์');
    let ytId: string; let title = ''; let connectionId: string | null = null;
    if (dto.mode === 'OAUTH') {
      if (!dto.connectionId) throw new BadRequestException('ต้องระบุ connectionId');
      const c = await this.discoverChannel(workspaceId, dto.connectionId, requestId); if (!c) throw new UnprocessableEntityException('บัญชี Google นี้ไม่มีช่อง YouTube');
      ytId = c.id; title = c.title; connectionId = dto.connectionId;
    } else {
      if (!this.yt.apiKey) throw new ConflictException('ยังไม่ได้ตั้ง YOUTUBE_API_KEY — ใช้โหมด OAuth แทน');
      if (!dto.channelId && !dto.handle) throw new BadRequestException('ต้องระบุ channelId หรือ @handle');
      const c = await this.quota.scope({ workspaceId, requestId }, () => dto.handle ? this.yt.yt.getChannelByHandle({ kind: 'apiKey', apiKey: this.yt.apiKey! }, dto.handle!) : this.yt.yt.getChannel({ kind: 'apiKey', apiKey: this.yt.apiKey! }, dto.channelId!)).catch(rethrowYt);
      if (!c) throw new NotFoundException('ไม่พบช่องนี้บน YouTube');
      ytId = c.id; title = c.title;
    }
    const dup = await this.prisma.youTubeChannel.findFirst({ where: { youtubeChannelId: ytId, disconnectedAt: null, brandId: { not: dto.brandId }, ...channelInWorkspace(workspaceId) }, select: { brand: { select: { name: true } } } });
    if (dup) throw new ConflictException(`ช่องนี้เชื่อมกับแบรนด์ "${dup.brand.name}" อยู่แล้ว`);
    const ch = await this.prisma.youTubeChannel.upsert({ where: { brandId_youtubeChannelId: { brandId: dto.brandId, youtubeChannelId: ytId } }, create: { brandId: dto.brandId, youtubeChannelId: ytId, title, accessMode: dto.mode, googleConnectionId: connectionId, policy: { defaultPrivacy: 'private', defaultMadeForKids: false, requireSyntheticMediaReview: true, requirePaidPlacementReview: true, allowAutoUpload: false, allowAutoMetadataUpdate: false, allowAutoReply: false } }, update: { title, accessMode: dto.mode, googleConnectionId: connectionId, status: 'ACTIVE', disconnectedAt: null, uploadsPaused: false }, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_CHANNEL_CONNECTED', resourceType: 'youtubeChannel', resourceId: ch.id, after: { youtubeChannelId: ytId, title, mode: dto.mode, brandId: dto.brandId }, requestId });
    const initial = await this.runSync(workspaceId, userId, ch.id, { stage: 'quick' }, requestId).then(r => ({ ok: true as const, ...r })).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? ((e as Error & { response?: { message?: string } }).response?.message ?? e.message) : String(e) }));
    const videos = await this.runSync(workspaceId, userId, ch.id, { stage: 'videos', maxVideos: 30 }, requestId).then(r => ({ ok: true as const, ...r })).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? ((e as Error & { response?: { message?: string } }).response?.message ?? e.message) : String(e) }));
    return { ...(await this.get(workspaceId, ch.id)), initialSync: { quick: initial, videos } };
  }
  async update(workspaceId: string, userId: string, id: string, dto: UpdateChannelDto, requestId: string) {
    const before = await this.prisma.youTubeChannel.findFirst({ where: { id, ...channelInWorkspace(workspaceId) }, select: { automationLevel: true, automationPaused: true, uploadsPaused: true, policy: true } });
    if (!before) throw new NotFoundException('ไม่พบช่อง');
    const policy = dto.policy ? { ...((before.policy as object) ?? {}), ...dto.policy } : undefined;
    const c = await this.prisma.youTubeChannel.update({ where: { id }, data: { ...(dto.automationLevel && { automationLevel: dto.automationLevel }), ...(dto.automationPaused !== undefined && { automationPaused: dto.automationPaused }), ...(dto.uploadsPaused !== undefined && { uploadsPaused: dto.uploadsPaused }), ...(dto.timezone && { timezone: dto.timezone }), ...(policy && { policy: policy as Prisma.InputJsonValue }) }, select: CHANNEL_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_AUTOMATION_CHANGED', resourceType: 'youtubeChannel', resourceId: id, before: { automationLevel: before.automationLevel, automationPaused: before.automationPaused, uploadsPaused: before.uploadsPaused }, after: dto as unknown as Prisma.InputJsonValue, requestId });
    return serialize(c);
  }
  async disconnect(workspaceId: string, userId: string, id: string, requestId: string) {
    const c = await this.prisma.youTubeChannel.findFirst({ where: { id, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true } });
    if (!c) throw new NotFoundException('ไม่พบช่อง');
    await this.prisma.youTubeChannel.update({ where: { id }, data: { status: 'DISCONNECTED', disconnectedAt: new Date(), uploadsPaused: true, automationPaused: true } });
    await this.prisma.contentItem.updateMany({ where: { youtubeChannelId: id, ytStatus: { in: ['UPLOAD_PENDING', 'SCHEDULED'] } }, data: { status: 'CANCELLED', ytStatus: 'CANCELLED' } });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_DISCONNECTED', resourceType: 'youtubeChannel', resourceId: id, before: { title: c.title }, requestId });
    return { ok: true };
  }

  /** progressive sync (§17) — stage all = quick → videos → analytics(ถ้า OAuth) → comments → playlists */
  async runSync(workspaceId: string, userId: string | null, id: string, dto: SyncDto, requestId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true } });
    if (!ch) throw new NotFoundException('ไม่พบช่อง');
    const stage = dto?.stage ?? 'all'; const out: Record<string, unknown> = {};
    try {
      await this.quota.scope({ workspaceId, channelId: id, requestId }, async () => {
        if (stage === 'quick' || stage === 'all') { await syncChannelSnapshot(this.yt, id); out.quick = true; }
        if (stage === 'videos' || stage === 'all') out.videos = await syncVideos(this.yt, id, { maxVideos: dto?.maxVideos ?? 30 });
        if (stage === 'history') out.videos = await syncVideos(this.yt, id, { maxVideos: dto?.maxVideos ?? 500, full: true });
        if (stage === 'analytics' || stage === 'all') out.analytics = await syncAnalytics(this.yt, id, { days: dto?.days ?? 28 });
        if (stage === 'comments' || stage === 'all') out.comments = await syncComments(this.yt, id, { maxVideos: 20 }).catch(e => { if (e instanceof YouTubeApiError && (e.code === 'forbidden' || e.code === 'insufficientPermissions')) return { skipped: e.userMessage }; throw e; });
        if (stage === 'playlists' || stage === 'all') out.playlists = await syncPlaylists(this.yt, id).catch(e => ({ skipped: e instanceof YouTubeApiError ? e.userMessage : String(e) }));
      });
    } catch (e) {
      await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_SYNC_FAILED', resourceType: 'youtubeChannel', resourceId: id, after: { stage, error: e instanceof Error ? e.message : String(e) }, requestId });
      if (e instanceof ChannelNotAccessible && e.reason === 'RECONNECT') await this.notifications.notify(workspaceId, { type: 'reconnect_required', severity: 'bad', title: `ช่อง YouTube ${ch.title} ต้องเชื่อมต่อ Google ใหม่`, body: e.message, href: '/youtube', dedupeKey: `yt-reconnect:${id}` });
      if (e instanceof YouTubeApiError && e.code === 'quotaExceeded') await this.notifications.notify(workspaceId, { type: 'info', severity: 'warn', title: 'โควตา YouTube API หมดวันนี้', body: e.userMessage, href: '/youtube', dedupeKey: `yt-quota:${quotaDayStart().toISOString().slice(0, 10)}` });
      rethrowYt(e);
    }
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_SYNC_COMPLETED', resourceType: 'youtubeChannel', resourceId: id, after: serialize(out) as Prisma.InputJsonValue, requestId });
    return serialize(out);
  }

  async quotaUsage(workspaceId: string) {
    const since = quotaDayStart();
    const rows = await this.prisma.youTubeApiUsage.groupBy({ by: ['method'], where: { workspaceId, calledAt: { gte: since } }, _sum: { quotaUnitsEstimated: true }, _count: { _all: true } });
    const used = rows.reduce((n, r) => n + (r._sum.quotaUnitsEstimated ?? 0), 0);
    return { ...quotaState(used, this.env.YOUTUBE_QUOTA_SOFT_LIMIT), used, dayStart: since, byMethod: rows.map(r => ({ method: r.method, calls: r._count._all, units: r._sum.quotaUnitsEstimated ?? 0 })).sort((a, b) => b.units - a.units) };
  }
}
