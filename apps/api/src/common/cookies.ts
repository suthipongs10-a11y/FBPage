/** cookie helpers — Express 5 ไม่ parse cookie ให้ และเราไม่ต้องการ dependency เพิ่ม */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } }
  }
  return out;
}

export interface CookieOptions { maxAgeSec?: number; secure?: boolean; path?: string; sameSite?: 'Lax' | 'Strict' | 'None' }

export function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`, 'HttpOnly', `SameSite=${o.sameSite ?? 'Lax'}`];
  if (o.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAgeSec))}`);
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}
