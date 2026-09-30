/**
 * LINE Messaging API (LINE Official Account) — HTTP ล้วน ใช้ร่วมกันระหว่าง API และ worker
 * push = ส่งหาผู้ใช้เอง (นับโควต้าข้อความของ OA) · reply = ตอบ event ภายในเวลาสั้นๆ (ไม่นับโควต้า)
 * ค่าลับ (channel secret / access token) ถอดรหัสจาก LineChannel ตอนใช้เท่านั้น ห้าม log
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const lineApiBase = (): string => (process.env.LINE_API_BASE_URL || 'https://api.line.me').replace(/\/+$/, '');
const MAX_TEXT = 4900;   // LINE รับ 5,000 ตัวอักษรต่อข้อความ

/** ลายเซ็น webhook: base64(HMAC-SHA256(channelSecret, rawBody)) ใน header x-line-signature */
export function verifyLineSignature(channelSecret: string, rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!rawBody || !header) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest();
  let got: Buffer; try { got = Buffer.from(header, 'base64'); } catch { return false; }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export interface LineResult { ok: boolean; status: number; error?: string }
async function call(path: string, token: string, init: { method?: string; body?: unknown }, fetchImpl: typeof fetch): Promise<LineResult & { json?: Record<string, unknown> }> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchImpl(`${lineApiBase()}${path}`, { method: init.method ?? 'POST', headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined, signal: ctl.signal });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return res.ok ? { ok: true, status: res.status, json } : { ok: false, status: res.status, error: String(json.message ?? `HTTP ${res.status}`).slice(0, 300) };
  } catch (e) { return { ok: false, status: 0, error: (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message }; } finally { clearTimeout(timer); }
}
const textMsg = (text: string) => [{ type: 'text', text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text }];

export const linePush = (token: string, to: string, text: string, fetchImpl: typeof fetch = fetch) => call('/v2/bot/message/push', token, { body: { to, messages: textMsg(text) } }, fetchImpl);
export const lineReply = (token: string, replyToken: string, text: string, fetchImpl: typeof fetch = fetch) => call('/v2/bot/message/reply', token, { body: { replyToken, messages: textMsg(text) } }, fetchImpl);
/** ตรวจ token + เอา @basicId/ชื่อ OA มาแสดงลิงก์เพิ่มเพื่อน */
export async function lineBotInfo(token: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; basicId: string | null; displayName: string | null } | { ok: false; error: string }> {
  const r = await call('/v2/bot/info', token, { method: 'GET' }, fetchImpl);
  return r.ok ? { ok: true, basicId: (r.json?.basicId as string) ?? null, displayName: (r.json?.displayName as string) ?? null } : { ok: false, error: r.error ?? 'error' };
}
export const lineAddFriendUrl = (basicId: string | null | undefined) => (basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : null);

/** LINE API จำลองสำหรับ test (ไม่ยิง LINE จริง) — token ที่ใช้ได้อยู่ใน validTokens */
export interface MockLineState { validTokens: Set<string>; pushes: { to: string; text: string; token: string }[]; replies: { replyToken: string; text: string }[]; failPush: number; bot: { basicId: string; displayName: string } }
export async function startMockLine(port = 0): Promise<{ url: string; state: MockLineState; server: Server }> {
  const state: MockLineState = { validTokens: new Set(['LINE_TOKEN_OK']), pushes: [], replies: [], failPush: 0, bot: { basicId: '@fbpm-test', displayName: 'SocialManage แจ้งเตือน' } };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on('data', c => chunks.push(c as Buffer)); req.on('end', () => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!state.validTokens.has(token)) return send(401, { message: 'Authentication failed. Confirm that the access token in the authorization header is valid.' });
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as { to?: string; replyToken?: string; messages?: { text: string }[] } : {};
      if (req.method === 'GET' && req.url === '/v2/bot/info') return send(200, { userId: 'Ubot', basicId: state.bot.basicId, displayName: state.bot.displayName });
      if (req.url === '/v2/bot/message/push') { if (state.failPush > 0) { state.failPush--; return send(429, { message: 'You have reached your monthly limit.' }); } state.pushes.push({ to: body.to ?? '', text: body.messages?.[0]?.text ?? '', token }); return send(200, {}); }
      if (req.url === '/v2/bot/message/reply') { state.replies.push({ replyToken: body.replyToken ?? '', text: body.messages?.[0]?.text ?? '' }); return send(200, {}); }
      send(404, { message: 'Not found' });
    });
  });
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state, server };
}
