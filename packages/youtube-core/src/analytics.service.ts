/** YouTubeAnalyticsService (§19) — Analytics API v2 ต้อง OAuth (yt-analytics.readonly); metric ที่ไม่มี = null */
import { YouTubeClient } from './client';
import { fromAnalyticsRow } from './metrics';
import { YouTubeApiError, type DateRange, type NormalizedYouTubeMetric, type YtAuth } from './types';

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const CHANNEL_METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained', 'subscribersLost'];
export const VIDEO_METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained', 'subscribersLost'];
export const REVENUE_METRICS = ['estimatedRevenue', 'monetizedPlaybacks', 'playbackBasedCpm'];

export class YouTubeAnalyticsService {
  constructor(readonly client: YouTubeClient) {}
  private q(auth: YtAuth, params: Record<string, string | undefined>): Promise<J> {
    if (auth.kind !== 'oauth') throw new YouTubeApiError('Analytics ต้องใช้ OAuth ของเจ้าของช่อง', 'insufficientPermissions', 401);
    return this.client.call<J>('reports', { auth, api: 'analytics', params: { ids: 'channel==MINE', ...params }, quotaMethod: 'analytics.query' });
  }
  /** สรุปช่วง — ถ้าบางเมตริกไม่รองรับ (เช่น engagedViews) จะพยายามใหม่ด้วยชุดพื้นฐาน */
  async channelSummary(auth: YtAuth, range: DateRange, metrics = CHANNEL_METRICS, currency?: string): Promise<{ metrics: NormalizedYouTubeMetric[]; unavailable: string[] }> {
    try { const j = await this.q(auth, { startDate: range.start, endDate: range.end, metrics: metrics.join(','), currency }); return { metrics: fromAnalyticsRow(j.columnHeaders ?? [], j.rows?.[0], new Date(), currency), unavailable: [] }; }
    catch (e) {
      if (e instanceof YouTubeApiError && e.code === 'invalidRequest' && metrics.length > 3) { const base = metrics.slice(0, 3); const r = await this.channelSummary(auth, range, base, currency); return { ...r, unavailable: metrics.filter(m => !base.includes(m)) }; }
      throw e;
    }
  }
  /** metric ต่อวิดีโอ (filters=video==ID) */
  async videoAnalytics(auth: YtAuth, videoId: string, range: DateRange, metrics = VIDEO_METRICS): Promise<NormalizedYouTubeMetric[]> {
    const j = await this.q(auth, { startDate: range.start, endDate: range.end, metrics: metrics.join(','), filters: `video==${videoId}` });
    return fromAnalyticsRow(j.columnHeaders ?? [], j.rows?.[0]);
  }
  /** หลายวิดีโอในครั้งเดียว (dimensions=video, ≤ 500 id) */
  async videoComparison(auth: YtAuth, videoIds: string[], range: DateRange, metrics = VIDEO_METRICS): Promise<Record<string, NormalizedYouTubeMetric[]>> {
    const out: Record<string, NormalizedYouTubeMetric[]> = {};
    for (let i = 0; i < videoIds.length; i += 200) {
      const chunk = videoIds.slice(i, i + 200);
      const j = await this.q(auth, { startDate: range.start, endDate: range.end, metrics: metrics.join(','), dimensions: 'video', filters: `video==${chunk.join(',')}`, sort: '-views', maxResults: '200' });
      const headers: { name: string }[] = j.columnHeaders ?? []; const vi = headers.findIndex(h => h.name === 'video');
      for (const row of (j.rows ?? []) as unknown[][]) { const id = String(row[vi]); out[id] = fromAnalyticsRow(headers.filter((_, k) => k !== vi), row.filter((_, k) => k !== vi)); }
    }
    return out;
  }
  async trafficSources(auth: YtAuth, range: DateRange): Promise<{ source: string; views: number }[]> {
    const j = await this.q(auth, { startDate: range.start, endDate: range.end, metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views' });
    return ((j.rows ?? []) as [string, number][]).map(r => ({ source: r[0], views: Number(r[1]) }));
  }
  async revenue(auth: YtAuth, range: DateRange, currency = 'USD'): Promise<NormalizedYouTubeMetric[]> {
    const j = await this.q(auth, { startDate: range.start, endDate: range.end, metrics: REVENUE_METRICS.join(','), currency });
    return fromAnalyticsRow(j.columnHeaders ?? [], j.rows?.[0], new Date(), currency);
  }
}
