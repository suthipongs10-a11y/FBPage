import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { parseCookies } from '../common/cookies';
import type { AppRequest } from '../common/request-context';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'fbpm_session';

/** ต้องล็อกอิน — แนบ req.user / req.sessionId (authorization ทำฝั่งเซิร์ฟเวอร์เสมอ §56) */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ');
    const s = await this.auth.resolveSession(token);
    if (!s) throw new UnauthorizedException('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    req.user = s.user;
    req.sessionId = s.sessionId;
    return true;
  }
}
