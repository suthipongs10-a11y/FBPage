/**
 * Media Service (§63) — สร้างการ์ดภาพจากเทมเพลตด้วย Chromium (ไม่ผูกกับผู้ให้บริการสร้างภาพรายใด), เก็บไฟล์ใน MEDIA_DIR, บันทึก MediaAsset
 * ไฟล์ที่ได้ใช้เป็น mediaPaths ของคอนเทนต์ → publisher อัปโหลดให้ Facebook เอง
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { contentInWorkspace } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { CARD_SIZE, CARD_TEMPLATES, THEME_NAMES, buildCardHtml, type CardData, type CardTemplate } from './card-templates';
import { chromeScreenshot, findChrome, findThaiFonts } from './chromium';
import type { AiCardDto, RenderCardDto } from './dto';

export const CARD_PROMPT_VERSION = 'card-v1';
const ASSET_SELECT = { id: true, workspaceId: true, contentId: true, kind: true, template: true, theme: true, path: true, mimeType: true, width: true, height: true, bytes: true, meta: true, createdAt: true } as const;

@Injectable()
export class MediaService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService, @Inject(AiGatewayService) private readonly ai: AiGatewayService) {}

  private chrome(): string {
    const c = findChrome(this.env.CHROME_BIN);
    if (!c) throw new UnprocessableEntityException('ไม่พบ Chromium สำหรับสร้างภาพ — ตั้ง CHROME_BIN');
    return c;
  }
  private fonts() { return findThaiFonts(); }
  capabilities() { return { templates: CARD_TEMPLATES, themes: THEME_NAMES, size: CARD_SIZE, chromium: !!findChrome(this.env.CHROME_BIN) }; }

  /** เรนเดอร์การ์ด → PNG ในดิสก์ + MediaAsset; attach = เพิ่มเข้า mediaPaths ของคอนเทนต์ */
  async renderCard(workspaceId: string, userId: string, contentId: string | null, dto: RenderCardDto, requestId: string, ai?: { provider: string; model: string }) {
    if (contentId) { const c = await this.prisma.contentItem.findFirst({ where: { id: contentId, ...contentInWorkspace(workspaceId) }, select: { id: true, mediaPaths: true, status: true } }); if (!c) throw new NotFoundException('ไม่พบคอนเทนต์'); if (c.mediaPaths.length >= 10) throw new UnprocessableEntityException('แนบรูปได้สูงสุด 10 ใบ'); }
    const chrome = this.chrome();
    const dir = resolve(this.env.MEDIA_DIR, workspaceId); mkdirSync(dir, { recursive: true });
    const id = `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const out = join(dir, `${id}.png`); const tmp = join(dir, `.${id}.html`);
    await writeFile(tmp, buildCardHtml(dto.template, dto.data as CardData, dto.data.theme ?? 'default', this.fonts()));
    try {
      await chromeScreenshot(chrome, tmp, out, CARD_SIZE);
    } catch (e) { throw new UnprocessableEntityException(`เรนเดอร์ภาพไม่สำเร็จ: ${(e as Error).message.slice(0, 200)}`); }
    finally { await rm(tmp, { force: true }); }
    if (!existsSync(out)) throw new UnprocessableEntityException('เรนเดอร์ภาพไม่สำเร็จ (ไม่มีไฟล์ออก)');
    const asset = await this.prisma.mediaAsset.create({ data: { workspaceId, contentId, kind: 'card', template: dto.template, theme: dto.data.theme ?? 'default', path: out, mimeType: 'image/png', width: CARD_SIZE, height: CARD_SIZE, bytes: statSync(out).size, meta: { data: dto.data, ai } as Prisma.InputJsonValue, createdById: userId }, select: ASSET_SELECT });
    if (contentId && dto.attach) await this.prisma.contentItem.update({ where: { id: contentId }, data: { mediaPaths: { push: out }, contentType: 'photo' } });
    await this.audit.log({ workspaceId, userId, action: 'media.card.render', resourceType: 'mediaAsset', resourceId: asset.id, after: { template: dto.template, theme: asset.theme, contentId, attached: !!contentId && dto.attach, ai }, requestId });
    return asset;
  }

  /** Creative Director (§21): ให้ AI ออกแบบข้อมูลการ์ดจากคอนเทนต์ แล้วเรนเดอร์ */
  async aiCard(workspaceId: string, userId: string, contentId: string, dto: AiCardDto, requestId: string) {
    const c = await this.prisma.contentItem.findFirst({ where: { id: contentId, ...contentInWorkspace(workspaceId) }, select: { id: true, title: true, caption: true, cta: true, mediaBrief: true, contentPillar: true, page: { select: { name: true, brand: { select: { name: true, toneOfVoice: true, primaryCTA: true, website: true } } } } } });
    if (!c) throw new NotFoundException('ไม่พบคอนเทนต์');
    const pg = c.page ?? { name: 'YouTube', brand: { name: '', toneOfVoice: null, primaryCTA: null, website: null } };
    const schema = `{ "template": "quote"|"stat"|"tips"|"hero", "data": { "theme"?: ${THEME_NAMES.map(t => `"${t}"`).join('|')}, "kicker"?: string(<=40), "title"?: string(<=60), "quote"?: string(<=120), "sub"?: string(<=140), "lead"?: string(<=120), "big"?: string(<=6), "bigUnit"?: string(<=8), "items"?: [{ "title": string(<=50), "text"?: string(<=90) }] (3-5 items, tips only), "rows"?: [{ "label": string, "old"?: string, "new": string, "unit"?: string }] (stat only), "punch"?: string(<=40), "footer"?: string(<=60), "brand"?: string(<=30) } }`;
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'media.card.design', role: 'content', requestId, promptVersion: CARD_PROMPT_VERSION, resourceType: 'contentItem', resourceId: contentId }, {
      system: 'คุณคือ Creative Director ออกแบบการ์ดภาพ 1080×1080 ประกอบโพสต์ Facebook: เลือกเทมเพลตให้เหมาะกับเนื้อหา (quote=ประโยคเด่น, tips=รายการข้อ, stat=ตัวเลขเปรียบเทียบ, hero=หัวเรื่องใหญ่) ข้อความบนภาพต้องสั้น อ่านง่ายบนมือถือ ใช้ *คำ* เพื่อเน้นสี ห้ามใส่ข้อมูลที่ไม่มีในโพสต์ (ราคา เบอร์ โปรโมชัน)',
      prompt: `เพจ ${pg.name} · แบรนด์ ${pg.brand.name} · น้ำเสียง ${pg.brand.toneOfVoice ?? '-'}\nหัวข้อ: ${c.title ?? '-'}\nโพสต์: ${c.caption ?? ''}\nCTA: ${c.cta ?? pg.brand.primaryCTA ?? '-'}\nบรีฟภาพ: ${c.mediaBrief ?? '-'}${dto?.hint ? `\nคำแนะนำเพิ่มเติม: ${dto.hint}` : ''}${dto?.template ? `\nใช้เทมเพลต ${dto.template}` : ''}\nใส่ brand = "${pg.name}" และ theme = "${dto?.theme ?? 'default'}"`,
      schemaDescription: schema, validate: v => { const o = v as { template?: string; data?: CardData }; if (!o.template || !(CARD_TEMPLATES as readonly string[]).includes(o.template)) throw new Error('template ไม่ถูกต้อง'); if (!o.data || typeof o.data !== 'object') throw new Error('data ต้องเป็น object'); return { template: o.template as CardTemplate, data: o.data }; }, maxTokens: 2500,
    });
    const design = out.result.data;
    const { renderCardSchema } = await import('./dto');
    const parsed = renderCardSchema.safeParse({ template: design.template, data: { ...design.data, theme: dto?.theme ?? design.data.theme ?? 'default', brand: design.data.brand ?? pg.name }, attach: true });
    if (!parsed.success) throw new UnprocessableEntityException(`AI ออกแบบการ์ดไม่ตรงข้อกำหนด: ${parsed.error.issues.map(i => i.path.join('.') + ' ' + i.message).join(', ')}`);
    const asset = await this.renderCard(workspaceId, userId, contentId, parsed.data, requestId, { provider: out.provider, model: out.model });
    return { asset, design: parsed.data, provider: out.provider, model: out.model, costUsd: out.costUsd };
  }

  async list(workspaceId: string, contentId?: string) {
    return this.prisma.mediaAsset.findMany({ where: { workspaceId, ...(contentId && { contentId }) }, orderBy: { createdAt: 'desc' }, take: 100, select: ASSET_SELECT });
  }

  async file(workspaceId: string, id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const a = await this.prisma.mediaAsset.findFirst({ where: { id, workspaceId }, select: { path: true, mimeType: true } });
    if (!a || !existsSync(a.path)) throw new NotFoundException('ไม่พบไฟล์');
    return { buffer: await readFile(a.path), mimeType: a.mimeType };
  }

  async remove(workspaceId: string, userId: string, id: string, requestId: string) {
    const a = await this.prisma.mediaAsset.findFirst({ where: { id, workspaceId }, select: { id: true, path: true, contentId: true } });
    if (!a) throw new NotFoundException('ไม่พบไฟล์');
    if (a.contentId) { const c = await this.prisma.contentItem.findUnique({ where: { id: a.contentId }, select: { mediaPaths: true } }); if (c) await this.prisma.contentItem.update({ where: { id: a.contentId }, data: { mediaPaths: c.mediaPaths.filter(p => p !== a.path) } }); }
    await rm(a.path, { force: true }); await this.prisma.mediaAsset.delete({ where: { id } });
    await this.audit.log({ workspaceId, userId, action: 'media.delete', resourceType: 'mediaAsset', resourceId: id, requestId });
    return { ok: true };
  }
  static dirOf(p: string) { return dirname(p); }
}
