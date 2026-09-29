/** YT-5 Comment intelligence (§47–52, §85, §106, §111) */
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { channelInWorkspace } from '@fbpm/database';
import { YouTubeApiError, channelAuth, recomputeNeedsReply, syncComments, type YtDeps } from '@fbpm/youtube-core';
import { YT_COMMENT_CLASSES, toolAllowedWithoutApproval, type YtCommentClass } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUOTA, QuotaLedger, YT } from './youtube.provider';
import { rethrowYt } from './errors';
import type { ClassifyYtDto, ListYtCommentsDto, UpdateYtCommentDto } from './dto';

export const YT_COMMENT_PROMPT_VERSION = 'youtube-comment-classifier-v1';
export const YT_CLUSTER_PROMPT_VERSION = 'youtube-comment-cluster-v1';
export const YT_HIGHLIGHT_PROMPT_VERSION = 'youtube-comment-highlights-v1';
const SELECT = { id: true, channelId: true, videoId: true, youtubeCommentId: true, parentCommentId: true, authorDisplayName: true, text: true, likeCount: true, publishedAt: true, isReply: true, classification: true, sentiment: true, riskFlag: true, aiSummary: true, draftReply: true, replyStatus: true, needsReply: true, replyExternalId: true, repliedAt: true, resolvedAt: true, clusterId: true, video: { select: { id: true, title: true, youtubeVideoId: true } }, channel: { select: { id: true, title: true, automationLevel: true } }, lead: { select: { id: true, leadScore: true, status: true } } } as const;
const AUTO_SAFE: YtCommentClass[] = ['QUESTION', 'PRAISE', 'CONTENT_REQUEST', 'EXPERIENCE_SHARE'];
interface Classified { id: string; classification: YtCommentClass; sentiment: 'positive' | 'neutral' | 'negative'; risk: boolean; summary: string; draftReply: string | null; lead: { intent: string | null; product: string | null; service: string | null; location: string | null; phone: string | null; leadScore: number; confidence: number } | null }

@Injectable()
export class YtCommentsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(YT) private readonly yt: YtDeps, @Inject(QUOTA) private readonly quota: QuotaLedger, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  list(workspaceId: string, q: ListYtCommentsDto) {
    return this.prisma.youTubeComment.findMany({ where: { channel: channelInWorkspace(workspaceId), ...(q.channelId && { channelId: q.channelId }), ...(q.videoId && { videoId: q.videoId }), ...(q.classification && { classification: q.classification }), ...(q.unresolved === '1' && { resolvedAt: null, isReply: false }), ...(q.unclassified === '1' && { classification: null }), ...(q.needsReply === '1' && { needsReply: true }) }, orderBy: { publishedAt: 'desc' }, take: q.limit ?? 200, select: SELECT });
  }

  /** เธรดที่รอช่องตอบ: เป้าหมาย = ความเห็นล่าสุดที่รอตอบในเธรด (อาจเป็น reply) + บทสนทนาในเธรดให้คนอ่านก่อนตอบ */
  async threads(workspaceId: string, channelId?: string, limit = 100) {
    const pending = await this.prisma.youTubeComment.findMany({ where: { channel: channelInWorkspace(workspaceId), needsReply: true, ...(channelId && { channelId }) }, orderBy: { publishedAt: 'desc' }, take: 600, select: SELECT });
    const byThread = new Map<string, typeof pending>();
    for (const c of pending) { const k = `${c.channelId}:${c.parentCommentId ?? c.youtubeCommentId}`; byThread.set(k, [...(byThread.get(k) ?? []), c]); }
    const picked = [...byThread.values()].slice(0, limit);
    const keys = picked.map(list => list[0]!.parentCommentId ?? list[0]!.youtubeCommentId);
    const owners = new Map((await this.prisma.youTubeChannel.findMany({ where: { id: { in: [...new Set(picked.map(l => l[0]!.channelId))] } }, select: { id: true, youtubeChannelId: true } })).map(c => [c.id, c.youtubeChannelId]));
    const msgs = keys.length ? await this.prisma.youTubeComment.findMany({ where: { channel: channelInWorkspace(workspaceId), OR: [{ youtubeCommentId: { in: keys } }, { parentCommentId: { in: keys } }] }, orderBy: { publishedAt: 'asc' }, select: { id: true, channelId: true, youtubeCommentId: true, parentCommentId: true, authorChannelId: true, authorDisplayName: true, text: true, publishedAt: true, isReply: true, needsReply: true } }) : [];
    return picked.map(list => {
      const target = list[0]!; const key = target.parentCommentId ?? target.youtubeCommentId; const owner = owners.get(target.channelId);
      const thread = msgs.filter(m => m.channelId === target.channelId && (m.youtubeCommentId === key || m.parentCommentId === key));
      return { threadId: key, target, pendingCount: list.length, total: thread.length, messages: thread.slice(-8).map(m => ({ id: m.id, author: m.authorDisplayName, text: m.text, publishedAt: m.publishedAt, isReply: m.isReply, fromChannel: !!owner && m.authorChannelId === owner, pending: m.needsReply })) };
    });
  }
  async sync(workspaceId: string, userId: string, channelId: string, requestId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true } }); if (!ch) throw new NotFoundException('ไม่พบช่อง');
    try { const r = await this.quota.scope({ workspaceId, channelId, requestId }, () => syncComments(this.yt, channelId, { maxVideos: 20 })); await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_COMMENTS_SYNCED', resourceType: 'youtubeChannel', resourceId: channelId, after: r, requestId }); return r; } catch (e) { rethrowYt(e); }
  }

  /** Comment Intelligence + Lead Detector (§49, §111) — batch ≤ 25; FULL_AUTO ตอบเองเฉพาะ safe classes ที่ policy.allowAutoReply */
  async classify(workspaceId: string, userId: string, dto: ClassifyYtDto, requestId: string) {
    const base = { channel: channelInWorkspace(workspaceId), ...(dto?.channelId && { channelId: dto.channelId }) };
    // pendingOnly: เป้าหมายของแต่ละเธรดที่รอตอบ (ความเห็นล่าสุด) ที่ยังไม่มีร่าง · ปกติ: ความเห็นที่ยังไม่จำแนก (top-level + reply ที่รอตอบ)
    const where: Prisma.YouTubeCommentWhereInput = dto?.commentIds ? { ...base, id: { in: dto.commentIds } }
      : dto?.pendingOnly ? { ...base, id: { in: (await this.threads(workspaceId, dto.channelId, 200)).filter(t => !t.target.draftReply || t.target.replyStatus === 'FAILED').map(t => t.target.id) } }
      : { ...base, classification: null, OR: [{ isReply: false }, { needsReply: true }] };
    const comments = await this.prisma.youTubeComment.findMany({ where, orderBy: { publishedAt: 'desc' }, take: dto?.limit ?? 25, select: { id: true, channelId: true, authorChannelId: true, authorDisplayName: true, text: true, likeCount: true, isReply: true, parentCommentId: true, youtubeCommentId: true, publishedAt: true, video: { select: { title: true } }, channel: { select: { youtubeChannelId: true } } } });
    const forAi = comments.filter(c => c.authorChannelId !== c.channel.youtubeChannelId);
    // บริบทเธรด: ข้อความก่อนหน้า (สูงสุด 4) บอกว่าใครพูด — ให้ AI ตอบให้ต่อเนื่องกับที่ช่องเคยตอบ
    const threadKeys = [...new Set(forAi.map(c => c.parentCommentId ?? c.youtubeCommentId))];
    const threadRows = threadKeys.length ? await this.prisma.youTubeComment.findMany({ where: { channel: channelInWorkspace(workspaceId), OR: [{ youtubeCommentId: { in: threadKeys } }, { parentCommentId: { in: threadKeys } }] }, orderBy: { publishedAt: 'asc' }, select: { channelId: true, youtubeCommentId: true, parentCommentId: true, authorChannelId: true, authorDisplayName: true, text: true, publishedAt: true } }) : [];
    const context = (c: (typeof forAi)[number]) => { const k = c.parentCommentId ?? c.youtubeCommentId; const prior = threadRows.filter(r => r.channelId === c.channelId && (r.youtubeCommentId === k || r.parentCommentId === k) && r.publishedAt < c.publishedAt).slice(-4); return prior.length ? prior.map(r => `${r.authorChannelId === c.channel.youtubeChannelId ? '[ช่อง]' : `[${r.authorDisplayName ?? 'ผู้ชม'}]`} ${r.text.slice(0, 200)}`) : undefined; };
    if (!forAi.length) return { classified: 0, leads: 0, autoReplied: 0, items: [] };
    let leads = 0; let autoReplied = 0; let cost = 0; const done: string[] = [];
    for (const channelId of [...new Set(forAi.map(c => c.channelId))]) {
      const ch = await this.prisma.youTubeChannel.findFirstOrThrow({ where: { id: channelId }, select: { id: true, title: true, automationLevel: true, policy: true, brand: { select: { name: true, toneOfVoice: true, primaryCTA: true, preferredLanguage: true, knowledge: { where: { active: true }, select: { type: true, title: true, content: true } } } } } });
      const batch = forAi.filter(c => c.channelId === channelId);
      const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.comments.classify', role: 'community', requestId, promptVersion: YT_COMMENT_PROMPT_VERSION, resourceType: 'youtubeChannel', resourceId: channelId }, {
        system: `คุณคือ Comment Intelligence ของช่อง YouTube "${ch.title}" (แบรนด์ ${ch.brand.name}) น้ำเสียง ${ch.brand.toneOfVoice ?? 'สุภาพ เป็นกันเอง'} ภาษา ${ch.brand.preferredLanguage === 'en' ? 'อังกฤษ' : 'ไทย'}\nจำแนกเป็น ${YT_COMMENT_CLASSES.join('|')} ประเมิน sentiment และ risk (true = ข้อโต้แย้งข้อเท็จจริง/สุขภาพ/กฎหมาย/ดราม่า ต้องให้คนดู) เขียน draftReply สั้น สุภาพ ตามข้อมูลแบรนด์ (ไม่มีข้อมูล → ชวนทักแชท ห้ามเดา) ทุกความเห็นต้องมี draftReply ยกเว้น SPAM → null (คำชมก็ขอบคุณสั้นๆ)\nความเห็นที่มี thread = บทสนทนาก่อนหน้าในเธรด ([ช่อง] = เราตอบไปแล้ว) ให้ตอบต่อเนื่องกับความเห็นล่าสุด ไม่ทวนสิ่งที่ช่องตอบไปแล้ว ไม่ต้องใส่ @ชื่อ (ระบบใส่ให้)\nlead เมื่อมีเจตนาซื้อ/ใช้บริการ/ถามที่ซื้อ-ราคา-พื้นที่ (§111) leadScore 0-100 ห้ามแต่งข้อมูลติดต่อ\nข้อมูลแบรนด์:\n${ch.brand.knowledge.map(k => `- [${k.type}] ${k.title}: ${k.content.slice(0, 250)}`).join('\n') || '(ยังไม่มี)'}`,
        prompt: `คอมเมนต์ ${batch.length} รายการ:\n${JSON.stringify(batch.map(c => ({ id: c.id, author: c.authorDisplayName, text: c.text.slice(0, 500), likes: c.likeCount, video: c.video?.title?.slice(0, 80), ...(context(c) && { thread: context(c) }) })))}`,
        schemaDescription: `{ "comments": [{ "id": string, "classification": ${YT_COMMENT_CLASSES.map(x => `"${x}"`).join('|')}, "sentiment": "positive"|"neutral"|"negative", "risk": boolean, "summary": string, "draftReply": string|null, "lead": null | { "intent": string|null, "product": string|null, "service": string|null, "location": string|null, "phone": string|null, "leadScore": number, "confidence": number } }] }`,
        validate: v => { const o = v as { comments?: unknown[] }; if (!Array.isArray(o.comments)) throw new Error('comments ต้องเป็น array'); return o.comments.map(raw => { const c = raw as Record<string, unknown>; if (typeof c.id !== 'string') throw new Error('id หาย'); if (!(YT_COMMENT_CLASSES as readonly string[]).includes(c.classification as string)) throw new Error(`classification ไม่ถูกต้อง: ${String(c.classification)}`); const l = c.lead as Record<string, unknown> | null | undefined; const s = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null); return { id: c.id, classification: c.classification as YtCommentClass, sentiment: (['positive', 'neutral', 'negative'].includes(c.sentiment as string) ? c.sentiment : 'neutral') as Classified['sentiment'], risk: c.risk === true, summary: String(c.summary ?? ''), draftReply: s(c.draftReply), lead: l && Number(l.leadScore) > 0 ? { intent: s(l.intent), product: s(l.product), service: s(l.service), location: s(l.location), phone: s(l.phone), leadScore: Math.max(0, Math.min(100, Math.round(Number(l.leadScore)))), confidence: Math.max(0, Math.min(1, Number(l.confidence ?? 0.5))) } : null } as Classified; }); }, maxTokens: 7000,
      });
      cost += out.costUsd ?? 0;
      const policy = (ch.policy as { allowAutoReply?: boolean } | null) ?? {};
      for (const r of out.result.data) {
        const c = batch.find(x => x.id === r.id); if (!c) continue; done.push(c.id);
        await this.prisma.youTubeComment.update({ where: { id: c.id }, data: { classification: r.classification, sentiment: r.sentiment, riskFlag: r.risk, aiSummary: r.summary, ...(r.draftReply && { draftReply: r.draftReply, replyStatus: 'DRAFTED' }), ...(r.classification === 'SPAM' && { replyStatus: 'SKIPPED' }) } });
        if (r.lead && r.lead.leadScore >= 40) {
          const lead = await this.prisma.lead.upsert({ where: { youtubeCommentId: c.id }, create: { workspaceId, pageId: null, youtubeCommentId: c.id, source: 'youtube-comment', sourcePlatform: 'YOUTUBE', name: c.authorDisplayName, ...r.lead, data: r as unknown as Prisma.InputJsonValue }, update: { ...r.lead }, select: { id: true } }).catch(() => null);
          if (lead) { leads++; if (r.lead.leadScore >= 70) await this.notifications.notify(workspaceId, { type: 'hot_lead', severity: 'warn', title: `ลีดร้อนจาก YouTube (${r.lead.leadScore}): ${c.authorDisplayName ?? 'ผู้ชม'} — ${r.lead.intent ?? r.lead.service ?? ''}`, body: c.text.slice(0, 140), href: '/leads', resourceType: 'lead', resourceId: lead.id, dedupeKey: `lead:${lead.id}` }); }
        }
        if (r.draftReply && !r.risk && AUTO_SAFE.includes(r.classification) && policy.allowAutoReply && toolAllowedWithoutApproval('PUBLISH', ch.automationLevel)) { try { await this.reply(workspaceId, null, c.id, r.draftReply, requestId, true); autoReplied++; } catch { /* บันทึก FAILED แล้ว */ } }
      }
    }
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_COMMENTS_CLASSIFIED', resourceType: 'youtubeComment', after: { classified: done.length, leads, autoReplied, costUsd: cost }, requestId });
    return { classified: done.length, leads, autoReplied, costUsd: cost, items: await this.prisma.youTubeComment.findMany({ where: { id: { in: done } }, select: SELECT }) };
  }

  /** Comment → Video Idea Engine (§50, §85): จับกลุ่มคำถาม/คำขอซ้ำ → CommentCluster (แทนที่ทั้งชุดของช่อง) */
  async cluster(workspaceId: string, userId: string, channelId: string, requestId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true } }); if (!ch) throw new NotFoundException('ไม่พบช่อง');
    const comments = await this.prisma.youTubeComment.findMany({ where: { channelId, isReply: false, classification: { in: ['QUESTION', 'CONTENT_REQUEST', 'FOLLOW_UP_QUESTION', 'MISUNDERSTANDING', 'CRITICISM', 'FACT_CHALLENGE', 'PRODUCT_INTEREST', 'SERVICE_INTEREST'] } }, orderBy: { publishedAt: 'desc' }, take: 300, select: { id: true, text: true, aiSummary: true, classification: true, publishedAt: true, video: { select: { title: true } } } });
    if (comments.length < 3) return { clusters: [], note: `คอมเมนต์ที่จำแนกเป็นคำถาม/คำขอมี ${comments.length} — น้อยเกินไปสำหรับจับกลุ่ม` };
    // §84: ส่งสรุปสั้น ไม่ส่งคอมเมนต์เต็มพันรายการ
    const compact = comments.map(c => ({ id: c.id, s: (c.aiSummary || c.text).slice(0, 120), k: c.classification, v: c.video?.title?.slice(0, 40) }));
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.comments.cluster', role: 'analysis', requestId, promptVersion: YT_CLUSTER_PROMPT_VERSION, resourceType: 'youtubeChannel', resourceId: channelId }, {
      system: 'จับกลุ่มคอมเมนต์ที่ถามหรือขอเรื่องเดียวกันเป็นคลัสเตอร์ (3–12 กลุ่ม) ตั้งชื่อกลุ่มเป็นคำถาม/หัวข้อสั้นภาษาไทย ระบุชนิด (CONTENT_REQUEST|QUESTION|COMPLAINT|MISUNDERSTANDING|OTHER) และรายการ id ของคอมเมนต์ในกลุ่ม ห้ามสร้าง id ใหม่',
      prompt: `ช่อง ${ch.title}\n${JSON.stringify(compact)}`, schemaDescription: `{ "clusters": [{ "label": string, "kind": "CONTENT_REQUEST"|"QUESTION"|"COMPLAINT"|"MISUNDERSTANDING"|"OTHER", "description": string, "commentIds": string[], "confidence": number }] }`,
      validate: v => { const o = v as { clusters?: { label?: string; kind?: string; description?: string; commentIds?: string[]; confidence?: number }[] }; if (!Array.isArray(o.clusters)) throw new Error('clusters หาย'); return o.clusters.filter(c => c.label && Array.isArray(c.commentIds)).map(c => ({ label: String(c.label).slice(0, 160), kind: ['CONTENT_REQUEST', 'QUESTION', 'COMPLAINT', 'MISUNDERSTANDING'].includes(c.kind ?? '') ? c.kind! : 'OTHER', description: String(c.description ?? '').slice(0, 1000), commentIds: c.commentIds!.filter(id => comments.some(x => x.id === id)), confidence: Math.max(0, Math.min(1, Number(c.confidence ?? 0.6))) })); }, maxTokens: 5000,
    });
    await this.prisma.youTubeComment.updateMany({ where: { channelId }, data: { clusterId: null } });
    await this.prisma.commentCluster.deleteMany({ where: { channelId } });
    const created = [];
    for (const c of out.result.data) {
      if (c.commentIds.length < 2) continue;
      const dates = comments.filter(x => c.commentIds.includes(x.id)).map(x => x.publishedAt.getTime());
      const row = await this.prisma.commentCluster.create({ data: { channelId, label: c.label, kind: c.kind, description: c.description, count: c.commentIds.length, representativeCommentIds: c.commentIds.slice(0, 3), confidence: c.confidence, firstSeen: new Date(Math.min(...dates)), lastSeen: new Date(Math.max(...dates)) } });
      await this.prisma.youTubeComment.updateMany({ where: { id: { in: c.commentIds } }, data: { clusterId: row.id } });
      created.push(row);
    }
    const top = created.sort((a, b) => b.count - a.count)[0];
    if (top && top.count >= 5) await this.notifications.notify(workspaceId, { type: 'info', severity: 'info', title: `ผู้ชมถามซ้ำ ${top.count} ครั้ง: ${top.label}`, body: 'สร้างไอเดียวิดีโอจากคลัสเตอร์นี้ได้ในหน้า YouTube › คอมเมนต์', href: '/youtube/comments', dedupeKey: `yt-cluster:${channelId}:${top.label.slice(0, 40)}` });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_COMMENTS_CLUSTERED', resourceType: 'youtubeChannel', resourceId: channelId, after: { clusters: created.length, costUsd: out.costUsd }, requestId });
    return { clusters: created.sort((a, b) => b.count - a.count) };
  }
  listClusters(workspaceId: string, channelId?: string) { return this.prisma.commentCluster.findMany({ where: { channel: channelInWorkspace(workspaceId), ...(channelId && { channelId }) }, orderBy: { count: 'desc' }, take: 50, include: { channel: { select: { id: true, title: true } } } }); }

  async update(workspaceId: string, userId: string, id: string, dto: UpdateYtCommentDto, requestId: string) {
    const c = await this.prisma.youTubeComment.findFirst({ where: { id, channel: channelInWorkspace(workspaceId) }, select: { id: true, channelId: true, replyStatus: true, youtubeCommentId: true, parentCommentId: true } }); if (!c) throw new NotFoundException('ไม่พบคอมเมนต์');
    let out = await this.prisma.youTubeComment.update({ where: { id }, data: { ...(dto.draftReply !== undefined && { draftReply: dto.draftReply, replyStatus: dto.draftReply ? (c.replyStatus === 'SENT' ? 'SENT' : 'APPROVED') : 'NONE' }), ...(dto.resolved !== undefined && { resolvedAt: dto.resolved ? new Date() : null }), ...(dto.classification && { classification: dto.classification }) }, select: SELECT });
    if (dto.resolved !== undefined || dto.classification) { await recomputeNeedsReply(this.prisma, c.channelId, [c.parentCommentId ?? c.youtubeCommentId]); out = await this.prisma.youTubeComment.findUniqueOrThrow({ where: { id }, select: SELECT }); }
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_COMMENT_REPLY_DRAFTED', resourceType: 'youtubeComment', resourceId: id, after: dto, requestId });
    return out;
  }
  /** ส่งคำตอบจริง (§106): ตรวจ kill switch, ต้อง OAuth + scope force-ssl */
  async reply(workspaceId: string, userId: string | null, id: string, message: string | undefined, requestId: string, auto = false) {
    const c = await this.prisma.youTubeComment.findFirst({ where: { id, channel: channelInWorkspace(workspaceId) }, select: { id: true, channelId: true, videoId: true, youtubeCommentId: true, parentCommentId: true, isReply: true, authorDisplayName: true, draftReply: true, replyStatus: true, channel: { select: { automationPaused: true, brand: { select: { client: { select: { workspace: { select: { automationPaused: true } } } } } } } } } });
    if (!c) throw new NotFoundException('ไม่พบคอมเมนต์'); if (c.replyStatus === 'SENT') throw new ConflictException('ตอบไปแล้ว');
    let text = (message ?? c.draftReply ?? '').trim(); if (!text) throw new UnprocessableEntityException('ไม่มีข้อความตอบ');
    // YouTube มี reply ชั้นเดียว: ตอบ reply = โพสต์ในเธรดเดิม (parentId = ความเห็นบนสุด) แล้วแท็ก @ผู้เขียนให้เขารู้ว่าตอบเขา
    const threadId = c.parentCommentId ?? c.youtubeCommentId;
    if (c.isReply && c.authorDisplayName) { const handle = c.authorDisplayName.startsWith('@') ? c.authorDisplayName : `@${c.authorDisplayName}`; if (!text.includes(handle)) text = `${handle} ${text}`; }
    if (c.channel.automationPaused || c.channel.brand.client.workspace.automationPaused) throw new ForbiddenException('ระบบอัตโนมัติถูกหยุดไว้ (kill switch)');
    try {
      const { auth } = await channelAuth(this.yt, c.channelId, { requireOAuth: true });
      const r = await this.quota.scope({ workspaceId, channelId: c.channelId, requestId }, () => this.yt.yt.replyToComment(auth, threadId, text));
      await this.prisma.youTubeComment.update({ where: { id }, data: { draftReply: text, replyStatus: 'SENT', replyExternalId: r.id, repliedAt: new Date(), resolvedAt: new Date(), needsReply: false } });
      // เก็บคำตอบของช่องไว้ในเธรดทันที (ไม่ต้องรอซิงก์รอบหน้า) แล้วคำนวณ "รอตอบ" ของเธรดใหม่
      await this.prisma.youTubeComment.upsert({ where: { channelId_youtubeCommentId: { channelId: c.channelId, youtubeCommentId: r.id } }, create: { channelId: c.channelId, videoId: c.videoId, youtubeCommentId: r.id, parentCommentId: threadId, authorChannelId: r.authorChannelId, authorDisplayName: r.authorDisplayName, text: r.text || text, publishedAt: new Date(r.publishedAt), isReply: true, replyStatus: 'SKIPPED', classification: 'OTHER', rawData: r.raw as Prisma.InputJsonValue }, update: {} });
      await recomputeNeedsReply(this.prisma, c.channelId, [threadId]);
      const out = await this.prisma.youTubeComment.findUniqueOrThrow({ where: { id }, select: SELECT });
      await this.audit.log({ workspaceId, userId, action: auto ? 'YOUTUBE_COMMENT_REPLIED_AUTO' : 'YOUTUBE_COMMENT_REPLIED', resourceType: 'youtubeComment', resourceId: id, after: { externalId: r.id, text: text.slice(0, 200) }, requestId });
      return out;
    } catch (e) { await this.prisma.youTubeComment.update({ where: { id }, data: { replyStatus: 'FAILED' } }); rethrowYt(e); }
  }
  /**
   * วิเคราะห์คอมเมนต์ทั้งหมดของช่อง → จัดอันดับความเห็นที่น่าสนใจ + ไอเดียหัวข้อคลิป (ส่งต่อ Content Lab ได้)
   * ส่งแค่ข้อความสั้น/ตัวเลขที่มีจริงให้ AI (§84) · id ที่ AI ตอบต้องมีอยู่จริง · ความเห็นของช่องเองไม่นับ
   */
  async highlights(workspaceId: string, userId: string, channelId: string, days: number, requestId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true, youtubeChannelId: true, brand: { select: { name: true, industry: true, targetAudience: true } } } });
    if (!ch) throw new NotFoundException('ไม่พบช่อง');
    const since = new Date(Date.now() - days * 86_400_000);
    // คอลัมน์ที่เป็น null ได้ต้องเขียน OR null เอง — `not` ใน SQL ตัดแถว null ทิ้ง (คอมเมนต์ที่ยังไม่จำแนกจะหลุด)
    const rows = await this.prisma.youTubeComment.findMany({ where: { channelId, publishedAt: { gte: since }, AND: [{ OR: [{ authorChannelId: null }, { authorChannelId: { not: ch.youtubeChannelId } }] }, { OR: [{ classification: null }, { classification: { not: 'SPAM' } }] }] }, orderBy: [{ likeCount: 'desc' }, { publishedAt: 'desc' }], take: 300, select: { id: true, youtubeCommentId: true, parentCommentId: true, authorDisplayName: true, text: true, likeCount: true, publishedAt: true, isReply: true, needsReply: true, classification: true, video: { select: { id: true, title: true, youtubeVideoId: true } } } });
    if (rows.length < 3) throw new UnprocessableEntityException(`มีคอมเมนต์ของผู้ชมในช่วง ${days} วันเพียง ${rows.length} รายการ — กด "ซิงก์คอมเมนต์" ก่อน หรือขยายช่วงเวลา`);
    const replies = new Map<string, number>(); for (const r of rows) if (r.parentCommentId) replies.set(r.parentCommentId, (replies.get(r.parentCommentId) ?? 0) + 1);
    const now = Date.now();
    const compact = rows.map(r => ({ id: r.id, v: r.video?.title?.slice(0, 60) ?? null, t: r.text.slice(0, 300), likes: r.likeCount, replies: replies.get(r.youtubeCommentId) ?? 0, ageDays: Math.floor((now - r.publishedAt.getTime()) / 86_400_000), reply: r.isReply || undefined, waiting: r.needsReply || undefined }));
    const KINDS = ['QUESTION', 'CONTENT_REQUEST', 'DEBATE', 'INSIGHT', 'COMPLAINT', 'MISINFO', 'LEAD', 'PRAISE'] as const;
    type Kind = (typeof KINDS)[number];
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.comments.highlights', role: 'analysis', requestId, promptVersion: YT_HIGHLIGHT_PROMPT_VERSION, resourceType: 'youtubeChannel', resourceId: channelId }, {
      system: `คุณคือผู้ช่วยครีเอเตอร์ YouTube ช่อง "${ch.title}" (แบรนด์ ${ch.brand.name}${ch.brand.industry ? `, ${ch.brand.industry}` : ''}${ch.brand.targetAudience ? `, ผู้ชม ${ch.brand.targetAudience}` : ''})
อ่านคอมเมนต์ของผู้ชม แล้วคัด "ความเห็นที่น่าสนใจ" สูงสุด 15 รายการ เรียงจากน่าสนใจที่สุด
น่าสนใจ = ถามสิ่งที่คนอื่นน่าจะสงสัยด้วย, ขอหัวข้อคลิป, เปิดประเด็นถกเถียง, ให้ข้อมูล/ประสบการณ์ใหม่, ติเพื่อก่อ, เข้าใจผิดที่ควรแก้, สนใจซื้อ/ใช้บริการ — likes/replies สูงช่วยยืนยัน แต่ไม่ใช่เกณฑ์เดียว
ห้ามแต่งตัวเลข ใช้ id ที่ให้เท่านั้น เหตุผลสั้นๆ ภาษาไทย แล้วสรุปภาพรวม 3–5 ข้อ และเสนอไอเดียหัวข้อคลิปใหม่ 3–6 เรื่องที่มาจากคอมเมนต์เหล่านี้ (บอก id ที่เป็นหลักฐาน)`,
      prompt: `คอมเมนต์ ${compact.length} รายการ (ageDays = อายุเป็นวัน, replies = จำนวนคนตอบต่อ, waiting = ช่องยังไม่ได้ตอบ):\n${JSON.stringify(compact)}`,
      schemaDescription: `{ "summary": string[], "highlights": [{ "id": string, "score": number (0-100), "kind": ${KINDS.map(k => `"${k}"`).join('|')}, "why": string, "topicIdea": string|null, "shouldReply": boolean }], "topicIdeas": [{ "title": string, "why": string, "commentIds": string[] }] }`,
      validate: v => {
        const o = v as { summary?: unknown; highlights?: unknown; topicIdeas?: unknown };
        if (!Array.isArray(o.highlights)) throw new Error('highlights ต้องเป็น array');
        const known = new Set(rows.map(r => r.id));
        const highlights = (o.highlights as Record<string, unknown>[]).filter(h => typeof h.id === 'string' && known.has(h.id)).slice(0, 15).map(h => ({ id: h.id as string, score: Math.max(0, Math.min(100, Math.round(Number(h.score) || 0))), kind: ((KINDS as readonly string[]).includes(h.kind as string) ? h.kind : 'INSIGHT') as Kind, why: String(h.why ?? '').slice(0, 400), topicIdea: typeof h.topicIdea === 'string' && h.topicIdea.trim() ? h.topicIdea.trim().slice(0, 200) : null, shouldReply: h.shouldReply === true }));
        const topicIdeas = (Array.isArray(o.topicIdeas) ? o.topicIdeas as Record<string, unknown>[] : []).filter(x => typeof x.title === 'string' && x.title.trim()).slice(0, 6).map(x => ({ title: String(x.title).trim().slice(0, 200), why: String(x.why ?? '').slice(0, 400), commentIds: (Array.isArray(x.commentIds) ? x.commentIds : []).filter((id): id is string => typeof id === 'string' && known.has(id)).slice(0, 10) }));
        return { summary: (Array.isArray(o.summary) ? o.summary : []).map(String).slice(0, 6), highlights: highlights.sort((a, b) => b.score - a.score), topicIdeas };
      }, maxTokens: 6000,
    });
    const r = out.result.data;
    const run = await this.prisma.youTubeCommentHighlightRun.create({ data: { channelId, commentCount: rows.length, result: { days, ...r } as unknown as Prisma.InputJsonValue, provider: out.provider, model: out.model, promptVersion: YT_HIGHLIGHT_PROMPT_VERSION, createdById: userId }, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_COMMENTS_HIGHLIGHTED', resourceType: 'youtubeChannel', resourceId: channelId, after: { runId: run.id, comments: rows.length, highlights: r.highlights.length, costUsd: out.costUsd }, requestId });
    return this.latestHighlights(workspaceId, channelId);
  }
  /** ผลล่าสุด + ข้อมูลคอมเมนต์จริง (ข้อความ/คลิป/วันที่) ประกอบจาก DB ไม่ใช้ข้อความที่ AI ส่งกลับ */
  async latestHighlights(workspaceId: string, channelId: string) {
    const run = await this.prisma.youTubeCommentHighlightRun.findFirst({ where: { channelId, channel: channelInWorkspace(workspaceId) }, orderBy: { createdAt: 'desc' } });
    if (!run) return null;
    const res = run.result as { days: number; summary: string[]; highlights: { id: string; score: number; kind: string; why: string; topicIdea: string | null; shouldReply: boolean }[]; topicIdeas: { title: string; why: string; commentIds: string[] }[] };
    const ids = [...new Set([...res.highlights.map(h => h.id), ...res.topicIdeas.flatMap(t => t.commentIds)])];
    const comments = new Map((await this.prisma.youTubeComment.findMany({ where: { id: { in: ids }, channelId }, select: SELECT })).map(c => [c.id, c]));
    return { id: run.id, createdAt: run.createdAt, model: run.model, commentCount: run.commentCount, days: res.days, summary: res.summary, highlights: res.highlights.filter(h => comments.has(h.id)).map(h => ({ ...h, comment: comments.get(h.id)! })), topicIdeas: res.topicIdeas.map(t => ({ ...t, comments: t.commentIds.map(id => comments.get(id)).filter(Boolean).map(c => ({ id: c!.id, text: c!.text.slice(0, 200), authorDisplayName: c!.authorDisplayName })) })) };
  }

  /** ส่งร่างที่คนตรวจแล้วหลายรายการ (ทีละรายการ ≤ 30) — หยุดเมื่อโควตาหมด/kill switch */
  async replyBulk(workspaceId: string, userId: string, ids: string[], requestId: string) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try { await this.reply(workspaceId, userId, id, undefined, requestId); results.push({ id, ok: true }); }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e); results.push({ id, ok: false, error: msg });
        if (e instanceof ForbiddenException || /quota|โควตา/i.test(msg) || (e instanceof YouTubeApiError && e.code === 'quotaExceeded')) break;
      }
    }
    return { sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
  }
  /** §52 Creator feedback + §33-style insights */
  async insights(workspaceId: string, channelId: string | undefined, days: number) {
    const since = new Date(Date.now() - days * 86_400_000); const where = { channel: channelInWorkspace(workspaceId), ...(channelId && { channelId }), isReply: false, publishedAt: { gte: since } };
    const rows = await this.prisma.youTubeComment.groupBy({ by: ['classification'], where: { ...where, classification: { not: null } }, _count: { _all: true } });
    const total = rows.reduce((n, r) => n + r._count._all, 0);
    const [needsReply, unresolved, drafted, unclassified, clusters] = await Promise.all([this.prisma.youTubeComment.count({ where: { channel: channelInWorkspace(workspaceId), ...(channelId && { channelId }), needsReply: true } }), this.prisma.youTubeComment.count({ where: { ...where, resolvedAt: null, classification: { notIn: ['SPAM', 'PRAISE'] } } }), this.prisma.youTubeComment.count({ where: { ...where, replyStatus: { in: ['DRAFTED', 'APPROVED'] } } }), this.prisma.youTubeComment.count({ where: { ...where, classification: null } }), this.listClusters(workspaceId, channelId)]);
    return { days, total, needsReply, distribution: rows.map(r => ({ classification: r.classification!, count: r._count._all, share: total ? Math.round((r._count._all / total) * 100) : 0 })).sort((a, b) => b.count - a.count), unresolved, drafted, unclassified, topRequests: clusters.filter(c => c.kind === 'CONTENT_REQUEST' || c.kind === 'QUESTION').slice(0, 5), complaints: clusters.filter(c => c.kind === 'COMPLAINT').slice(0, 3), misunderstandings: clusters.filter(c => c.kind === 'MISUNDERSTANDING').slice(0, 3) };
  }
}
