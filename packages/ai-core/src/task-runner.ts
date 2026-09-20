/**
 * ทางเดียวที่ทั้งระบบเรียก AI — ใช้ได้ทั้งใน API (ผ่าน AiGatewayService) และใน worker ที่ไม่มี NestJS
 * รวมสี่อย่างไว้ที่เดียว: เลือก provider/model ตามบทบาท (§5), ใช้ BYOK ของ workspace ก่อน key ระดับแพลตฟอร์ม (§42),
 * ตรวจงบเดือนก่อนยิง, และบันทึก AiTaskLog ทุกครั้งทั้งสำเร็จและล้ม (§50)
 * ไม่ผูกกับ framework ใด ๆ — ผู้เรียกแปลง error เป็นรูปแบบของตัวเอง (HTTP ใน API, log ใน worker)
 */
import { decryptSecret, type PrismaClient } from '@fbpm/database';
import type { AiRole } from '@fbpm/shared';
import { estimateCostUsd, generateStructured, type StructuredInput, type StructuredResult } from './gateway';
import { AiProviderError, PROVIDERS, type AiProviderId, type ProviderConfig, type Usage } from './types';

/** ค่าตั้งเท่าที่ชั้น AI ต้องใช้ — ผู้เรียกส่ง env ของตัวเองเข้ามา ไม่อ่าน process.env เอง */
export interface AiEnv {
  AUTH_SECRET: string;
  OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string; GOOGLE_AI_API_KEY?: string; GOOGLE_AI_MODEL?: string;
  OPENROUTER_API_KEY?: string; LITELLM_API_KEY?: string; LITELLM_BASE_URL?: string;
}
export interface AiTaskContext {
  prisma: PrismaClient;
  env: AiEnv;
  /** แจ้งเตือนเมื่องบใกล้หมด — ไม่ส่งมาก็ข้ามไป (worker ไม่จำเป็นต้องแจ้ง) */
  notifyBudget?: (workspaceId: string, input: { percent: number; costUsd: number; budgetUsd: number; monthKey: string }) => Promise<void>;
}
export interface ResolvedModel { cfg: ProviderConfig; provider: AiProviderId; model: string; role: AiRole; source: 'role' | 'fallback' | 'auto' }
export interface AiTaskMeta { workspaceId: string; userId?: string | null; taskType: string; role: AiRole; requestId: string; resourceType?: string; resourceId?: string; promptVersion?: string }
export interface AiTaskOutcome<T> { result: T; provider: AiProviderId; model: string; usage: Usage; costUsd: number | null; latencyMs: number; taskId: string; fallbackUsed: boolean }

/** ยังไม่มี key ของผู้ให้บริการ AI เลย — ผู้ใช้ต้องไปตั้งที่หน้า "โมเดล AI" */
export class AiNotConfiguredError extends Error {
  constructor(message = 'ยังไม่ได้ตั้งค่า AI — ใส่ API key ของผู้ให้บริการอย่างน้อย 1 รายที่หน้า "โมเดล AI"') { super(message); this.name = 'AiNotConfiguredError'; }
}
/** งบ AI เดือนนี้ถูกใช้หมดแล้ว — กันไว้ก่อนยิงคำขอ */
export class AiBudgetExceededError extends Error {
  constructor(public readonly budgetUsd: number, public readonly costUsd: number) {
    super(`งบ AI เดือนนี้ (${budgetUsd} USD) ถูกใช้หมดแล้ว — เพิ่มงบที่หน้า "โมเดล AI"`); this.name = 'AiBudgetExceededError';
  }
}

const ROLE_FALLBACK_ORDER: Record<AiRole, AiRole[]> = {
  strategy: ['strategy', 'fallback', 'content', 'analysis'], content: ['content', 'fallback', 'strategy'], analysis: ['analysis', 'fallback', 'strategy'],
  community: ['community', 'fast', 'fallback', 'content'], research: ['research', 'fallback', 'strategy'], vision: ['vision', 'fallback'],
  fast: ['fast', 'fallback', 'content'], fallback: ['fallback', 'strategy', 'content'],
};

/** key ของ provider — จาก BYOK ของ workspace ก่อน ไม่มีจึงใช้ key ระดับแพลตฟอร์มจาก env (§42) */
export async function providerConfig(ctx: AiTaskContext, workspaceId: string, provider: AiProviderId, model: string): Promise<ProviderConfig | null> {
  const row = await ctx.prisma.aiProviderKey.findUnique({ where: { workspaceId_provider: { workspaceId, provider } }, select: { encryptedApiKey: true, baseUrl: true, status: true } });
  if (row && row.status === 'ACTIVE') return { provider, apiKey: row.encryptedApiKey ? decryptSecret(row.encryptedApiKey, ctx.env.AUTH_SECRET) : '', model, baseUrl: row.baseUrl ?? undefined };
  const platform: Partial<Record<AiProviderId, { key?: string; baseUrl?: string }>> = {
    openai: { key: ctx.env.OPENAI_API_KEY }, anthropic: { key: ctx.env.ANTHROPIC_API_KEY }, gemini: { key: ctx.env.GOOGLE_AI_API_KEY }, openrouter: { key: ctx.env.OPENROUTER_API_KEY },
    compatible: { key: ctx.env.LITELLM_API_KEY, baseUrl: ctx.env.LITELLM_BASE_URL },
  };
  const p = platform[provider];
  if (p?.key || (provider === 'compatible' && p?.baseUrl)) return { provider, apiKey: p.key ?? '', model, baseUrl: p.baseUrl };
  return null;
}

/** เลือก provider/model ตามบทบาท (§5) — ไม่ตั้งไว้ → fallback → provider แรกที่มี key */
export async function resolveModel(ctx: AiTaskContext, workspaceId: string, role: AiRole, exclude: AiProviderId[] = []): Promise<ResolvedModel> {
  const roles = await ctx.prisma.aiRoleConfig.findMany({ where: { workspaceId }, select: { role: true, provider: true, model: true } });
  for (const r of ROLE_FALLBACK_ORDER[role]) {
    const c = roles.find(x => x.role === r);
    if (!c || exclude.includes(c.provider as AiProviderId)) continue;
    const cfg = await providerConfig(ctx, workspaceId, c.provider as AiProviderId, c.model);
    if (cfg) return { cfg, provider: cfg.provider, model: c.model, role, source: r === role ? 'role' : 'fallback' };
  }
  const keys = await ctx.prisma.aiProviderKey.findMany({ where: { workspaceId, status: 'ACTIVE' }, select: { provider: true }, orderBy: { createdAt: 'asc' } });
  const candidates: AiProviderId[] = [...keys.map(k => k.provider as AiProviderId), 'gemini', 'anthropic', 'openai', 'openrouter', 'compatible'];
  for (const p of candidates) {
    if (exclude.includes(p) || !PROVIDERS[p]?.defaultModel && p !== 'compatible') continue;
    const cfg = await providerConfig(ctx, workspaceId, p, p === 'gemini' ? (ctx.env.GOOGLE_AI_MODEL || PROVIDERS[p].defaultModel) : PROVIDERS[p].defaultModel);
    if (cfg && (cfg.model || p !== 'compatible')) return { cfg, provider: p, model: cfg.model ?? '', role, source: 'auto' };
  }
  throw new AiNotConfiguredError();
}

/** ค่าใช้จ่าย AI เดือนนี้ (UTC) ของ workspace */
export async function monthUsage(prisma: PrismaClient, workspaceId: string): Promise<{ costUsd: number; tasks: number; failed: number; since: Date }> {
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const agg = await prisma.aiTaskLog.aggregate({ where: { workspaceId, createdAt: { gte: since } }, _sum: { estimatedCost: true }, _count: { _all: true } });
  const failed = await prisma.aiTaskLog.count({ where: { workspaceId, createdAt: { gte: since }, success: false } });
  return { costUsd: Number(agg._sum.estimatedCost ?? 0), tasks: agg._count._all, failed, since };
}

export async function assertBudget(ctx: AiTaskContext, workspaceId: string): Promise<void> {
  const ws = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiMonthlyBudgetUsd: true } });
  if (ws.aiMonthlyBudgetUsd == null) return;
  const { costUsd, since } = await monthUsage(ctx.prisma, workspaceId);
  const budget = Number(ws.aiMonthlyBudgetUsd);
  if (budget > 0 && costUsd / budget >= 0.85 && ctx.notifyBudget) {
    await ctx.notifyBudget(workspaceId, { percent: Math.round((costUsd / budget) * 100), costUsd, budgetUsd: budget, monthKey: since.toISOString().slice(0, 7) });
  }
  if (costUsd >= budget) throw new AiBudgetExceededError(budget, costUsd);
}

/** บันทึก AiTaskLog หนึ่งแถว — ทุกคำขอ AI ต้องผ่านตรงนี้ ไม่ว่าจะสำเร็จหรือล้ม (§50) */
export function logAiTask(prisma: PrismaClient, meta: AiTaskMeta, r: { provider: string; model: string; latencyMs: number; usage: Usage; costUsd: number | null; success: boolean; retry: number; error?: string }): Promise<{ id: string }> {
  return prisma.aiTaskLog.create({
    data: {
      workspaceId: meta.workspaceId, taskType: meta.taskType, role: meta.role, provider: r.provider, model: r.model, promptVersion: meta.promptVersion ?? null,
      latencyMs: r.latencyMs, inputTokens: r.usage.input, outputTokens: r.usage.output, estimatedCost: r.costUsd, success: r.success, retry: r.retry,
      resourceType: meta.resourceType ?? null, resourceId: meta.resourceId ?? null, requestId: meta.requestId, error: r.error ?? null,
    }, select: { id: true },
  });
}

/** เกินเพดานต่อ task: ไม่ทิ้งผลลัพธ์ที่จ่ายไปแล้ว แต่ติดหมายเหตุไว้ใน log ให้เห็น */
async function markPerTaskCap(prisma: PrismaClient, workspaceId: string, costUsd: number | null): Promise<void> {
  if (costUsd == null) return;
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiMaxCostPerTaskUsd: true } });
  if (ws.aiMaxCostPerTaskUsd != null && costUsd > Number(ws.aiMaxCostPerTaskUsd)) {
    await prisma.aiTaskLog.updateMany({ where: { workspaceId, createdAt: { gte: new Date(Date.now() - 5000) }, error: null }, data: { error: `เกินเพดานต่อ task (${costUsd.toFixed(4)} > ${Number(ws.aiMaxCostPerTaskUsd)} USD)` } });
  }
}

/** รัน task หนึ่งครั้งพร้อม log — provider ล้มแบบ retryable จะลอง provider อื่น 1 ครั้ง */
export async function runAiTask<T>(ctx: AiTaskContext, meta: AiTaskMeta, fn: (cfg: ProviderConfig, resolved: ResolvedModel) => Promise<{ result: T; usage: Usage; model?: string }>): Promise<AiTaskOutcome<T>> {
  await assertBudget(ctx, meta.workspaceId);
  const tried: AiProviderId[] = []; let lastErr: unknown; let retry = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    let resolved: ResolvedModel;
    try { resolved = await resolveModel(ctx, meta.workspaceId, meta.role, tried); } catch (e) { if (attempt === 0) throw e; break; }
    tried.push(resolved.provider);
    const t0 = Date.now();
    try {
      const out = await fn(resolved.cfg, resolved);
      const model = out.model ?? resolved.model; const costUsd = estimateCostUsd(model, out.usage);
      const log = await logAiTask(ctx.prisma, meta, { provider: resolved.provider, model, latencyMs: Date.now() - t0, usage: out.usage, costUsd, success: true, retry });
      await markPerTaskCap(ctx.prisma, meta.workspaceId, costUsd);
      return { result: out.result, provider: resolved.provider, model, usage: out.usage, costUsd, latencyMs: Date.now() - t0, taskId: log.id, fallbackUsed: attempt > 0 };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof AiProviderError ? e.userMessage : e instanceof Error ? e.message : String(e);
      await logAiTask(ctx.prisma, meta, { provider: resolved.provider, model: resolved.model, latencyMs: Date.now() - t0, usage: { input: null, output: null }, costUsd: null, success: false, retry, error: msg.slice(0, 500) });
      if (!(e instanceof AiProviderError) || !e.isRetryable) break;
      retry++;
    }
  }
  throw lastErr ?? new Error('AI ล้มเหลว');
}

/** structured output ผ่านทางเดินเดียวกัน — ตัวช่วยที่โมดูลส่วนใหญ่ใช้ */
export function runStructuredTask<T>(ctx: AiTaskContext, meta: AiTaskMeta, input: StructuredInput<T>): Promise<AiTaskOutcome<StructuredResult<T>>> {
  return runAiTask(ctx, meta, async cfg => { const r = await generateStructured(cfg, input); return { result: r, usage: r.usage, model: r.model }; });
}
