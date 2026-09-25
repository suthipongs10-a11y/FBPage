import { TikTokClient, type TikTokDeps } from '@fbpm/tiktok-core';
import type { PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
export const TT = Symbol('TIKTOK');
export const tiktokProvider = { provide: TT, inject: [PRISMA, ENV], useFactory: (prisma: PrismaClient, env: Env): TikTokDeps => ({ prisma, secret: env.AUTH_SECRET, publishingEnabled: env.SOCIAL_PUBLISHING_ENABLED, mediaPrefixes: env.TIKTOK_VERIFIED_MEDIA_PREFIXES.split(',').map(s => s.trim()).filter(Boolean), client: new TikTokClient({ clientKey: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET, redirectUri: env.TIKTOK_REDIRECT_URI, mockBaseUrl: env.TIKTOK_MOCK_BASE_URL, testMode: env.APP_ENV === 'test' }) }) };
