/**
 * Strategist (§18) · Content Creator (§20) · Reviewer (§25) — ผลลัพธ์แบบโครงสร้างเท่านั้น, ห้ามแต่งข้อมูลธุรกิจ (§54)
 */
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { contentInWorkspace, pageInWorkspace } from '@fbpm/database';
import type { MetricSnapshot } from '@fbpm/facebook-core';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { ContentService } from './content.service';
import type { GenerateDto, PlanDto } from './dto';

export const STRATEGIST_PROMPT_VERSION = 'strategist-v1';
export const CONTENT_PROMPT_VERSION = 'content-v1';
export const REVIEWER_PROMPT_VERSION = 'reviewer-v1';

interface PlanItem { dayOffset: number; contentType: string; pillar: string; title: string; objective: string; hook: string; cta: string }
export interface StrategistPlan { objective: string; contentPillars: string[]; recommendedMix: Record<string, number>; items: PlanItem[]; rationale: string; dataLimitations: string[] }
export interface ContentDraft { headline: string; caption: string; cta: string; hashtags: string[]; mediaBrief: string; contentPillar: string; missingInfo: string[] }
export interface ReviewResult { result: 'PASS' | 'NEEDS_REVISION' | 'BLOCKED'; issues: { type: string; detail: string; severity: 'low' | 'medium' | 'high' }[]; summary: string }

const str = (v: unknown, name: string): string => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} ต้องเป็นข้อความ`); return v.trim(); };
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

function validatePlan(v: unknown): StrategistPlan {
  const o = v as Partial<StrategistPlan>;
  const items = Array.isArray(o.items) ? o.items : [];
  if (!items.length) throw new Error('items ต้องมีอย่างน้อย 1 รายการ');
  const out = items.map(i => ({ dayOffset: Number(i?.dayOffset ?? 0), contentType: String(i?.contentType ?? 'post'), pillar: str(i?.pillar, 'pillar'), title: str(i?.title, 'title'), objective: String(i?.objective ?? ''), hook: String(i?.hook ?? ''), cta: String(i?.cta ?? '') }));
  const pillars = strArr(o.contentPillars); if (!pillars.length) throw new Error('contentPillars ต้องมี');
  const mix = (o.recommendedMix && typeof o.recommendedMix === 'object') ? Object.fromEntries(Object.entries(o.recommendedMix).map(([k, n]) => [k, Number(n)])) : {};
  return { objective: str(o.objective, 'objective'), contentPillars: pillars, recommendedMix: mix, items: out, rationale: String(o.rationale ?? ''), dataLimitations: strArr(o.dataLimitations) };
}
function validateDraft(v: unknown): ContentDraft {
  const o = v as Partial<ContentDraft>;
  return { headline: String(o.headline ?? ''), caption: str(o.caption, 'caption'), cta: String(o.cta ?? ''), hashtags: strArr(o.hashtags).slice(0, 15).map(h => h.replace(/^#/, '')), mediaBrief: String(o.mediaBrief ?? ''), contentPillar: String(o.contentPillar ?? ''), missingInfo: strArr(o.missingInfo) };
}
function validateReview(v: unknown): ReviewResult {
  const o = v as Partial<ReviewResult>;
  if (!['PASS', 'NEEDS_REVISION', 'BLOCKED'].includes(o.result as string)) throw new Error('result ต้องเป็น PASS | NEEDS_REVISION | BLOCKED');
  const issues = Array.isArray(o.issues) ? o.issues.map(i => ({ type: String(i?.type ?? 'other'), detail: String(i?.detail ?? ''), severity: (['low', 'medium', 'high'].includes(i?.severity as string) ? i!.severity : 'medium') as 'low' | 'medium' | 'high' })) : [];
  return { result: o.result as ReviewResult['result'], issues, summary: String(o.summary ?? '') };
}

@Injectable()
export class ContentAgentsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(ContentService) private readonly content: ContentService, @Inject(AuditService) private readonly audit: AuditService) {}

  /** บริบทที่ทุก agent ต้องได้ (§20 Inputs): brand knowledge, voice, performance, โพสต์ล่าสุด */
  private async pageContext(workspaceId: string, pageId: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true, name: true, category: true, fanCount: true, timezone: true, brand: { select: { id: true, name: true, industry: true, description: true, targetAudience: true, toneOfVoice: true, preferredLanguage: true, serviceArea: true, primaryCTA: true, website: true, knowledgeBaseStatus: true, client: { select: { name: true } }, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
    const recent = await this.prisma.facebookPost.findMany({ where: { pageId }, orderBy: { publishedAt: 'desc' }, take: 15, select: { message: true, mediaType: true, publishedAt: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { metrics: true } } } });
    const analysis = await this.prisma.pageAnalysis.findFirst({ where: { pageId }, orderBy: { createdAt: 'desc' }, select: { result: true, createdAt: true } });
    const b = page.brand;
    const prohibited = b.knowledge.filter(k => k.type === 'prohibited_claim');
    const text = [
      `เพจ "${page.name}" (${page.category ?? '-'}, ผู้ติดตาม ${page.fanCount ?? 'ไม่ทราบ'}) · ลูกค้า ${b.client.name} · แบรนด์ ${b.name}`,
      `ธุรกิจ: ${b.industry ?? '-'} · ${b.description ?? ''}`, `กลุ่มเป้าหมาย: ${b.targetAudience ?? '-'}`, `น้ำเสียงแบรนด์: ${b.toneOfVoice ?? '-'}`, `ภาษาคอนเทนต์: ${b.preferredLanguage}`,
      `พื้นที่ให้บริการ: ${b.serviceArea ?? 'ไม่ระบุ'} · CTA หลัก: ${b.primaryCTA ?? 'ไม่ระบุ'} · เว็บไซต์: ${b.website ?? 'ไม่ระบุ'}`,
      b.knowledge.length ? `ข้อมูลแบรนด์ (ใช้ได้เฉพาะที่ระบุไว้ ห้ามแต่งเพิ่ม):\n${b.knowledge.filter(k => k.type !== 'prohibited_claim').map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 500)}`).join('\n')}` : 'ข้อมูลแบรนด์: ยังไม่ได้กรอก — ห้ามแต่งราคา/โปรโมชัน/เบอร์/ที่อยู่/รับรองใดๆ',
      prohibited.length ? `ข้อห้ามกล่าวอ้าง:\n${prohibited.map(k => `- ${k.title}: ${k.content}`).join('\n')}` : 'ข้อห้ามทั่วไป: ห้ามอ้างผลทางการแพทย์/กฎหมาย/การเงิน ห้ามแต่งรีวิว ราคา โปรโมชัน หรือใบรับรอง',
      recent.length ? `โพสต์ล่าสุด ${recent.length} รายการ (null = อ่านไม่ได้):\n${JSON.stringify(recent.map(r => { const m = (r.snapshots[0]?.metrics ?? null) as MetricSnapshot | null; return { date: r.publishedAt?.toISOString().slice(0, 10), type: r.mediaType, text: (r.message ?? '').slice(0, 160), shares: m?.shares?.value ?? null, reactions: m?.reactions?.value ?? null }; }))}` : 'ยังไม่มีโพสต์ที่ซิงก์มา',
      analysis ? `ผลวิเคราะห์ล่าสุด (${analysis.createdAt.toISOString().slice(0, 10)}): ${JSON.stringify(analysis.result).slice(0, 2500)}` : '',
    ].filter(Boolean).join('\n\n');
    return { page, brand: b, text };
  }

  /** Strategist: แผน N วัน → ContentPlan + ContentItem สถานะ PLANNED */
  async plan(workspaceId: string, userId: string, pageId: string, dto: PlanDto, requestId: string) {
    const days = dto?.days ?? 7; const perWeek = dto?.postsPerWeek ?? 3;
    const { page, text } = await this.pageContext(workspaceId, pageId);
    const count = Math.max(1, Math.round((days / 7) * perWeek));
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'content.plan', role: 'strategy', requestId, promptVersion: STRATEGIST_PROMPT_VERSION, resourceType: 'facebookPage', resourceId: pageId }, {
      system: 'คุณคือ Strategist ของเอเจนซี่ดูแลเพจ Facebook วางแผนจากข้อมูลจริงของแบรนด์และผลงานที่ผ่านมา ตอบภาษาไทย ห้ามแต่งข้อเท็จจริงเกี่ยวกับธุรกิจ',
      prompt: `${text}\n\nวางแผนคอนเทนต์ ${days} วัน จำนวน ${count} โพสต์${dto?.objective ? ` เป้าหมาย: ${dto.objective}` : ''}${dto?.notes ? `\nโน้ตจากผู้ดูแล: ${dto.notes}` : ''}\nกระจาย dayOffset (0 = วันแรก) ให้ห่างกันสมเหตุสมผล ระบุเสาหลักคอนเทนต์และสัดส่วน (รวม = 1)`,
      schemaDescription: `{ "objective": string, "contentPillars": string[], "recommendedMix": { [pillar: string]: number }, "rationale": string, "dataLimitations": string[], "items": [{ "dayOffset": number, "contentType": "post"|"photo"|"video"|"reel", "pillar": string, "title": string, "objective": string, "hook": string, "cta": string }] }`,
      validate: validatePlan, maxTokens: 6000,
    });
    const plan = out.result.data;
    const saved = await this.prisma.contentPlan.create({ data: { pageId, days, objective: plan.objective, pillars: plan.contentPillars as unknown as Prisma.InputJsonValue, mix: plan.recommendedMix as Prisma.InputJsonValue, items: plan.items as unknown as Prisma.InputJsonValue, provider: out.provider, model: out.model, createdById: userId }, select: { id: true, createdAt: true } });
    const items = [];
    for (const it of plan.items) {
      items.push(await this.content.create(workspaceId, userId, { pageId, contentType: (['post', 'photo', 'video', 'reel', 'story'].includes(it.contentType) ? it.contentType : 'post') as 'post', title: it.title, objective: it.objective, contentPillar: it.pillar, cta: it.cta, hashtags: [], mediaPaths: [] }, requestId, { provider: out.provider, model: out.model, promptVersion: STRATEGIST_PROMPT_VERSION, notes: { hook: it.hook, dayOffset: it.dayOffset }, planId: saved.id, status: 'PLANNED' }));
    }
    await this.audit.log({ workspaceId, userId, action: 'ai.content.plan', resourceType: 'contentPlan', resourceId: saved.id, after: { pageId, days, items: items.length, costUsd: out.costUsd, model: out.model }, requestId });
    return { id: saved.id, createdAt: saved.createdAt, page: { id: page.id, name: page.name }, plan, items, provider: out.provider, model: out.model, costUsd: out.costUsd };
  }

  /** Content Creator: เขียนร่างจาก item ที่มีอยู่ (PLANNED/DRAFT) หรือสร้างใหม่จาก brief */
  async generate(workspaceId: string, userId: string, pageId: string, dto: GenerateDto, requestId: string, contentId?: string) {
    const { text, brand } = await this.pageContext(workspaceId, pageId);
    const existing = contentId ? await this.prisma.contentItem.findFirst({ where: { id: contentId, ...contentInWorkspace(workspaceId) }, select: { id: true, status: true, title: true, objective: true, contentPillar: true, cta: true, aiNotes: true, caption: true } }) : null;
    if (contentId && !existing) throw new NotFoundException('ไม่พบคอนเทนต์');
    if (existing && !['PLANNED', 'IDEA', 'DRAFT', 'NEEDS_REVISION'].includes(existing.status)) throw new UnprocessableEntityException(`สร้างร่างให้คอนเทนต์สถานะ ${existing.status} ไม่ได้`);
    const brief = existing ? `หัวข้อ: ${existing.title ?? '-'} · เป้าหมาย: ${existing.objective ?? '-'} · เสาหลัก: ${existing.contentPillar ?? '-'} · CTA: ${existing.cta ?? brand.primaryCTA ?? '-'} · hook: ${(existing.aiNotes as { hook?: string } | null)?.hook ?? '-'}${existing.caption ? `\nร่างเดิม (ปรับปรุงให้ดีขึ้น): ${existing.caption.slice(0, 1500)}` : ''}` : `brief: ${dto?.brief ?? 'โพสต์ให้เหมาะกับแบรนด์'} · เสาหลัก: ${dto?.pillar ?? '-'} · เป้าหมาย: ${dto?.objective ?? '-'}`;
    const count = existing ? 1 : dto?.count ?? 1;
    const schema = `{ "drafts": [{ "headline": string, "caption": string, "cta": string, "hashtags": string[], "mediaBrief": string, "contentPillar": string, "missingInfo": string[] }] }`;
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'content.generate', role: 'content', requestId, promptVersion: CONTENT_PROMPT_VERSION, resourceType: existing ? 'contentItem' : 'facebookPage', resourceId: existing?.id ?? pageId }, {
      system: `คุณคือ Content Creator ของเอเจนซี่ดูแลเพจ Facebook เขียนภาษา ${brand.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย'} ตามน้ำเสียงแบรนด์ ใช้เฉพาะข้อเท็จจริงที่ให้มา ถ้าข้อมูลจำเป็น (ราคา โปรโมชัน เบอร์ ที่อยู่ เวลา) ไม่มี ให้เว้นและใส่รายการใน missingInfo แทนการเดา (§54) caption ควรมี hook บรรทัดแรก เนื้อหาอ่านง่าย มี emoji พอประมาณ และ CTA ชัดเจน ห้ามใส่ hashtag ใน caption (แยกไว้ใน hashtags)`,
      prompt: `${text}\n\nงาน: เขียนร่างโพสต์ ${count} แบบ\n${brief}`, schemaDescription: schema,
      validate: v => { const o = v as { drafts?: unknown[] }; if (!Array.isArray(o.drafts) || !o.drafts.length) throw new Error('drafts ต้องมีอย่างน้อย 1'); return o.drafts.map(validateDraft); }, maxTokens: 6000,
    });
    const drafts = out.result.data;
    const ai = { provider: out.provider, model: out.model, promptVersion: CONTENT_PROMPT_VERSION };
    const items = [];
    if (existing) {
      const d = drafts[0]!;
      const rev = await this.prisma.contentRevision.count({ where: { contentId: existing.id } });
      const updated = await this.prisma.contentItem.update({ where: { id: existing.id }, data: { status: 'DRAFT', title: d.headline || existing.title, caption: d.caption, cta: d.cta || existing.cta, hashtags: d.hashtags, mediaBrief: d.mediaBrief, contentPillar: d.contentPillar || existing.contentPillar, aiProvider: out.provider, aiModel: out.model, promptVersion: CONTENT_PROMPT_VERSION, aiNotes: { ...((existing.aiNotes as object) ?? {}), missingInfo: d.missingInfo, needsHumanInput: d.missingInfo.length > 0 } as Prisma.InputJsonValue, reviewResult: undefined, revisions: { create: { version: rev + 1, caption: d.caption, editedBy: 'ai', reason: 'ai draft' } } }, select: { id: true } });
      items.push(await this.content.get(workspaceId, updated.id));
    } else {
      for (const d of drafts) items.push(await this.content.create(workspaceId, userId, { pageId, contentType: 'post', title: d.headline, caption: d.caption, cta: d.cta, hashtags: d.hashtags, mediaBrief: d.mediaBrief, mediaPaths: [], objective: dto?.objective, contentPillar: d.contentPillar || dto?.pillar }, requestId, { ...ai, notes: { missingInfo: d.missingInfo, needsHumanInput: d.missingInfo.length > 0 } }));
    }
    await this.audit.log({ workspaceId, userId, action: 'ai.content.generate', resourceType: 'facebookPage', resourceId: pageId, after: { items: items.map(i => i.id), costUsd: out.costUsd, model: out.model }, requestId });
    return { items, provider: out.provider, model: out.model, costUsd: out.costUsd };
  }

  /** Reviewer (§25): ตรวจร่างก่อนเข้าคิวอนุมัติ — ถ้า AI ยังไม่ตั้งค่า ข้ามการรีวิว (บันทึกไว้) */
  async review(workspaceId: string, userId: string, contentId: string, requestId: string): Promise<ReviewResult | null> {
    const c = await this.prisma.contentItem.findFirst({ where: { id: contentId, ...contentInWorkspace(workspaceId) }, select: { id: true, pageId: true, caption: true, cta: true, hashtags: true, contentPillar: true } });
    if (!c) throw new NotFoundException('ไม่พบคอนเทนต์');
    try { await this.ai.resolve(workspaceId, 'fast'); } catch { return null; }
    const { text } = await this.pageContext(workspaceId, c.pageId);
    const dupes = await this.prisma.contentItem.findMany({ where: { pageId: c.pageId, id: { not: c.id }, status: { in: ['PUBLISHED', 'SCHEDULED', 'APPROVED'] } }, orderBy: { updatedAt: 'desc' }, take: 10, select: { caption: true } });
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'content.review', role: 'fast', requestId, promptVersion: REVIEWER_PROMPT_VERSION, resourceType: 'contentItem', resourceId: contentId }, {
      system: 'คุณคือ Reviewer/QA ตรวจโพสต์ก่อนเผยแพร่: ความถูกต้องตามข้อมูลแบรนด์, น้ำเสียง, ข้อห้ามกล่าวอ้าง, ราคา/เบอร์/ที่อยู่ต้องตรงกับข้อมูลที่ให้, ซ้ำกับโพสต์ก่อนหน้า, ภาษาผิด, CTA. BLOCKED เมื่อมีการอ้างที่ตรวจไม่ได้หรือผิดกฎ; NEEDS_REVISION เมื่อแก้แล้วใช้ได้; PASS เมื่อพร้อม',
      prompt: `${text}\n\nโพสต์ที่ต้องตรวจ:\ncaption: ${c.caption ?? ''}\ncta: ${c.cta ?? ''}\nhashtags: ${c.hashtags.join(' ')}\npillar: ${c.contentPillar ?? ''}\n\nโพสต์ก่อนหน้าที่ต้องไม่ซ้ำ:\n${dupes.map(d => `- ${(d.caption ?? '').slice(0, 200)}`).join('\n') || '-'}`,
      schemaDescription: `{ "result": "PASS"|"NEEDS_REVISION"|"BLOCKED", "summary": string, "issues": [{ "type": string, "detail": string, "severity": "low"|"medium"|"high" }] }`, validate: validateReview, maxTokens: 2000,
    });
    return out.result.data;
  }
}
