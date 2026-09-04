import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/**
 * rate limit ต่อ IP (§56) — ใช้ Redis (INCR + EXPIRE) เมื่อมีหลาย instance; ถ้า Redis ล่มจะถอยไปตัวนับในหน่วยความจำแทนเพื่อไม่ล็อกผู้ใช้
 */
interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return { allowed: true, retryAfterSec: 0 }; }
  b.count++;
  if (b.count > limit) return { allowed: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  return { allowed: true, retryAfterSec: 0 };
}
export const _resetRateLimits = (): void => buckets.clear();

export async function checkRateLimitRedis(redis: Redis, key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const k = `rl:${key}`;
  const count = await redis.incr(k);
  if (count === 1) await redis.pexpire(k, windowMs);
  if (count > limit) { const ttl = await redis.pttl(k); return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000)) }; }
  return { allowed: true, retryAfterSec: 0 };
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(@Optional() @Inject(REDIS) private readonly redis?: Redis) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const key = `auth:${ip}`; const limit = process.env.APP_ENV === 'test' ? 1000 : 20;
    let r: { allowed: boolean; retryAfterSec: number };
    if (this.redis && this.redis.status === 'ready') { try { r = await checkRateLimitRedis(this.redis, key, limit, 60_000); } catch { r = checkRateLimit(key, limit, 60_000); } }
    else r = checkRateLimit(key, limit, 60_000);
    if (!r.allowed) throw new HttpException({ message: 'พยายามบ่อยเกินไป กรุณารอสักครู่', retryAfterSec: r.retryAfterSec }, HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
