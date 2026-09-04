import { AiProviderError, PROVIDERS, type AIProvider, type AiMessage, type AiProviderId, type ChatRequest, type ChatResult, type ProviderConfig } from '../types';
import { postJson } from './http';

export function toOpenAIMessages(system: string | undefined, messages: AiMessage[]): unknown[] {
  const out: unknown[] = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length) out.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

/** Chat Completions — ใช้กับ openai / openrouter / compatible (LiteLLM, Groq, Ollama …) */
export function openAICompatible(provider: AiProviderId): AIProvider {
  return {
    async chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
      const meta = PROVIDERS[provider];
      const base = (cfg.baseUrl || meta.baseUrl).replace(/\/+$/, '');
      if (!base) throw new AiProviderError(`${meta.label} ต้องระบุ Base URL`, provider, 400);
      const model = cfg.model || meta.defaultModel;
      if (!model) throw new AiProviderError(`${meta.label} ต้องระบุชื่อโมเดล`, provider, 400);
      const payload = {
        model, messages: toOpenAIMessages(req.system, req.messages),
        ...(req.maxTokens && { max_completion_tokens: req.maxTokens }),
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.jsonMode && { response_format: { type: 'json_object' } }),
        ...(req.tools?.length && { tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }),
      };
      const headers: Record<string, string> = { authorization: `Bearer ${cfg.apiKey}` };
      if (provider === 'openrouter') { headers['http-referer'] = 'https://github.com/fbpm'; headers['x-title'] = 'Facebook AI Page Manager'; }
      const body = await postJson(`${base}/chat/completions`, headers, payload, provider, cfg.timeoutMs);
      const msg = body.choices?.[0]?.message ?? {};
      const toolCalls = ((msg.tool_calls ?? []) as { id: string; function: { name: string; arguments?: string } }[]).map(c => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* ปล่อยว่าง */ }
        return { id: c.id, name: c.function.name, args };
      });
      return { text: msg.content ?? '', toolCalls, usage: { input: body.usage?.prompt_tokens ?? null, output: body.usage?.completion_tokens ?? null }, model: body.model ?? model, provider };
    },
  };
}
