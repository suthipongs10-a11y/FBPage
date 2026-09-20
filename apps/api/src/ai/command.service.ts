/**
 * AI Command Center (§37) — แชทที่ผูกกับข้อมูลจริงของ workspace ผ่าน tool registry
 * บริบท (client/brand/page/ช่วงวัน) ถูกล็อกจากฝั่งเซิร์ฟเวอร์ — AI เปลี่ยนเองไม่ได้
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { brandInWorkspace, pageInWorkspace } from '@fbpm/database';
import type { AiMessage, ToolStep } from '@fbpm/ai-core';
import { toolAllowedWithoutApproval, type Permission, type ToolContext } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { AiGatewayService } from './gateway.service';
import { buildTools, toToolDefs, type AgentTool } from './tools';
import type { CommandDto } from './dto';

export const COMMAND_PROMPT_VERSION = 'command-v1';

@Injectable()
export class CommandService {
  private readonly tools: AgentTool[];
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AiGatewayService) private readonly ai: AiGatewayService) {
    this.tools = buildTools({ prisma });
  }

  /** ตรวจว่า context ที่ส่งมาอยู่ใน workspace จริง แล้วสร้างคำอธิบายบริบทให้โมเดล */
  private async describeContext(workspaceId: string, c: CommandDto['context']): Promise<{ ctx: Omit<ToolContext, 'userId' | 'requestId'>; text: string }> {
    const parts: string[] = [];
    const ctx: Omit<ToolContext, 'userId' | 'requestId'> = { workspaceId };
    if (c.pageId) {
      const p = await this.prisma.facebookPage.findFirst({ where: { id: c.pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, name: true, brandId: true, brand: { select: { name: true, clientId: true, client: { select: { name: true } } } } } });
      if (!p) throw new NotFoundException('ไม่พบเพจในบริบท');
      ctx.pageId = p.id; ctx.brandId = p.brandId; ctx.clientId = p.brand.clientId;
      parts.push(`เพจ: ${p.name} (pageId=${p.id}) · แบรนด์: ${p.brand.name} · ลูกค้า: ${p.brand.client.name}`);
    } else if (c.brandId) {
      const b = await this.prisma.brand.findFirst({ where: { id: c.brandId, ...brandInWorkspace(workspaceId) }, select: { id: true, name: true, clientId: true, client: { select: { name: true } } } });
      if (!b) throw new NotFoundException('ไม่พบแบรนด์ในบริบท');
      ctx.brandId = b.id; ctx.clientId = b.clientId; parts.push(`แบรนด์: ${b.name} (brandId=${b.id}) · ลูกค้า: ${b.client.name}`);
    } else if (c.clientId) {
      const cl = await this.prisma.client.findFirst({ where: { id: c.clientId, workspaceId }, select: { id: true, name: true } });
      if (!cl) throw new NotFoundException('ไม่พบลูกค้าในบริบท');
      ctx.clientId = cl.id; parts.push(`ลูกค้า: ${cl.name} (clientId=${cl.id})`);
    } else parts.push('ทั้ง workspace (ยังไม่เลือกลูกค้า/เพจ)');
    parts.push(`ช่วงข้อมูล: ${c.days} วันล่าสุด`);
    return { ctx, text: parts.join('\n') };
  }

  async command(workspaceId: string, userId: string, permissions: readonly Permission[], dto: CommandDto, requestId: string) {
    const { ctx, text } = await this.describeContext(workspaceId, dto.context);
    const toolCtx: ToolContext = { ...ctx, userId, requestId };
    const usable = this.tools.filter(t => !t.requiredPermission || permissions.includes(t.requiredPermission));
    const system = [
      'คุณคือ AI Marketing Manager ของเอเจนซี่ดูแลเพจ Facebook ตอบเป็นภาษาไทย กระชับ เป็นมืออาชีพ',
      'ใช้เครื่องมือเพื่ออ่านข้อมูลจริงก่อนตอบทุกครั้งที่คำถามเกี่ยวกับเพจ/โพสต์/ลูกค้า ห้ามเดาตัวเลข',
      'ตัวเลขที่เป็น null คือ "อ่านไม่ได้ด้วยสิทธิ์ปัจจุบัน" — ให้บอกผู้ใช้ตรงๆ ห้ามตีความเป็น 0 และห้ามสรุปแนวโน้มจากค่าที่อ่านไม่ได้',
      'ห้ามเปลี่ยนบริบท (ลูกค้า/แบรนด์/เพจ) เอง ถ้าผู้ใช้ถามถึงเพจอื่นให้บอกให้เปลี่ยนบริบทที่ตัวเลือกด้านบน',
      'คุณโพสต์/แก้ไขอะไรบนเพจจริงไม่ได้ในโหมดนี้ — ถ้าผู้ใช้ขอให้โพสต์ ให้เสนอร่างและบอกให้ไปสร้างในหน้าคอนเทนต์เพื่อผ่านการอนุมัติ',
      'ทุกคำแนะนำให้ระบุระดับความมั่นใจ (สูง/กลาง/ต่ำ) และเหตุผลจากข้อมูล',
      `บริบทปัจจุบัน:\n${text}`,
    ].join('\n');
    const messages: AiMessage[] = [...(dto.history as AiMessage[]), { role: 'user', content: dto.message }];
    const steps: ToolStep[] = [];
    const out = await this.ai.toolLoop({ workspaceId, userId, taskType: 'ai.command', role: dto.role, requestId, promptVersion: COMMAND_PROMPT_VERSION, override: dto.modelOverride ?? null, resourceType: ctx.pageId ? 'facebookPage' : ctx.brandId ? 'brand' : undefined, resourceId: ctx.pageId ?? ctx.brandId }, {
      system, messages, tools: toToolDefs(usable), maxRounds: 8,
      onStep: s => steps.push(s),
      exec: async call => {
        const tool = usable.find(t => t.name === call.name);
        if (!tool) throw new Error(`ไม่มีเครื่องมือ ${call.name}`);
        if (tool.riskLevel !== 'READ') {
          const level = ctx.pageId ? (await this.prisma.facebookPage.findUnique({ where: { id: ctx.pageId }, select: { automationLevel: true } }))?.automationLevel ?? 'READ_ONLY' : 'READ_ONLY';
          if (!toolAllowedWithoutApproval(tool.riskLevel, level)) throw new ForbiddenException(`เครื่องมือ ${tool.name} ต้องผ่านการอนุมัติ`);
        }
        return tool.execute(toolCtx, call.args);
      },
    });
    return { text: out.result.text, messages: out.result.messages, steps, usage: out.usage, costUsd: out.costUsd, model: out.model, provider: out.provider, taskId: out.taskId, latencyMs: out.latencyMs, stoppedByLimit: out.result.stoppedByLimit, context: { ...ctx, days: dto.context.days } };
  }

  listTools(permissions: readonly Permission[]) {
    return this.tools.map(t => ({ name: t.name, description: t.description, riskLevel: t.riskLevel, requiredPermission: t.requiredPermission ?? null, allowed: !t.requiredPermission || permissions.includes(t.requiredPermission) }));
  }
}
