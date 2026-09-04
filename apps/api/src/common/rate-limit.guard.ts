import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * rate limit ในหน่วยความจำต่อ IP — เพียงพอสำหรับ instance เดียว (§56)
 * เมื่อ scale หลาย instance ให้ย้ายตัวนับไป Redis
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

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const r = checkRateLimit(`auth:${ip}`, 20, 60_000);
    if (!r.allowed) throw new HttpException({ message: 'พยายามบ่อยเกินไป กรุณารอสักครู่', retryAfterSec: r.retryAfterSec }, HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
