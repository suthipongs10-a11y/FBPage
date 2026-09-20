/**
 * AiGatewayService — จุดเดียวที่โค้ดใน API เรียก AI (§4, §5)
 * ตรรกะจริง (เลือกโมเดลตามบทบาท, BYOK, งบ, retry/fallback, AiTaskLog) อยู่ที่ `@fbpm/ai-core/task-runner`
 * เพื่อให้ worker ที่ไม่มี NestJS ใช้ทางเดินเดียวกันได้ — ที่นี่เหลือหน้าที่ฉีด dependency และแปลง error เป็น HTTP
 */
import { HttpException, HttpStatus, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { AiBudgetExceededError, AiNotConfiguredError, AiProviderError, PROVIDERS, chat, estimateCostUsd, generateStructured, logAiTask, monthUsage, providerConfig, resolveModel, runAiTask, runToolLoop, type AiProviderId, type AiTaskContext, type AiTaskMeta, type AiTaskOutcome, type ChatRequest, type ChatResult, type ProviderConfig, type ResolvedModel, type StructuredInput, type StructuredResult, type ToolLoopInput, type ToolLoopResult, type Usage } from '@fbpm/ai-core';
import type { AiRole } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';

export type { ResolvedModel } from '@fbpm/ai-core';
export type TaskMeta = AiTaskMeta;
export type TaskOutcome<T> = AiTaskOutcome<T>;

/** งบหมด → 402, ยังไม่ตั้งค่า AI → 422, provider ล้ม → 502 — ที่เดียวที่แปลง error ของชั้น AI เป็น HTTP */
export function toHttpAiError(e: unknown): unknown {
  if (e instanceof AiBudgetExceededError) return new HttpException({ statusCode: HttpStatus.PAYMENT_REQUIRED, message: e.message }, HttpStatus.PAYMENT_REQUIRED);
  if (e instanceof AiNotConfiguredError) return new UnprocessableEntityException(e.message);
  if (e instanceof AiProviderError) return new HttpException({ statusCode: HttpStatus.BAD_GATEWAY, message: e.userMessage, provider: e.provider }, HttpStatus.BAD_GATEWAY);
  if (e instanceof HttpException) return e;
  return new HttpException({ statusCode: HttpStatus.BAD_GATEWAY, message: e instanceof Error ? e.message : 'AI ล้มเหลว' }, HttpStatus.BAD_GATEWAY);
}

@Injectable()
export class AiGatewayService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  /** context ที่ชั้น AI ต้องใช้ — worker สร้างอันของตัวเองด้วย buildAiContext() */
  get ctx(): AiTaskContext {
    return {
      prisma: this.prisma, env: this.env,
      notifyBudget: async (workspaceId, b) => {
        await this.notifications.notify(workspaceId, { type: 'ai_budget', severity: 'warn', title: `งบ AI เดือนนี้ใช้ไปแล้ว ${b.percent}%`, body: `${b.costUsd.toFixed(2)} / ${b.budgetUsd} USD`, href: '/ai-models', dedupeKey: `ai_budget:${b.monthKey}` });
      },
    };
  }

  /** เลือก provider/model ตามบทบาท (§5) */
  async resolve(workspaceId: string, role: AiRole, exclude: AiProviderId[] = []): Promise<ResolvedModel> {
    try { return await resolveModel(this.ctx, workspaceId, role, exclude); } catch (e) { throw toHttpAiError(e); }
  }

  /** ค่าใช้จ่าย AI เดือนนี้ (UTC) ของ workspace */
  monthUsage(workspaceId: string): Promise<{ costUsd: number; tasks: number; failed: number; since: Date }> {
    return monthUsage(this.prisma, workspaceId);
  }

  /** รัน task หนึ่งครั้งพร้อม log — fn ได้รับ config ของโมเดลที่เลือก; ถ้า provider ล้มแบบ retryable จะลอง fallback provider อื่น 1 ครั้ง */
  async run<T>(meta: TaskMeta, fn: (cfg: ProviderConfig, resolved: ResolvedModel) => Promise<{ result: T; usage: Usage; model?: string }>): Promise<TaskOutcome<T>> {
    try { return await runAiTask(this.ctx, meta, fn); } catch (e) { throw toHttpAiError(e); }
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
    const cfg = await providerConfig(this.ctx, workspaceId, provider, PROVIDERS[provider].defaultModel);
    if (!cfg) return { ok: false, model: '', latencyMs: 0, error: 'ยังไม่มี key' };
    const roleModel = await this.prisma.aiRoleConfig.findFirst({ where: { workspaceId, provider }, select: { model: true } });
    cfg.model = roleModel?.model || cfg.model;
    if (!cfg.model) return { ok: false, model: '', latencyMs: 0, error: 'ต้องระบุชื่อโมเดลในบทบาทใดบทบาทหนึ่งก่อน' };
    const t0 = Date.now();
    const meta: TaskMeta = { workspaceId, userId, taskType: 'provider.validate', role: 'fast', requestId };
    try {
      const r = await chat(cfg, { messages: [{ role: 'user', content: 'ตอบคำเดียวว่า OK' }], maxTokens: 20 });
      await logAiTask(this.prisma, meta, { provider, model: r.model, latencyMs: Date.now() - t0, usage: r.usage, costUsd: estimateCostUsd(r.model, r.usage), success: true, retry: 0 });
      return { ok: true, model: r.model, latencyMs: Date.now() - t0 };
    } catch (e) {
      const msg = e instanceof AiProviderError ? e.userMessage : (e as Error).message;
      await logAiTask(this.prisma, meta, { provider, model: cfg.model ?? '', latencyMs: Date.now() - t0, usage: { input: null, output: null }, costUsd: null, success: false, retry: 0, error: msg.slice(0, 500) });
      return { ok: false, model: cfg.model ?? '', latencyMs: Date.now() - t0, error: msg };
    }
  }
}
