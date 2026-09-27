import { AiProviderError, PROVIDERS, mergeCitations, type AIProvider, type AiMessage, type ChatRequest, type ChatResult, type ProviderConfig } from '../types';
import { postJson } from './http';

export function toGeminiContents(messages: AiMessage[]): unknown[] {
  const out: { role: string; parts: Record<string, unknown>[] }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      let response: unknown; try { response = JSON.parse(m.content); } catch { response = { result: m.content }; }
      const part = { functionResponse: { name: m.name, response } };
      const last = out[out.length - 1];
      if (last?.role === 'user' && last.parts[0]?.functionResponse) last.parts.push(part); else out.push({ role: 'user', parts: [part] });
    } else if (m.role === 'assistant') {
      const parts: Record<string, unknown>[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
      out.push({ role: 'model', parts });
    } else out.push({ role: 'user', parts: [{ text: m.content }] });
  }
  return out;
}

/**
 * Gemini 2.5+ เป็นโมเดล "คิดก่อนตอบ" — โทเค็นที่ใช้คิดนับรวมใน maxOutputTokens
 * ถ้าไม่เผื่อไว้ งานที่ขอ JSON สั้น ๆ จะคิดจนหมดโควตาแล้วได้คำตอบว่าง/ขาดกลาง (ปัญหาที่เจอจริงกับ gemini-2.5-pro)
 * จึงจำกัดงบคิดของ 2.5 และบวกที่เผื่อให้ทุกรุ่นที่คิดได้
 */
const THINKING_BUDGET = 2048;
const thinkingHeadroom = (model: string) => (/gemini-2\.5/i.test(model) ? THINKING_BUDGET : /gemini-(3|[4-9])/i.test(model) ? 8192 : 0);

export const geminiProvider: AIProvider = {
  async chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
    const model = cfg.model || PROVIDERS.gemini.defaultModel;
    const url = `${(cfg.baseUrl || PROVIDERS.gemini.baseUrl).replace(/\/+$/, '')}/${model}:generateContent`;
    const payload = {
      ...(req.system && { systemInstruction: { parts: [{ text: req.system }] } }),
      contents: toGeminiContents(req.messages),
      generationConfig: {
        ...(req.maxTokens && { maxOutputTokens: req.maxTokens + thinkingHeadroom(model) }),
        ...(/gemini-2\.5/i.test(model) && { thinkingConfig: { thinkingBudget: THINKING_BUDGET } }),
        // ค้นเว็บ (Google Search grounding) ใช้คู่กับ JSON mode ไม่ได้ — ขอ JSON ผ่านคำสั่งแทน
        ...(req.temperature !== undefined && { temperature: req.temperature }), ...(req.jsonMode && !req.webSearch && { responseMimeType: 'application/json' }),
      },
      ...(req.webSearch ? { tools: [{ google_search: {} }] } : req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
    };
    const body = await postJson(url, { 'x-goog-api-key': cfg.apiKey }, payload, 'gemini', cfg.timeoutMs);
    const parts: { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown> } }[] = (body.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought);
    const finish = body.candidates?.[0]?.finishReason as string | undefined;
    if (!parts.some(p => p.text || p.functionCall)) {
      // ตอบว่าง — บอกเหตุจริง (MAX_TOKENS = คิดจนหมดโควตาคำตอบ, SAFETY = ถูกกรอง) แทนข้อความกว้าง ๆ ว่า JSON อ่านไม่ได้
      throw new AiProviderError(finish === 'MAX_TOKENS' ? `Gemini (${model}) ใช้โควตาคำตอบหมดก่อนตอบ — ลองใช้รุ่น flash หรือลดงานต่อครั้ง` : `Gemini (${model}) ไม่ได้ตอบกลับ (${finish ?? 'ไม่ทราบเหตุ'})`, 'gemini', 422);
    }
    return {
      text: parts.filter(p => p.text).map(p => p.text).join('\n'),
      toolCalls: parts.filter(p => p.functionCall).map((p, i) => ({ id: `gem_${Date.now()}_${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} })),
      ...(req.webSearch && { citations: mergeCitations(((body.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as { web?: { uri?: string; title?: string } }[]).filter(c => c.web?.uri).map(c => ({ url: c.web!.uri!, title: c.web!.title ?? null }))) }),
      usage: { input: body.usageMetadata?.promptTokenCount ?? null, output: body.usageMetadata?.candidatesTokenCount == null ? null : body.usageMetadata.candidatesTokenCount + (body.usageMetadata.thoughtsTokenCount ?? 0) }, model, provider: 'gemini',
    };
  },
};
