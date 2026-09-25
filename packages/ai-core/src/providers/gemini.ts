import { PROVIDERS, type AIProvider, type AiMessage, type ChatRequest, type ChatResult, type ProviderConfig } from '../types';
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

export const geminiProvider: AIProvider = {
  async chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
    const model = cfg.model || PROVIDERS.gemini.defaultModel;
    const url = `${(cfg.baseUrl || PROVIDERS.gemini.baseUrl).replace(/\/+$/, '')}/${model}:generateContent`;
    const payload = {
      ...(req.system && { systemInstruction: { parts: [{ text: req.system }] } }),
      contents: toGeminiContents(req.messages),
      generationConfig: { ...(req.maxTokens && { maxOutputTokens: req.maxTokens }), ...(req.temperature !== undefined && { temperature: req.temperature }), ...(req.jsonMode && { responseMimeType: 'application/json' }) },
      ...(req.tools?.length && { tools: [{ functionDeclarations: req.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }] }),
    };
    const body = await postJson(url, { 'x-goog-api-key': cfg.apiKey }, payload, 'gemini', cfg.timeoutMs);
    const parts: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] = body.candidates?.[0]?.content?.parts ?? [];
    return {
      text: parts.filter(p => p.text).map(p => p.text).join('\n'),
      toolCalls: parts.filter(p => p.functionCall).map((p, i) => ({ id: `gem_${Date.now()}_${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} })),
      usage: { input: body.usageMetadata?.promptTokenCount ?? null, output: body.usageMetadata?.candidatesTokenCount ?? null }, model, provider: 'gemini',
    };
  },
};
