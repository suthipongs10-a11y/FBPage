import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateClientDto, UpdateClientDto } from './dto';

const SELECT = { id: true, name: true, contactName: true, email: true, phone: true, notes: true, status: true, createdAt: true, updatedAt: true, _count: { select: { brands: true } } } as const;

/** ทุก query scope ด้วย workspaceId — ห้าม findUnique ด้วย id เดี่ยวๆ (§57) */
@Injectable()
export class ClientsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AuditService) private readonly audit: AuditService) {}

  list(workspaceId: string) {
    return this.prisma.client.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, select: SELECT });
  }

  async get(workspaceId: string, id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, workspaceId }, select: { ...SELECT, brands: { orderBy: { createdAt: 'desc' }, select: { id: true, name: true, industry: true, knowledgeBaseStatus: true, _count: { select: { knowledge: true, pages: true } } } } } });
    if (!c) throw new NotFoundException('ไม่พบลูกค้า');
    return c;
  }

  async create(workspaceId: string, userId: string, dto: CreateClientDto, requestId: string) {
    const c = await this.prisma.client.create({ data: { ...dto, workspaceId }, select: SELECT });
    await this.audit.log({ workspaceId, userId, action: 'client.create', resourceType: 'client', resourceId: c.id, after: dto, requestId });
    return c;
  }

  async update(workspaceId: string, userId: string, id: string, dto: UpdateClientDto, requestId: string) {
    const before = await this.prisma.client.findFirst({ where: { id, workspaceId }, select: { name: true, contactName: true, email: true, phone: true, notes: true, status: true } });
    if (!before) throw new NotFoundException('ไม่พบลูกค้า');
    const c = await this.prisma.client.update({ where: { id }, data: dto, select: SELECT });
    await this.audit.log({ workspaceId, userId, action: 'client.update', resourceType: 'client', resourceId: id, before, after: dto, requestId });
    return c;
  }

  async remove(workspaceId: string, userId: string, id: string, requestId: string) {
    const before = await this.prisma.client.findFirst({ where: { id, workspaceId }, select: { name: true } });
    if (!before) throw new NotFoundException('ไม่พบลูกค้า');
    await this.prisma.client.delete({ where: { id } });
    await this.audit.log({ workspaceId, userId, action: 'client.delete', resourceType: 'client', resourceId: id, before, requestId });
    return { ok: true };
  }
}
