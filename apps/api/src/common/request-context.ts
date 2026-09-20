import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission, WorkspaceRole } from '@fbpm/shared';

export interface AuthUser { id: string; email: string; name: string }
export interface TenantContext { workspaceId: string; role: WorkspaceRole; permissions: readonly Permission[] }

/** ฟิลด์ที่ middleware/guard แนบเข้ากับ request */
export interface AppRequest extends Request {
  requestId: string;
  user?: AuthUser;
  sessionId?: string;
  tenant?: TenantContext;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.user) throw new Error('CurrentUser used without AuthGuard');
  return req.user;
});

export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.tenant) throw new Error('Tenant used without TenantGuard');
  return req.tenant;
});

export const RequestId = createParamDecorator((_: unknown, ctx: ExecutionContext): string =>
  ctx.switchToHttp().getRequest<AppRequest>().requestId);
