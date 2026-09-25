/**
 * Provider adapters (W-4) — Brevo และ Resend ผ่าน HTTP ล้วน (ห้าม import SDK)
 * ทั้งคู่ส่ง header List-Unsubscribe + tag campaignId/sendId เพื่อโยง webhook กลับมา
 * API key อยู่ในหน่วยความจำของ instance เท่านั้น ไม่อยู่ใน error/log
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EmailEventType, EmailProviderId } from '@fbpm/shared';
import { EmailError, type BulkMailProvider, type NormalizedEvent, type OutboundMessage, type ProviderAccountInfo, type ProviderOptions, type SendResult } from './types';

async function http(opts: ProviderOptions, url: string, init: RequestInit & { headers: Record<string, string> }): Promise<{ status: number; json: unknown; text: string }> {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { ...init, signal: ctrl.signal });
    const text = await res.text(); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, json, text };
  } catch (e) { throw new EmailError(`เชื่อมต่อผู้ให้บริการอีเมลไม่ได้: ${e instanceof Error ? e.message : String(e)}`, 'network'); }
  finally { clearTimeout(timer); }
}
function fail(status: number, detail: string): never {
  if (status === 401 || status === 403) throw new EmailError(`ผู้ให้บริการปฏิเสธ API key (${status}): ${detail}`, 'auth', status);
  if (status === 429) throw new EmailError(`ถูกจำกัดอัตราส่ง (429): ${detail}`, 'quota', status);
  if (status >= 500) throw new EmailError(`ผู้ให้บริการขัดข้อง (${status}): ${detail}`, 'network', status);
  if (status === 404) throw new EmailError(detail, 'notFound', status);
  throw new EmailError(`ผู้ให้บริการปฏิเสธคำขอ (${status}): ${detail}`, 'invalid', status);
}
const detailOf = (json: unknown, text: string) => ((json as { message?: string; error?: { message?: string } | string } | null)?.message ?? (typeof (json as { error?: unknown })?.error === 'string' ? (json as { error: string }).error : (json as { error?: { message?: string } })?.error?.message) ?? text.slice(0, 200));
const tsOf = (v: unknown): Date => { const d = typeof v === 'number' ? new Date(v > 1e12 ? v : v * 1000) : v ? new Date(String(v)) : new Date(); return Number.isNaN(d.getTime()) ? new Date() : d; };

// ---------- Brevo ----------
const BREVO_EVENTS: Record<string, EmailEventType | undefined> = { delivered: 'delivered', opened: 'opened', unique_opened: 'opened', click: 'clicked', hard_bounce: 'bounced', soft_bounce: 'bounced', blocked: 'bounced', invalid_email: 'bounced', spam: 'complained', complaint: 'complained', unsubscribed: 'unsubscribed', error: 'failed' };
export class BrevoProvider implements BulkMailProvider {
  readonly id: EmailProviderId = 'brevo'; private readonly base: string;
  constructor(private readonly opts: ProviderOptions) { this.base = (opts.baseUrl ?? 'https://api.brevo.com').replace(/\/+$/, ''); }
  private headers() { return { 'api-key': this.opts.apiKey, accept: 'application/json', 'content-type': 'application/json' }; }
  async verify(): Promise<ProviderAccountInfo> {
    const r = await http(this.opts, `${this.base}/v3/account`, { method: 'GET', headers: this.headers() });
    if (r.status >= 400) fail(r.status, detailOf(r.json, r.text));
    const a = r.json as { email?: string; companyName?: string } | null; return { ok: true, accountEmail: a?.email ?? null, detail: a?.companyName ?? null };
  }
  async send(m: OutboundMessage): Promise<SendResult> {
    const body = { sender: { email: m.from.email, name: m.from.name }, to: [{ email: m.to.email, ...(m.to.name && { name: m.to.name }) }], ...(m.replyTo && { replyTo: { email: m.replyTo } }), subject: m.subject, htmlContent: m.html, textContent: m.text, headers: { 'List-Unsubscribe': `<${m.listUnsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-FBPM-Campaign': m.campaignId, 'X-FBPM-Send': m.sendId }, tags: [`campaign:${m.campaignId}`, `send:${m.sendId}`] };
    const r = await http(this.opts, `${this.base}/v3/smtp/email`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (r.status >= 400) fail(r.status, detailOf(r.json, r.text));
    const id = (r.json as { messageId?: string } | null)?.messageId; if (!id) throw new EmailError('Brevo ไม่คืน messageId', 'unknown');
    return { messageId: id };
  }
  /** Brevo ไม่เซ็น webhook → ใช้ secret ใน URL (?token=) ที่ API ย้ายมาเป็น header x-webhook-token */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string, secret: string | null): NormalizedEvent[] {
    if (secret) { const got = String(headers['x-webhook-token'] ?? ''); if (!got || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) throw new EmailError('webhook token ไม่ถูกต้อง', 'auth', 401); }
    let body: unknown; try { body = JSON.parse(rawBody); } catch { throw new EmailError('webhook body ไม่ใช่ JSON', 'invalid', 400); }
    const items = Array.isArray(body) ? body : [body];
    return items.flatMap(raw => {
      const e = raw as Record<string, unknown>; const type = BREVO_EVENTS[String(e.event ?? '')]; if (!type) return [];
      const tags = Array.isArray(e.tags) ? (e.tags as string[]) : typeof e.tag === 'string' ? [e.tag] : [];
      const pick = (p: string) => tags.find(t => t.startsWith(`${p}:`))?.slice(p.length + 1) ?? null;
      return [{ type, email: e.email ? String(e.email) : null, providerMessageId: e['message-id'] ? String(e['message-id']) : null, campaignId: pick('campaign'), sendId: pick('send'), occurredAt: tsOf(e.ts_event ?? e.date), raw }];
    });
  }
}

// ---------- Resend ----------
const RESEND_EVENTS: Record<string, EmailEventType | undefined> = { 'email.delivered': 'delivered', 'email.opened': 'opened', 'email.clicked': 'clicked', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed' };
export class ResendProvider implements BulkMailProvider {
  readonly id: EmailProviderId = 'resend'; private readonly base: string;
  constructor(private readonly opts: ProviderOptions) { this.base = (opts.baseUrl ?? 'https://api.resend.com').replace(/\/+$/, ''); }
  private headers() { return { authorization: `Bearer ${this.opts.apiKey}`, accept: 'application/json', 'content-type': 'application/json' }; }
  async verify(): Promise<ProviderAccountInfo> {
    const r = await http(this.opts, `${this.base}/domains`, { method: 'GET', headers: this.headers() });
    if (r.status >= 400) fail(r.status, detailOf(r.json, r.text));
    const d = r.json as { data?: { name: string; status: string }[] } | null; const verified = (d?.data ?? []).filter(x => x.status === 'verified').map(x => x.name);
    return { ok: true, accountEmail: null, detail: verified.length ? `โดเมนที่ยืนยันแล้ว: ${verified.join(', ')}` : 'ยังไม่มีโดเมนที่ยืนยัน (SPF/DKIM) — ส่งจริงจะถูกปฏิเสธ' };
  }
  async send(m: OutboundMessage): Promise<SendResult> {
    const body = { from: `${m.from.name.replace(/[<>"]/g, '')} <${m.from.email}>`, to: [m.to.email], ...(m.replyTo && { reply_to: m.replyTo }), subject: m.subject, html: m.html, text: m.text, headers: { 'List-Unsubscribe': `<${m.listUnsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, tags: [{ name: 'campaign', value: m.campaignId }, { name: 'send', value: m.sendId }] };
    const r = await http(this.opts, `${this.base}/emails`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (r.status >= 400) fail(r.status, detailOf(r.json, r.text));
    const id = (r.json as { id?: string } | null)?.id; if (!id) throw new EmailError('Resend ไม่คืน id', 'unknown');
    return { messageId: id };
  }
  /** Resend เซ็นด้วย Svix: HMAC-SHA256(`${id}.${ts}.${body}`) เทียบกับ svix-signature (v1,<base64>) */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string, secret: string | null): NormalizedEvent[] {
    if (secret) {
      const id = String(headers['svix-id'] ?? ''); const ts = String(headers['svix-timestamp'] ?? ''); const sigs = String(headers['svix-signature'] ?? '').split(' ').map(s => s.split(',')[1] ?? '').filter(Boolean);
      const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64'); const expected = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');
      const ok = sigs.some(s => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
      if (!ok) throw new EmailError('ลายเซ็น webhook ไม่ถูกต้อง', 'auth', 401);
      if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new EmailError('webhook เก่าเกิน 5 นาที', 'auth', 401);
    }
    let body: Record<string, unknown>; try { body = JSON.parse(rawBody) as Record<string, unknown>; } catch { throw new EmailError('webhook body ไม่ใช่ JSON', 'invalid', 400); }
    const type = RESEND_EVENTS[String(body.type ?? '')]; if (!type) return [];
    const data = (body.data as Record<string, unknown> | undefined) ?? {};
    const tagsRaw = data.tags; const tags: Record<string, string> = Array.isArray(tagsRaw) ? Object.fromEntries((tagsRaw as { name: string; value: string }[]).map(t => [t.name, t.value])) : ((tagsRaw as Record<string, string> | undefined) ?? {});
    const to = Array.isArray(data.to) ? String((data.to as string[])[0] ?? '') : typeof data.to === 'string' ? data.to : '';
    return [{ type, email: to || null, providerMessageId: data.email_id ? String(data.email_id) : null, campaignId: tags.campaign ?? null, sendId: tags.send ?? null, occurredAt: tsOf(body.created_at), raw: body }];
  }
}

export function createProvider(id: EmailProviderId, opts: ProviderOptions): BulkMailProvider {
  if (id === 'brevo') return new BrevoProvider(opts);
  if (id === 'resend') return new ResendProvider(opts);
  throw new EmailError(`ไม่รองรับผู้ให้บริการ ${String(id)}`, 'invalid');
}
