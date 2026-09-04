/** ตั้งค่า AI ของ workspace: BYOK keys (§42), บทบาท→โมเดล (§41), งบ, การใช้งาน */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { AI_PROVIDERS, PROVIDERS, type AiProviderId } from '@fbpm/ai-core';
import { AI_ROLES } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { encryptSecret } from '../common/crypto';
import { AiGatewayService } from './gateway.service';
import type { PutRolesDto, UpsertProviderKeyDto } from './dto';

const KEY_SELECT = { provider: true, label: true, keyHint: true, baseUrl: true, status: true, lastValidatedAt: true, lastError: true, updatedAt: true } as const;

@Injectable()
export class AiSettingsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService, @Inject(AiGatewayService) private readonly gateway: AiGatewayService) {}

  async providers(workspaceId: string) {
    const keys = await this.prisma.aiProviderKey.findMany({ where: { workspaceId }, select: KEY_SELECT });
    const platform: Record<AiProviderId, boolean> = { openai: !!this.env.OPENAI_API_KEY, anthropic: !!this.env.ANTHROPIC_API_KEY, gemini: !!this.env.GOOGLE_AI_API_KEY, openrouter: !!this.env.OPENROUTER_API_KEY, compatible: !!this.env.LITELLM_BASE_URL };
    return AI_PROVIDERS.map(id => { const k = keys.find(x => x.provider === id); return { ...PROVIDERS[id], configured: !!k && k.status === 'ACTIVE', platformKey: platform[id], keyHint: k?.keyHint ?? null, label: k?.label ?? PROVIDERS[id].label, customBaseUrl: k?.baseUrl ?? null, lastValidatedAt: k?.lastValidatedAt ?? null, lastError: k?.lastError ?? null, updatedAt: k?.updatedAt ?? null }; });
  }

  async upsertKey(workspaceId: string, userId: string, provider: AiProviderId, dto: UpsertProviderKeyDto, requestId: string) {
    const existing = await this.prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId, provider } }, select: { id: true, encryptedApiKey: true } });
    if (!dto.apiKey && !existing) throw new NotFoundException('ต้องใส่ API key');
    if (PROVIDERS[provider].needsBaseUrl && !dto.baseUrl && !existing) throw new NotFoundException(`${PROVIDERS[provider].label} ต้องระบุ Base URL`);
    const data = {
      ...(dto.apiKey && { encryptedApiKey: encryptSecret(dto.apiKey, this.env.AUTH_SECRET), keyHint: dto.apiKey.slice(-4) }),
      ...(dto.baseUrl !== undefined && { baseUrl: dto.baseUrl || null }),
      ...(dto.label !== undefined && { label: dto.label || null }),
      status: 'ACTIVE', lastError: null,
    };
    const row = await this.prisma.aiProviderKey.upsert({ where: { workspaceId_provider: { workspaceId, provider } }, create: { workspaceId, provider, encryptedApiKey: '', ...data }, update: data, select: KEY_SELECT });
    await this.audit.log({ workspaceId, userId, action: existing ? 'ai.provider.update' : 'ai.provider.add', resourceType: 'aiProviderKey', resourceId: provider, after: { provider, keyHint: row.keyHint, baseUrl: row.baseUrl, keyChanged: !!dto.apiKey }, requestId });
    return row;
  }

  async removeKey(workspaceId: string, userId: string, provider: AiProviderId, requestId: string) {
    const r = await this.prisma.aiProviderKey.deleteMany({ where: { workspaceId, provider } });
    if (!r.count) throw new NotFoundException('ไม่มี key ของผู้ให้บริการนี้');
    await this.audit.log({ workspaceId, userId, action: 'ai.provider.remove', resourceType: 'aiProviderKey', resourceId: provider, requestId });
    return { ok: true };
  }

  async validateKey(workspaceId: string, userId: string, provider: AiProviderId, requestId: string) {
    const r = await this.gateway.ping(workspaceId, provider, requestId, userId);
    await this.prisma.aiProviderKey.updateMany({ where: { workspaceId, provider }, data: r.ok ? { lastValidatedAt: new Date(), lastError: null, status: 'ACTIVE' } : { lastError: r.error?.slice(0, 500) ?? 'ล้มเหลว' } });
    return r;
  }

  async roles(workspaceId: string) {
    const rows = await this.prisma.aiRoleConfig.findMany({ where: { workspaceId }, select: { role: true, provider: true, model: true } });
    return { roles: Object.fromEntries(AI_ROLES.map(r => [r, rows.find(x => x.role === r) ? { provider: rows.find(x => x.role === r)!.provider, model: rows.find(x => x.role === r)!.model } : null])) };
  }

  async putRoles(workspaceId: string, userId: string, dto: PutRolesDto, requestId: string) {
    for (const [role, cfg] of Object.entries(dto.roles)) {
      if (!cfg) await this.prisma.aiRoleConfig.deleteMany({ where: { workspaceId, role } });
      else await this.prisma.aiRoleConfig.upsert({ where: { workspaceId_role: { workspaceId, role } }, create: { workspaceId, role, provider: cfg.provider, model: cfg.model }, update: { provider: cfg.provider, model: cfg.model } });
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
    return this.prisma.aiTaskLog.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: Math.min(200, Math.max(1, limit)), select: { id: true, taskType: true, role: true, provider: true, model: true, latencyMs: true, inputTokens: true, outputTokens: true, estimatedCost: true, success: true, retry: true, resourceType: true, resourceId: true, requestId: true, error: true, createdAt: true } });
  }
}
