/**
 * Analyst Agent (§19, §88, §89) — วิเคราะห์เพจจากข้อมูลที่ซิงก์มาแล้ว คืนผลแบบโครงสร้าง + ระดับความมั่นใจ
 * ไม่เดาตัวเลขที่อ่านไม่ได้: ส่งรายการข้อจำกัดของข้อมูลให้โมเดลและบังคับให้รายงานกลับใน dataLimitations
 */
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { pageInWorkspace } from '@fbpm/database';
import { pageCompleteness, type MetricSnapshot } from '@fbpm/facebook-core';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from './gateway.service';

export const ANALYST_PROMPT_VERSION = 'analyst-v1';
export interface PageAnalysisResult {
  summary: string;
  dataLimitations: string[];
  topPosts: { facebookPostId: string; why: string }[];
  patterns: { finding: string; evidence: string; confidence: 'high' | 'medium' | 'low' }[];
  recommendations: { title: string; why: string; action: string; confidence: 'high' | 'medium' | 'low'; expectedImpact: 'high' | 'medium' | 'low' }[];
  contentPillars: string[];
}

const CONF = ['high', 'medium', 'low'];
function validate(v: unknown): PageAnalysisResult {
  const o = v as Partial<PageAnalysisResult>;
  if (typeof o.summary !== 'string' || !o.summary) throw new Error('summary ต้องเป็นข้อความ');
  if (!Array.isArray(o.dataLimitations)) throw new Error('dataLimitations ต้องเป็น array ของข้อความ');
  if (!Array.isArray(o.recommendations) || o.recommendations.length === 0) throw new Error('recommendations ต้องมีอย่างน้อย 1 ข้อ');
  for (const r of o.recommendations) if (!r?.title || !r.action || !CONF.includes(r.confidence) || !CONF.includes(r.expectedImpact)) throw new Error('recommendation ต้องมี title, action, confidence(high|medium|low), expectedImpact(high|medium|low)');
  const patterns = Array.isArray(o.patterns) ? o.patterns : [];
  for (const p of patterns) if (!p?.finding || !CONF.includes(p.confidence)) throw new Error('pattern ต้องมี finding และ confidence');
  return { summary: o.summary, dataLimitations: o.dataLimitations.map(String), topPosts: Array.isArray(o.topPosts) ? o.topPosts : [], patterns, recommendations: o.recommendations, contentPillars: Array.isArray(o.contentPillars) ? o.contentPillars.map(String) : [] };
}

@Injectable()
export class AnalystService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService) {}

  async analyzePage(workspaceId: string, userId: string, pageId: string, days: number, requestId: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, name: true, category: true, fanCount: true, profile: true, tasks: true, lastSyncedAt: true, brand: { select: { name: true, industry: true, targetAudience: true, toneOfVoice: true, primaryCTA: true, serviceArea: true, client: { select: { name: true } }, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    if (!page.lastSyncedAt) throw new UnprocessableEntityException('ยังไม่ได้ซิงก์ข้อมูลเพจ — กด "ซิงก์ตอนนี้" ก่อน');
    const since = new Date(Date.now() - days * 86_400_000);
    const posts = await this.prisma.facebookPost.findMany({ where: { pageId, publishedAt: { gte: since } }, orderBy: { publishedAt: 'desc' }, take: 80, select: { facebookPostId: true, message: true, mediaType: true, publishedAt: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { metrics: true } } } });
    const rows = posts.map(p => { const m = (p.snapshots[0]?.metrics ?? null) as MetricSnapshot | null; return { id: p.facebookPostId, date: p.publishedAt?.toISOString().slice(0, 10), type: p.mediaType, text: (p.message ?? '').slice(0, 300), shares: m?.shares?.value ?? null, reactions: m?.reactions?.value ?? null, comments: m?.comments?.value ?? null }; });
    const unavailable = rows.length ? (['shares', 'reactions', 'comments'] as const).filter(k => rows.every(r => r[k] === null)) : [];
    const completeness = pageCompleteness((page.profile as Record<string, unknown> | null) ?? {});
    const limitations = [
      ...unavailable.map(k => `ค่า ${k} อ่านไม่ได้ทุกโพสต์ (สิทธิ์ Facebook ไม่พอ) — วิเคราะห์จากค่านี้ไม่ได้`),
      'ไม่มีตัวเลขการเข้าถึง (reach/impressions) เพราะไม่มีสิทธิ์ read_insights',
      ...(rows.length < 5 ? [`มีโพสต์ในช่วง ${days} วันเพียง ${rows.length} โพสต์ — ข้อสรุปมีความมั่นใจต่ำ`] : []),
    ];
    const prompt = [
      `วิเคราะห์เพจ Facebook "${page.name}" (หมวด ${page.category ?? '-'}, ผู้ติดตาม ${page.fanCount ?? 'ไม่ทราบ'}) ของลูกค้า ${page.brand.client.name} / แบรนด์ ${page.brand.name}`,
      `ธุรกิจ: ${page.brand.industry ?? '-'} · กลุ่มเป้าหมาย: ${page.brand.targetAudience ?? '-'} · น้ำเสียง: ${page.brand.toneOfVoice ?? '-'} · CTA หลัก: ${page.brand.primaryCTA ?? '-'} · พื้นที่: ${page.brand.serviceArea ?? '-'}`,
      page.brand.knowledge.length ? `ข้อมูลแบรนด์:\n${page.brand.knowledge.map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 400)}`).join('\n')}` : 'ข้อมูลแบรนด์: ยังไม่ได้กรอก',
      `ความสมบูรณ์ของข้อมูลเพจ ${completeness.score}% ขาด: ${completeness.missing.map(m => m.label).join(', ') || 'ไม่ขาด'}`,
      `ข้อจำกัดของข้อมูล (ต้องรายงานกลับใน dataLimitations และห้ามสรุปเกินข้อมูล):\n${limitations.map(l => `- ${l}`).join('\n')}`,
      `โพสต์ ${rows.length} รายการใน ${days} วัน (null = อ่านไม่ได้):\n${JSON.stringify(rows)}`,
      'ให้: สรุปภาพรวมสั้นๆ, โพสต์เด่น (อ้างจากค่าที่อ่านได้เท่านั้น), รูปแบบที่พบ (ประเภทโพสต์/ความถี่/เวลา/หัวข้อ), คำแนะนำที่ทำได้จริง 3–6 ข้อ เรียงตามผลกระทบ, และเสาหลักคอนเทนต์ (content pillars) 3–5 หัวข้อ — ภาษาไทย',
    ].join('\n\n');
    const schema = `{
  "summary": string,
  "dataLimitations": string[],
  "topPosts": [{ "facebookPostId": string, "why": string }],
  "patterns": [{ "finding": string, "evidence": string, "confidence": "high"|"medium"|"low" }],
  "recommendations": [{ "title": string, "why": string, "action": string, "confidence": "high"|"medium"|"low", "expectedImpact": "high"|"medium"|"low" }],
  "contentPillars": string[]
}`;
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'page.analyze', role: 'analysis', requestId, promptVersion: ANALYST_PROMPT_VERSION, resourceType: 'facebookPage', resourceId: pageId }, {
      system: 'คุณคือ Analyst Agent ของระบบดูแลเพจ Facebook วิเคราะห์จากข้อมูลที่ให้เท่านั้น ระบุความมั่นใจตามหลักฐาน ห้ามแต่งตัวเลข',
      prompt, schemaDescription: schema, validate, maxTokens: 6000,
    });
    const result = out.result.data;
    const saved = await this.prisma.pageAnalysis.create({ data: { pageId, days, result: result as unknown as Prisma.InputJsonValue, provider: out.provider, model: out.model, createdById: userId }, select: { id: true, createdAt: true } });
    await this.audit.log({ workspaceId, userId, action: 'ai.page.analyze', resourceType: 'facebookPage', resourceId: pageId, after: { analysisId: saved.id, days, provider: out.provider, model: out.model, costUsd: out.costUsd, recommendations: result.recommendations.length }, requestId });
    return { id: saved.id, createdAt: saved.createdAt, days, provider: out.provider, model: out.model, costUsd: out.costUsd, latencyMs: out.latencyMs, postsAnalyzed: rows.length, result };
  }

  async latest(workspaceId: string, pageId: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    return this.prisma.pageAnalysis.findMany({ where: { pageId }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, days: true, result: true, provider: true, model: true, createdAt: true } });
  }
}
