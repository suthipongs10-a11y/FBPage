/** ชนิดข้อมูลแพ็กเกจ/โควต้า/ภาพรวมทุกเพจ (API: apps/api/src/plans) */
import type { QuotaPace } from '@fbpm/shared';

export interface ServicePlan { id: string; name: string; description: string | null; priceMonthly?: number | null; postsPerMonth: number | null; reelsPerMonth: number | null; features: string[]; active: boolean; sortOrder: number; pages: number }
export interface QuotaView { limit: number | null; used: number; planned: number; remaining: number | null; expectedByNow: number | null; pace: QuotaPace }
export interface CycleView { start: string; end: string; startDate: string; lastDate: string; daysTotal: number; daysLeft: number; elapsed: number }
export interface PortfolioRow {
  page: { id: string; name: string; pictureUrl: string | null; fanCount: number | null; tokenStatus: string; publishingPaused: boolean };
  brand: { id: string; name: string }; client: { id: string; name: string };
  plan: { id: string; name: string; postsPerMonth: number | null; reelsPerMonth: number | null; features: string[]; priceMonthly?: number | null } | null;
  billingDay: number; planStartedAt: string | null; cycle: CycleView; quota: QuotaView; scheduled: number;
  reels: { limit: number | null; planned: number; remaining: number | null }; pagePosts: number;
  activity: { lastPostAt: string | null; daysSinceLastPost: number | null; nextScheduledAt: string | null; pendingApproval: number; approvedUnscheduled: number; failed: number; commentsPending: number; chatsNeedAttention: number; newLeads: number };
  attention: string[];
}
export interface Portfolio {
  generatedAt: string; showMoney: boolean; rows: PortfolioRow[];
  summary: { pages: number; withPlan: number; monthlyRevenue: number | null; postsUsed: number; postsPlanned: number; quotaTotal: number; quotaPlannedOfLimited: number; behind: number; full: number; over: number; needsAttention: number; pendingApproval: number; commentsPending: number; newLeads: number; byPlan: { id: string; name: string; pages: number; revenue: number | null }[] };
}
export const baht = (n: number) => `฿${n.toLocaleString('th-TH')}`;
export const shortDate = (s: string | Date) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
/** วันที่ท้องถิ่นของเพจ (YYYY-MM-DD) → ข้อความ ไม่เลื่อนตามเขตเวลาของเบราว์เซอร์ */
const localDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const cycleLabel = (c: Pick<CycleView, 'startDate' | 'lastDate'>) => `${localDay(c.startDate)} – ${localDay(c.lastDate)}`;
