/**
 * รอบบิล + โควต้าโพสต์ต่อเดือนของแพ็กเกจลูกค้า (docs/PLANS_QUOTA.md) — ฟังก์ชันบริสุทธิ์ ใช้ทั้ง API และหน้าเว็บ
 * รอบ = วันตัดรอบ (billingDay 1–28) เวลา 00:00 ตามเขตเวลาของเพจ ถึงก่อนวันเดียวกันของเดือนถัดไป
 */

export interface BillingCycle { start: Date; end: Date; /** วันแรก/วันสุดท้ายของรอบตามเวลาท้องถิ่น YYYY-MM-DD (ไว้แสดงผล ไม่ขึ้นกับเขตเวลาของเบราว์เซอร์) */ startDate: string; lastDate: string; daysTotal: number; daysLeft: number; /** สัดส่วนเวลาที่ผ่านไปของรอบ 0–1 */ elapsed: number }
export type QuotaPace = 'NO_PLAN' | 'UNLIMITED' | 'BEHIND' | 'ON_TRACK' | 'FULL' | 'OVER';
export interface QuotaStatus { limit: number | null; used: number; planned: number; remaining: number | null; expectedByNow: number | null; pace: QuotaPace }

const clampDay = (d: number) => Math.min(28, Math.max(1, Math.trunc(d) || 1));

function localParts(at: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const g = (k: string) => Number(parts.find(p => p.type === k)?.value);
  return { y: g('year'), m: g('month'), d: g('day') };
}
/** 00:00 ของวันที่ (y, m, d) ในเขตเวลานั้น → UTC (m นับ 1–12, ล้นเดือนได้) */
export function zonedMidnight(y: number, m: number, d: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const g = (k: string) => Number(parts.find(p => p.type === k)?.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms;
  };
  let utc = guess - offsetAt(guess); utc = guess - offsetAt(utc);
  return new Date(utc);
}

export function billingCycle(now: Date, billingDay: number, timeZone = 'Asia/Bangkok'): BillingCycle {
  const day = clampDay(billingDay);
  let tz = timeZone; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'Asia/Bangkok'; }
  const l = localParts(now, tz);
  const [y, m] = l.d >= day ? [l.y, l.m] : l.m === 1 ? [l.y - 1, 12] : [l.y, l.m - 1];
  const start = zonedMidnight(y, m, day, tz);
  const end = m === 12 ? zonedMidnight(y + 1, 1, day, tz) : zonedMidnight(y, m + 1, day, tz);
  const total = end.getTime() - start.getTime();
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const last = localParts(new Date(end.getTime() - 1), tz);
  return { start, end, startDate: iso(y, m, day), lastDate: iso(last.y, last.m, last.d), daysTotal: Math.round(total / 86_400_000), daysLeft: Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000)), elapsed: Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / total)) };
}

/**
 * used = โพสต์ขึ้นแล้วในรอบ · scheduled = ตั้งเวลาไว้ภายในรอบ · planned = used + scheduled
 * BEHIND = งานที่ลงไว้ (planned) น้อยกว่าที่ควรมีตามเวลาที่ผ่านไป · FULL = ครบพอดี · OVER = เกินโควต้า
 */
export function quotaStatus(o: { hasPlan: boolean; limit: number | null | undefined; used: number; scheduled: number; elapsed: number }): QuotaStatus {
  const planned = o.used + o.scheduled; const limit = o.limit ?? null;
  if (!o.hasPlan) return { limit: null, used: o.used, planned, remaining: null, expectedByNow: null, pace: 'NO_PLAN' };
  if (limit === null) return { limit, used: o.used, planned, remaining: null, expectedByNow: null, pace: 'UNLIMITED' };
  const expectedByNow = Math.floor(limit * o.elapsed);
  const pace: QuotaPace = planned > limit ? 'OVER' : planned === limit ? 'FULL' : planned < expectedByNow ? 'BEHIND' : 'ON_TRACK';
  return { limit, used: o.used, planned, remaining: limit - planned, expectedByNow, pace };
}

/** บริการที่เลือกใส่ในแพ็กเกจได้ (แสดงผลเท่านั้น — ไม่ได้เปิด/ปิดฟีเจอร์ในระบบ) */
export const PLAN_FEATURES = ['posts', 'reels', 'design', 'comments', 'messenger', 'leads', 'report', 'portal', 'line', 'ads', 'youtube', 'tiktok', 'web'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];
