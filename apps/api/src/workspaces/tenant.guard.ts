import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaClient } from '@fbpm/database';
import type { Permission, WorkspaceRole } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import type { AppRequest } from '../common/request-context';
import { effectivePermissions, hasAll, REQUIRE_PERMISSION_KEY } from './permissions';

/**
 * Tenant isolation (§57) + RBAC (§58)
 * - ผู้ใช้ต้องเป็นสมาชิกของ :workspaceId ไม่งั้น 404 (ไม่เผยว่า workspace มีอยู่)
 * - ต้องมี permission ตาม @RequirePermission ไม่งั้น 403
 * - แนบ req.tenant ให้ service ใช้ scope ทุก query
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.user) throw new UnauthorizedException();
    const workspaceId = (req.params as Record<string, string | undefined>).workspaceId;
    if (!workspaceId) throw new NotFoundException('ไม่พบ workspace');

    const m = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: req.user.id } },
      select: { role: true, permissions: true, workspace: { select: { status: true } } },
    });
    if (!m || m.workspace.status !== 'ACTIVE') throw new NotFoundException('ไม่พบ workspace');

    const permissions = effectivePermissions(m.role as WorkspaceRole, m.permissions);
    const need = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRE_PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (!hasAll(permissions, need)) throw new ForbiddenException('ไม่มีสิทธิ์ทำรายการนี้');

    req.tenant = { workspaceId, role: m.role as WorkspaceRole, permissions };
    return true;
  }
}
