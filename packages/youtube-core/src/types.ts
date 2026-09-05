/** รูปแบบกลางของโมดูล YouTube (AGENTS_YOUTUBE.md §15, §18, §19, §139) */
export type YtErrorCode = 'quotaExceeded' | 'rateLimit' | 'invalidGrant' | 'insufficientPermissions' | 'forbidden' | 'notFound' | 'commentsDisabled' | 'invalidRequest' | 'network' | 'uploadNotEnabled' | 'unknown';

export class YouTubeApiError extends Error {
  constructor(message: string, public readonly code: YtErrorCode, public readonly httpStatus: number, public readonly raw?: unknown) { super(message); this.name = 'YouTubeApiError'; }
  get isRetryable(): boolean { return this.code === 'rateLimit' || this.code === 'network' || (this.httpStatus >= 500 && this.httpStatus < 600); }
  /** ห้าม retry วน (§140) */
  get isPermanent(): boolean { return ['invalidGrant', 'insufficientPermissions', 'forbidden', 'invalidRequest', 'commentsDisabled', 'quotaExceeded'].includes(this.code); }
  get needsReconnect(): boolean { return this.code === 'invalidGrant' || this.code === 'insufficientPermissions'; }
  /** ข้อความสำหรับผู้ใช้ (§139) — raw เก็บไว้ debug */
  get userMessage(): string {
    switch (this.code) {
      case 'quotaExceeded': return 'โควตา YouTube API วันนี้หมดแล้ว — งานซิงก์ที่ไม่จำเป็นถูกพักจนกว่าโควตาจะรีเซ็ต (เที่ยงคืนเวลา Pacific)';
      case 'rateLimit': return 'YouTube จำกัดจำนวนคำขอชั่วคราว ระบบจะลองใหม่ให้';
      case 'invalidGrant': return 'การอนุญาต Google ใช้ไม่ได้แล้ว — กด "เชื่อมต่อ YouTube ใหม่"';
      case 'insufficientPermissions': return 'สิทธิ์ที่อนุญาตไม่พอสำหรับการกระทำนี้ — เชื่อมต่อใหม่พร้อมสิทธิ์เพิ่ม';
      case 'forbidden': return 'YouTube ปฏิเสธคำขอนี้ (forbidden)';
      case 'notFound': return 'ไม่พบทรัพยากรบน YouTube (อาจถูกลบหรือเป็นส่วนตัว)';
      case 'commentsDisabled': return 'วิดีโอนี้ปิดคอมเมนต์';
      case 'uploadNotEnabled': return 'การอัปโหลดยังไม่เปิดใช้ (YOUTUBE_UPLOAD_ENABLED=false หรือแอป Google ยังไม่ผ่านการตรวจสอบ)';
      case 'network': return 'ติดต่อ Google ไม่ได้ — ตรวจเครือข่าย';
      default: return this.message || 'Google/YouTube ตอบกลับผิดพลาด';
    }
  }
}

export type YtAuth = { kind: 'oauth'; accessToken: string } | { kind: 'apiKey'; apiKey: string };
export interface DateRange { start: string; end: string }   // YYYY-MM-DD

export interface YtChannelDto { id: string; title: string; customUrl: string | null; description: string | null; country: string | null; defaultLanguage: string | null; thumbnailUrl: string | null; publishedAt: string | null; uploadsPlaylistId: string | null; subscriberCount: number | null; videoCount: number | null; viewCount: number | null; raw: Record<string, unknown> }
export interface YtVideoDto {
  id: string; title: string; description: string; publishedAt: string | null; scheduledPublishAt: string | null; privacyStatus: string | null; uploadStatus: string | null; durationSeconds: number | null;
  categoryId: string | null; defaultLanguage: string | null; defaultAudioLanguage: string | null; tags: string[]; thumbnailUrl: string | null; madeForKids: boolean | null; liveBroadcastContent: string | null;
  viewCount: number | null; likeCount: number | null; commentCount: number | null; commentsDisabled: boolean; raw: Record<string, unknown>;
}
export interface YtCommentDto { id: string; videoId: string | null; parentId: string | null; authorChannelId: string | null; authorDisplayName: string | null; text: string; likeCount: number; publishedAt: string; updatedAt: string | null; totalReplyCount: number; raw: Record<string, unknown> }
export interface YtPlaylistDto { id: string; title: string; description: string | null; privacyStatus: string | null; itemCount: number | null; raw: Record<string, unknown> }
export interface Paginated<T> { items: T[]; nextPageToken: string | null; totalResults: number | null }
export interface UpdateVideoInput { title?: string; description?: string; tags?: string[]; categoryId?: string; privacyStatus?: 'private' | 'unlisted' | 'public'; publishAt?: string | null; madeForKids?: boolean; defaultLanguage?: string }
export interface UploadVideoInput { title: string; description?: string; tags?: string[]; categoryId?: string; privacyStatus: 'private' | 'unlisted' | 'public'; publishAt?: string; madeForKids: boolean; selfDeclaredMadeForKids?: boolean; containsSyntheticMedia?: boolean; defaultLanguage?: string; notifySubscribers?: boolean }

export type MetricUnit = 'COUNT' | 'SECONDS' | 'MINUTES' | 'PERCENT' | 'CURRENCY' | 'RATIO';
export type MetricSource = 'DATA_API' | 'ANALYTICS_API' | 'REPORTING_API';
export interface NormalizedYouTubeMetric { key: string; value: number | null; unit: MetricUnit; sourceMetric: string; source: MetricSource; capturedAt: string; currency?: string }
/** รูปแบบที่เก็บใน metricsJson — key → { value, unit, sourceMetric, source } */
export type YtMetricSnapshot = Record<string, { value: number | null; unit: MetricUnit; sourceMetric: string; source: MetricSource; currency?: string }>;
export const YT_METRIC_SET_VERSION = 'yt-metrics-v1';
export interface QuotaRecorder { record(input: { api: 'data' | 'analytics' | 'upload' | 'oauth'; method: string; units: number; success: boolean }): Promise<void> | void }
