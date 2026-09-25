/** YtDeps ตัวเดียวทั้ง API (§18–21) — quota บันทึกลง YouTubeApiUsage ทุกคำขอ */
import type { Provider } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { GoogleAuth, YouTubeAnalyticsService, YouTubeClient, YouTubeService, type YtDeps } from '@fbpm/youtube-core';
import { ENV, type Env } from '../config/env';
import { PRISMA } from '../database/prisma.service';

export const YT = Symbol('YT');
/** ผู้บันทึก quota ผูกกับ workspace/channel ปัจจุบันผ่าน AsyncLocalStorage แบบง่าย (ค่าเริ่มต้น = ไม่รู้ workspace → เก็บใน 'platform') */
export class QuotaLedger {
  constructor(private readonly prisma: PrismaClient) {}
  private ctx: { workspaceId: string; channelId?: string; requestId?: string } | null = null;
  scope<T>(ctx: { workspaceId: string; channelId?: string; requestId?: string }, fn: () => Promise<T>): Promise<T> { const prev = this.ctx; this.ctx = ctx; return fn().finally(() => { this.ctx = prev; }); }
  async record(r: { api: string; method: string; units: number; success: boolean }): Promise<void> {
    if (!this.ctx) return;
    await this.prisma.youTubeApiUsage.create({ data: { workspaceId: this.ctx.workspaceId, channelId: this.ctx.channelId ?? null, api: r.api, method: r.method, quotaUnitsEstimated: r.units, success: r.success, requestId: this.ctx.requestId ?? null } }).catch(() => undefined);
  }
}
export const QUOTA = Symbol('QUOTA');
export const quotaProvider: Provider = { provide: QUOTA, inject: [PRISMA], useFactory: (prisma: PrismaClient) => new QuotaLedger(prisma) };

export function buildYtDeps(env: Env, prisma: PrismaClient, quota: QuotaLedger): YtDeps {
  const mock = env.YOUTUBE_MOCK_BASE_URL?.replace(/\/+$/, '');
  const client = new YouTubeClient({ ...(mock && { dataBaseUrl: `${mock}/youtube/v3`, analyticsBaseUrl: `${mock}/analytics`, uploadBaseUrl: `${mock}/upload` }), quota });
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI
    ? new GoogleAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI, ...(mock && { authBaseUrl: `${mock}/auth`, tokenUrl: `${mock}/token`, tokenInfoUrl: `${mock}/tokeninfo`, revokeUrl: `${mock}/revoke` }) }) : null;
  return { prisma, yt: new YouTubeService(client), analytics: new YouTubeAnalyticsService(client), google, authSecret: env.AUTH_SECRET, apiKey: env.YOUTUBE_API_KEY, uploadEnabled: env.YOUTUBE_UPLOAD_ENABLED, mediaDir: env.MEDIA_DIR };
}
export const ytProvider: Provider = { provide: YT, inject: [ENV, PRISMA, QUOTA], useFactory: buildYtDeps };
