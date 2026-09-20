import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';

export interface AuditEntry {
  workspaceId: string;
  userId?: string | null;
  action: string;          // เช่น client.create, brand.update, workspace.member.add
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId: string;
}

/** Audit log บังคับสำหรับทุกการเปลี่ยนแปลง (AGENTS.md §49) — ห้ามใส่ความลับใน before/after */
@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async log(e: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        workspaceId: e.workspaceId,
        userId: e.userId ?? null,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId ?? null,
        before: e.before === undefined ? undefined : (e.before as Prisma.InputJsonValue),
        after: e.after === undefined ? undefined : (e.after as Prisma.InputJsonValue),
        requestId: e.requestId,
      },
    });
  }

  list(workspaceId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
      select: { id: true, action: true, resourceType: true, resourceId: true, before: true, after: true, requestId: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    });
  }
}
