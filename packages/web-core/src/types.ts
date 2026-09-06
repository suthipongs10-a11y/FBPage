/** ชนิดข้อมูลกลางของ Website Care (AGENTS_WEB.md §3, §5) — ค่าที่อ่านไม่ได้เป็น null เสมอ */
export type SiteStatus = 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
export type CheckStatus = 'OK' | 'WARN' | 'FAIL' | 'SKIPPED';
export type CheckKind = 'UPTIME' | 'SSL' | 'SEO' | 'LINKS' | 'PAGESPEED';

export interface UptimeResult { status: CheckStatus; siteStatus: SiteStatus; httpStatus: number | null; latencyMs: number | null; finalUrl: string | null; redirected: boolean; textFound: boolean | null; error: string | null; html: string | null }
export interface SslResult { status: CheckStatus; validTo: string | null; validFrom: string | null; daysLeft: number | null; issuer: string | null; subject: string | null; error: string | null }
export interface SeoIssue { code: string; severity: 'high' | 'medium' | 'low'; message: string; detail?: string }
export interface SeoResult { status: CheckStatus; title: string | null; titleLength: number; description: string | null; descriptionLength: number; h1Count: number; canonical: string | null; robotsMeta: string | null; lang: string | null; viewport: boolean; ogTitle: boolean; ogImage: boolean; imagesTotal: number; imagesMissingAlt: number; wordCount: number; internalLinks: number; externalLinks: number; issues: SeoIssue[] }
export interface LinkCheck { url: string; status: number | null; ok: boolean; error: string | null }
export interface LinksResult { status: CheckStatus; checked: number; broken: LinkCheck[]; skipped: number; error: string | null }
export interface PageSpeedResult { status: CheckStatus; strategy: 'mobile' | 'desktop'; performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null; lcpMs: number | null; cls: number | null; inpMs: number | null; fcpMs: number | null; ttfbMs: number | null; fieldData: boolean; error: string | null }

export interface SearchRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }
export interface SearchDay { date: string; clicks: number | null; impressions: number | null; ctr: number | null; position: number | null; topQueries: SearchRow[]; topPages: SearchRow[] }

export class WebError extends Error {
  constructor(message: string, public readonly code: 'blocked' | 'network' | 'forbidden' | 'notFound' | 'quota' | 'invalid' | 'reconnect' | 'unknown', public readonly httpStatus = 0) { super(message); this.name = 'WebError'; }
}
