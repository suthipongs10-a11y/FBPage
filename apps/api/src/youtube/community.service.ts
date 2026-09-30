/**
 * ร่างโพสต์ชุมชน YouTube (แท็บ "โพสต์" ของช่อง)
 * YouTube Data API ไม่มีคำสั่งโพสต์ชุมชน (activities.insert/bulletin ปิดตั้งแต่พฤษภาคม 2020) → ระบบร่าง + เก็บ + เตือนตามเวลา แล้วคนคัดลอกไปโพสต์เอง
 */
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { channelInWorkspace } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import type { CommunityDraftDto, CommunityManualDto, CommunityUpdateDto } from './dto';

export const YT_COMMUNITY_PROMPT_VERSION = 'youtube-community-post-v1';
/** ข้อจำกัดโพลของ YouTube: 2–5 ตัวเลือก ตัวละไม่เกิน 65 ตัวอักษร */
export const POLL_MIN = 2; export const POLL_MAX = 5; export const POLL_OPTION_MAX = 65;
const KINDS = ['TEXT', 'POLL', 'IMAGE'] as const;
type Kind = (typeof KINDS)[number];
const SELECT = { id: true, channelId: true, kind: true, text: true, pollOptions: true, imageIdea: true, source: true, sourceRef: true, aiModel: true, status: true, scheduledAt: true, remindedAt: true, postedAt: true, createdAt: true, updatedAt: true, channel: { select: { id: true, title: true, youtubeChannelId: true, customUrl: true } } } as const;

/** ตัวเลือกโพล: ตัดช่องว่าง/ซ้ำ ยาวไม่เกินที่ YouTube รับ สูงสุด 5 ข้อ */
export function cleanPollOptions(opts: unknown[]): string[] {
  const out: string[] = [];
  for (const o of opts) { const s = String(o ?? '').replace(/\s+/g, ' ').trim().slice(0, POLL_OPTION_MAX); if (s && !out.includes(s)) out.push(s); if (out.length === POLL_MAX) break; }
  return out;
}

@Injectable()
export class YtCommunityService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService) {}

  list(workspaceId: string, channelId?: string, status = 'DRAFT') {
    return this.prisma.youTubeCommunityDraft.findMany({ where: { channel: channelInWorkspace(workspaceId), ...(channelId && { channelId }), ...(status === 'ALL' ? { status: { not: 'ARCHIVED' } } : { status }) }, orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: 200, select: SELECT });
  }

  private async channel(workspaceId: string, channelId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true, brand: { select: { name: true, industry: true, targetAudience: true, toneOfVoice: true, primaryCTA: true, preferredLanguage: true, knowledge: { where: { active: true }, select: { type: true, title: true, content: true }, take: 12 } } } } });
    if (!ch) throw new NotFoundException('ไม่พบช่อง');
    return ch;
  }

  /** ข้อมูลตั้งต้นให้ AI: คลิป (ล่าสุดหรือที่เลือก) / ผลวิเคราะห์คอมเมนต์น่าสนใจล่าสุด / ข้อความที่วางมา (เช่น โพสต์ Facebook) */
  private async sourceMaterial(channelId: string, dto: CommunityDraftDto): Promise<{ text: string; ref: string | null }> {
    if (dto.source === 'VIDEO') {
      const v = await this.prisma.youTubeVideo.findFirst({ where: { channelId, availability: 'AVAILABLE', ...(dto.videoId ? { id: dto.videoId } : { publishedAt: { not: null } }) }, orderBy: { publishedAt: 'desc' }, select: { id: true, youtubeVideoId: true, title: true, description: true, videoType: true, publishedAt: true, viewCount: true } });
      if (!v) throw new UnprocessableEntityException(dto.videoId ? 'ไม่พบคลิปนี้ในช่อง' : 'ยังไม่มีคลิปในระบบ — กดซิงก์ช่องก่อน');
      const url = v.videoType === 'SHORT' ? `https://youtube.com/shorts/${v.youtubeVideoId}` : `https://youtu.be/${v.youtubeVideoId}`;
      return { ref: v.id, text: `คลิป: "${v.title}" (${v.videoType === 'SHORT' ? 'Shorts' : 'คลิปยาว'}${v.publishedAt ? `, ลง ${v.publishedAt.toISOString().slice(0, 10)}` : ''})\nลิงก์: ${url}\nคำอธิบายคลิป: ${(v.description ?? '').slice(0, 900) || '-'}` };
    }
    if (dto.source === 'HIGHLIGHTS') {
      const run = await this.prisma.youTubeCommentHighlightRun.findFirst({ where: { channelId }, orderBy: { createdAt: 'desc' }, select: { id: true, result: true } });
      if (!run) throw new UnprocessableEntityException('ยังไม่เคยวิเคราะห์คอมเมนต์น่าสนใจ — ไปที่ YT · คอมเมนต์ แท็บ "คอมเมนต์น่าสนใจ" ก่อน');
      const r = run.result as { summary?: string[]; topicIdeas?: { title: string; why: string }[]; highlights?: { id: string; why: string; topicIdea: string | null }[] };
      const quotes = await this.prisma.youTubeComment.findMany({ where: { id: { in: (r.highlights ?? []).slice(0, 8).map(h => h.id) } }, select: { text: true } });
      return { ref: run.id, text: `สิ่งที่ผู้ชมพูดถึงในคอมเมนต์:\n${(r.summary ?? []).map(s => `- ${s}`).join('\n')}\nไอเดียหัวข้อ: ${(r.topicIdeas ?? []).map(t => t.title).join(' | ') || '-'}\nตัวอย่างคอมเมนต์: ${quotes.map(q => `"${q.text.slice(0, 160)}"`).join(' | ') || '-'}` };
    }
    const t = (dto.text ?? '').trim(); if (!t) throw new UnprocessableEntityException('ใส่ข้อความหรือหัวข้อที่อยากโพสต์');
    return { ref: null, text: `ข้อความ/หัวข้อตั้งต้น (อาจเป็นโพสต์ Facebook ที่ให้ดัดแปลง):\n${t.slice(0, 3000)}` };
  }

  /** ให้ AI ร่าง 1–5 แบบ แล้วเก็บเป็น DRAFT */
  async draft(workspaceId: string, userId: string, channelId: string, dto: CommunityDraftDto, requestId: string) {
    const ch = await this.channel(workspaceId, channelId);
    const src = await this.sourceMaterial(ch.id, dto);
    const want = dto.kind === 'AUTO' ? 'เลือกรูปแบบที่เหมาะที่สุดเอง ผสมกันได้ (TEXT / POLL / IMAGE)' : `ทุกโพสต์ต้องเป็นแบบ ${dto.kind}`;
    const lang = ch.brand.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย';
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.community.draft', role: 'content', requestId, promptVersion: YT_COMMUNITY_PROMPT_VERSION, resourceType: 'youtubeChannel', resourceId: ch.id }, {
      system: `คุณเขียนโพสต์ชุมชน (แท็บ "โพสต์") ให้ช่อง YouTube "${ch.title}" แบรนด์ ${ch.brand.name}${ch.brand.industry ? ` (${ch.brand.industry})` : ''}${ch.brand.targetAudience ? ` ผู้ชม: ${ch.brand.targetAudience}` : ''} น้ำเสียง ${ch.brand.toneOfVoice ?? 'เป็นกันเอง'} ภาษา${lang}
รูปแบบ: TEXT = ข้อความชวนคุย/อัปเดต/โปรโมตคลิป · POLL = ข้อความเป็นคำถาม + ตัวเลือก ${POLL_MIN}–${POLL_MAX} ข้อ แต่ละข้อไม่เกิน ${POLL_OPTION_MAX} ตัวอักษร · IMAGE = ข้อความ + imageIdea บอกว่าควรใช้รูปอะไร (คนทำรูปเอง)
${want}
กติกา: สั้น อ่านง่ายบนมือถือ 1–5 บรรทัด ใส่อีโมจิได้พอดี เปิดด้วยประโยคดึงความสนใจ ปิดด้วยคำชวนให้คอมเมนต์หรือกดดูคลิป ถ้ามีลิงก์คลิปให้ใส่ลิงก์นั้นตรงตัว แฮชแท็กไม่เกิน 3 ห้ามแต่งตัวเลข ราคา หรือข้อเท็จจริงที่ไม่มีในข้อมูล${ch.brand.primaryCTA ? ` · CTA ของแบรนด์: ${ch.brand.primaryCTA}` : ''}
ข้อมูลแบรนด์: ${ch.brand.knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.slice(0, 200)}`).join(' | ') || '-'}`,
      prompt: `${src.text}${dto.note ? `\n\nความต้องการเพิ่มเติม: ${dto.note.slice(0, 500)}` : ''}\n\nเขียน ${dto.count} โพสต์ที่แตกต่างกัน`,
      schemaDescription: `{ "posts": [{ "kind": "TEXT"|"POLL"|"IMAGE", "text": string, "pollOptions": string[] (เฉพาะ POLL), "imageIdea": string|null (เฉพาะ IMAGE) }] }`,
      validate: v => {
        const o = v as { posts?: unknown }; if (!Array.isArray(o.posts)) throw new Error('posts ต้องเป็น array');
        const posts = (o.posts as Record<string, unknown>[]).map(p => {
          let kind = ((KINDS as readonly string[]).includes(String(p.kind)) ? p.kind : 'TEXT') as Kind;
          if (dto.kind !== 'AUTO') kind = dto.kind;
          const opts = kind === 'POLL' ? cleanPollOptions(Array.isArray(p.pollOptions) ? p.pollOptions : []) : [];
          if (kind === 'POLL' && opts.length < POLL_MIN) kind = 'TEXT';   // โพลที่ตัวเลือกไม่พอ → เป็นข้อความธรรมดา ไม่ทิ้งงาน
          return { kind, text: String(p.text ?? '').trim().slice(0, 2000), pollOptions: kind === 'POLL' ? opts : [], imageIdea: kind === 'IMAGE' && typeof p.imageIdea === 'string' && p.imageIdea.trim() ? p.imageIdea.trim().slice(0, 600) : null };
        }).filter(p => p.text);
        if (!posts.length) throw new Error('ไม่มีโพสต์ที่ใช้ได้');
        return posts.slice(0, dto.count);
      }, maxTokens: 3000,
    });
    const created = [];
    for (const p of out.result.data) created.push(await this.prisma.youTubeCommunityDraft.create({ data: { channelId: ch.id, kind: p.kind, text: p.text, pollOptions: p.pollOptions, imageIdea: p.imageIdea, source: dto.source, sourceRef: src.ref, aiModel: out.model, createdById: userId }, select: SELECT }));
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_COMMUNITY_DRAFTED', resourceType: 'youtubeChannel', resourceId: ch.id, after: { drafts: created.length, source: dto.source, costUsd: out.costUsd }, requestId });
    return created;
  }

  async create(workspaceId: string, userId: string, dto: CommunityManualDto, requestId: string) {
    const ch = await this.channel(workspaceId, dto.channelId);
    const d = await this.prisma.youTubeCommunityDraft.create({ data: { channelId: ch.id, ...this.shape(dto.kind, dto.text, dto.pollOptions, dto.imageIdea), scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null, source: 'MANUAL', createdById: userId }, select: SELECT });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_COMMUNITY_CREATED', resourceType: 'youTubeCommunityDraft', resourceId: d.id, requestId });
    return d;
  }

  private shape(kind: Kind, text: string, pollOptions?: string[], imageIdea?: string | null) {
    const opts = kind === 'POLL' ? cleanPollOptions(pollOptions ?? []) : [];
    if (kind === 'POLL' && opts.length < POLL_MIN) throw new UnprocessableEntityException(`โพลต้องมีตัวเลือก ${POLL_MIN}–${POLL_MAX} ข้อ`);
    return { kind, text: text.trim(), pollOptions: opts, imageIdea: kind === 'IMAGE' ? imageIdea?.trim() || null : null };
  }

  private async find(workspaceId: string, id: string) {
    const d = await this.prisma.youTubeCommunityDraft.findFirst({ where: { id, channel: channelInWorkspace(workspaceId) }, select: SELECT });
    if (!d) throw new NotFoundException('ไม่พบร่างโพสต์');
    return d;
  }

  async update(workspaceId: string, userId: string, id: string, dto: CommunityUpdateDto, requestId: string) {
    const d = await this.find(workspaceId, id);
    const kind = (dto.kind ?? d.kind) as Kind;
    const content = (dto.kind !== undefined || dto.text !== undefined || dto.pollOptions !== undefined || dto.imageIdea !== undefined) ? this.shape(kind, dto.text ?? d.text, dto.pollOptions ?? d.pollOptions, dto.imageIdea !== undefined ? dto.imageIdea : d.imageIdea) : {};
    const data: Prisma.YouTubeCommunityDraftUpdateInput = { ...content };
    if (dto.scheduledAt !== undefined) { data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null; data.remindedAt = null; }   // เปลี่ยนเวลา → เตือนใหม่
    if (dto.status) { data.status = dto.status; data.postedAt = dto.status === 'POSTED' ? new Date() : dto.status === 'DRAFT' ? null : d.postedAt; }
    const out = await this.prisma.youTubeCommunityDraft.update({ where: { id }, data, select: SELECT });
    await this.audit.log({ workspaceId, userId, action: dto.status === 'POSTED' ? 'YOUTUBE_COMMUNITY_MARKED_POSTED' : dto.status === 'ARCHIVED' ? 'YOUTUBE_COMMUNITY_ARCHIVED' : 'YOUTUBE_COMMUNITY_UPDATED', resourceType: 'youTubeCommunityDraft', resourceId: id, before: { status: d.status }, after: { status: out.status, scheduledAt: out.scheduledAt }, requestId });
    return out;
  }
}
