import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../auth/auth.service';
import type { AddMemberDto, CreateWorkspaceDto, UpdateMemberDto, UpdateWorkspaceDto } from './dto';

const WS_SELECT = { id: true, name: true, slug: true, timezone: true, plan: true, status: true, automationPaused: true, aiMonthlyBudgetUsd: true, aiMaxCostPerTaskUsd: true, createdAt: true } as const;

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateWorkspaceDto, requestId: string) {
    const ws = await this.prisma.workspace.create({
      data: { name: dto.name, slug: slugify(dto.name), timezone: dto.timezone ?? this.env.DEFAULT_TIMEZONE, members: { create: { userId, role: 'owner' } } },
      select: WS_SELECT,
    });
    await this.audit.log({ workspaceId: ws.id, userId, action: 'workspace.create', resourceType: 'workspace', resourceId: ws.id, after: { name: ws.name, timezone: ws.timezone }, requestId });
    return ws;
  }

  get(workspaceId: string) {
    return this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { ...WS_SELECT, _count: { select: { clients: true, members: true } } },
    });
  }

  async update(workspaceId: string, userId: string, dto: UpdateWorkspaceDto, requestId: string) {
    const before = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, timezone: true, automationPaused: true } });
    const ws = await this.prisma.workspace.update({ where: { id: workspaceId }, data: dto, select: WS_SELECT });
    await this.audit.log({
      workspaceId, userId, action: dto.automationPaused !== undefined && dto.automationPaused !== before.automationPaused ? 'automation.change' : 'workspace.update',
      resourceType: 'workspace', resourceId: workspaceId, before, after: dto, requestId,
    });
    return ws;
  }

  members(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId }, orderBy: { createdAt: 'asc' },
      select: { role: true, permissions: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    });
  }

  async addMember(workspaceId: string, actorId: string, dto: AddMemberDto, requestId: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true, name: true, email: true } });
    // Phase 2: เชิญได้เฉพาะผู้ใช้ที่มีบัญชีแล้ว (ระบบเชิญทางอีเมลมากับ Notification Service §65)
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้ที่ใช้อีเมลนี้ — ให้สมัครบัญชีก่อน');
    const exists = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
    if (exists) throw new ConflictException('ผู้ใช้นี้เป็นสมาชิกอยู่แล้ว');
    const m = await this.prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role: dto.role }, select: { role: true, user: { select: { id: true, name: true, email: true } } } });
    await this.audit.log({ workspaceId, userId: actorId, action: 'workspace.member.add', resourceType: 'workspaceMember', resourceId: user.id, after: { email: user.email, role: dto.role }, requestId });
    return m;
  }

  async updateMember(workspaceId: string, actorId: string, memberUserId: string, dto: UpdateMemberDto, requestId: string) {
    const cur = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: memberUserId } }, select: { role: true } });
    if (!cur) throw new NotFoundException('ไม่พบสมาชิก');
    if (cur.role === 'owner') throw new BadRequestException('เปลี่ยนบทบาท owner ไม่ได้');
    const m = await this.prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId: memberUserId } }, data: { role: dto.role }, select: { role: true, user: { select: { id: true, name: true, email: true } } } });
    await this.audit.log({ workspaceId, userId: actorId, action: 'workspace.member.update', resourceType: 'workspaceMember', resourceId: memberUserId, before: { role: cur.role }, after: { role: dto.role }, requestId });
    return m;
  }

  async removeMember(workspaceId: string, actorId: string, memberUserId: string, requestId: string) {
    const cur = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: memberUserId } }, select: { role: true } });
    if (!cur) throw new NotFoundException('ไม่พบสมาชิก');
    if (cur.role === 'owner') throw new BadRequestException('ลบ owner ไม่ได้');
    await this.prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId: memberUserId } } });
    await this.audit.log({ workspaceId, userId: actorId, action: 'workspace.member.remove', resourceType: 'workspaceMember', resourceId: memberUserId, before: { role: cur.role }, requestId });
    return { ok: true };
  }
}
