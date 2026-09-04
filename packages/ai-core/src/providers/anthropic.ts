import { AiProviderError, PROVIDERS, type AIProvider, type AiMessage, type ChatRequest, type ChatResult, type ProviderConfig } from '../types';
import { postJson } from './http';

// รุ่นที่รองรับ adaptive thinking (Claude 4.6 ขึ้นไป / Claude 5) — รุ่นเก่ากว่านั้นไม่ส่งพารามิเตอร์ thinking
const adaptiveOK = (m: string) => /(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|haiku-4-5|fable|mythos)/.test(m);

export function toAnthropicMessages(messages: AiMessage[]): unknown[] {
  const out: { role: string; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const content: unknown[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      out.push({ role: 'assistant', content });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

export const anthropicProvider: AIProvider = {
  async chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
    const model = cfg.model || PROVIDERS.anthropic.defaultModel;
    const payload = {
      model, max_tokens: req.maxTokens ?? 8000, ...(req.system && { system: req.system }),
      messages: toAnthropicMessages(req.messages),
      ...(adaptiveOK(model) && { thinking: { type: 'adaptive' } }),
      ...(req.temperature !== undefined && !adaptiveOK(model) && { temperature: req.temperature }),
      ...(req.tools?.length && { tools: req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) }),
    };
    const body = await postJson(cfg.baseUrl || PROVIDERS.anthropic.baseUrl, { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }, payload, 'anthropic', cfg.timeoutMs);
    if (body.stop_reason === 'refusal') throw new AiProviderError('โมเดลปฏิเสธคำขอนี้ (refusal)', 'anthropic', 422);
    const content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] = body.content ?? [];
    return {
      text: content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n'),
      toolCalls: content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id!, name: b.name!, args: b.input ?? {} })),
      usage: { input: body.usage?.input_tokens ?? null, output: body.usage?.output_tokens ?? null }, model, provider: 'anthropic',
    };
  },
};
