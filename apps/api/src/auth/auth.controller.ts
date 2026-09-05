import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { serializeCookie } from '../common/cookies';
import { AuthRateLimitGuard } from '../common/rate-limit.guard';
import { CurrentUser, type AppRequest, type AuthUser } from '../common/request-context';
import { ENV, type Env } from '../config/env';
import { AuthGuard, SESSION_COOKIE } from './auth.guard';
import { AuthService, SESSION_TTL_SEC } from './auth.service';
import { acceptInviteSchema, changePasswordSchema, forgotSchema, loginSchema, registerSchema, resetPasswordSchema, type AcceptInviteDto, type ChangePasswordDto, type ForgotDto, type LoginDto, type RegisterDto, type ResetPasswordDto } from './dto';
import { InvitesService } from './invites.service';
import { parseCookies } from '../common/cookies';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
    @Inject(InvitesService) private readonly invites: InvitesService,
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

  @Post('password') @HttpCode(200) @UseGuards(AuthGuard)
  changePassword(@CurrentUser() u: AuthUser, @Body(new ZodPipe(changePasswordSchema)) dto: ChangePasswordDto, @Req() req: AppRequest) { return this.invites.changePassword(u.id, dto.current, dto.next, req.requestId); }

  // ---------- คำเชิญ / รีเซ็ต (สาธารณะ — ตัวตนอยู่ใน token ของลิงก์) ----------
  @Get('invites/:token') @UseGuards(AuthRateLimitGuard)
  inspectInvite(@Param('token') token: string) { return this.invites.inspect(token); }

  @Post('invites/:token/accept') @HttpCode(200) @UseGuards(AuthRateLimitGuard)
  async acceptInvite(@Param('token') token: string, @Body(new ZodPipe(acceptInviteSchema)) dto: AcceptInviteDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const current = cookie ? await this.auth.resolveSession(cookie) : null;
    const r = await this.invites.accept(token, current?.user.id ?? null, dto, this.meta(req));
    if (r.token) this.setSession(res, r.token);
    return { workspaceId: r.workspaceId, workspaceName: r.workspaceName, role: r.role };
  }

  /** ลืมรหัสผ่าน — ตอบ 200 เสมอ ไม่เผยว่ามีบัญชีหรือไม่ (ส่งลิงก์ทางอีเมลเมื่อตั้ง SMTP) */
  @Post('forgot') @HttpCode(200) @UseGuards(AuthRateLimitGuard)
  forgot(@Body(new ZodPipe(forgotSchema)) dto: ForgotDto, @Req() req: AppRequest) { return this.invites.forgot(dto.email, req.requestId); }

  @Get('reset/:token') @UseGuards(AuthRateLimitGuard)
  inspectReset(@Param('token') token: string) { return this.invites.inspectReset(token); }

  @Post('reset/:token') @HttpCode(200) @UseGuards(AuthRateLimitGuard)
  async reset(@Param('token') token: string, @Body(new ZodPipe(resetPasswordSchema)) dto: ResetPasswordDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.invites.resetPassword(token, dto.password, this.meta(req));
    this.setSession(res, r.token);
    return { ok: true };
  }
}
