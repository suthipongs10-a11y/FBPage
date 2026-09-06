/** WebDeps ตัวเดียวทั้ง API (AGENTS_WEB.md §4) — ใช้ Google OAuth client เดิมของ YouTube สำหรับ Search Console */
import type { Provider } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { GoogleAuth } from '@fbpm/youtube-core';
import { SearchConsoleClient, type WebDeps } from '@fbpm/web-core';
import { ENV, type Env } from '../config/env';
import { PRISMA } from '../database/prisma.service';

export const WEB = Symbol('WEB');
export function buildWebDeps(env: Env, prisma: PrismaClient): WebDeps {
  const ytMock = env.YOUTUBE_MOCK_BASE_URL?.replace(/\/+$/, ''); const mock = env.WEB_MOCK_BASE_URL?.replace(/\/+$/, '');
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI
    ? new GoogleAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI, ...(ytMock && { authBaseUrl: `${ytMock}/auth`, tokenUrl: `${ytMock}/token`, tokenInfoUrl: `${ytMock}/tokeninfo`, revokeUrl: `${ytMock}/revoke` }) }) : null;
  return { prisma, google, authSecret: env.AUTH_SECRET, pagespeedKey: env.PAGESPEED_API_KEY, pagespeedBaseUrl: mock ? `${mock}/pagespeed` : undefined, searchConsole: new SearchConsoleClient({ baseUrl: mock ? `${mock}/webmasters/v3` : undefined }), check: { allowPrivate: env.WEB_ALLOW_PRIVATE_TARGETS, timeoutMs: 15_000 }, linkDelayMs: mock ? 0 : 1000 };
}
export const webProvider: Provider = { provide: WEB, inject: [ENV, PRISMA], useFactory: buildWebDeps };
