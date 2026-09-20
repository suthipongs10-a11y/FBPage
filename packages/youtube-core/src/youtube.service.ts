/** YouTubeService (§18) — Data API v3 ผ่าน YouTubeClient; ไม่รู้จัก DB/tenant */
import { YouTubeClient } from './client';
import { YouTubeApiError, type Paginated, type UpdateVideoInput, type UploadVideoInput, type YtAuth, type YtChannelDto, type YtCommentDto, type YtPlaylistDto, type YtVideoDto } from './types';
import { parseIsoDuration } from './metrics';

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const int = (v: unknown): number | null => (v === undefined || v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function mapChannel(c: J): YtChannelDto {
  const sn = c.snippet ?? {}; const st = c.statistics ?? {}; const cd = c.contentDetails ?? {};
  return { id: String(c.id), title: String(sn.title ?? ''), customUrl: str(sn.customUrl), description: str(sn.description), country: str(sn.country), defaultLanguage: str(sn.defaultLanguage), thumbnailUrl: sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null, publishedAt: str(sn.publishedAt), uploadsPlaylistId: cd.relatedPlaylists?.uploads ?? null, subscriberCount: st.hiddenSubscriberCount ? null : int(st.subscriberCount), videoCount: int(st.videoCount), viewCount: int(st.viewCount), raw: c };
}
export function mapVideo(v: J): YtVideoDto {
  const sn = v.snippet ?? {}; const st = v.statistics ?? {}; const cd = v.contentDetails ?? {}; const status = v.status ?? {};
  return { id: String(v.id), title: String(sn.title ?? ''), description: String(sn.description ?? ''), publishedAt: str(sn.publishedAt), scheduledPublishAt: str(status.publishAt), privacyStatus: str(status.privacyStatus), uploadStatus: str(status.uploadStatus), durationSeconds: parseIsoDuration(cd.duration), categoryId: str(sn.categoryId), defaultLanguage: str(sn.defaultLanguage), defaultAudioLanguage: str(sn.defaultAudioLanguage), tags: Array.isArray(sn.tags) ? sn.tags.map(String) : [], thumbnailUrl: sn.thumbnails?.maxres?.url ?? sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null, madeForKids: typeof status.madeForKids === 'boolean' ? status.madeForKids : null, liveBroadcastContent: str(sn.liveBroadcastContent), viewCount: int(st.viewCount), likeCount: int(st.likeCount), commentCount: st.commentCount === undefined ? null : int(st.commentCount), commentsDisabled: st.commentCount === undefined && !!v.statistics, raw: v };
}
export function mapComment(c: J, videoId: string | null): YtCommentDto {
  const sn = c.snippet ?? {};
  return { id: String(c.id), videoId: sn.videoId ?? videoId, parentId: sn.parentId ?? null, authorChannelId: sn.authorChannelId?.value ?? null, authorDisplayName: str(sn.authorDisplayName), text: String(sn.textOriginal ?? sn.textDisplay ?? ''), likeCount: int(sn.likeCount) ?? 0, publishedAt: String(sn.publishedAt ?? new Date().toISOString()), updatedAt: str(sn.updatedAt), totalReplyCount: 0, raw: c };
}

export class YouTubeService {
  constructor(readonly client: YouTubeClient) {}

  /** ช่องของเจ้าของ token (OAuth) */
  async getMyChannel(auth: YtAuth): Promise<YtChannelDto | null> {
    const j = await this.client.call<J>('channels', { auth, params: { part: 'snippet,contentDetails,statistics', mine: true }, quotaMethod: 'channels.list' });
    return j.items?.[0] ? mapChannel(j.items[0]) : null;
  }
  async getChannel(auth: YtAuth, channelId: string): Promise<YtChannelDto | null> {
    const j = await this.client.call<J>('channels', { auth, params: { part: 'snippet,contentDetails,statistics', id: channelId }, quotaMethod: 'channels.list' });
    return j.items?.[0] ? mapChannel(j.items[0]) : null;
  }
  /** @handle → channel (API key ก็ได้) */
  async getChannelByHandle(auth: YtAuth, handle: string): Promise<YtChannelDto | null> {
    const j = await this.client.call<J>('channels', { auth, params: { part: 'snippet,contentDetails,statistics', forHandle: handle.replace(/^@/, '') }, quotaMethod: 'channels.list' });
    return j.items?.[0] ? mapChannel(j.items[0]) : null;
  }
  /** ไล่ uploads playlist (§22) — 1 unit/หน้า แทน search.list 100 units */
  async listUploadIds(auth: YtAuth, uploadsPlaylistId: string, pageToken?: string): Promise<Paginated<{ videoId: string; publishedAt: string | null }>> {
    const j = await this.client.call<J>('playlistItems', { auth, params: { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: 50, pageToken }, quotaMethod: 'playlistItems.list' });
    return { items: (j.items ?? []).map((i: J) => ({ videoId: String(i.contentDetails?.videoId), publishedAt: str(i.contentDetails?.videoPublishedAt) })), nextPageToken: j.nextPageToken ?? null, totalResults: int(j.pageInfo?.totalResults) };
  }
  /** videos.list สูงสุด 50 id ต่อครั้ง */
  async getVideos(auth: YtAuth, ids: string[]): Promise<YtVideoDto[]> {
    const out: YtVideoDto[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const j = await this.client.call<J>('videos', { auth, params: { part: 'snippet,contentDetails,statistics,status', id: ids.slice(i, i + 50).join(','), maxResults: 50 }, quotaMethod: 'videos.list' });
      out.push(...(j.items ?? []).map(mapVideo));
    }
    return out;
  }
  async updateVideo(auth: YtAuth, videoId: string, current: YtVideoDto, input: UpdateVideoInput): Promise<YtVideoDto> {
    // Data API แทนที่ snippet ทั้งก้อน — ต้องส่งค่าเดิมกลับไปด้วย
    const snippet: J = { title: input.title ?? current.title, description: input.description ?? current.description, tags: input.tags ?? current.tags, categoryId: input.categoryId ?? current.categoryId ?? '22', ...(input.defaultLanguage ?? current.defaultLanguage ? { defaultLanguage: input.defaultLanguage ?? current.defaultLanguage } : {}) };
    const status: J = { ...(input.madeForKids !== undefined ? { selfDeclaredMadeForKids: input.madeForKids } : {}), ...(input.publishAt !== undefined ? (input.publishAt ? { publishAt: input.publishAt } : {}) : current.scheduledPublishAt ? { publishAt: current.scheduledPublishAt } : {}) };
    status.privacyStatus = input.publishAt ? 'private' : (input.privacyStatus ?? current.privacyStatus ?? 'private');
    const j = await this.client.call<J>('videos', { auth, method: 'PUT', params: { part: 'snippet,status' }, body: { id: videoId, snippet, status }, quotaMethod: 'videos.update' });
    return mapVideo(j);
  }
  async deleteVideo(auth: YtAuth, videoId: string): Promise<void> { await this.client.call('videos', { auth, method: 'DELETE', params: { id: videoId }, quotaMethod: 'videos.delete' }); }

  /** อัปโหลดแบบ resumable ทั้งไฟล์ (สำหรับไฟล์เล็ก/ทดสอบ) — งานจริงใช้ upload.ts ที่เก็บ session state */
  buildUploadMetadata(input: UploadVideoInput): J {
    return { snippet: { title: input.title.slice(0, 100), description: (input.description ?? '').slice(0, 5000), tags: input.tags ?? [], categoryId: input.categoryId ?? '22', ...(input.defaultLanguage && { defaultLanguage: input.defaultLanguage }) }, status: { privacyStatus: input.publishAt ? 'private' : input.privacyStatus, selfDeclaredMadeForKids: input.selfDeclaredMadeForKids ?? input.madeForKids, ...(input.publishAt && { publishAt: input.publishAt }), ...(input.containsSyntheticMedia !== undefined && { containsSyntheticMedia: input.containsSyntheticMedia }) } };
  }

  async listPlaylists(auth: YtAuth, channelId: string | 'mine'): Promise<YtPlaylistDto[]> {
    const out: YtPlaylistDto[] = []; let pageToken: string | undefined;
    do {
      const j = await this.client.call<J>('playlists', { auth, params: { part: 'snippet,contentDetails,status', ...(channelId === 'mine' ? { mine: true } : { channelId }), maxResults: 50, pageToken }, quotaMethod: 'playlists.list' });
      out.push(...(j.items ?? []).map((p: J) => ({ id: String(p.id), title: String(p.snippet?.title ?? ''), description: str(p.snippet?.description), privacyStatus: str(p.status?.privacyStatus), itemCount: int(p.contentDetails?.itemCount), raw: p })));
      pageToken = j.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }
  async listPlaylistVideoIds(auth: YtAuth, playlistId: string): Promise<string[]> {
    const ids: string[] = []; let pageToken: string | undefined;
    do { const p = await this.listUploadIds(auth, playlistId, pageToken); ids.push(...p.items.map(i => i.videoId)); pageToken = p.nextPageToken ?? undefined; } while (pageToken);
    return ids;
  }
  async createPlaylist(auth: YtAuth, input: { title: string; description?: string; privacyStatus?: 'private' | 'unlisted' | 'public' }): Promise<YtPlaylistDto> {
    const j = await this.client.call<J>('playlists', { auth, method: 'POST', params: { part: 'snippet,status' }, body: { snippet: { title: input.title, description: input.description ?? '' }, status: { privacyStatus: input.privacyStatus ?? 'public' } }, quotaMethod: 'playlists.insert' });
    return { id: String(j.id), title: String(j.snippet?.title ?? input.title), description: str(j.snippet?.description), privacyStatus: str(j.status?.privacyStatus), itemCount: 0, raw: j };
  }
  async addVideoToPlaylist(auth: YtAuth, playlistId: string, videoId: string): Promise<void> {
    await this.client.call('playlistItems', { auth, method: 'POST', params: { part: 'snippet' }, body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } }, quotaMethod: 'playlistItems.insert' });
  }

  /** commentThreads (§48) — replies ที่ฝังมาอาจไม่ครบ ใช้ listReplies เมื่อ totalReplyCount > replies ที่ได้ */
  async listCommentThreads(auth: YtAuth, videoId: string, pageToken?: string): Promise<Paginated<YtCommentDto & { replies: YtCommentDto[] }>> {
    let j: J;
    try { j = await this.client.call<J>('commentThreads', { auth, params: { part: 'snippet,replies', videoId, maxResults: 100, order: 'time', textFormat: 'plainText', pageToken }, quotaMethod: 'commentThreads.list' }); }
    catch (e) { if (e instanceof YouTubeApiError && e.code === 'forbidden' && /disabled/i.test(e.message)) throw new YouTubeApiError(e.message, 'commentsDisabled', e.httpStatus, e.raw); throw e; }
    const items = (j.items ?? []).map((t: J) => { const top = mapComment(t.snippet?.topLevelComment ?? {}, videoId); top.totalReplyCount = int(t.snippet?.totalReplyCount) ?? 0; return { ...top, replies: (t.replies?.comments ?? []).map((r: J) => mapComment(r, videoId)) }; });
    return { items, nextPageToken: j.nextPageToken ?? null, totalResults: int(j.pageInfo?.totalResults) };
  }
  async listReplies(auth: YtAuth, parentId: string): Promise<YtCommentDto[]> {
    const out: YtCommentDto[] = []; let pageToken: string | undefined;
    do { const j = await this.client.call<J>('comments', { auth, params: { part: 'snippet', parentId, maxResults: 100, textFormat: 'plainText', pageToken }, quotaMethod: 'comments.list' }); out.push(...(j.items ?? []).map((c: J) => mapComment(c, null))); pageToken = j.nextPageToken ?? undefined; } while (pageToken);
    return out;
  }
  async replyToComment(auth: YtAuth, parentId: string, text: string): Promise<YtCommentDto> {
    const j = await this.client.call<J>('comments', { auth, method: 'POST', params: { part: 'snippet' }, body: { snippet: { parentId, textOriginal: text } }, quotaMethod: 'comments.insert' });
    return mapComment(j, null);
  }
}
