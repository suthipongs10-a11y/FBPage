/**
 * Playlist Architect (AGENTS_YOUTUBE §45) — AI เสนอการจัดกลุ่มจากข้อมูลที่ซิงก์ไว้ (ไม่ยิง API) → เก็บเป็น YouTubeRecommendation
 * (ADD_TO_PLAYLIST / CREATE_PLAYLIST) → คนกด "ทำเลย" ระบบจึงเรียก YouTube ผ่าน OAuth ของเจ้าของช่อง แล้วซิงก์ playlist กลับ
 */
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { channelInWorkspace } from '@fbpm/database';
import { channelAuth, syncPlaylists, type YtDeps } from '@fbpm/youtube-core';
import { PRISMA } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { QUOTA, QuotaLedger, YT } from './youtube.provider';
import { rethrowYt } from './errors';

export const YT_PLAYLIST_PROMPT_VERSION = 'youtube-playlist-architect-v1';
interface PlaylistPlan { playlistId: string | null; title: string; description: string; videoIds: string[]; why: string; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; priority: number }
const ser = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x))) as T;

@Injectable()
export class YtPlaylistsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(YT) private readonly yt: YtDeps, @Inject(QUOTA) private readonly quota: QuotaLedger, @Inject(AiGatewayService) private readonly ai: AiGatewayService, @Inject(AuditService) private readonly audit: AuditService) {}

  private async channel(workspaceId: string, channelId: string) {
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: channelId, ...channelInWorkspace(workspaceId) }, select: { id: true, title: true, accessMode: true, automationLevel: true, brand: { select: { name: true, targetAudience: true } } } });
    if (!ch) throw new NotFoundException('ไม่พบช่อง'); return ch;
  }

  async list(workspaceId: string, channelId: string) {
    await this.channel(workspaceId, channelId);
    const rows = await this.prisma.youTubePlaylist.findMany({ where: { channelId }, orderBy: { title: 'asc' }, select: { id: true, youtubePlaylistId: true, title: true, description: true, privacyStatus: true, itemCount: true, lastSyncedAt: true, items: { orderBy: { position: 'asc' }, select: { position: true, video: { select: { id: true, youtubeVideoId: true, title: true, videoType: true, viewCount: true } } } } } });
    const inLists = new Set(rows.flatMap(r => r.items.map(i => i.video.id)));
    const orphans = await this.prisma.youTubeVideo.findMany({ where: { channelId, availability: 'AVAILABLE', id: { notIn: [...inLists] } }, orderBy: { publishedAt: 'desc' }, select: { id: true, youtubeVideoId: true, title: true, videoType: true, contentPillar: true, viewCount: true } });
    return ser({ playlists: rows, unlisted: orphans });
  }

  /** เสนอแผน playlist: ใช้ชื่อ/เสา/สถิติที่มี + playlist ที่มีอยู่ — ผลเป็น recommendation ให้คนตัดสิน */
  async plan(workspaceId: string, userId: string, channelId: string, requestId: string) {
    const ch = await this.channel(workspaceId, channelId);
    const [videos, lists] = await Promise.all([
      this.prisma.youTubeVideo.findMany({ where: { channelId, availability: 'AVAILABLE' }, orderBy: { publishedAt: 'desc' }, take: 300, select: { id: true, youtubeVideoId: true, title: true, videoType: true, contentPillar: true, viewCount: true, publishedAt: true, playlistItems: { select: { playlist: { select: { youtubePlaylistId: true } } } } } }),
      this.prisma.youTubePlaylist.findMany({ where: { channelId }, select: { youtubePlaylistId: true, title: true, description: true, itemCount: true } }),
    ]);
    if (videos.length < 3) throw new UnprocessableEntityException(`วิดีโอที่ซิงก์ไว้มี ${videos.length} รายการ — น้อยเกินไปสำหรับจัด playlist`);
    const compact = videos.map(v => ({ id: v.youtubeVideoId, t: v.title.slice(0, 80), type: v.videoType, pillar: v.contentPillar, views: v.viewCount === null ? null : Number(v.viewCount), date: v.publishedAt?.toISOString().slice(0, 10), in: v.playlistItems.map(p => p.playlist.youtubePlaylistId) }));
    const out = await this.ai.structured({ workspaceId, userId, taskType: 'youtube.playlists.plan', role: 'strategy', requestId, promptVersion: YT_PLAYLIST_PROMPT_VERSION, resourceType: 'youtubeChannel', resourceId: channelId }, {
      system: 'คุณคือ Playlist Architect ของช่อง YouTube จัดกลุ่มวิดีโอเป็น playlist ที่ช่วยให้ผู้ชมดูต่อเนื่อง (series/หัวข้อเดียวกัน/ระดับผู้เริ่ม→ขั้นสูง) ใช้ playlist ที่มีอยู่ก่อนถ้าเข้ากัน (ระบุ playlistId เดิม) สร้างใหม่เฉพาะเมื่อจำเป็น แยก Shorts ออกจากวิดีโอยาว ตั้งชื่อ playlist เป็นภาษาเดียวกับชื่อวิดีโอ อธิบายเหตุผลจากชื่อ/เสา/สถิติที่ให้เท่านั้น ห้ามอ้างวิดีโอที่ไม่มีในรายการ อย่าเสนอเกิน 8 playlist',
      prompt: `ช่อง "${ch.title}" แบรนด์ ${ch.brand.name} กลุ่มเป้าหมาย ${ch.brand.targetAudience ?? '-'}\nplaylist ที่มี: ${JSON.stringify(lists)}\nวิดีโอ (in = playlist ที่อยู่แล้ว): ${JSON.stringify(compact)}`,
      schemaDescription: `{ "playlists": [{ "playlistId": string|null, "title": string, "description": string, "videoIds": string[], "why": string, "confidence": "LOW"|"MEDIUM"|"HIGH", "priority": number }], "notes": string[] }`,
      validate: v => { const o = v as { playlists?: Record<string, unknown>[]; notes?: unknown[] }; if (!Array.isArray(o.playlists)) throw new Error('playlists หาย'); const known = new Set(videos.map(x => x.youtubeVideoId)); const known2 = new Set(lists.map(l => l.youtubePlaylistId));
        return { playlists: o.playlists.filter(p => typeof p.title === 'string' && Array.isArray(p.videoIds)).map(p => ({ playlistId: typeof p.playlistId === 'string' && known2.has(p.playlistId) ? p.playlistId : null, title: String(p.title).slice(0, 150), description: String(p.description ?? '').slice(0, 5000), videoIds: (p.videoIds as unknown[]).map(String).filter(id => known.has(id)), why: String(p.why ?? '').slice(0, 2000), confidence: (['LOW', 'MEDIUM', 'HIGH'].includes(String(p.confidence)) ? String(p.confidence) : 'MEDIUM') as PlaylistPlan['confidence'], priority: Math.max(0, Math.min(100, Math.round(Number(p.priority ?? 50)))) })).filter(p => p.videoIds.length > 0).slice(0, 8) as PlaylistPlan[], notes: Array.isArray(o.notes) ? o.notes.map(String) : [] }; }, maxTokens: 5000,
    });
    let created = 0;
    for (const p of out.result.data.playlists) {
      const actionType = p.playlistId ? 'ADD_TO_PLAYLIST' : 'CREATE_PLAYLIST';
      const title = p.playlistId ? `เพิ่ม ${p.videoIds.length} วิดีโอเข้า playlist "${lists.find(l => l.youtubePlaylistId === p.playlistId)?.title ?? p.title}"` : `สร้าง playlist "${p.title}" (${p.videoIds.length} วิดีโอ)`;
      const exists = await this.prisma.youTubeRecommendation.findFirst({ where: { channelId, actionType, title, status: 'OPEN' }, select: { id: true } });
      if (exists) continue;
      await this.prisma.youTubeRecommendation.create({ data: { channelId, actionType, title, why: p.why, evidence: { playlistId: p.playlistId, playlistTitle: p.title, description: p.description, videoIds: p.videoIds, videos: p.videoIds.map(id => videos.find(v => v.youtubeVideoId === id)?.title ?? id) } as Prisma.InputJsonValue, confidence: p.confidence, priority: p.priority, source: 'playlist-architect', promptVersion: YT_PLAYLIST_PROMPT_VERSION } }); created++;
    }
    await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_PLAYLIST_PLANNED', resourceType: 'youtubeChannel', resourceId: channelId, after: { proposed: out.result.data.playlists.length, created, costUsd: out.costUsd }, requestId });
    return { proposed: out.result.data.playlists, notes: out.result.data.notes, recommendationsCreated: created, provider: out.provider, model: out.model, costUsd: out.costUsd };
  }

  /** ทำตามคำแนะนำ playlist จริง (ต้อง OAuth + youtube.playlists.manage) — idempotent: ข้ามวิดีโอที่อยู่ใน playlist แล้ว */
  async apply(workspaceId: string, userId: string, recommendationId: string, requestId: string) {
    const rec = await this.prisma.youTubeRecommendation.findFirst({ where: { id: recommendationId, channel: channelInWorkspace(workspaceId) }, select: { id: true, channelId: true, actionType: true, status: true, evidence: true, title: true } });
    if (!rec) throw new NotFoundException('ไม่พบคำแนะนำ');
    if (!['ADD_TO_PLAYLIST', 'CREATE_PLAYLIST'].includes(rec.actionType)) throw new ConflictException('คำแนะนำนี้ไม่ใช่งาน playlist');
    if (rec.status === 'DONE') throw new ConflictException('ทำไปแล้ว');
    const ch = await this.prisma.youTubeChannel.findFirst({ where: { id: rec.channelId }, select: { id: true, automationPaused: true, disconnectedAt: true, brand: { select: { client: { select: { workspace: { select: { automationPaused: true } } } } } } } });
    if (!ch || ch.disconnectedAt) throw new ConflictException('ช่องถูกตัดการเชื่อมต่อแล้ว');
    if (ch.automationPaused || ch.brand.client.workspace.automationPaused) throw new ConflictException('ระบบอัตโนมัติถูกหยุดไว้ (kill switch)');
    const ev = rec.evidence as { playlistId: string | null; playlistTitle: string; description?: string; videoIds: string[] };
    try {
      return await this.quota.scope({ workspaceId, channelId: rec.channelId, requestId }, async () => {
        const { auth } = await channelAuth(this.yt, rec.channelId, { requireOAuth: true });
        let playlistId = ev.playlistId; let createdPlaylist = false;
        if (!playlistId) { const p = await this.yt.yt.createPlaylist(auth, { title: ev.playlistTitle, description: ev.description, privacyStatus: 'public' }); playlistId = p.id; createdPlaylist = true; }
        const existing = new Set(await this.yt.yt.listPlaylistVideoIds(auth, playlistId));
        let added = 0; const skipped: string[] = [];
        for (const vid of ev.videoIds) { if (existing.has(vid)) { skipped.push(vid); continue; } await this.yt.yt.addVideoToPlaylist(auth, playlistId, vid); added++; }
        await syncPlaylists(this.yt, rec.channelId).catch(() => undefined);
        const outcome = { playlistId, createdPlaylist, added, skipped, appliedAt: new Date().toISOString(), by: userId };
        await this.prisma.youTubeRecommendation.update({ where: { id: rec.id }, data: { status: 'DONE', outcome: outcome as Prisma.InputJsonValue } });
        await this.audit.log({ workspaceId, userId, action: 'YOUTUBE_PLAYLIST_APPLIED', resourceType: 'youtubeRecommendation', resourceId: rec.id, after: outcome, requestId });
        return outcome;
      });
    } catch (e) { rethrowYt(e); }
  }
}
