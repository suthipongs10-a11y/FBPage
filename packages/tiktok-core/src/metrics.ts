export interface Metrics { views: number | null; likes: number | null; comments: number | null; shares: number | null }
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y); const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}
export function analyzeMetrics<T extends Metrics & { id: string }>(rows: T[]) {
  const known = rows.flatMap(r => r.views === null ? [] : [r.views]);
  const baseline = median(known);
  return { sampleSize: rows.length, measuredSampleSize: known.length, medianViews: baseline, basis: 'Recent imported public videos; lifetime counts, mixed ages; descriptive comparison only.', videos: rows.map(r => {
    const relativeViews = r.views !== null && baseline !== null && baseline > 0 ? r.views / baseline : null;
    return { ...r, relativeViews, highPerforming: known.length >= 5 && relativeViews !== null && relativeViews >= 2,
      engagementRate: r.views && r.likes !== null && r.comments !== null && r.shares !== null ? (r.likes + r.comments + r.shares) / r.views : null,
      shareRate: r.views && r.shares !== null ? r.shares / r.views : null, commentRate: r.views && r.comments !== null ? r.comments / r.views : null };
  }) };
}
export function validateMediaUrl(value: string, prefixes: string[]) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.search || !u.pathname.toLowerCase().endsWith('.mp4')) throw new Error('Use a public HTTPS MP4 URL without credentials, query or fragment');
  const allowed = prefixes.some(p => {
    try { const base = new URL(p); return base.protocol === 'https:' && !base.search && !base.hash && !base.username && !base.password && u.origin === base.origin && (u.pathname === base.pathname || u.pathname.startsWith(base.pathname.endsWith('/') ? base.pathname : base.pathname + '/')); } catch { return false; }
  });
  if (!allowed || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) throw new Error('Media URL must match a configured TikTok-verified public prefix');
  return u.href;
}
