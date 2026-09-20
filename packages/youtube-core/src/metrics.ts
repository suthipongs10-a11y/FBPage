/** YouTubeMetricAdapter (§15–16, §43–45, §95–99) — ค่าที่ไม่มี = null, เก็บ source/unit/version, เปรียบเทียบเฉพาะหน้าต่างอายุเท่ากัน */
import type { NormalizedYouTubeMetric, YtMetricSnapshot, YtVideoDto } from './types';
export { YT_METRIC_SET_VERSION } from './types';

const num = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** สถิติสาธารณะจาก Data API (videos.list statistics) */
export function fromDataApiStats(video: Pick<YtVideoDto, 'viewCount' | 'likeCount' | 'commentCount'>, capturedAt = new Date()): NormalizedYouTubeMetric[] {
  const at = capturedAt.toISOString();
  return [
    { key: 'views', value: video.viewCount, unit: 'COUNT', sourceMetric: 'statistics.viewCount', source: 'DATA_API', capturedAt: at },
    { key: 'likes', value: video.likeCount, unit: 'COUNT', sourceMetric: 'statistics.likeCount', source: 'DATA_API', capturedAt: at },
    { key: 'comments', value: video.commentCount, unit: 'COUNT', sourceMetric: 'statistics.commentCount', source: 'DATA_API', capturedAt: at },
  ];
}

const ANALYTICS_UNITS: Record<string, { key: string; unit: NormalizedYouTubeMetric['unit'] }> = {
  views: { key: 'views', unit: 'COUNT' }, engagedViews: { key: 'engagedViews', unit: 'COUNT' }, estimatedMinutesWatched: { key: 'watchMinutes', unit: 'MINUTES' }, averageViewDuration: { key: 'averageViewDuration', unit: 'SECONDS' },
  averageViewPercentage: { key: 'averageViewPercentage', unit: 'PERCENT' }, likes: { key: 'likes', unit: 'COUNT' }, dislikes: { key: 'dislikes', unit: 'COUNT' }, comments: { key: 'comments', unit: 'COUNT' }, shares: { key: 'shares', unit: 'COUNT' },
  subscribersGained: { key: 'subscribersGained', unit: 'COUNT' }, subscribersLost: { key: 'subscribersLost', unit: 'COUNT' }, estimatedRevenue: { key: 'estimatedRevenue', unit: 'CURRENCY' },
  annotationImpressions: { key: 'thumbnailImpressions', unit: 'COUNT' }, cardImpressions: { key: 'cardImpressions', unit: 'COUNT' }, videosAddedToPlaylists: { key: 'addedToPlaylists', unit: 'COUNT' },
};
/** แถวจาก Analytics API (columnHeaders + row) → metric กลาง; header ที่ไม่รู้จักยังเก็บไว้ด้วยชื่อเดิม */
export function fromAnalyticsRow(headers: { name: string }[], row: unknown[] | undefined, capturedAt = new Date(), currency?: string): NormalizedYouTubeMetric[] {
  const at = capturedAt.toISOString();
  return headers.map((h, i) => { const m = ANALYTICS_UNITS[h.name] ?? { key: h.name, unit: 'COUNT' as const }; return { key: m.key, value: row ? num(row[i]) : null, unit: m.unit, sourceMetric: h.name, source: 'ANALYTICS_API' as const, capturedAt: at, ...(m.unit === 'CURRENCY' && currency && { currency }) }; });
}
export const toYtSnapshot = (ms: NormalizedYouTubeMetric[]): YtMetricSnapshot => Object.fromEntries(ms.map(m => [m.key, { value: m.value, unit: m.unit, sourceMetric: m.sourceMetric, source: m.source, ...(m.currency && { currency: m.currency }) }]));
export const metricValue = (s: YtMetricSnapshot | null | undefined, key: string): number | null => s?.[key]?.value ?? null;

/** subscribersGained / views (§43) — zero-safe */
export const subscriberConversion = (gained: number | null, views: number | null): number | null => (gained === null || views === null || views <= 0 ? null : gained / views);

/** ตัวจำแนกประเภทวิดีโอ (§12) — แทนที่ได้; เวอร์ชันนี้ใช้ความยาว + liveBroadcastContent เท่านั้น */
export const VIDEO_CLASSIFIER_VERSION = 'duration-v1';
export function classifyVideoType(v: { durationSeconds: number | null; liveBroadcastContent: string | null; raw?: Record<string, unknown> }): 'LONG_FORM' | 'SHORT' | 'LIVE' | 'PREMIERE' | 'UNKNOWN' {
  if (v.liveBroadcastContent === 'live' || v.liveBroadcastContent === 'upcoming') return 'LIVE';
  const live = (v.raw?.liveStreamingDetails as Record<string, unknown> | undefined);
  if (live?.actualEndTime) return 'LIVE';
  if (v.durationSeconds === null) return 'UNKNOWN';
  return v.durationSeconds <= 180 ? 'SHORT' : 'LONG_FORM';   // Shorts ปัจจุบันยาวได้ถึง 3 นาที — ตรวจเอกสารเมื่อเปลี่ยน
}
/** ISO 8601 duration (PT1H2M3S) → วินาที */
export function parseIsoDuration(s: string | null | undefined): number | null {
  if (!s) return null; const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s); if (!m) return null;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
}

/** หน้าต่างอายุ (§95) */
export type PerformanceWindow = 'FIRST_24H' | 'FIRST_72H' | 'FIRST_7D' | 'FIRST_28D' | 'LIFETIME';
export function ageWindow(publishedAt: Date, at = new Date()): PerformanceWindow {
  const h = (at.getTime() - publishedAt.getTime()) / 3_600_000;
  return h <= 24 ? 'FIRST_24H' : h <= 72 ? 'FIRST_72H' : h <= 24 * 7 ? 'FIRST_7D' : h <= 24 * 28 ? 'FIRST_28D' : 'LIFETIME';
}
export function median(xs: number[]): number | null { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; }
/** outlier แบบง่าย (§98): > 5× median และ ≥ 5 ตัวอย่าง */
export const isOutlier = (v: number, med: number | null, n: number): boolean => med !== null && n >= 5 && med > 0 && v > med * 5;

/** Packaging Diagnosis (§34) — ผลเป็นสมมติฐาน ไม่ใช่ข้อเท็จจริง */
export type PackagingDiagnosis = 'PACKAGING_OPPORTUNITY' | 'EXPECTATION_MISMATCH' | 'TOPIC_OR_QUALITY' | 'STRONG_FOLLOWUP' | 'INSUFFICIENT_DATA';
export function packagingDiagnosis(input: { ctr: number | null; ctrMedian: number | null; avgViewDuration: number | null; avdMedian: number | null; views: number | null; viewsMedian: number | null }): { diagnosis: PackagingDiagnosis; hypothesis: string; confidence: 'LOW' | 'MEDIUM' | 'HIGH' } {
  const retentionHigh = input.avgViewDuration !== null && input.avdMedian !== null && input.avdMedian > 0 ? input.avgViewDuration >= input.avdMedian : null;
  // ไม่มี CTR (ต้อง Analytics) → ใช้ views เทียบ median เป็นตัวแทน "การเข้าถึงต่ำ" ด้วยความมั่นใจต่ำ
  const ctrHigh = input.ctr !== null && input.ctrMedian !== null && input.ctrMedian > 0 ? input.ctr >= input.ctrMedian : (input.views !== null && input.viewsMedian !== null && input.viewsMedian > 0 ? input.views >= input.viewsMedian : null);
  const conf: 'LOW' | 'MEDIUM' | 'HIGH' = input.ctr !== null && input.avgViewDuration !== null ? 'MEDIUM' : 'LOW';
  if (retentionHigh === null || ctrHigh === null) return { diagnosis: 'INSUFFICIENT_DATA', hypothesis: 'ข้อมูล CTR/ระยะเวลาดูไม่พอสำหรับวินิจฉัย', confidence: 'LOW' };
  if (retentionHigh && !ctrHigh) return { diagnosis: 'PACKAGING_OPPORTUNITY', hypothesis: 'คนที่กดดูอยู่นานกว่าค่ากลาง แต่คนกดน้อย — หัวเรื่อง/ภาพปกน่าจะจำกัดผลงาน', confidence: conf };
  if (!retentionHigh && ctrHigh) return { diagnosis: 'EXPECTATION_MISMATCH', hypothesis: 'คนกดเยอะแต่ดูไม่นาน — เนื้อหาอาจไม่ตรงกับที่หัวเรื่อง/ภาพปกสัญญา', confidence: conf };
  if (!retentionHigh && !ctrHigh) return { diagnosis: 'TOPIC_OR_QUALITY', hypothesis: 'ทั้งการกดและการดูต่ำกว่าค่ากลาง — อาจเป็นหัวข้อ แพ็กเกจ หรือคุณภาพเนื้อหา', confidence: conf };
  return { diagnosis: 'STRONG_FOLLOWUP', hypothesis: 'ทั้งการกดและการดูสูงกว่าค่ากลาง — เหมาะทำตอนต่อ/ซีรีส์', confidence: conf };
}

/** Revival Score (§42) v1 — ภายใน ไม่ใช่ metric ทางการของ YouTube */
export const REVIVAL_SCORE_VERSION = 'revival-v1';
export function revivalScore(input: { avdRatio: number | null; subConvRatio: number | null; viewsRatio: number | null; ageDays: number; recentDeclineRatio: number | null; commentDemand: number }): { score: number; reasons: string[] } {
  let score = 0; const reasons: string[] = [];
  if (input.avdRatio !== null && input.avdRatio >= 1.1) { score += 30; reasons.push(`ระยะเวลาดูเฉลี่ยสูงกว่าค่ากลางช่อง ${Math.round((input.avdRatio - 1) * 100)}%`); }
  if (input.subConvRatio !== null && input.subConvRatio >= 1.3) { score += 25; reasons.push(`อัตราได้ผู้ติดตามต่อวิว ${input.subConvRatio.toFixed(1)}× ค่ากลาง`); }
  if (input.viewsRatio !== null && input.viewsRatio < 0.8) { score += 20; reasons.push('วิวต่ำกว่าค่ากลาง (การเข้าถึงหรือแพ็กเกจอ่อน)'); }
  if (input.ageDays >= 90) { score += 10; reasons.push('อายุเกิน 90 วัน เหมาะรีเฟรชหัวเรื่อง/ภาพปก'); }
  if (input.commentDemand >= 3) { score += 15; reasons.push(`มีคอมเมนต์ถาม/ขอเนื้อหาเกี่ยวข้อง ${input.commentDemand} รายการ`); }
  return { score: Math.min(100, score), reasons };
}
