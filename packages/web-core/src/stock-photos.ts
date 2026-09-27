/**
 * ภาพถ่ายจริงจากคลังภาพฟรี (Pexels) — ใช้ประกอบการ์ดข่าวแทนการเอารูปของสำนักข่าว (ซึ่งห้ามใช้)
 * สัญญาอนุญาตของ Pexels ใช้เชิงพาณิชย์และดัดแปลงได้ ไม่บังคับให้เครดิต แต่ระบบใส่เครดิตช่างภาพให้เสมอ
 * ภาพเป็นภาพ "บรรยากาศเรื่อง" ไม่ใช่ภาพเหตุการณ์จริง — ห้ามอ้างว่าเป็นภาพจากเหตุการณ์
 */
import { politeFetchBytes } from './news';
import { USER_AGENT } from './checks';
import { WebError } from './types';

export interface StockPhoto { id: string; pageUrl: string; imageUrl: string; width: number; height: number; photographer: string; photographerUrl: string | null; alt: string | null; provider: 'pexels' }
export interface PexelsOptions { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number; perPage?: number; orientation?: 'landscape' | 'square' | 'portrait' }

export async function pexelsSearch(apiKey: string, query: string, o: PexelsOptions = {}): Promise<StockPhoto[]> {
  const f = o.fetchImpl ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 15_000);
  try {
    const u = new URL(`${(o.baseUrl ?? 'https://api.pexels.com').replace(/\/+$/, '')}/v1/search`);
    u.searchParams.set('query', query.slice(0, 100)); u.searchParams.set('per_page', String(Math.min(15, Math.max(1, o.perPage ?? 8)))); u.searchParams.set('orientation', o.orientation ?? 'landscape');
    let res: Response;
    try { res = await f(u, { headers: { authorization: apiKey, 'user-agent': USER_AGENT }, signal: ctl.signal }); }
    catch (e) { throw new WebError((e as Error).name === 'AbortError' ? 'Pexels ตอบช้าเกินไป' : `เชื่อมต่อ Pexels ไม่ได้: ${(e as Error).message}`, 'network'); }
    if (res.status === 401 || res.status === 403) throw new WebError('API key ของ Pexels ไม่ถูกต้อง', 'forbidden', res.status);
    if (res.status === 429) throw new WebError('โควตา Pexels เต็ม (จำกัดต่อชั่วโมง/เดือน)', 'quota', res.status);
    if (!res.ok) throw new WebError(`Pexels ตอบ HTTP ${res.status}`, 'unknown', res.status);
    const body = await res.json() as { photos?: { id: number; url?: string; width?: number; height?: number; photographer?: string; photographer_url?: string; alt?: string; src?: { large2x?: string; large?: string } }[] };
    return (body.photos ?? []).flatMap(p => {
      const img = p.src?.large2x ?? p.src?.large;
      if (!img || !/^https?:\/\//.test(img)) return [];
      return [{ id: String(p.id), pageUrl: p.url ?? '', imageUrl: img, width: p.width ?? 0, height: p.height ?? 0, photographer: p.photographer?.slice(0, 80) || 'Pexels', photographerUrl: p.photographer_url ?? null, alt: p.alt?.slice(0, 200) ?? null, provider: 'pexels' as const }];
    });
  } finally { clearTimeout(timer); }
}

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export function sniffImage(buf: Buffer): ImageMime | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** ดาวน์โหลดภาพ (กัน SSRF ทุก redirect, เพดาน 12 MB) แล้วตรวจว่าเป็นภาพจริงจากไบต์ ไม่เชื่อ content-type */
export async function downloadImage(url: string, o: { allowPrivate?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {}): Promise<{ bytes: Buffer; mimeType: ImageMime }> {
  const r = await politeFetchBytes(url, { ...o, maxBytes: o.maxBytes ?? 12_000_000, timeoutMs: o.timeoutMs ?? 20_000, accept: 'image/jpeg, image/png, image/webp' });
  const mimeType = sniffImage(r.bytes);
  if (!mimeType) throw new WebError('ไฟล์ที่ได้ไม่ใช่ภาพ png/jpeg/webp', 'invalid');
  return { bytes: r.bytes, mimeType };
}
