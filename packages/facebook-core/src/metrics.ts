/**
 * Metric adapter (AGENTS.md §60) — แปลง payload ของ Graph เป็นรูปแบบกลาง
 * กฎเหล็กจาก ADR-001: ค่าที่อ่านไม่ได้ต้องเป็น null ห้ามแปลงเป็น 0 เพราะทำให้รายงานหลอกตา
 */
import type { NormalizedMetric } from '@fbpm/shared';

export interface RawPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  shares?: { count?: number };
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  attachments?: { data?: { media_type?: string; type?: string }[] };
  full_picture?: string;
}

/** ฟิลด์ไหน "ถูกขอไปจริง" ในรอบนี้ — ถ้าไม่ได้ขอ (เพราะสิทธิ์ไม่พอ) ค่าต้องเป็น null */
export interface MetricAvailability { likes: boolean; comments: boolean; shares: boolean }

export function normalizePostMetrics(post: RawPost, avail: MetricAvailability, capturedAt = new Date()): NormalizedMetric[] {
  const at = capturedAt.toISOString();
  return [
    { metric: 'shares', sourceMetric: 'shares.count', value: avail.shares ? (post.shares?.count ?? 0) : null, capturedAt: at },
    { metric: 'reactions', sourceMetric: 'likes.summary.total_count', value: avail.likes ? (post.likes?.summary?.total_count ?? 0) : null, capturedAt: at },
    { metric: 'comments', sourceMetric: 'comments.summary.total_count', value: avail.comments ? (post.comments?.summary?.total_count ?? 0) : null, capturedAt: at },
  ];
}

/** รูปแบบที่เก็บใน PostMetricSnapshot.metrics (JSON) — key = metric */
export type MetricSnapshot = Record<string, { value: number | null; sourceMetric: string; period?: string }>;
export const toSnapshot = (m: NormalizedMetric[]): MetricSnapshot =>
  Object.fromEntries(m.map(x => [x.metric, { value: x.value, sourceMetric: x.sourceMetric, ...(x.period && { period: x.period }) }]));

export function mediaTypeOf(post: RawPost): string {
  const a = post.attachments?.data?.[0];
  if (a?.media_type) return a.media_type;            // photo | video | album | link …
  if (a?.type) return a.type.replace(/_.*$/, '');
  return post.full_picture ? 'photo' : 'status';
}

/** คะแนนความสมบูรณ์ของข้อมูลเพจ — พอร์ตจาก CLI audit */
export const PAGE_CHECKS = [
  ['username', 'ชื่อผู้ใช้ @username', 'ตั้งได้ที่การตั้งค่าเพจเท่านั้น'],
  ['category', 'หมวดหมู่ธุรกิจ', 'เปลี่ยนที่การตั้งค่าเพจ'],
  ['about', 'About (ข้อความสั้นใต้ชื่อเพจ)', null],
  ['description', 'รายละเอียดเพจ', null],
  ['phone', 'เบอร์โทร', null],
  ['website', 'เว็บไซต์', null],
  ['emails', 'อีเมลติดต่อ', null],
  ['single_line_address', 'ที่อยู่', null],
  ['hours', 'เวลาทำการ', null],
  ['cover', 'รูปปก', 'อัปโหลดในหน้าเพจ'],
  ['picture', 'รูปโปรไฟล์', 'อัปโหลดในหน้าเพจ'],
] as const;

export function isMissing(key: string, v: unknown): boolean {
  if (key === 'picture') { const p = v as { data?: { url?: string; is_silhouette?: boolean } } | undefined; return !p?.data?.url || p.data.is_silhouette === true; }
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

export function pageCompleteness(info: Record<string, unknown>): { score: number; missing: { key: string; label: string; hint: string | null }[] } {
  const missing = PAGE_CHECKS.filter(([k]) => isMissing(k, info[k])).map(([key, label, hint]) => ({ key, label, hint }));
  return { score: Math.round(((PAGE_CHECKS.length - missing.length) / PAGE_CHECKS.length) * 100), missing };
}
