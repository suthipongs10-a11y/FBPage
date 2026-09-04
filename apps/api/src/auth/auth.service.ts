import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from './password';
import type { LoginDto, RegisterDto } from './dto';
import type { AuthUser } from '../common/request-context';

export const SESSION_TTL_SEC = 30 * 24 * 3600;
export interface SessionMeta { ip?: string; userAgent?: string; requestId: string }

export function slugify(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base || 'ws'}-${randomBytes(3).toString('hex')}`;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, meta: SessionMeta) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (exists) throw new ConflictException('อีเมลนี้ถูกใช้แล้ว');
    const passwordHash = await hashPassword(dto.password);
    const wsName = dto.workspaceName ?? `${dto.name} Workspace`;

    const { user, workspace } = await this.prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: dto.email, name: dto.name, passwordHash }, select: { id: true, email: true, name: true } });
      const workspace = await tx.workspace.create({
        data: { name: wsName, slug: slugify(wsName), timezone: this.env.DEFAULT_TIMEZONE, members: { create: { userId: user.id, role: 'owner' } } },
        select: { id: true, name: true, slug: true },
      });
      return { user, workspace };
    });
    await this.audit.log({ workspaceId: workspace.id, userId: user.id, action: 'workspace.create', resourceType: 'workspace', resourceId: workspace.id, after: { name: workspace.name }, requestId: meta.requestId });
    await this.audit.log({ workspaceId: workspace.id, userId: user.id, action: 'auth.register', resourceType: 'user', resourceId: user.id, requestId: meta.requestId });
    const token = await this.createSession(user.id, meta);
    return { user, workspace, token };
  }

  async login(dto: LoginDto, meta: SessionMeta) {
    const u = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true, email: true, name: true, passwordHash: true, status: true } });
    // ตอบเหมือนกันไม่ว่าอีเมลไม่มีหรือรหัสผิด — กัน enumeration
    if (!u || u.status !== 'ACTIVE' || !(await verifyPassword(dto.password, u.passwordHash))) throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    const token = await this.createSession(u.id, meta);
    const ws = await this.prisma.workspaceMember.findFirst({ where: { userId: u.id }, orderBy: { createdAt: 'asc' }, select: { workspaceId: true } });
    if (ws) await this.audit.log({ workspaceId: ws.workspaceId, userId: u.id, action: 'auth.login', resourceType: 'user', resourceId: u.id, requestId: meta.requestId });
    return { user: { id: u.id, email: u.email, name: u.name }, token };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  /** คืน user จาก cookie token — null ถ้าไม่มี/หมดอายุ (guard แปลงเป็น 401) */
  async resolveSession(token: string): Promise<{ user: AuthUser; sessionId: string } | null> {
    const s = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, expiresAt: true, user: { select: { id: true, email: true, name: true, status: true } } },
    });
    if (!s || s.expiresAt.getTime() < Date.now() || s.user.status !== 'ACTIVE') return null;
    return { user: { id: s.user.id, email: s.user.email, name: s.user.name }, sessionId: s.id };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, avatarUrl: true } });
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId }, orderBy: { createdAt: 'asc' },
      select: { role: true, workspace: { select: { id: true, name: true, slug: true, timezone: true, automationPaused: true } } },
    });
    return { user, workspaces: memberships.map(m => ({ ...m.workspace, role: m.role })) };
  }

  async createSession(userId: string, meta: SessionMeta): Promise<string> {
    const token = newSessionToken();
    await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_SEC * 1000), ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
    });
    return token;
  }
}
