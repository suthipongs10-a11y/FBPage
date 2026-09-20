import { AiProviderError, type AiProviderId } from '../types';

/** POST JSON แล้วคืน body — error ทุกแบบกลายเป็น AiProviderError ที่ไม่มี key/prompt อยู่ในข้อความ */
export async function postJson(url: string, headers: Record<string, string>, payload: unknown, provider: AiProviderId, timeoutMs = 120_000): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response; let text: string;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload), signal: ctl.signal });
    // Keep the deadline active through the response body, including a server that stalls after headers.
    text = await res.text();
  } catch (e) {
    const cause = (e as Error & { cause?: Error }).cause?.message ?? (e as Error).message;
    throw new AiProviderError(`ต่อ ${provider} ไม่ได้: ${cause}`, provider, null);
  } finally { clearTimeout(timer); }
  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = body?.error?.message ?? (typeof body?.error === 'string' ? body.error : null) ?? body?.message ?? JSON.stringify(body).slice(0, 300);
    throw new AiProviderError(`${provider} ตอบ HTTP ${res.status}: ${msg}`, provider, res.status);
  }
  return body;
}
