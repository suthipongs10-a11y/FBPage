/**
 * Google Drive แบบอ่านอย่างเดียวด้วย service account — HTTP ล้วน (ไม่ใช้ googleapis SDK)
 * ผู้ใช้แชร์โฟลเดอร์ให้อีเมล service account เป็น "ผู้มีสิทธิ์อ่าน" → ระบบเห็นเฉพาะโฟลเดอร์นั้น ไม่ต้องขอสิทธิ์ทั้งไดรฟ์
 * กัน SSRF: ไม่เชื่อ token_uri ในไฟล์คีย์ — ใช้ปลายทางของ Google เสมอ (ยกเว้น baseUrl ของ mock ใน test)
 */
import { createSign } from 'node:crypto';
import { WebError } from './types';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3';
export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

export interface ServiceAccount { client_email: string; private_key: string }
export interface DriveFile { id: string; name: string; mimeType: string; md5Checksum?: string; modifiedTime?: string; size?: string }
export interface DriveOptions { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

/** ตรวจไฟล์คีย์ JSON ของ service account — ไม่ใช่ service account / ขาดฟิลด์ = error ที่อ่านเข้าใจได้ */
export function parseServiceAccount(json: string): ServiceAccount {
  let o: Record<string, unknown>;
  try { o = JSON.parse(json) as Record<string, unknown>; } catch { throw new WebError('ไฟล์คีย์ไม่ใช่ JSON', 'invalid'); }
  if (o.type !== 'service_account') throw new WebError('ต้องเป็นคีย์ของ service account (type = "service_account")', 'invalid');
  const email = typeof o.client_email === 'string' ? o.client_email : '';
  const key = typeof o.private_key === 'string' ? o.private_key : '';
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email)) throw new WebError('ไม่พบ client_email ของ service account', 'invalid');
  if (!key.includes('PRIVATE KEY')) throw new WebError('ไม่พบ private_key ในไฟล์คีย์', 'invalid');
  return { client_email: email, private_key: key };
}

export const isDriveFolderId = (v: string) => /^[\w-]{10,200}$/.test(v);
/** รับได้ทั้งลิงก์โฟลเดอร์ (…/folders/<id>?usp=…) และ id ตรง ๆ */
export function driveFolderIdFrom(input: string): string | null {
  const s = input.trim(); const m = s.match(/\/folders\/([\w-]{10,200})/) ?? s.match(/[?&]id=([\w-]{10,200})/);
  const id = m ? m[1]! : s;
  return isDriveFolderId(id) ? id : null;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function call(url: string, init: RequestInit, o: DriveOptions): Promise<Response> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), o.timeoutMs ?? 20_000);
  try { return await (o.fetchImpl ?? fetch)(url, { ...init, signal: ctl.signal, redirect: 'error' }); }
  catch (e) { throw new WebError(`ติดต่อ Google ไม่ได้: ${(e as Error).name === 'AbortError' ? 'หมดเวลา' : (e as Error).message}`, 'network'); }
  finally { clearTimeout(t); }
}
async function errorOf(res: Response): Promise<string> {
  const j = await res.json().catch(() => null) as { error?: string | { message?: string }; error_description?: string } | null;
  const e = j?.error; return (typeof e === 'object' ? e?.message : j?.error_description ?? e) ?? `HTTP ${res.status}`;
}

/** แลก JWT ที่เซ็นด้วยคีย์ service account เป็น access token (อายุ ≤ 1 ชม.) */
export async function serviceAccountToken(sa: ServiceAccount, scope = DRIVE_SCOPE, o: DriveOptions = {}): Promise<string> {
  const aud = o.baseUrl ? `${o.baseUrl}/token` : TOKEN_URL;
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope, aud, iat, exp: iat + 3600 }))}`;
  let sig: string;
  try { sig = b64url(createSign('RSA-SHA256').update(unsigned).sign(sa.private_key)); } catch { throw new WebError('private_key ในไฟล์คีย์ใช้เซ็นไม่ได้', 'invalid'); }
  const res = await call(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }).toString() }, o);
  if (!res.ok) throw new WebError(`Google ไม่ยอมรับคีย์: ${await errorOf(res)}`, 'forbidden');
  const j = await res.json() as { access_token?: string };
  if (!j.access_token) throw new WebError('Google ไม่ส่ง access token กลับมา', 'forbidden');
  return j.access_token;
}

/** ไฟล์ในโฟลเดอร์ (ไม่รวมถังขยะ) ใหม่สุดก่อน */
export async function driveListFolder(token: string, folderId: string, o: DriveOptions & { max?: number } = {}): Promise<DriveFile[]> {
  if (!isDriveFolderId(folderId)) throw new WebError('รหัสโฟลเดอร์ไม่ถูกต้อง', 'invalid');
  const q = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false`, fields: 'files(id,name,mimeType,md5Checksum,modifiedTime,size)', orderBy: 'modifiedTime desc', pageSize: String(Math.min(o.max ?? 100, 200)), supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  const res = await call(`${o.baseUrl ? `${o.baseUrl}/drive/v3` : DRIVE_URL}/files?${q}`, { headers: { authorization: `Bearer ${token}` } }, o);
  if (res.status === 404) throw new WebError('ไม่พบโฟลเดอร์ — ตรวจรหัสโฟลเดอร์ และแชร์โฟลเดอร์ให้อีเมล service account แล้วหรือยัง', 'notFound');
  if (res.status === 403) throw new WebError(`ไม่มีสิทธิ์อ่านโฟลเดอร์ (เปิด Google Drive API ในโปรเจกต์ และแชร์โฟลเดอร์ให้ service account): ${await errorOf(res)}`, 'forbidden');
  if (!res.ok) throw new WebError(`อ่านรายการไฟล์ไม่ได้: ${await errorOf(res)}`, 'unknown');
  return ((await res.json()) as { files?: DriveFile[] }).files ?? [];
}

/** ดาวน์โหลดไฟล์ (Google Docs → ส่งออกเป็นข้อความ) พร้อมเพดานขนาด */
export async function driveDownload(token: string, file: Pick<DriveFile, 'id' | 'mimeType'>, o: DriveOptions & { maxBytes?: number } = {}): Promise<Buffer> {
  const max = o.maxBytes ?? 12 * 1024 * 1024;
  const base = o.baseUrl ? `${o.baseUrl}/drive/v3` : DRIVE_URL;
  const url = file.mimeType === GOOGLE_DOC_MIME ? `${base}/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain` : `${base}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
  const res = await call(url, { headers: { authorization: `Bearer ${token}` } }, o);
  if (!res.ok) throw new WebError(`ดาวน์โหลดไฟล์ไม่ได้: ${await errorOf(res)}`, 'unknown');
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) throw new WebError(`ไฟล์ใหญ่เกิน ${Math.round(max / 1048576)} MB`, 'invalid');
  const reader = res.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = []; let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > max) { await reader.cancel(); throw new WebError(`ไฟล์ใหญ่เกิน ${Math.round(max / 1048576)} MB`, 'invalid'); } chunks.push(Buffer.from(value)); }
  return Buffer.concat(chunks);
}
