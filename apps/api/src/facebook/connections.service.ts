import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@fbpm/database';
import { pageInWorkspace } from '@fbpm/database';
import type { FacebookPageSummary, FacebookService } from '@fbpm/facebook-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret, signState, verifyState } from '../common/crypto';
import { FACEBOOK } from './facebook.provider';
import { rethrowGraph } from './graph-errors';

/** สิทธิ์ที่ขอตอน OAuth — Meta ให้เท่าที่แอปผ่านรีวิว ที่เหลือระบบจะรายงานว่า "อ่านไม่ได้" ไม่ใช่ 0 (ADR-001) */
export const OAUTH_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_manage_posts', 'pages_read_user_content', 'pages_manage_engagement', 'read_insights'];

const CONN_SELECT = {
  id: true, providerUserId: true, providerUserName: true, scopes: true, status: true, tokenExpiresAt: true, lastValidatedAt: true, createdAt: true,
  user: { select: { id: true, name: true } }, _count: { select: { pages: true } },
} as const;

export interface AvailablePage { id: string; name: string; category: string | null; tasks: string[]; pictureUrl: string | null; connected: { pageId: string; brandId: string; brandName: string } | null }
interface OAuthState { ws: string; uid: string; exp: number; n: string }

/** การเชื่อมบัญชี Facebook ของผู้ใช้กับ workspace (§11) — user token ถูกเข้ารหัสและไม่เคยออกจากเซิร์ฟเวอร์ */
@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(FACEBOOK) private readonly fb: FacebookService,
    @Inject(ENV) private readonly env: Env,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(workspaceId: string) {
    return this.prisma.facebookConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, select: CONN_SELECT });
  }

  /** เชื่อมด้วย user token ที่วางมาโดยตรง (ทางลัดที่ใช้รับงานได้ทันที ไม่ต้องมีแอป Meta) */
  async connectWithToken(workspaceId: string, userId: string, accessToken: string, requestId: string) {
    const info = await this.fb.inspectUserToken(accessToken).catch(rethrowGraph);
    const enc = encryptSecret(accessToken, this.env.AUTH_SECRET);
    const now = new Date();
    const data = { userId, providerUserName: info.user.name, encryptedAccessToken: enc, tokenExpiresAt: info.expiresAt, scopes: info.grantedScopes, status: 'ACTIVE', lastValidatedAt: now };
    const conn = await this.prisma.facebookConnection.upsert({
      where: { workspaceId_providerUserId: { workspaceId, providerUserId: info.user.id } },
      create: { workspaceId, providerUserId: info.user.id, ...data },
      update: data,
      select: CONN_SELECT,
    });
    const pages = await this.fetchPages(workspaceId, conn.id, accessToken);
    await this.audit.log({ workspaceId, userId, action: 'facebook.connection.create', resourceType: 'facebookConnection', resourceId: conn.id, after: { providerUserId: info.user.id, scopes: info.grantedScopes, tokenExpiresAt: info.expiresAt, pagesVisible: pages.length }, requestId });
    return { connection: conn, pages };
  }

  async availablePages(workspaceId: string, connectionId: string): Promise<AvailablePage[]> {
    const token = await this.userToken(workspaceId, connectionId);
    return this.fetchPages(workspaceId, connectionId, token);
  }

  /** user token ที่ถอดรหัสแล้ว — ใช้ภายในเท่านั้น */
  async userToken(workspaceId: string, connectionId: string): Promise<string> {
    const c = await this.prisma.facebookConnection.findFirst({ where: { id: connectionId, workspaceId }, select: { encryptedAccessToken: true, status: true } });
    if (!c) throw new NotFoundException('ไม่พบการเชื่อมต่อ Facebook');
    if (c.status !== 'ACTIVE' || !c.encryptedAccessToken) throw new UnprocessableEntityException('การเชื่อมต่อนี้ถูกยกเลิกแล้ว — เชื่อมต่อใหม่');
    return decryptSecret(c.encryptedAccessToken, this.env.AUTH_SECRET);
  }

  /** ยกเลิกการเชื่อมต่อ: ลบ token ทิ้ง (เขียนทับ) + ตัดเพจทุกเพจใต้การเชื่อมต่อนี้ */
  async revoke(workspaceId: string, userId: string, connectionId: string, requestId: string) {
    const c = await this.prisma.facebookConnection.findFirst({ where: { id: connectionId, workspaceId }, select: { id: true, providerUserId: true } });
    if (!c) throw new NotFoundException('ไม่พบการเชื่อมต่อ Facebook');
    const pages = await this.prisma.facebookPage.updateMany({ where: { connectionId, disconnectedAt: null }, data: { pageAccessTokenEncrypted: '', tokenStatus: 'DISCONNECTED', disconnectedAt: new Date() } });
    await this.prisma.facebookConnection.update({ where: { id: connectionId }, data: { encryptedAccessToken: '', status: 'REVOKED' } });
    await this.audit.log({ workspaceId, userId, action: 'facebook.connection.revoke', resourceType: 'facebookConnection', resourceId: connectionId, before: { providerUserId: c.providerUserId }, after: { pagesDisconnected: pages.count }, requestId });
    return { ok: true, pagesDisconnected: pages.count };
  }

  // ---------- OAuth (ใช้ได้เมื่อมี META_APP_ID/SECRET) ----------
  private get oauthConfigured(): boolean { return !!(this.env.META_APP_ID && this.env.META_APP_SECRET && this.env.META_OAUTH_REDIRECT_URI); }

  oauthStartUrl(workspaceId: string, userId: string): { url: string } {
    if (!this.oauthConfigured) throw new ConflictException('ยังไม่ได้ตั้งค่า META_APP_ID / META_APP_SECRET / META_OAUTH_REDIRECT_URI — ใช้วิธีวาง token แทนได้');
    const state = signState({ ws: workspaceId, uid: userId, exp: Date.now() + 10 * 60_000, n: randomBytes(8).toString('hex') } satisfies OAuthState, this.env.AUTH_SECRET);
    const u = new URL(`https://www.facebook.com/${this.env.META_GRAPH_API_VERSION}/dialog/oauth`);
    u.searchParams.set('client_id', this.env.META_APP_ID!);
    u.searchParams.set('redirect_uri', this.env.META_OAUTH_REDIRECT_URI!);
    u.searchParams.set('state', state);
    u.searchParams.set('scope', OAUTH_SCOPES.join(','));
    u.searchParams.set('response_type', 'code');
    return { url: u.toString() };
  }

  /** callback จาก Meta: ตรวจ state → แลก code เป็น token ยาว → บันทึกเป็น connection → redirect กลับหน้าเว็บ */
  async oauthCallback(code: string | undefined, state: string | undefined, providerError: string | undefined): Promise<{ redirectTo: string }> {
    const back = (q: string) => ({ redirectTo: `${this.env.APP_URL}/pages?${q}` });
    if (providerError) return back(`fbError=${encodeURIComponent(providerError)}`);
    const st = verifyState<OAuthState>(state, this.env.AUTH_SECRET);
    if (!st || st.exp < Date.now() || !code) return back('fbError=state');
    if (!this.oauthConfigured) return back('fbError=not_configured');
    const member = await this.prisma.workspaceMember.findFirst({ where: { workspaceId: st.ws, userId: st.uid }, select: { userId: true } });
    if (!member) return back('fbError=membership');
    try {
      const base = { client_id: this.env.META_APP_ID, client_secret: this.env.META_APP_SECRET };
      const short = await this.fb.graph.call<{ access_token: string }>('oauth/access_token', { token: '', params: { ...base, redirect_uri: this.env.META_OAUTH_REDIRECT_URI, code } });
      const long = await this.fb.graph.call<{ access_token: string }>('oauth/access_token', { token: '', params: { ...base, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token } });
      const r = await this.connectWithToken(st.ws, st.uid, long.access_token, `oauth-${randomUUID()}`);
      return back(`connected=${r.connection.id}`);
    } catch {
      return back('fbError=exchange');
    }
  }

  /** me/accounts → ตัด access_token ออก, ระบุว่าเพจไหนเชื่อมแล้ว, และต่ออายุ page token ของเพจที่เชื่อมอยู่ (กรณีผู้ใช้วาง token ใหม่) */
  private async fetchPages(workspaceId: string, connectionId: string, userToken: string): Promise<AvailablePage[]> {
    const raw: FacebookPageSummary[] = await this.fb.listPages(userToken).catch(rethrowGraph);
    const existing = await this.prisma.facebookPage.findMany({
      where: { facebookPageId: { in: raw.map(p => p.id) }, disconnectedAt: null, ...pageInWorkspace(workspaceId) },
      select: { id: true, facebookPageId: true, connectionId: true, brand: { select: { id: true, name: true } } },
    });
    for (const e of existing) {
      const p = raw.find(x => x.id === e.facebookPageId);
      if (p && e.connectionId === connectionId) {
        await this.prisma.facebookPage.update({ where: { id: e.id }, data: { pageAccessTokenEncrypted: encryptSecret(p.accessToken, this.env.AUTH_SECRET), tasks: p.tasks, tokenStatus: 'VALID', lastValidatedAt: new Date(), name: p.name, pictureUrl: p.pictureUrl } });
      }
    }
    return raw.map(p => {
      const e = existing.find(x => x.facebookPageId === p.id);
      return { id: p.id, name: p.name, category: p.category, tasks: p.tasks, pictureUrl: p.pictureUrl, connected: e ? { pageId: e.id, brandId: e.brand.id, brandName: e.brand.name } : null };
    });
  }
}
