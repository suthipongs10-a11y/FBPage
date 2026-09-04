import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [{
    provide: REDIS,
    inject: [ENV],
    useFactory: (env: Env) => new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false }),
  }],
  exports: [REDIS],
})
export class RedisModule {}
