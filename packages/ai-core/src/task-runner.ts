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
export interface ResolvedModel {
  cfg: ProviderConfig; provider: AiProviderId; model: string; role: AiRole;
  /** คีย์ใบไหนที่ถูกเลือก — null เมื่อมาจาก key ระดับแพลตฟอร์มใน env ซึ่งไม่มีแถวใน AiConnection */
  connectionId: string | null; connectionLabel: string | null;
  source: 'override' | 'role' | 'fallback' | 'auto';
}
/** สั่งใช้คีย์ใบนี้โมเดลนี้เฉพาะครั้งนี้ ข้ามการเลือกตามบทบาท — งบและ log ยังทำงานเหมือนเดิมทุกอย่าง */
export interface AiModelOverride { connectionId: string; model?: string }
export interface AiTaskMeta { workspaceId: string; userId?: string | null; taskType: string; role: AiRole; requestId: string; resourceType?: string; resourceId?: string; promptVersion?: string; override?: AiModelOverride | null }
export interface AiTaskOutcome<T> { result: T; provider: AiProviderId; model: string; usage: Usage; costUsd: number | null; latencyMs: number; taskId: string; connectionId: string | null; fallbackUsed: boolean }

/** ระบุคีย์ที่ override มาไม่ได้ — ถูกลบไปแล้ว ปิดอยู่ หรือเป็นของพื้นที่ทำงานอื่น */
export class AiConnectionUnavailableError extends Error {
  constructor(public readonly connectionId: string) { super('คีย์ AI ที่เลือกใช้ไม่ได้แล้ว — เลือกใหม่ที่หน้า "โมเดล AI"'); this.name = 'AiConnectionUnavailableError'; }
}

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

/** คีย์หนึ่งใบที่ถูกเลือกไว้แล้ว → config ที่อะแดปเตอร์ใช้ได้ */
interface ConnectionRow { id: string; label: string; kind: string; encryptedApiKey: string; baseUrl: string | null }
const CONNECTION_SELECT = { id: true, label: true, kind: true, encryptedApiKey: true, baseUrl: true } as const;

function configFromConnection(ctx: AiTaskContext, row: ConnectionRow, model: string): ProviderConfig {
  return { provider: row.kind as AiProviderId, apiKey: row.encryptedApiKey ? decryptSecret(row.encryptedApiKey, ctx.env.AUTH_SECRET) : '', model, baseUrl: row.baseUrl ?? undefined };
}

/** key ระดับแพลตฟอร์มจาก env — ใช้เมื่อ workspace ยังไม่ได้ใส่คีย์ของตัวเอง (§42) */
export function platformConfig(ctx: AiTaskContext, provider: AiProviderId, model: string): ProviderConfig | null {
  const platform: Partial<Record<AiProviderId, { key?: string; baseUrl?: string }>> = {
    openai: { key: ctx.env.OPENAI_API_KEY }, anthropic: { key: ctx.env.ANTHROPIC_API_KEY }, gemini: { key: ctx.env.GOOGLE_AI_API_KEY }, openrouter: { key: ctx.env.OPENROUTER_API_KEY },
    compatible: { key: ctx.env.LITELLM_API_KEY, baseUrl: ctx.env.LITELLM_BASE_URL },
  };
  const p = platform[provider];
  if (p?.key || (provider === 'compatible' && p?.baseUrl)) return { provider, apiKey: p.key ?? '', model, baseUrl: p.baseUrl };
  return null;
}

/** คีย์ใบที่ระบุ — ใช้กับ override ต่อครั้ง ไม่เจอ/ปิดอยู่ = error ไม่เงียบ ๆ ไปใช้ใบอื่น */
export async function resolveOverride(ctx: AiTaskContext, workspaceId: string, role: AiRole, override: AiModelOverride): Promise<ResolvedModel> {
  const row = await ctx.prisma.aiConnection.findFirst({ where: { id: override.connectionId, workspaceId, status: 'ACTIVE' }, select: { ...CONNECTION_SELECT, models: true } });
  if (!row) throw new AiConnectionUnavailableError(override.connectionId);
  const roleCfg = override.model ? null : await ctx.prisma.aiRoleConfig.findFirst({ where: { workspaceId, connectionId: row.id }, select: { model: true } });
  const model = override.model || roleCfg?.model || row.models[0] || PROVIDERS[row.kind as AiProviderId]?.defaultModel || '';
  if (!model) throw new AiConnectionUnavailableError(override.connectionId);
  return { cfg: configFromConnection(ctx, row, model), provider: row.kind as AiProviderId, model, role, connectionId: row.id, connectionLabel: row.label, source: 'override' };
}

/**
 * เลือกคีย์+โมเดลตามบทบาท (§5) — บทบาทชี้ไปที่คีย์ใบหนึ่งโดยตรง
 * ไม่ได้ตั้งบทบาทนี้ไว้ → ไล่ตามบทบาทสำรอง → คีย์ใบแรกที่ยังเปิดอยู่ → key ระดับแพลตฟอร์มจาก env
 * `exclude` เป็นรายการ connectionId ที่ลองแล้วล้ม (ใช้ตอน fallback) — key จาก env ใช้ชื่อเทียม `env:<kind>`
 */
export async function resolveModel(ctx: AiTaskContext, workspaceId: string, role: AiRole, exclude: string[] = []): Promise<ResolvedModel> {
  const roles = await ctx.prisma.aiRoleConfig.findMany({ where: { workspaceId }, select: { role: true, model: true, connection: { select: { ...CONNECTION_SELECT, status: true } } } });
  for (const r of ROLE_FALLBACK_ORDER[role]) {
    const c = roles.find(x => x.role === r);
    if (!c || c.connection.status !== 'ACTIVE' || exclude.includes(c.connection.id)) continue;
    return { cfg: configFromConnection(ctx, c.connection, c.model), provider: c.connection.kind as AiProviderId, model: c.model, role, connectionId: c.connection.id, connectionLabel: c.connection.label, source: r === role ? 'role' : 'fallback' };
  }
  const connections = await ctx.prisma.aiConnection.findMany({ where: { workspaceId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { ...CONNECTION_SELECT, models: true } });
  for (const row of connections) {
    if (exclude.includes(row.id)) continue;
    const model = row.models[0] || PROVIDERS[row.kind as AiProviderId]?.defaultModel || '';
    if (!model) continue;   // compatible ที่ไม่ได้ระบุโมเดลไว้เลย เดาชื่อโมเดลเองไม่ได้
    return { cfg: configFromConnection(ctx, row, model), provider: row.kind as AiProviderId, model, role, connectionId: row.id, connectionLabel: row.label, source: 'auto' };
  }
  for (const p of ['gemini', 'anthropic', 'openai', 'openrouter', 'compatible'] as AiProviderId[]) {
    if (exclude.includes(`env:${p}`)) continue;
    const model = p === 'gemini' ? (ctx.env.GOOGLE_AI_MODEL || PROVIDERS[p].defaultModel) : PROVIDERS[p].defaultModel;
    const cfg = platformConfig(ctx, p, model);
    if (cfg?.model) return { cfg, provider: p, model: cfg.model, role, connectionId: null, connectionLabel: null, source: 'auto' };
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
export function logAiTask(prisma: PrismaClient, meta: AiTaskMeta, r: { provider: string; model: string; connectionId?: string | null; latencyMs: number; usage: Usage; costUsd: number | null; success: boolean; retry: number; error?: string }): Promise<{ id: string }> {
  return prisma.aiTaskLog.create({
    data: {
      workspaceId: meta.workspaceId, taskType: meta.taskType, role: meta.role, provider: r.provider, connectionId: r.connectionId ?? null, model: r.model, promptVersion: meta.promptVersion ?? null,
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
  // override = ผู้ใช้เลือกเองครั้งนี้ ใช้ใบนั้นใบเดียว ไม่เงียบ ๆ เปลี่ยนไปใบอื่นให้
  const attempts = meta.override ? 1 : 2;
  const tried: string[] = []; let lastErr: unknown; let retry = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let resolved: ResolvedModel;
    try {
      resolved = meta.override ? await resolveOverride(ctx, meta.workspaceId, meta.role, meta.override) : await resolveModel(ctx, meta.workspaceId, meta.role, tried);
    } catch (e) { if (attempt === 0) throw e; break; }
    tried.push(resolved.connectionId ?? `env:${resolved.provider}`);
    const t0 = Date.now();
    try {
      const out = await fn(resolved.cfg, resolved);
      const model = out.model ?? resolved.model; const costUsd = estimateCostUsd(model, out.usage);
      const log = await logAiTask(ctx.prisma, meta, { provider: resolved.provider, connectionId: resolved.connectionId, model, latencyMs: Date.now() - t0, usage: out.usage, costUsd, success: true, retry });
      await markPerTaskCap(ctx.prisma, meta.workspaceId, costUsd);
      return { result: out.result, provider: resolved.provider, model, usage: out.usage, costUsd, latencyMs: Date.now() - t0, taskId: log.id, connectionId: resolved.connectionId, fallbackUsed: attempt > 0 };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof AiProviderError ? e.userMessage : e instanceof Error ? e.message : String(e);
      await logAiTask(ctx.prisma, meta, { provider: resolved.provider, connectionId: resolved.connectionId, model: resolved.model, latencyMs: Date.now() - t0, usage: { input: null, output: null }, costUsd: null, success: false, retry, error: msg.slice(0, 500) });
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
