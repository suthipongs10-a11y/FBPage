/** แปลงเวลา local + timezone → UTC โดยไม่พึ่ง library (§47, §87) — ใช้ Intl ตรวจ offset ของโซนนั้น ณ เวลานั้น */
export function localToUtc(local: string, timeZone: string): Date {
  const [d, t] = local.split('T'); const [y, m, day] = d!.split('-').map(Number); const [hh, mm, ss = 0] = t!.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, day!, hh!, mm!, ss);
  const offsetAt = (ms: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const g = (k: string) => Number(parts.find(p => p.type === k)?.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);   // ปรับรอบสอง กรณีข้าม DST
  return new Date(utc);
}
export function isValidTimeZone(tz: string): boolean { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; } }
