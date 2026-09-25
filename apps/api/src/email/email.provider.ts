/** W-4: EmailDeps ตัวเดียวทั้ง API — ส่งจริงเมื่อ EMAIL_SEND_ENABLED=true เท่านั้น; EMAIL_MOCK_BASE_URL ชี้ผู้ให้บริการไป mock (test) */
import type { Provider } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import type { EmailDeps } from '@fbpm/email-core';
import { ENV, type Env } from '../config/env';
import { PRISMA } from '../database/prisma.service';

export const EMAIL = Symbol('EMAIL');
export function buildEmailDeps(env: Env, prisma: PrismaClient): EmailDeps {
  const mock = env.EMAIL_MOCK_BASE_URL?.replace(/\/+$/, '');
  return { prisma, authSecret: env.AUTH_SECRET, appUrl: env.APP_URL, sendEnabled: env.EMAIL_SEND_ENABLED, providerBaseUrl: mock, sendDelayMs: mock ? 0 : 60 };
}
export const emailProvider: Provider = { provide: EMAIL, inject: [ENV, PRISMA], useFactory: buildEmailDeps };
