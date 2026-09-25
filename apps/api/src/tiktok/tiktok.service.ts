import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient, decryptSecret, type WorkspaceRole } from '@fbpm/database';
import { BASE_SCOPES, TikTokError, accountScope, analyzeMetrics, encryptedTokens, syncAccount, type TikTokDeps } from '@fbpm/tiktok-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { effectivePermissions } from '../workspaces/permissions';
import { TT } from './tiktok.provider';
import type { z } from 'zod';
import type { connectSchema } from './dto';

const safeAccount = { id: true, brandId: true, displayName: true, username: true, avatarUrl: true, followers: true, following: true, likes: true, videoCount: true, scopes: true, status: true, uploadsPaused: true, lastSyncedAt: true, lastError: true, tokenExpiresAt: true, brand: { select: { name: true } } } as const;
export const hashState = (v: string) => createHash('sha256').update(v).digest('hex');
export function rethrowTikTok(e: unknown): never { if (e instanceof TikTokError) throw new HttpException({ message: e.message, code: e.code }, e.status); throw e; }

@Injectable()
export class TikTokService {
  constructor(@Inject(PRISMA) readonly db: PrismaClient, @Inject(TT) readonly deps: TikTokDeps, @Inject(ENV) readonly env: Env, @Inject(AuditService) readonly audit: AuditService) {}
  health() { return { configured: this.deps.client.configured, publishingEnabled: this.deps.publishingEnabled, mediaConfigured: this.deps.mediaPrefixes.length > 0, mode: this.env.APP_ENV === 'test' && this.env.TIKTOK_MOCK_BASE_URL ? 'MOCK' : 'OFFICIAL_API', realApiVerified: false }; }
  list(ws: string) { return this.db.tikTokAccount.findMany({ where: accountScope(ws), select: safeAccount, orderBy: { createdAt: 'desc' } }); }
  async get(ws: string, id: string) { const a = await this.db.tikTokAccount.findFirst({ where: { id, ...accountScope(ws) }, select: safeAccount }); if (!a) throw new NotFoundException('ไม่พบบัญชี TikTok'); return a; }
  async connect(ws: string, uid: string, sessionId: string, b: z.infer<typeof connectSchema>) {
    if (!await this.db.brand.findFirst({ where: { id: b.brandId, client: { workspaceId: ws } } })) throw new NotFoundException('ไม่พบแบรนด์');
    const state = randomBytes(32).toString('base64url');
    const scopes = [...BASE_SCOPES, ...(b.profile ? ['user.info.profile'] : []), ...(b.stats ? ['user.info.stats'] : []), ...(b.upload ? ['video.upload'] : [])];
    let url: string; try { url = this.deps.client.authUrl(state, scopes); } catch (e) { rethrowTikTok(e); }
    await this.db.tikTokOAuthState.create({ data: { hash: hashState(state), sessionId, userId: uid, workspaceId: ws, brandId: b.brandId, expiresAt: new Date(Date.now() + 600_000) } });
    return { url, scopes };
  }
  async callback(uid: string, sessionId: string, code?: string, state?: string, error?: string) {
    const back = (s: string) => `${this.env.APP_URL}/tiktok?connection=${s}`;
    if (!state || state.length > 200) return back('invalid_state');
    const s = await this.db.tikTokOAuthState.findUnique({ where: { hash: hashState(state) } });
    if (!s || s.userId !== uid || s.sessionId !== sessionId || s.consumedAt || s.expiresAt.getTime() <= Date.now()) return back('invalid_state');
    const m = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: s.workspaceId, userId: uid } }, include: { workspace: true } });
    if (!m || m.workspace.status !== 'ACTIVE' || !effectivePermissions(m.role as WorkspaceRole, m.permissions).includes('tiktok.connect')) return back('permission_denied');
    if (!await this.db.brand.findFirst({ where: { id: s.brandId, client: { workspaceId: s.workspaceId } } })) return back('invalid_brand');
    const consumed = await this.db.tikTokOAuthState.updateMany({ where: { hash: s.hash, consumedAt: null }, data: { consumedAt: new Date() } });
    if (!consumed.count) return back('invalid_state');
    if (error || !code) return back('cancelled');
    try {
      const tokens = await this.deps.client.exchange(code); const scopes = tokens.scope.split(',');
      if (!scopes.includes('user.info.basic')) return back('missing_scope');
      const p = await this.deps.client.profile(tokens.access_token, scopes);
      if (p.open_id !== tokens.open_id) return back('invalid_profile');
      const prior = await this.db.tikTokAccount.findUnique({ where: { workspaceId_openId: { workspaceId: s.workspaceId, openId: tokens.open_id } } });
      if (prior && prior.brandId !== s.brandId) return back('already_assigned');
      const data = { ...encryptedTokens(tokens, this.env.AUTH_SECRET), displayName: p.display_name ?? '', username: p.username ?? null, avatarUrl: p.avatar_url, followers: p.follower_count, following: p.following_count, likes: p.likes_count, videoCount: p.video_count, status: 'ACTIVE', lastError: null };
      const a = await this.db.tikTokAccount.upsert({ where: { workspaceId_openId: { workspaceId: s.workspaceId, openId: tokens.open_id } }, create: { workspaceId: s.workspaceId, brandId: s.brandId, openId: tokens.open_id, ...data }, update: data });
      await this.audit.log({ workspaceId: s.workspaceId, userId: uid, action: 'tiktok.connected', resourceType: 'tiktokAccount', resourceId: a.id, requestId: `oauth-${s.hash.slice(0, 12)}`, after: { scopes } });
      return back('connected');
    } catch { return back('failed'); }
  }
  async disconnect(ws: string, uid: string, id: string, rid: string) {
    await this.get(ws, id);
    let revokeStatus = 'REVOKED';
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
      const a = await tx.tikTokAccount.findFirstOrThrow({ where: { id, ...accountScope(ws) } });
      if (a.accessTokenEncrypted) try { await this.deps.client.revoke(decryptSecret(a.accessTokenEncrypted, this.env.AUTH_SECRET)); } catch { revokeStatus = 'LOCAL_DISCONNECT_ONLY'; }
      await tx.tikTokAccount.update({ where: { id }, data: { status: 'DISCONNECTED', accessTokenEncrypted: '', refreshTokenEncrypted: '', uploadsPaused: true } });
      await tx.contentItem.updateMany({ where: { tiktokAccountId: id, status: { in: ['APPROVED', 'SCHEDULED', 'READY_FOR_APPROVAL'] } }, data: { status: 'CANCELLED', scheduledAt: null } });
    }, { timeout: 25_000 });
    await this.audit.log({ workspaceId: ws, userId: uid, action: 'tiktok.disconnected', resourceType: 'tiktokAccount', resourceId: id, requestId: rid, after: { revokeStatus } });
    return { status: 'DISCONNECTED', revokeStatus };
  }
  async pause(ws: string, uid: string, id: string, paused: boolean, rid: string) {
    await this.get(ws, id);
    await this.db.tikTokAccount.update({ where: { id }, data: { uploadsPaused: paused } });
    await this.audit.log({ workspaceId: ws, userId: uid, action: 'tiktok.pause', resourceType: 'tiktokAccount', resourceId: id, requestId: rid, after: { paused } });
    return this.get(ws, id);
  }
  async sync(ws: string, uid: string, id: string, rid: string) {
    const a = await this.get(ws, id);
    if (a.lastSyncedAt && Date.now() - a.lastSyncedAt.getTime() < 60_000) throw new ConflictException('เพิ่งซิงก์ข้อมูล กรุณารอหนึ่งนาที');
    try { const result = await syncAccount(this.deps, ws, id); await this.audit.log({ workspaceId: ws, userId: uid, action: 'tiktok.synced', resourceType: 'tiktokAccount', resourceId: id, requestId: rid, after: result }); return result; } catch (e) { rethrowTikTok(e); }
  }
  async videos(ws: string, id: string) {
    const a = await this.get(ws, id);
    if (!a.scopes.includes('video.list')) throw new ForbiddenException('ยังไม่มีสิทธิ์อ่านวิดีโอ TikTok');
    return this.db.tikTokVideo.findMany({ where: { accountId: id, account: accountScope(ws) }, orderBy: { publishedAt: 'desc' }, take: 100, include: { snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 } } });
  }
  async analytics(ws: string, id: string) {
    const videos = await this.videos(ws, id);
    return analyzeMetrics(videos.map(v => ({ id: v.id, title: v.title, publishedAt: v.publishedAt, capturedAt: v.snapshots[0]?.capturedAt ?? null, views: v.snapshots[0]?.views ?? null, likes: v.snapshots[0]?.likes ?? null, comments: v.snapshots[0]?.comments ?? null, shares: v.snapshots[0]?.shares ?? null })));
  }
}
