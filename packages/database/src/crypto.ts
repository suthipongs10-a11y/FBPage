/**
 * เข้ารหัสความลับที่ต้องเก็บใน DB (page token, user token) — AES-256-GCM คีย์มาจาก AUTH_SECRET (AGENTS.md §13)
 * รูปแบบที่เก็บ: v1.<iv>.<tag>.<ciphertext> (base64url) — ค่าที่ถอดแล้วห้ามหลุดไป log หรือ response
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const keyOf = (secret: string): Buffer => createHash('sha256').update(secret, 'utf8').digest();

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

export function decryptSecret(encoded: string, secret: string): string {
  const [v, iv, tag, ct] = encoded.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('รูปแบบข้อมูลเข้ารหัสไม่ถูกต้อง');
  const d = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** state ของ OAuth: payload + HMAC เพื่อกัน CSRF (§13) */
export function signState(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState<T = Record<string, unknown>>(state: string | undefined, secret: string): T | null {
  if (!state) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; } catch { return null; }
}
