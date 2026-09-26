/**
 * สร้างภาพด้วยคีย์ AiConnection เดิม — HTTP ล้วน ไม่ import SDK (N-3)
 * - openai / compatible: POST {base}/images/generations (b64_json หรือ url)
 * - openrouter: chat/completions + modalities ["image","text"] → message.images[].image_url (data URL)
 * - gemini: {base}/{model}:generateContent + responseModalities IMAGE → inlineData
 * - anthropic: Claude สร้างภาพไม่ได้ → error ชัดเจน
 * ผลลัพธ์เป็นไบต์ของภาพ + mimeType ที่ตรวจแล้ว (png/jpeg/webp) ไม่เกิน 15 MB
 */
import { postJson } from './providers/http';
import { AiProviderError, PROVIDERS, type AiProviderId, type ProviderConfig } from './types';

export const IMAGE_PROVIDERS: AiProviderId[] = ['openai', 'gemini', 'openrouter', 'compatible'];
export interface ImageRequest { prompt: string; size?: '1024x1024' | '1024x1536' | '1536x1024' }
export interface ImageResult { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; model: string }

const MAX_BYTES = 15 * 1024 * 1024;
const MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

function sniff(buf: Buffer): ImageResult['mimeType'] | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
function fromBase64(b64: string, provider: AiProviderId, model: string): ImageResult {
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.byteLength > MAX_BYTES) throw new AiProviderError('ภาพที่ได้ใหญ่เกิน 15 MB', provider, 422);
  const mimeType = sniff(bytes);
  if (!mimeType) throw new AiProviderError(`${provider} ไม่ได้ส่งภาพที่อ่านได้กลับมา`, provider, 422);
  return { bytes, mimeType, model };
}
function fromDataUrl(url: string, provider: AiProviderId, model: string): ImageResult {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(url);
  if (!m || !MIME.has(m[1]!.toLowerCase())) throw new AiProviderError(`${provider} ส่งภาพในรูปแบบที่ไม่รองรับ`, provider, 422);
  return fromBase64(m[2]!, provider, model);
}
/** ดาวน์โหลดภาพจาก URL ที่ผู้ให้บริการส่งกลับ — https เท่านั้น, เพดานขนาด, timeout */
async function download(url: string, provider: AiProviderId, model: string, timeoutMs: number): Promise<ImageResult> {
  let u: URL; try { u = new URL(url); } catch { throw new AiProviderError('ลิงก์ภาพไม่ถูกต้อง', provider, 422); }
  if (u.protocol !== 'https:') throw new AiProviderError('ลิงก์ภาพต้องเป็น https', provider, 422);
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(u, { signal: ctl.signal, redirect: 'error' });
    if (!res.ok) throw new AiProviderError(`ดาวน์โหลดภาพไม่ได้ (HTTP ${res.status})`, provider, res.status);
    const len = Number(res.headers.get('content-length') ?? 0); if (len > MAX_BYTES) throw new AiProviderError('ภาพที่ได้ใหญ่เกิน 15 MB', provider, 422);
    return fromBase64(Buffer.from(await res.arrayBuffer()).toString('base64'), provider, model);
  } catch (e) { if (e instanceof AiProviderError) throw e; throw new AiProviderError(`ดาวน์โหลดภาพไม่ได้: ${(e as Error).message}`, provider, null); } finally { clearTimeout(timer); }
}

export async function generateImage(cfg: ProviderConfig, req: ImageRequest): Promise<ImageResult> {
  const provider = cfg.provider; const meta = PROVIDERS[provider];
  const timeoutMs = cfg.timeoutMs ?? 180_000;
  if (provider === 'anthropic') throw new AiProviderError('Claude สร้างภาพไม่ได้ — เลือกคีย์ OpenAI, Gemini หรือ OpenRouter สำหรับงานภาพ', provider, 400);
  const model = cfg.model || '';
  if (!model) throw new AiProviderError(`${meta.label} ต้องระบุชื่อโมเดลภาพ`, provider, 400);
  const base = (cfg.baseUrl || meta.baseUrl).replace(/\/+$/, '');
  if (!base) throw new AiProviderError(`${meta.label} ต้องระบุ Base URL`, provider, 400);

  if (provider === 'gemini') {
    const body = await postJson(`${base}/${model}:generateContent`, { 'x-goog-api-key': cfg.apiKey }, { contents: [{ role: 'user', parts: [{ text: req.prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }, provider, timeoutMs);
    const parts = (body.candidates?.[0]?.content?.parts ?? []) as { inlineData?: { mimeType?: string; data?: string } }[];
    const img = parts.find(p => p.inlineData?.data && MIME.has((p.inlineData.mimeType ?? '').toLowerCase()));
    if (!img) throw new AiProviderError(`Gemini ไม่ได้สร้างภาพ (${body.candidates?.[0]?.finishReason ?? 'ไม่มีภาพในคำตอบ'}) — ตรวจว่าเป็นโมเดลที่สร้างภาพได้`, provider, 422);
    return fromBase64(img.inlineData!.data!, provider, model);
  }
  if (provider === 'openrouter') {
    const body = await postJson(`${base}/chat/completions`, { authorization: `Bearer ${cfg.apiKey}` }, { model, messages: [{ role: 'user', content: req.prompt }], modalities: ['image', 'text'] }, provider, timeoutMs);
    const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url as string | undefined;
    if (!url) throw new AiProviderError('OpenRouter ไม่ได้ส่งภาพกลับมา — ตรวจว่าเป็นโมเดลที่สร้างภาพได้', provider, 422);
    return url.startsWith('data:') ? fromDataUrl(url, provider, model) : download(url, provider, model, timeoutMs);
  }
  // openai / compatible
  const payload: Record<string, unknown> = { model, prompt: req.prompt, n: 1, size: req.size ?? '1024x1024' };
  if (/^dall-e/i.test(model)) payload.response_format = 'b64_json';
  const body = await postJson(`${base}/images/generations`, { authorization: `Bearer ${cfg.apiKey}` }, payload, provider, timeoutMs);
  const d = body.data?.[0] as { b64_json?: string; url?: string } | undefined;
  if (d?.b64_json) return fromBase64(d.b64_json, provider, model);
  if (d?.url) return download(d.url, provider, model, timeoutMs);
  throw new AiProviderError(`${meta.label} ไม่ได้ส่งภาพกลับมา`, provider, 422);
}
