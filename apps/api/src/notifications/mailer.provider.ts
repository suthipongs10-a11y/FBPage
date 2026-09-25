/** Mailer provider — สร้างจาก env ครั้งเดียว และผูกเข้า notify() ให้ส่งอีเมลเหตุการณ์สำคัญ (§65) */
import type { Provider } from '@nestjs/common';
import { mailerFromEnv, setNotifyMailer, type Mailer } from '@fbpm/database';
import { ENV, type Env } from '../config/env';

export const MAILER = Symbol('MAILER');
export const mailerProvider: Provider = { provide: MAILER, inject: [ENV], useFactory: (env: Env): Mailer | null => {
  const m = mailerFromEnv({ SMTP_HOST: env.SMTP_HOST, SMTP_PORT: env.SMTP_PORT ? String(env.SMTP_PORT) : undefined, SMTP_USER: env.SMTP_USER, SMTP_PASS: env.SMTP_PASS, SMTP_FROM: env.SMTP_FROM, SMTP_SECURE: env.SMTP_SECURE ? 'true' : '', SMTP_ALLOW_INSECURE: env.SMTP_ALLOW_INSECURE ? 'true' : '' });
  setNotifyMailer(m, env.APP_URL);
  return m;
} };
