import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { brandInWorkspace, type Prisma, type PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateBrandDto, CreateKnowledgeDto, UpdateBrandDto, UpdateKnowledgeDto } from './dto';

const BRAND_SELECT = {
  id: true, clientId: true, name: true, description: true, industry: true, targetAudience: true, toneOfVoice: true,
  preferredLanguage: true, serviceArea: true, primaryCTA: true, website: true, knowledgeBaseStatus: true, createdAt: true, updatedAt: true,
  client: { select: { id: true, name: true } },
  _count: { select: { knowledge: true, pages: true } },
} as const;
const KN_SELECT = { id: true, type: true, title: true, content: true, source: true, metadata: true, active: true, createdAt: true, updatedAt: true } as const;

/** Brand อยู่ใต้ Client ซึ่งอยู่ใต้ Workspace — ทุก lookup ผ่าน brandInWorkspace (§57) */
@Injectable()
export class BrandsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AuditService) private readonly audit: AuditService) {}

  private async assertBrand(workspaceId: string, brandId: string) {
    const b = await this.prisma.brand.findFirst({ where: { id: brandId, ...brandInWorkspace(workspaceId) }, select: { id: true, clientId: true } });
    if (!b) throw new NotFoundException('ไม่พบแบรนด์');
    return b;
  }

  listByClient(workspaceId: string, clientId: string) {
    return this.prisma.brand.findMany({ where: { clientId, client: { workspaceId } }, orderBy: { createdAt: 'desc' }, select: BRAND_SELECT });
  }

  async get(workspaceId: string, brandId: string) {
    const b = await this.prisma.brand.findFirst({ where: { id: brandId, ...brandInWorkspace(workspaceId) }, select: BRAND_SELECT });
    if (!b) throw new NotFoundException('ไม่พบแบรนด์');
    return b;
  }

  async create(workspaceId: string, userId: string, clientId: string, dto: CreateBrandDto, requestId: string) {
    const client = await this.prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true } });
    if (!client) throw new NotFoundException('ไม่พบลูกค้า');
    const b = await this.prisma.brand.create({ data: { ...dto, clientId }, select: BRAND_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'brand.create', resourceType: 'brand', resourceId: b.id, after: dto, requestId });
    return b;
  }

  async update(workspaceId: string, userId: string, brandId: string, dto: UpdateBrandDto, requestId: string) {
    await this.assertBrand(workspaceId, brandId);
    const before = await this.prisma.brand.findUniqueOrThrow({ where: { id: brandId }, select: { name: true, industry: true, toneOfVoice: true, serviceArea: true, primaryCTA: true, website: true } });
    const b = await this.prisma.brand.update({ where: { id: brandId }, data: dto, select: BRAND_SELECT });
    await this.audit.log({ workspaceId, userId, action: 'brand.update', resourceType: 'brand', resourceId: brandId, before, after: dto, requestId });
    return b;
  }

  async remove(workspaceId: string, userId: string, brandId: string, requestId: string) {
    await this.assertBrand(workspaceId, brandId);
    const before = await this.prisma.brand.findUniqueOrThrow({ where: { id: brandId }, select: { name: true } });
    await this.prisma.brand.delete({ where: { id: brandId } });
    await this.audit.log({ workspaceId, userId, action: 'brand.delete', resourceType: 'brand', resourceId: brandId, before, requestId });
    return { ok: true };
  }

  // ---------- Brand knowledge (§9, §53) ----------
  async listKnowledge(workspaceId: string, brandId: string) {
    await this.assertBrand(workspaceId, brandId);
    return this.prisma.brandKnowledgeItem.findMany({ where: { brandId }, orderBy: [{ type: 'asc' }, { createdAt: 'desc' }], select: KN_SELECT });
  }

  async addKnowledge(workspaceId: string, userId: string, brandId: string, dto: CreateKnowledgeDto, requestId: string) {
    await this.assertBrand(workspaceId, brandId);
    const item = await this.prisma.brandKnowledgeItem.create({ data: { ...dto, metadata: dto.metadata as Prisma.InputJsonValue | undefined, brandId }, select: KN_SELECT });
    await this.refreshKnowledgeStatus(brandId);
    await this.audit.log({ workspaceId, userId, action: 'brand.knowledge.add', resourceType: 'brandKnowledgeItem', resourceId: item.id, after: { type: dto.type, title: dto.title }, requestId });
    return item;
  }

  async updateKnowledge(workspaceId: string, userId: string, brandId: string, itemId: string, dto: UpdateKnowledgeDto, requestId: string) {
    await this.assertBrand(workspaceId, brandId);
    const before = await this.prisma.brandKnowledgeItem.findFirst({ where: { id: itemId, brandId }, select: { type: true, title: true, active: true } });
    if (!before) throw new NotFoundException('ไม่พบข้อมูลแบรนด์');
    const item = await this.prisma.brandKnowledgeItem.update({ where: { id: itemId }, data: { ...dto, metadata: dto.metadata as Prisma.InputJsonValue | undefined }, select: KN_SELECT });
    await this.refreshKnowledgeStatus(brandId);
    await this.audit.log({ workspaceId, userId, action: 'brand.knowledge.update', resourceType: 'brandKnowledgeItem', resourceId: itemId, before, after: { type: dto.type, title: dto.title, active: dto.active }, requestId });
    return item;
  }

  async removeKnowledge(workspaceId: string, userId: string, brandId: string, itemId: string, requestId: string) {
    await this.assertBrand(workspaceId, brandId);
    const before = await this.prisma.brandKnowledgeItem.findFirst({ where: { id: itemId, brandId }, select: { type: true, title: true } });
    if (!before) throw new NotFoundException('ไม่พบข้อมูลแบรนด์');
    await this.prisma.brandKnowledgeItem.delete({ where: { id: itemId } });
    await this.refreshKnowledgeStatus(brandId);
    await this.audit.log({ workspaceId, userId, action: 'brand.knowledge.remove', resourceType: 'brandKnowledgeItem', resourceId: itemId, before, requestId });
    return { ok: true };
  }

  /** EMPTY → PARTIAL → READY ตามความครบของประเภทข้อมูลสำคัญ — AI ต้องใช้ brand knowledge ก่อนสร้างคอนเทนต์ (§9) */
  private async refreshKnowledgeStatus(brandId: string): Promise<void> {
    const rows = await this.prisma.brandKnowledgeItem.groupBy({ by: ['type'], where: { brandId, active: true }, _count: { _all: true } });
    const types = new Set(rows.map(r => r.type));
    const essential = ['business_info', 'brand_voice', 'product', 'service'];
    const status = types.size === 0 ? 'EMPTY' : (types.has('business_info') && types.has('brand_voice') && (types.has('product') || types.has('service'))) ? 'READY' : 'PARTIAL';
    void essential;
    await this.prisma.brand.update({ where: { id: brandId }, data: { knowledgeBaseStatus: status } });
  }
}
