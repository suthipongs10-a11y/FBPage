import { describe, expect, it } from 'vitest';
import { billingCycle, quotaStatus } from './quota';

describe('billing cycle', () => {
  it('uses the billing day at local midnight (Bangkok = UTC+7)', () => {
    const c = billingCycle(new Date('2026-10-20T05:00:00Z'), 15, 'Asia/Bangkok');
    expect(c.start.toISOString()).toBe('2026-10-14T17:00:00.000Z');   // 15 ต.ค. 00:00 น.
    expect(c.end.toISOString()).toBe('2026-11-14T17:00:00.000Z');
    expect(c.daysTotal).toBe(31); expect(c.startDate).toBe('2026-10-15'); expect(c.lastDate).toBe('2026-11-14');
  });
  it('rolls back to the previous month before the billing day, across the new year', () => {
    const c = billingCycle(new Date('2027-01-03T12:00:00Z'), 10, 'Asia/Bangkok');
    expect(c.start.toISOString()).toBe('2026-12-09T17:00:00.000Z'); expect(c.end.toISOString()).toBe('2027-01-09T17:00:00.000Z');
  });
  it('the local date decides: 1 Nov 01:00 in Bangkok is still 31 Oct in UTC', () => {
    const c = billingCycle(new Date('2026-10-31T18:00:00Z'), 1, 'Asia/Bangkok');
    expect(c.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(c.elapsed).toBeGreaterThan(0); expect(c.elapsed).toBeLessThan(0.01);
  });
  it('clamps the billing day to 1–28 and falls back on a bad time zone', () => {
    const c = billingCycle(new Date('2026-02-28T10:00:00Z'), 31, 'Nope/Zone');
    expect(c.start.toISOString()).toBe('2026-02-27T17:00:00.000Z');
    expect(c.daysLeft).toBe(28);
  });
});

describe('quota status', () => {
  const s = (used: number, scheduled: number, elapsed: number, limit: number | null = 12, hasPlan = true) => quotaStatus({ hasPlan, limit, used, scheduled, elapsed });
  it('no plan / unlimited', () => { expect(s(3, 0, 0.5, 12, false).pace).toBe('NO_PLAN'); expect(s(30, 0, 0.5, null).pace).toBe('UNLIMITED'); });
  it('behind when fewer posts are lined up than the time elapsed calls for', () => {
    expect(s(2, 1, 0.5)).toMatchObject({ pace: 'BEHIND', expectedByNow: 6, remaining: 9, planned: 3 });
    expect(s(2, 4, 0.5).pace).toBe('ON_TRACK');
    expect(s(0, 0, 0.02).pace).toBe('ON_TRACK');
  });
  it('scheduled posts count toward full / over', () => { expect(s(8, 4, 0.4).pace).toBe('FULL'); expect(s(10, 3, 0.4)).toMatchObject({ pace: 'OVER', remaining: -1 }); });
});
