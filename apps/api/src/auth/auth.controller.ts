import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { serializeCookie } from '../common/cookies';
import { AuthRateLimitGuard } from '../common/rate-limit.guard';
import { CurrentUser, type AppRequest, type AuthUser } from '../common/request-context';
import { ENV, type Env } from '../config/env';
import { AuthGuard, SESSION_COOKIE } from './auth.guard';
import { AuthService, SESSION_TTL_SEC } from './auth.service';
import { loginSchema, registerSchema, type LoginDto, type RegisterDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private meta(req: AppRequest) {
    return {
      ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    };
  }
  private setSession(res: Response, token: string | null) {
    res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token ?? '', {
      maxAgeSec: token ? SESSION_TTL_SEC : 0, secure: this.env.APP_ENV === 'production', sameSite: 'Lax',
    }));
  }

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: 'สมัครผู้ใช้ + สร้าง workspace แรก (ผู้สมัครเป็น owner)' })
  async register(@Body(new ZodPipe(registerSchema)) dto: RegisterDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.register(dto, this.meta(req));
    this.setSession(res, r.token);
    return { user: r.user, workspace: r.workspace };
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  async login(@Body(new ZodPipe(loginSchema)) dto: LoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, this.meta(req));
    this.setSession(res, r.token);
    return { user: r.user };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (req.sessionId) await this.auth.logout(req.sessionId);
    this.setSession(res, null);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
