/**
 * Mock ผู้ให้บริการอีเมล (test เท่านั้น) — เลียนแบบ Brevo (/v3/*) และ Resend (/emails, /domains) ในเซิร์ฟเวอร์เดียว
 * ห้ามใช้ใน production; test ห้ามส่งอีเมลจริง
 */
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface MockEmailMessage { provider: 'brevo' | 'resend'; id: string; to: string; from: string; subject: string; html: string; text: string; headers: Record<string, string>; tags: unknown }
export interface MockEmailState { messages: MockEmailMessage[]; failNext: number; authFail: boolean; rejectEmails: Set<string>; requests: string[] }
export const MOCK_BREVO_KEY = 'xkeysib-MOCK-BREVO-OK'; export const MOCK_RESEND_KEY = 're_MOCK_RESEND_OK'; export const MOCK_SVIX_SECRET = 'whsec_bW9ja3NlY3JldG1vY2tzZWNyZXQ=';

export async function startMockEmailProvider(port = 0): Promise<{ server: Server; url: string; state: MockEmailState; svixHeaders: (body: string) => Record<string, string> }> {
  const state: MockEmailState = { messages: [], failNext: 0, authFail: false, rejectEmails: new Set(['bounce@invalid.test']), requests: [] };
  let n = 0;
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'); state.requests.push(`${req.method} ${u.pathname}`);
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
    const brevo = u.pathname.startsWith('/v3/');
    const authed = brevo ? req.headers['api-key'] === MOCK_BREVO_KEY : req.headers.authorization === `Bearer ${MOCK_RESEND_KEY}`;
    if (state.authFail || !authed) return json(401, brevo ? { code: 'unauthorized', message: 'Key not found' } : { statusCode: 401, name: 'validation_error', message: 'API key is invalid' });
    if (state.failNext > 0) { state.failNext--; return json(500, { message: 'mock failure' }); }
    if (u.pathname === '/v3/account') return json(200, { email: 'agency@example.com', companyName: 'Mock Agency' });
    if (u.pathname === '/domains') return json(200, { data: [{ name: 'news.example.com', status: 'verified' }] });
    if (u.pathname === '/v3/smtp/email' || u.pathname === '/emails') {
      const to = brevo ? String((body.to as { email: string }[])[0]?.email ?? '') : String((body.to as string[])[0] ?? '');
      if (!to.includes('@')) return json(400, { message: 'invalid recipient' });
      if (state.rejectEmails.has(to)) return json(400, brevo ? { code: 'invalid_parameter', message: 'email is invalid' } : { statusCode: 422, name: 'validation_error', message: 'Invalid `to` field' });
      const id = `${brevo ? 'brevo' : 'resend'}-msg-${++n}`;
      state.messages.push({ provider: brevo ? 'brevo' : 'resend', id, to, from: brevo ? String((body.sender as { email: string }).email) : String(body.from), subject: String(body.subject), html: String(brevo ? body.htmlContent : body.html), text: String(brevo ? body.textContent : body.text), headers: (body.headers as Record<string, string>) ?? {}, tags: body.tags });
      return json(brevo ? 201 : 200, brevo ? { messageId: id } : { id });
    }
    json(404, { message: 'not found' });
  });
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  const p = (server.address() as { port: number }).port;
  const svixHeaders = (raw: string) => { const id = `msg_${Date.now()}`; const ts = String(Math.floor(Date.now() / 1000)); const sig = createHmac('sha256', Buffer.from(MOCK_SVIX_SECRET.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${raw}`).digest('base64'); return { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` }; };
  return { server, url: `http://127.0.0.1:${p}`, state, svixHeaders };
}
