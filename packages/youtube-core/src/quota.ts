/** ต้นทุน quota โดยประมาณต่อ method (§21–22) — ตรวจกับเอกสาร Google เมื่อเปลี่ยนเวอร์ชัน (docs/youtube/API_CHANGELOG.md) */
export const QUOTA_COSTS: Record<string, number> = {
  'channels.list': 1, 'playlistItems.list': 1, 'videos.list': 1, 'videos.insert': 1600, 'videos.update': 50, 'videos.delete': 50, 'thumbnails.set': 50,
  'commentThreads.list': 1, 'comments.list': 1, 'comments.insert': 50, 'comments.setModerationStatus': 50,
  'playlists.list': 1, 'playlists.insert': 50, 'playlistItems.insert': 50, 'search.list': 100, 'captions.list': 50,
};
export const DAILY_QUOTA_DEFAULT = 10_000;
export const quotaCost = (method: string): number => QUOTA_COSTS[method] ?? 1;
/** >80% เตือน, >95% พักงานที่ไม่จำเป็น (§93) */
export function quotaState(usedUnits: number, dailyLimit = DAILY_QUOTA_DEFAULT): { pct: number; level: 'OK' | 'WARN' | 'CRITICAL'; remaining: number } {
  const pct = dailyLimit > 0 ? Math.round((usedUnits / dailyLimit) * 100) : 0;
  return { pct, level: pct >= 95 ? 'CRITICAL' : pct >= 80 ? 'WARN' : 'OK', remaining: Math.max(0, dailyLimit - usedUnits) };
}
/** Data API quota รีเซ็ตเที่ยงคืน Pacific Time — คืนเวลาเริ่มวันโควตาปัจจุบัน (UTC) */
export function quotaDayStart(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const g = (k: string) => Number(parts.find(p => p.type === k)?.value);
  const laAsUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  const offset = laAsUtc - now.getTime();   // LA local - UTC
  return new Date(Date.UTC(g('year'), g('month') - 1, g('day')) - offset);
}
