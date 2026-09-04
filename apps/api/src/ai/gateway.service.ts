/**
 * AiGatewayService — จุดเดียวที่โค้ดใน API เรียก AI (§4, §5): เลือกโมเดลตามบทบาท, ตรวจงบ, retry/fallback, และบันทึก AiTaskLog ทุกครั้ง (§50)
 */
import { HttpException, HttpStatus, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { AiProviderError, PROVIDERS, chat, estimateCostUsd, generateStructured, runToolLoop, type AiProviderId, type ChatRequest, type ChatResult, type ProviderConfig, type StructuredInput, type StructuredResult, type ToolLoopInput, type ToolLoopResult, type Usage } from '@fbpm/ai-core';
import type { AiRole } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { decryptSecret } from '../common/crypto';

export interface ResolvedModel { cfg: ProviderConfig; provider: AiProviderId; model: string; role: AiRole; source: 'role' | 'fallback' | 'auto' }
export interface TaskMeta { workspaceId: string; userId?: string | null; taskType: string; role: AiRole; requestId: string; resourceType?: string; resourceId?: string; promptVersion?: string }
export interface TaskOutcome<T> { result: T; provider: AiProviderId; model: string; usage: Usage; costUsd: number | null; latencyMs: number; taskId: string; fallbackUsed: boolean }

const ROLE_FALLBACK_ORDER: Record<AiRole, AiRole[]> = {
  strategy: ['strategy', 'fallback', 'content', 'analysis'], content: ['content', 'fallback', 'strategy'], analysis: ['analysis', 'fallback', 'strategy'],
  community: ['community', 'fast', 'fallback', 'content'], research: ['research', 'fallback', 'strategy'], vision: ['vision', 'fallback'],
  fast: ['fast', 'fallback', 'content'], fallback: ['fallback', 'strategy', 'content'],
};

@Injectable()
export class AiGatewayService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env) {}

  /** key ของ provider — จาก BYOK ของ workspace ก่อน ไม่มีจึงใช้ key ระดับแพลตฟอร์มจาก env (§42) */
  private async providerConfig(workspaceId: string, provider: AiProviderId, model: string): Promise<ProviderConfig | null> {
    const row = await this.prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId, provider } }, select: { encryptedApiKey: true, baseUrl: true, status: true } });
    if (row && row.status === 'ACTIVE') return { provider, apiKey: row.encryptedApiKey ? decryptSecret(row.encryptedApiKey, this.env.AUTH_SECRET) : '', model, baseUrl: row.baseUrl ?? undefined };
    const platform: Partial<Record<AiProviderId, { key?: string; baseUrl?: string }>> = {
      openai: { key: this.env.OPENAI_API_KEY }, anthropic: { key: this.env.ANTHROPIC_API_KEY }, gemini: { key: this.env.GOOGLE_AI_API_KEY }, openrouter: { key: this.env.OPENROUTER_API_KEY },
      compatible: { key: this.env.LITELLM_API_KEY, baseUrl: this.env.LITELLM_BASE_URL },
    };
    const p = platform[provider];
    if (p?.key || (provider === 'compatible' && p?.baseUrl)) return { provider, apiKey: p.key ?? '', model, baseUrl: p.baseUrl };
    return null;
  }

  /** เลือก provider/model ตามบทบาท (§5) — ไม่ตั้งไว้ → fallback → provider แรกที่มี key */
  async resolve(workspaceId: string, role: AiRole, exclude: AiProviderId[] = []): Promise<ResolvedModel> {
    const roles = await this.prisma.aiRoleConfig.findMany({ where: { workspaceId }, select: { role: true, provider: true, model: true } });
    for (const r of ROLE_FALLBACK_ORDER[role]) {
      const c = roles.find(x => x.role === r);
      if (!c || exclude.includes(c.provider as AiProviderId)) continue;
      const cfg = await this.providerConfig(workspaceId, c.provider as AiProviderId, c.model);
      if (cfg) return { cfg, provider: cfg.provider, model: c.model, role, source: r === role ? 'role' : 'fallback' };
    }
    const keys = await this.prisma.aiProviderKey.findMany({ where: { workspaceId, status: 'ACTIVE' }, select: { provider: true }, orderBy: { createdAt: 'asc' } });
    const candidates: AiProviderId[] = [...keys.map(k => k.provider as AiProviderId), 'anthropic', 'openai', 'gemini', 'openrouter', 'compatible'];
    for (const p of candidates) {
      if (exclude.includes(p) || !PROVIDERS[p]?.defaultModel && p !== 'compatible') continue;
      const cfg = await this.providerConfig(workspaceId, p, PROVIDERS[p].defaultModel);
      if (cfg && (cfg.model || p !== 'compatible')) return { cfg, provider: p, model: cfg.model ?? '', role, source: 'auto' };
    }
    throw new UnprocessableEntityException('ยังไม่ได้ตั้งค่า AI — ใส่ API key ของผู้ให้บริการอย่างน้อย 1 รายที่หน้า "โมเดล AI"');
  }

  /** ค่าใช้จ่าย AI เดือนนี้ (UTC) ของ workspace */
  async monthUsage(workspaceId: string): Promise<{ costUsd: number; tasks: number; failed: number; since: Date }> {
    const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const agg = await this.prisma.aiTaskLog.aggregate({ where: { workspaceId, createdAt: { gte: since } }, _sum: { estimatedCost: true }, _count: { _all: true } });
    const failed = await this.prisma.aiTaskLog.count({ where: { workspaceId, createdAt: { gte: since }, success: false } });
    return { costUsd: Number(agg._sum.estimatedCost ?? 0), tasks: agg._count._all, failed, since };
  }

  private async assertBudget(workspaceId: string): Promise<void> {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiMonthlyBudgetUsd: true } });
    if (ws.aiMonthlyBudgetUsd == null) return;
    const { costUsd } = await this.monthUsage(workspaceId);
    if (costUsd >= Number(ws.aiMonthlyBudgetUsd)) throw new HttpException({ statusCode: HttpStatus.PAYMENT_REQUIRED, message: `งบ AI เดือนนี้ (${Number(ws.aiMonthlyBudgetUsd)} USD) ถูกใช้หมดแล้ว — เพิ่มงบที่หน้า "โมเดล AI"` }, HttpStatus.PAYMENT_REQUIRED);
  }

  /** รัน task หนึ่งครั้งพร้อม log — fn ได้รับ config ของโมเดลที่เลือก; ถ้า provider ล้มแบบ retryable จะลอง fallback provider อื่น 1 ครั้ง */
  async run<T>(meta: TaskMeta, fn: (cfg: ProviderConfig, resolved: ResolvedModel) => Promise<{ result: T; usage: Usage; model?: string }>): Promise<TaskOutcome<T>> {
    await this.assertBudget(meta.workspaceId);
    const tried: AiProviderId[] = []; let lastErr: unknown; let retry = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      let resolved: ResolvedModel;
      try { resolved = await this.resolve(meta.workspaceId, meta.role, tried); } catch (e) { if (attempt === 0) throw e; break; }
      tried.push(resolved.provider);
      const t0 = Date.now();
      try {
        const out = await fn(resolved.cfg, resolved);
        const model = out.model ?? resolved.model; const costUsd = estimateCostUsd(model, out.usage);
        const log = await this.log(meta, { provider: resolved.provider, model, latencyMs: Date.now() - t0, usage: out.usage, costUsd, success: true, retry });
        await this.assertPerTaskCap(meta.workspaceId, costUsd);
        return { result: out.result, provider: resolved.provider, model, usage: out.usage, costUsd, latencyMs: Date.now() - t0, taskId: log.id, fallbackUsed: attempt > 0 };
      } catch (e) {
        lastErr = e;
        const msg = e instanceof AiProviderError ? e.userMessage : e instanceof Error ? e.message : String(e);
        await this.log(meta, { provider: resolved.provider, model: resolved.model, latencyMs: Date.now() - t0, usage: { input: null, output: null }, costUsd: null, success: false, retry, error: msg.slice(0, 500) });
        if (!(e instanceof AiProviderError) || !e.isRetryable) break;
        retry++;
      }
    }
    if (lastErr instanceof AiProviderError) throw new HttpException({ statusCode: HttpStatus.BAD_GATEWAY, message: lastErr.userMessage, provider: lastErr.provider }, HttpStatus.BAD_GATEWAY);
    if (lastErr instanceof HttpException) throw lastErr;
    throw new HttpException({ statusCode: HttpStatus.BAD_GATEWAY, message: lastErr instanceof Error ? lastErr.message : 'AI ล้มเหลว' }, HttpStatus.BAD_GATEWAY);
  }

  private async assertPerTaskCap(workspaceId: string, costUsd: number | null): Promise<void> {
    if (costUsd == null) return;
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiMaxCostPerTaskUsd: true } });
    // เกินเพดานต่อ task: ไม่ทิ้งผลลัพธ์ที่จ่ายไปแล้ว แต่บันทึกไว้ให้เห็นใน log (ค่าจริงถูกตัดจากงบเดือนอยู่แล้ว)
    if (ws.aiMaxCostPerTaskUsd != null && costUsd > Number(ws.aiMaxCostPerTaskUsd)) {
      await this.prisma.aiTaskLog.updateMany({ where: { workspaceId, createdAt: { gte: new Date(Date.now() - 5000) }, error: null }, data: { error: `เกินเพดานต่อ task (${costUsd.toFixed(4)} > ${Number(ws.aiMaxCostPerTaskUsd)} USD)` } });
    }
  }

  private log(meta: TaskMeta, r: { provider: string; model: string; latencyMs: number; usage: Usage; costUsd: number | null; success: boolean; retry: number; error?: string }) {
    return this.prisma.aiTaskLog.create({
      data: {
        workspaceId: meta.workspaceId, taskType: meta.taskType, role: meta.role, provider: r.provider, model: r.model, promptVersion: meta.promptVersion ?? null,
        latencyMs: r.latencyMs, inputTokens: r.usage.input, outputTokens: r.usage.output, estimatedCost: r.costUsd, success: r.success, retry: r.retry,
        resourceType: meta.resourceType ?? null, resourceId: meta.resourceId ?? null, requestId: meta.requestId, error: r.error ?? null,
      }, select: { id: true },
    });
  }

  // ---------- ตัวช่วยที่ agent/บริการอื่นเรียก ----------
  chat(meta: TaskMeta, req: ChatRequest): Promise<TaskOutcome<ChatResult>> {
    return this.run(meta, async cfg => { const r = await chat(cfg, req); return { result: r, usage: r.usage, model: r.model }; });
  }
  structured<T>(meta: TaskMeta, input: StructuredInput<T>): Promise<TaskOutcome<StructuredResult<T>>> {
    return this.run(meta, async cfg => { const r = await generateStructured(cfg, input); return { result: r, usage: r.usage, model: r.model }; });
  }
  toolLoop(meta: TaskMeta, input: ToolLoopInput): Promise<TaskOutcome<ToolLoopResult>> {
    return this.run(meta, async cfg => { const r = await runToolLoop(cfg, input); return { result: r, usage: r.usage, model: r.model }; });
  }

  /** ทดสอบ key ของ provider ด้วยคำขอสั้นๆ (ไม่ผ่านการเลือกบทบาท) */
  async ping(workspaceId: string, provider: AiProviderId, requestId: string, userId: string): Promise<{ ok: boolean; model: string; latencyMs: number; error?: string }> {
    const cfg = await this.providerConfig(workspaceId, provider, PROVIDERS[provider].defaultModel);
    if (!cfg) return { ok: false, model: '', latencyMs: 0, error: 'ยังไม่มี key' };
    const roleModel = await this.prisma.aiRoleConfig.findFirst({ where: { workspaceId, provider }, select: { model: true } });
    cfg.model = roleModel?.model || cfg.model;
    if (!cfg.model) return { ok: false, model: '', latencyMs: 0, error: 'ต้องระบุชื่อโมเดลในบทบาทใดบทบาทหนึ่งก่อน' };
    const t0 = Date.now();
    try {
      const r = await chat(cfg, { messages: [{ role: 'user', content: 'ตอบคำเดียวว่า OK' }], maxTokens: 20 });
      await this.log({ workspaceId, userId, taskType: 'provider.validate', role: 'fast', requestId }, { provider, model: r.model, latencyMs: Date.now() - t0, usage: r.usage, costUsd: estimateCostUsd(r.model, r.usage), success: true, retry: 0 });
      return { ok: true, model: r.model, latencyMs: Date.now() - t0 };
    } catch (e) {
      const msg = e instanceof AiProviderError ? e.userMessage : (e as Error).message;
      await this.log({ workspaceId, userId, taskType: 'provider.validate', role: 'fast', requestId }, { provider, model: cfg.model ?? '', latencyMs: Date.now() - t0, usage: { input: null, output: null }, costUsd: null, success: false, retry: 0, error: msg.slice(0, 500) });
      return { ok: false, model: cfg.model ?? '', latencyMs: Date.now() - t0, error: msg };
    }
  }
}
