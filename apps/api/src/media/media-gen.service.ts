/**
 * ภาพจาก AI (N-3) — ใช้คีย์ AiConnection เดิม (OpenAI/Gemini/OpenRouter/compatible) เรียกผ่าน generateImage ของ @fbpm/ai-core (HTTP ล้วน)
 * - ค่าเริ่มต้นต่องาน (purpose) ตั้งใน MediaModelConfig · เลือกรายครั้งได้ด้วย override
 * - เพดานจำนวนภาพต่อเดือนแยกจากงบข้อความ (Workspace.mediaMonthlyImageLimit) · ราคาต่อภาพกรอกเอง ไม่รู้ = null
 * - ทุกครั้งบันทึก MediaJob (รวมที่ล้มเหลว) · idempotencyKey เดิมที่สำเร็จแล้วคืนภาพเดิม ไม่ยิงซ้ำ
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { contentInWorkspace } from '@fbpm/database';
import { AiProviderError, IMAGE_PROVIDERS, generateImage, resolveOverride, type AiProviderId } from '@fbpm/ai-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService, toHttpAiError } from '../ai/gateway.service';

export type MediaPurpose = 'IMAGE_POST';
export interface ImageGenInput { contentId?: string | null; prompt: string; purpose?: MediaPurpose; override?: { connectionId: string; model?: string } | null; attach?: boolean; idempotencyKey?: string }
const ASSET_SELECT = { id: true, contentId: true, kind: true, path: true, mimeType: true, width: true, height: true, bytes: true, aiGenerated: true, createdAt: true } as const;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
/** ต่อท้ายทุกคำสั่งภาพ — ภาพประกอบเชิงสัญลักษณ์ ไม่ใช่ภาพถ่ายเหตุการณ์จริง */
export const IMAGE_SAFETY_SUFFIX = 'Editorial illustration, symbolic, no text, no letters, no logos, no watermarks, no identifiable real people or faces, not photorealistic news photography.';

@Injectable()
export class MediaGenService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService, @Inject(AiGatewayService) private readonly ai: AiGatewayService) {}

  private monthStart() { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); }

  async getConfig(workspaceId: string) {
    const [cfg, ws, used] = await Promise.all([
      this.prisma.mediaModelConfig.findUnique({ where: { workspaceId_purpose: { workspaceId, purpose: 'IMAGE_POST' } }, select: { connectionId: true, model: true, unitCostUsd: true, connection: { select: { label: true, kind: true, status: true } } } }),
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { mediaMonthlyImageLimit: true } }),
      this.prisma.mediaJob.aggregate({ where: { workspaceId, createdAt: { gte: this.monthStart() }, status: { not: 'FAILED' } }, _count: { _all: true }, _sum: { costUsd: true } }),
    ]);
    const costKnown = cfg?.unitCostUsd != null;
    return {
      image: cfg ? { connectionId: cfg.connectionId, model: cfg.model, unitCostUsd: cfg.unitCostUsd == null ? null : Number(cfg.unitCostUsd), connectionLabel: cfg.connection.label, kind: cfg.connection.kind, connectionStatus: cfg.connection.status } : null,
      monthlyImageLimit: ws.mediaMonthlyImageLimit,
      usedThisMonth: used._count._all,
      costThisMonthUsd: costKnown ? Number(used._sum.costUsd ?? 0) : null,
      supportedKinds: IMAGE_PROVIDERS,
    };
  }

  async setConfig(workspaceId: string, userId: string, dto: { connectionId?: string | null; model?: string; unitCostUsd?: number | null; monthlyImageLimit?: number | null }, requestId: string) {
    if (dto.connectionId) {
      const c = await this.prisma.aiConnection.findFirst({ where: { id: dto.connectionId, workspaceId }, select: { kind: true, label: true } });
      if (!c) throw new NotFoundException('ไม่พบคีย์ AI');
      if (!IMAGE_PROVIDERS.includes(c.kind as AiProviderId)) throw new UnprocessableEntityException(`${c.label} สร้างภาพไม่ได้ — ใช้คีย์ OpenAI, Gemini หรือ OpenRouter`);
      if (!dto.model) throw new UnprocessableEntityException('ระบุชื่อโมเดลภาพ เช่น gpt-image-1 หรือ gemini-2.5-flash-image');
      const data = { connectionId: dto.connectionId, model: dto.model, unitCostUsd: dto.unitCostUsd ?? null };
      await this.prisma.mediaModelConfig.upsert({ where: { workspaceId_purpose: { workspaceId, purpose: 'IMAGE_POST' } }, create: { workspaceId, purpose: 'IMAGE_POST', ...data }, update: data });
    } else if (dto.connectionId === null) {
      await this.prisma.mediaModelConfig.deleteMany({ where: { workspaceId, purpose: 'IMAGE_POST' } });
    }
    if (dto.monthlyImageLimit !== undefined) await this.prisma.workspace.update({ where: { id: workspaceId }, data: { mediaMonthlyImageLimit: dto.monthlyImageLimit } });
    await this.audit.log({ workspaceId, userId, action: 'media.ai_config.set', resourceType: 'workspace', resourceId: workspaceId, after: dto, requestId });
    return this.getConfig(workspaceId);
  }

  /** สร้างภาพหนึ่งภาพ → ไฟล์ใน MEDIA_DIR + MediaAsset(aiGenerated) · attach = เพิ่มเข้า mediaPaths ของคอนเทนต์ */
  async generate(workspaceId: string, userId: string, input: ImageGenInput, requestId: string) {
    const purpose = input.purpose ?? 'IMAGE_POST';
    if (input.contentId) {
      const c = await this.prisma.contentItem.findFirst({ where: { id: input.contentId, ...contentInWorkspace(workspaceId) }, select: { mediaPaths: true } });
      if (!c) throw new NotFoundException('ไม่พบคอนเทนต์');
      if (input.attach && c.mediaPaths.length >= 10) throw new UnprocessableEntityException('แนบรูปได้สูงสุด 10 ใบ');
    }
    const key = input.idempotencyKey ? `img:${workspaceId}:${input.idempotencyKey}` : `img:${workspaceId}:${randomUUID()}`;
    const prior = await this.prisma.mediaJob.findUnique({ where: { idempotencyKey: key }, select: { status: true, outputAssetId: true } });
    if (prior?.status === 'SUCCEEDED' && prior.outputAssetId) {
      const asset = await this.prisma.mediaAsset.findFirst({ where: { id: prior.outputAssetId, workspaceId }, select: ASSET_SELECT });
      if (asset) return { asset, reused: true, provider: null, model: null, costUsd: null };
    }
    if (prior?.status === 'RUNNING') throw new HttpException('ภาพนี้กำลังสร้างอยู่ — รอสักครู่', HttpStatus.CONFLICT);

    // เลือกคีย์: override ต่อครั้ง → ค่าเริ่มต้นของงานนี้
    const cfgRow = input.override ? null : await this.prisma.mediaModelConfig.findUnique({ where: { workspaceId_purpose: { workspaceId, purpose } }, select: { connectionId: true, model: true, unitCostUsd: true } });
    const pick = input.override ?? (cfgRow ? { connectionId: cfgRow.connectionId, model: cfgRow.model } : null);
    if (!pick) throw new UnprocessableEntityException('ยังไม่ได้ตั้งโมเดลสร้างภาพ — ตั้งที่หน้าโมเดล AI (ส่วน "ภาพจาก AI")');
    let resolved; try { resolved = await resolveOverride(this.ai.ctx, workspaceId, 'content', pick); } catch (e) { throw toHttpAiError(e); }
    if (!IMAGE_PROVIDERS.includes(resolved.provider)) throw new UnprocessableEntityException(`${resolved.connectionLabel ?? resolved.provider} สร้างภาพไม่ได้ — ใช้คีย์ OpenAI, Gemini หรือ OpenRouter`);
    const unitCost = input.override ? null : cfgRow?.unitCostUsd ?? null;

    // เพดานรายเดือน (นับงานที่ไม่ล้มเหลว)
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { mediaMonthlyImageLimit: true } });
    if (ws.mediaMonthlyImageLimit != null) {
      const used = await this.prisma.mediaJob.count({ where: { workspaceId, createdAt: { gte: this.monthStart() }, status: { not: 'FAILED' } } });
      if (used >= ws.mediaMonthlyImageLimit) throw new HttpException({ statusCode: HttpStatus.PAYMENT_REQUIRED, message: `ครบเพดานภาพ AI เดือนนี้แล้ว (${used}/${ws.mediaMonthlyImageLimit} ภาพ) — ปรับได้ที่หน้าโมเดล AI` }, HttpStatus.PAYMENT_REQUIRED);
    }

    const prompt = `${input.prompt.trim().slice(0, 1500)}\n\n${IMAGE_SAFETY_SUFFIX}`;
    const job = prior
      ? await this.prisma.mediaJob.update({ where: { idempotencyKey: key }, data: { status: 'RUNNING', error: null, provider: resolved.provider, model: resolved.model, connectionId: resolved.connectionId, prompt } })
      : await this.prisma.mediaJob.create({ data: { workspaceId, contentId: input.contentId ?? null, purpose, connectionId: resolved.connectionId, provider: resolved.provider, model: resolved.model, prompt, idempotencyKey: key, requestedById: userId } });
    const t0 = Date.now();
    try {
      const img = await generateImage(resolved.cfg, { prompt });
      const dir = resolve(this.env.MEDIA_DIR, workspaceId); mkdirSync(dir, { recursive: true });
      const out = join(dir, `ai-${job.id}.${EXT[img.mimeType] ?? 'png'}`);
      await writeFile(out, img.bytes);
      const asset = await this.prisma.mediaAsset.create({ data: { workspaceId, contentId: input.contentId ?? null, kind: 'ai', path: out, mimeType: img.mimeType, bytes: img.bytes.byteLength, aiGenerated: true, sha256: createHash('sha256').update(img.bytes).digest('hex'), mediaJobId: job.id, meta: { provider: resolved.provider, model: resolved.model, prompt: input.prompt.slice(0, 1500) } as Prisma.InputJsonValue, createdById: userId }, select: ASSET_SELECT });
      if (input.contentId && input.attach) await this.prisma.contentItem.update({ where: { id: input.contentId }, data: { mediaPaths: { push: out }, contentType: 'photo' } });
      await this.prisma.mediaJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', outputAssetId: asset.id, costUsd: unitCost, durationMs: Date.now() - t0, finishedAt: new Date() } });
      await this.audit.log({ workspaceId, userId, action: 'media.ai_image', resourceType: 'mediaAsset', resourceId: asset.id, after: { provider: resolved.provider, model: resolved.model, connectionId: resolved.connectionId, contentId: input.contentId ?? null, attached: !!(input.contentId && input.attach) }, requestId });
      return { asset, reused: false, provider: resolved.provider, model: resolved.model, costUsd: unitCost == null ? null : Number(unitCost) };
    } catch (e) {
      const msg = e instanceof AiProviderError ? e.userMessage : (e as Error).message;
      await this.prisma.mediaJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: msg.slice(0, 500), durationMs: Date.now() - t0, finishedAt: new Date() } });
      throw toHttpAiError(e);
    }
  }

  /** ไฟล์ภาพ → data URL (ใช้ฝังในการ์ดข่าว) */
  static dataUrl(bytes: Buffer, mimeType: string) { return `data:${mimeType};base64,${bytes.toString('base64')}`; }
}
