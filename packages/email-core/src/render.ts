/** เรนเดอร์อีเมลต่อผู้รับ (W-4) — แทน placeholder, บังคับมีลิงก์ยกเลิกรับ (PDPA) ทุกฉบับ, สร้าง text version */
export interface RenderInput { bodyHtml: string; bodyText?: string | null; subject: string; preheader?: string | null; subscriber: { email: string; name?: string | null }; unsubscribeUrl: string; fromName: string; brandName?: string | null }
export interface Rendered { subject: string; html: string; text: string }

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const htmlToText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

export const PLACEHOLDERS = ['{{name}}', '{{email}}', '{{unsubscribe_url}}'] as const;
function fill(tpl: string, vars: Record<string, string>): string { return tpl.replace(/\{\{\s*(name|email|unsubscribe_url)\s*\}\}/g, (_m, k: string) => vars[k] ?? ''); }

export function renderEmail(i: RenderInput): Rendered {
  const name = (i.subscriber.name ?? '').trim() || i.subscriber.email.split('@')[0]!;
  const vars = { name: escapeHtml(name), email: escapeHtml(i.subscriber.email), unsubscribe_url: i.unsubscribeUrl };
  const varsText = { name, email: i.subscriber.email, unsubscribe_url: i.unsubscribeUrl };
  let html = fill(i.bodyHtml, vars);
  const hasUnsub = /\{\{\s*unsubscribe_url\s*\}\}/.test(i.bodyHtml);
  if (!hasUnsub) html += `\n<p style="margin-top:32px;font-size:12px;line-height:1.6;color:#6b7a90">คุณได้รับอีเมลนี้เพราะสมัครรับข่าวจาก ${escapeHtml(i.brandName ?? i.fromName)} · <a href="${i.unsubscribeUrl}" style="color:#6b7a90">ยกเลิกรับอีเมล</a></p>`;
  const pre = i.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(i.preheader)}</div>` : '';
  const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(i.subject)}</title></head><body style="margin:0;padding:24px;background:#f5f7fb;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Thai',sans-serif;color:#1f2a3c">${pre}<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;line-height:1.7">${html}</div></body></html>`;
  const text = `${i.bodyText ? fill(i.bodyText, varsText) : htmlToText(fill(i.bodyHtml, varsText))}${hasUnsub ? '' : `\n\n—\nยกเลิกรับอีเมล: ${i.unsubscribeUrl}`}`;
  return { subject: fill(i.subject, varsText), html: doc, text };
}
