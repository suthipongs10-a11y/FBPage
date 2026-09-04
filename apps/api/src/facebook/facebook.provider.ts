import type { Provider } from '@nestjs/common';
import { FacebookService } from '@fbpm/facebook-core';
import { ENV, type Env } from '../config/env';

export const FACEBOOK = Symbol('FACEBOOK');
/** FacebookService ตัวเดียวทั้ง API — เวอร์ชัน Graph/ปลายทางมาจาก env (§61, §77 mock ใน test) */
export const facebookProvider: Provider = {
  provide: FACEBOOK,
  inject: [ENV],
  useFactory: (env: Env) => new FacebookService({ version: env.META_GRAPH_API_VERSION, baseUrl: env.META_GRAPH_BASE_URL }),
};
