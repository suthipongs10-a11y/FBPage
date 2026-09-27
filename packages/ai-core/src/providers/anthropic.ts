import { AiProviderError, PROVIDERS, mergeCitations, type AIProvider, type AiMessage, type ChatRequest, type ChatResult, type Citation, type ProviderConfig } from '../types';
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

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; citations?: { url?: string; title?: string }[]; content?: unknown };

export const anthropicProvider: AIProvider = {
  async chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
    const model = cfg.model || PROVIDERS.anthropic.defaultModel;
    const tools: unknown[] = [
      ...(req.tools ?? []).map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      ...(req.webSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] : []),
    ];
    const messages = toAnthropicMessages(req.messages) as { role: string; content: unknown }[];
    const usage = { input: 0, output: 0 }; let content: Block[] = [];
    // เครื่องมือฝั่งเซิร์ฟเวอร์ (ค้นเว็บ) อาจหยุดกลางทางด้วย pause_turn — ส่งต่อให้ทำต่อได้สูงสุด 2 รอบ
    for (let round = 0; round < 3; round++) {
      const payload = {
        model, max_tokens: req.maxTokens ?? 8000, ...(req.system && { system: req.system }), messages,
        ...(adaptiveOK(model) && { thinking: { type: 'adaptive' } }),
        ...(req.temperature !== undefined && !adaptiveOK(model) && { temperature: req.temperature }),
        ...(tools.length && { tools }),
      };
      const body = await postJson(cfg.baseUrl || PROVIDERS.anthropic.baseUrl, { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }, payload, 'anthropic', cfg.timeoutMs);
      if (body.stop_reason === 'refusal') throw new AiProviderError('โมเดลปฏิเสธคำขอนี้ (refusal)', 'anthropic', 422);
      usage.input += body.usage?.input_tokens ?? 0; usage.output += body.usage?.output_tokens ?? 0;
      content = [...content, ...((body.content ?? []) as Block[])];
      if (body.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: body.content });
    }
    const cited: Citation[] = content.filter(b => b.type === 'text').flatMap(b => b.citations ?? []).filter(c => c.url).map(c => ({ url: c.url!, title: c.title ?? null }));
    const found: Citation[] = content.filter(b => b.type === 'web_search_tool_result' && Array.isArray(b.content)).flatMap(b => b.content as { url?: string; title?: string }[]).filter(c => c.url).map(c => ({ url: c.url!, title: c.title ?? null }));
    const citations = mergeCitations(cited, found);
    return {
      text: content.filter(b => b.type === 'text').map(b => b.text ?? '').join(''),
      toolCalls: content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id!, name: b.name!, args: b.input ?? {} })),
      ...(req.webSearch && { citations }),
      usage, model, provider: 'anthropic',
    };
  },
};
