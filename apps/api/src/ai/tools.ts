/**
 * Tool Registry (§43, §44) — เครื่องมือที่ AI เรียกได้ นิยามที่เดียว ทุกตัวมี permission + risk level
 * บริบท (ToolContext) ถูกตรวจฝั่งเซิร์ฟเวอร์ ห้ามให้ AI สลับ client/page เอง (§37)
 */
import type { PrismaClient } from '@fbpm/database';
import { brandInWorkspace, pageInWorkspace } from '@fbpm/database';
import { pageCompleteness, type MetricSnapshot } from '@fbpm/facebook-core';
import type { AiToolDef } from '@fbpm/ai-core';
import type { Permission, ToolContext, ToolRiskLevel } from '@fbpm/shared';

export interface AgentTool<I = Record<string, unknown>, O = unknown> {
  name: string; description: string; inputSchema: Record<string, unknown>;
  requiredPermission?: Permission; riskLevel: ToolRiskLevel;
  execute(ctx: ToolContext, input: I): Promise<O>;
}
export interface ToolDeps { prisma: PrismaClient }

const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const metricsOf = (m: MetricSnapshot | null) => m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.value])) : null;

/** เพจที่ถูกต้องตามบริบท: ถ้า ctx มี pageId → บังคับใช้ตัวนั้น, ไม่งั้นต้องอยู่ใน brand/client ของบริบท */
async function resolvePage(d: ToolDeps, ctx: ToolContext, pageId?: string) {
  const id = ctx.pageId ?? pageId;
  if (!id) throw new Error('ต้องเลือกเพจก่อน (ระบุ pageId หรือเลือกเพจในบริบท)');
  const p = await d.prisma.facebookPage.findFirst({ where: { id, ...pageInWorkspace(ctx.workspaceId), ...(ctx.brandId && { brandId: ctx.brandId }), ...(ctx.clientId && { brand: { clientId: ctx.clientId } }) }, select: { id: true, name: true, facebookPageId: true, brandId: true, fanCount: true, category: true, tasks: true, automationLevel: true, publishingPaused: true, tokenStatus: true, lastSyncedAt: true, profile: true, disconnectedAt: true, brand: { select: { name: true, client: { select: { name: true } } } } } });
  if (!p) throw new Error('ไม่พบเพจนี้ในบริบทปัจจุบัน');
  return p;
}

export function buildTools(d: ToolDeps): AgentTool[] {
  const listPages: AgentTool = {
    name: 'list_pages', description: 'รายชื่อเพจ Facebook ที่เชื่อมไว้ในบริบทปัจจุบัน (ชื่อ, แบรนด์, ลูกค้า, ผู้ติดตาม, สถานะ)', inputSchema: obj({}), requiredPermission: 'page.read', riskLevel: 'READ',
    async execute(ctx) {
      const rows = await d.prisma.facebookPage.findMany({ where: { ...pageInWorkspace(ctx.workspaceId), disconnectedAt: null, ...(ctx.pageId && { id: ctx.pageId }), ...(ctx.brandId && { brandId: ctx.brandId }), ...(ctx.clientId && { brand: { clientId: ctx.clientId } }) }, select: { id: true, name: true, category: true, fanCount: true, tokenStatus: true, automationLevel: true, lastSyncedAt: true, brand: { select: { id: true, name: true, client: { select: { id: true, name: true } } } }, _count: { select: { posts: true } } } });
      return rows.map(r => ({ pageId: r.id, name: r.name, category: r.category, followers: r.fanCount, tokenStatus: r.tokenStatus, automationLevel: r.automationLevel, lastSyncedAt: r.lastSyncedAt, brand: r.brand.name, brandId: r.brand.id, client: r.brand.client.name, importedPosts: r._count.posts }));
    },
  };
  const pageOverview: AgentTool<{ pageId?: string }> = {
    name: 'get_page_overview', description: 'ข้อมูลเพจ: หมวดหมู่, ผู้ติดตาม, คะแนนความสมบูรณ์ของข้อมูล + รายการที่ยังขาด, สิทธิ์บนเพจ, ระดับอัตโนมัติ', inputSchema: obj({ pageId: { type: 'string' } }), requiredPermission: 'page.read', riskLevel: 'READ',
    async execute(ctx, input) {
      const p = await resolvePage(d, ctx, input.pageId);
      const profile = (p.profile as Record<string, unknown> | null) ?? {};
      const c = pageCompleteness(profile);
      return { pageId: p.id, name: p.name, client: p.brand.client.name, brand: p.brand.name, category: p.category, followers: p.fanCount, about: profile.about ?? null, description: profile.description ?? null, phone: profile.phone ?? null, website: profile.website ?? null, address: profile.single_line_address ?? null, hours: profile.hours ?? null, completenessScore: c.score, missing: c.missing.map(m => m.label), tasks: p.tasks, canPublish: p.tasks.includes('CREATE_CONTENT'), canManageSettings: p.tasks.includes('MANAGE'), automationLevel: p.automationLevel, publishingPaused: p.publishingPaused, tokenStatus: p.tokenStatus, lastSyncedAt: p.lastSyncedAt };
    },
  };
  const getPosts: AgentTool<{ pageId?: string; days?: number; limit?: number }> = {
    name: 'get_posts', description: 'โพสต์ของเพจย้อนหลัง N วัน พร้อมตัวเลข (shares/reactions/comments) — ค่า null หมายถึง Facebook ไม่ให้อ่านด้วยสิทธิ์ปัจจุบัน ห้ามตีความเป็น 0', inputSchema: obj({ pageId: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 365 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), requiredPermission: 'analytics.read', riskLevel: 'READ',
    async execute(ctx, input) {
      const p = await resolvePage(d, ctx, input.pageId);
      const days = input.days ?? 30;
      const rows = await d.prisma.facebookPost.findMany({ where: { pageId: p.id, publishedAt: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { publishedAt: 'desc' }, take: Math.min(100, input.limit ?? 50), select: { id: true, facebookPostId: true, message: true, mediaType: true, permalink: true, publishedAt: true, source: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { metrics: true, capturedAt: true } } } });
      const posts = rows.map(r => ({ postId: r.id, facebookPostId: r.facebookPostId, publishedAt: r.publishedAt, mediaType: r.mediaType, message: (r.message ?? '').slice(0, 600), permalink: r.permalink, metrics: metricsOf((r.snapshots[0]?.metrics ?? null) as MetricSnapshot | null), metricsCapturedAt: r.snapshots[0]?.capturedAt ?? null }));
      const sample = posts[0]?.metrics ?? null;
      const unavailable = sample ? Object.entries(sample).filter(([, v]) => v === null).map(([k]) => k) : [];
      return { page: p.name, days, count: posts.length, metricsUnavailable: unavailable, note: unavailable.length ? `ค่า ${unavailable.join(', ')} อ่านไม่ได้ด้วยสิทธิ์ปัจจุบัน — อย่าสรุปว่าเป็น 0` : undefined, posts };
    },
  };
  const brandKnowledge: AgentTool<{ brandId?: string }> = {
    name: 'get_brand_knowledge', description: 'ข้อมูลแบรนด์/ธุรกิจที่ผู้ใช้กรอกไว้: ข้อมูลธุรกิจ, สินค้า/บริการ, ราคา, น้ำเสียง, ข้อห้ามกล่าวอ้าง ฯลฯ — ต้องอ่านก่อนสร้างคอนเทนต์', inputSchema: obj({ brandId: { type: 'string' } }), requiredPermission: 'client.read', riskLevel: 'READ',
    async execute(ctx, input) {
      let brandId = ctx.brandId ?? input.brandId;
      if (!brandId && ctx.pageId) brandId = (await resolvePage(d, ctx)).brandId;
      if (!brandId) throw new Error('ต้องระบุ brandId หรือเลือกแบรนด์/เพจในบริบท');
      const b = await d.prisma.brand.findFirst({ where: { id: brandId, ...brandInWorkspace(ctx.workspaceId) }, select: { id: true, name: true, description: true, industry: true, targetAudience: true, toneOfVoice: true, preferredLanguage: true, serviceArea: true, primaryCTA: true, website: true, knowledgeBaseStatus: true, client: { select: { name: true } }, knowledge: { where: { active: true }, select: { type: true, title: true, content: true }, orderBy: { type: 'asc' } } } });
      if (!b) throw new Error('ไม่พบแบรนด์');
      return { ...b, knowledgeItems: b.knowledge, knowledge: undefined };
    },
  };
  const listClients: AgentTool = {
    name: 'list_clients_brands', description: 'รายชื่อลูกค้าและแบรนด์ทั้งหมดใน workspace พร้อมสถานะฐานความรู้', inputSchema: obj({}), requiredPermission: 'client.read', riskLevel: 'READ',
    async execute(ctx) {
      const rows = await d.prisma.client.findMany({ where: { workspaceId: ctx.workspaceId, ...(ctx.clientId && { id: ctx.clientId }) }, select: { id: true, name: true, status: true, brands: { select: { id: true, name: true, industry: true, knowledgeBaseStatus: true, _count: { select: { pages: true } } } } } });
      return rows.map(c => ({ clientId: c.id, name: c.name, status: c.status, brands: c.brands.map(b => ({ brandId: b.id, name: b.name, industry: b.industry, knowledgeBaseStatus: b.knowledgeBaseStatus, pages: b._count.pages })) }));
    },
  };
  const latestAnalysis: AgentTool<{ pageId?: string }> = {
    name: 'get_latest_page_analysis', description: 'ผลวิเคราะห์เพจล่าสุดโดย Analyst Agent (ถ้ามี) — ใช้ต่อยอดในการวางแผน', inputSchema: obj({ pageId: { type: 'string' } }), requiredPermission: 'analytics.read', riskLevel: 'READ',
    async execute(ctx, input) {
      const p = await resolvePage(d, ctx, input.pageId);
      const a = await d.prisma.pageAnalysis.findFirst({ where: { pageId: p.id }, orderBy: { createdAt: 'desc' }, select: { days: true, result: true, createdAt: true, model: true } });
      return a ?? { note: 'ยังไม่มีผลวิเคราะห์ — ผู้ใช้กด "วิเคราะห์ด้วย AI" ที่หน้าเพจได้' };
    },
  };
  return [listPages, pageOverview, getPosts, brandKnowledge, listClients, latestAnalysis] as AgentTool[];
}

export const toToolDefs = (tools: AgentTool[]): AiToolDef[] => tools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
