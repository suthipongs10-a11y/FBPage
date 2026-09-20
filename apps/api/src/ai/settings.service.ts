/**
 * ตั้งค่า AI ของ workspace: คีย์ BYOK หลายใบ (§42, CONTENT_ENGINE_PLAN §12.2), บทบาท→คีย์+โมเดล (§41), งบ, การใช้งาน
 * คีย์หนึ่งใบ = หนึ่ง AiConnection ตั้งชื่อเองได้ ใส่ชนิดเดียวกันกี่ใบก็ได้ (MiniMax + Groq + DeepSeek พร้อมกัน)
 */
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@fbpm/database';
import { PROVIDER_PRESETS, presetById, kindLabel, type AiProviderId } from '@fbpm/ai-core';
import { AI_ROLES } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { encryptSecret } from '../common/crypto';
import { AiGatewayService } from './gateway.service';
import type { CreateConnectionDto, PutRolesDto, UpdateConnectionDto } from './dto';

/** ไม่มี encryptedApiKey อยู่ในนี้เด็ดขาด — คีย์ไม่ออกจากเซิร์ฟเวอร์ (§42) */
const CONNECTION_SELECT = { id: true, label: true, kind: true, preset: true, keyHint: true, baseUrl: true, models: true, status: true, lastValidatedAt: true, lastError: true, createdAt: true, updatedAt: true } as const;

@Injectable()
export class AiSettingsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService, @Inject(AiGatewayService) private readonly gateway: AiGatewayService) {}

  /** คีย์ที่ตั้งไว้ + แคตตาล็อก preset + คีย์ระดับแพลตฟอร์มที่มีใน env */
  async connections(workspaceId: string) {
    const rows = await this.prisma.aiConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: CONNECTION_SELECT });
    const platform: Partial<Record<AiProviderId, boolean>> = {
      openai: !!this.env.OPENAI_API_KEY, anthropic: !!this.env.ANTHROPIC_API_KEY, gemini: !!this.env.GOOGLE_AI_API_KEY,
      openrouter: !!this.env.OPENROUTER_API_KEY, compatible: !!this.env.LITELLM_BASE_URL,
    };
    return {
      connections: rows.map(r => ({ ...r, kindLabel: kindLabel(r.kind) })),
      presets: PROVIDER_PRESETS,
      /** ชนิดที่ระบบมี key กลางให้อยู่แล้ว — ใช้ได้แม้ workspace ยังไม่ใส่คีย์เอง */
      platformKeys: Object.entries(platform).filter(([, v]) => v).map(([k]) => k),
    };
  }

  private async connection(workspaceId: string, id: string) {
    const row = await this.prisma.aiConnection.findFirst({ where: { id, workspaceId }, select: { ...CONNECTION_SELECT, encryptedApiKey: true } });
    if (!row) throw new NotFoundException('ไม่พบคีย์ที่ระบุ');
    return row;
  }

  async createConnection(workspaceId: string, userId: string, dto: CreateConnectionDto, requestId: string) {
    const preset = presetById(dto.preset);
    if (!preset) throw new UnprocessableEntityException('ไม่รู้จักผู้ให้บริการที่เลือก');
    const baseUrl = dto.baseUrl?.trim() || preset.baseUrl || null;
    if (preset.needsBaseUrl && !baseUrl) throw new UnprocessableEntityException(`${preset.label} ต้องระบุ Base URL`);
    const label = dto.label.trim();
    try {
      const row = await this.prisma.aiConnection.create({
        data: {
          workspaceId, label, kind: preset.kind, preset: preset.id, baseUrl,
          encryptedApiKey: encryptSecret(dto.apiKey, this.env.AUTH_SECRET), keyHint: dto.apiKey.slice(-4),
          models: dto.models ?? preset.models,
        },
        select: CONNECTION_SELECT,
      });
      await this.audit.log({ workspaceId, userId, action: 'ai.connection.add', resourceType: 'aiConnection', resourceId: row.id, after: { label, kind: preset.kind, preset: preset.id, baseUrl, keyHint: row.keyHint }, requestId });
      return { ...row, kindLabel: kindLabel(row.kind) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('มีคีย์ชื่อนี้อยู่แล้ว ตั้งชื่ออื่น');
      throw e;
    }
  }

  async updateConnection(workspaceId: string, userId: string, id: string, dto: UpdateConnectionDto, requestId: string) {
    const existing = await this.connection(workspaceId, id);
    const preset = presetById(existing.preset);
    const baseUrl = dto.baseUrl === undefined ? existing.baseUrl : (dto.baseUrl.trim() || null);
    // อะแดปเตอร์ compatible ไม่รู้ปลายทางเอง — ต้องมี baseUrl เสมอ แม้ preset จะระบุตัวไม่ได้ (คีย์เก่าที่ย้ายมา)
    const needsBaseUrl = preset ? preset.needsBaseUrl : existing.kind === 'compatible';
    if (needsBaseUrl && !baseUrl) throw new UnprocessableEntityException(`${preset?.label ?? kindLabel(existing.kind)} ต้องระบุ Base URL`);
    const data = {
      ...(dto.label !== undefined && { label: dto.label.trim() }),
      ...(dto.apiKey && { encryptedApiKey: encryptSecret(dto.apiKey, this.env.AUTH_SECRET), keyHint: dto.apiKey.slice(-4) }),
      ...(dto.baseUrl !== undefined && { baseUrl }),
      ...(dto.models !== undefined && { models: dto.models }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.apiKey && { lastError: null, lastValidatedAt: null }),
    };
    try {
      const row = await this.prisma.aiConnection.update({ where: { id }, data, select: CONNECTION_SELECT });
      await this.audit.log({ workspaceId, userId, action: 'ai.connection.update', resourceType: 'aiConnection', resourceId: id, after: { label: row.label, baseUrl: row.baseUrl, status: row.status, keyHint: row.keyHint, keyChanged: !!dto.apiKey }, requestId });
      return { ...row, kindLabel: kindLabel(row.kind) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('มีคีย์ชื่อนี้อยู่แล้ว ตั้งชื่ออื่น');
      throw e;
    }
  }

  /** ลบคีย์ → บทบาทที่ชี้ใบนี้หายไปด้วย (FK cascade) ต้องบอกผู้ใช้ว่ากระทบบทบาทไหนบ้าง */
  async removeConnection(workspaceId: string, userId: string, id: string, requestId: string) {
    await this.connection(workspaceId, id);
    const affected = await this.prisma.aiRoleConfig.findMany({ where: { workspaceId, connectionId: id }, select: { role: true } });
    await this.prisma.aiConnection.delete({ where: { id } });
    await this.audit.log({ workspaceId, userId, action: 'ai.connection.remove', resourceType: 'aiConnection', resourceId: id, after: { clearedRoles: affected.map(a => a.role) }, requestId });
    return { ok: true, clearedRoles: affected.map(a => a.role) };
  }

  async validateConnection(workspaceId: string, userId: string, id: string, requestId: string) {
    await this.connection(workspaceId, id);
    const r = await this.gateway.ping(workspaceId, id, requestId, userId);
    await this.prisma.aiConnection.update({ where: { id }, data: r.ok ? { lastValidatedAt: new Date(), lastError: null, status: 'ACTIVE' } : { lastError: r.error?.slice(0, 500) ?? 'ล้มเหลว' } });
    return r;
  }

  async roles(workspaceId: string) {
    const rows = await this.prisma.aiRoleConfig.findMany({ where: { workspaceId }, select: { role: true, connectionId: true, model: true } });
    return { roles: Object.fromEntries(AI_ROLES.map(r => { const row = rows.find(x => x.role === r); return [r, row ? { connectionId: row.connectionId, model: row.model } : null]; })) };
  }

  async putRoles(workspaceId: string, userId: string, dto: PutRolesDto, requestId: string) {
    const wanted = Object.values(dto.roles).filter((c): c is { connectionId: string; model: string } => !!c).map(c => c.connectionId);
    if (wanted.length) {
      const found = await this.prisma.aiConnection.findMany({ where: { workspaceId, id: { in: [...new Set(wanted)] } }, select: { id: true } });
      if (found.length !== new Set(wanted).size) throw new UnprocessableEntityException('มีบทบาทที่ชี้ไปยังคีย์ที่ไม่มีอยู่ในพื้นที่ทำงานนี้');
    }
    for (const [role, cfg] of Object.entries(dto.roles)) {
      if (!cfg) await this.prisma.aiRoleConfig.deleteMany({ where: { workspaceId, role } });
      else await this.prisma.aiRoleConfig.upsert({ where: { workspaceId_role: { workspaceId, role } }, create: { workspaceId, role, connectionId: cfg.connectionId, model: cfg.model }, update: { connectionId: cfg.connectionId, model: cfg.model } });
    }
    await this.audit.log({ workspaceId, userId, action: 'ai.roles.update', resourceType: 'aiRoleConfig', after: dto.roles, requestId });
    return this.roles(workspaceId);
  }

  async usage(workspaceId: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiMonthlyBudgetUsd: true, aiMaxCostPerTaskUsd: true } });
    const m = await this.gateway.monthUsage(workspaceId);
    const byModel = await this.prisma.aiTaskLog.groupBy({ by: ['provider', 'model'], where: { workspaceId, createdAt: { gte: m.since } }, _count: { _all: true }, _sum: { estimatedCost: true, inputTokens: true, outputTokens: true }, _avg: { latencyMs: true } });
    return { monthlyBudgetUsd: ws.aiMonthlyBudgetUsd == null ? null : Number(ws.aiMonthlyBudgetUsd), maxCostPerTaskUsd: ws.aiMaxCostPerTaskUsd == null ? null : Number(ws.aiMaxCostPerTaskUsd), monthToDate: { ...m, since: m.since }, byModel: byModel.map(b => ({ provider: b.provider, model: b.model, tasks: b._count._all, costUsd: Number(b._sum.estimatedCost ?? 0), inputTokens: b._sum.inputTokens ?? 0, outputTokens: b._sum.outputTokens ?? 0, avgLatencyMs: Math.round(b._avg.latencyMs ?? 0) })) };
  }

  tasks(workspaceId: string, limit = 50) {
    return this.prisma.aiTaskLog.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: Math.min(200, Math.max(1, limit)), select: { id: true, taskType: true, role: true, provider: true, connectionId: true, model: true, latencyMs: true, inputTokens: true, outputTokens: true, estimatedCost: true, success: true, retry: true, resourceType: true, resourceId: true, requestId: true, error: true, createdAt: true } });
  }
}
