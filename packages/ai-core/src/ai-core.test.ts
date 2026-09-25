import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiProviderError, chat, estimateCostUsd, extractJson, generateStructured, runToolLoop, toAnthropicMessages, toGeminiContents, toOpenAIMessages, type AiMessage, type ProviderConfig } from './index';
import { startMockAi, type MockAiState } from './mock-ai';

let url = ''; let state: MockAiState; let close: () => void;
beforeAll(async () => { const m = await startMockAi(); url = m.url; state = m.state; close = () => m.server.close(); });
afterAll(() => close());
const cfg = (): ProviderConfig => ({ provider: 'compatible', apiKey: 'MOCK_KEY', model: 'mock-1', baseUrl: url });

describe('message transforms (§4 — provider code lives only in adapters)', () => {
  const history: AiMessage[] = [
    { role: 'user', content: 'สรุปเพจ' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_posts', args: { days: 30 } }] },
    { role: 'tool', toolCallId: 'c1', name: 'get_posts', content: '{"posts":[]}' },
  ];
  it('anthropic: tool results become user tool_result blocks', () => {
    const out = toAnthropicMessages(history) as { role: string; content: unknown }[];
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect((out[2]!.content as { type: string }[])[0]!.type).toBe('tool_result');
  });
  it('openai: system first, tool role preserved', () => {
    const out = toOpenAIMessages('sys', history) as { role: string }[];
    expect(out.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
  });
  it('gemini: assistant→model, tool→functionResponse', () => {
    const out = toGeminiContents(history) as { role: string; parts: Record<string, unknown>[] }[];
    expect(out.map(m => m.role)).toEqual(['user', 'model', 'user']);
    expect(out[2]!.parts[0]).toHaveProperty('functionResponse');
  });
});

describe('gateway against mock provider', () => {
  it('chat returns text + usage and never sends the key elsewhere than the auth header', async () => {
    const r = await chat(cfg(), { system: 's', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('echo: hi'); expect(r.usage).toEqual({ input: 120, output: 40 }); expect(r.provider).toBe('compatible');
    expect(JSON.stringify(state.requests.at(-1)!.messages)).not.toContain('MOCK_KEY');
  });
  it('bad key → AiProviderError.isAuthError with a user message', async () => {
    await expect(chat({ ...cfg(), apiKey: 'WRONG' }, { messages: [{ role: 'user', content: 'x' }] })).rejects.toSatisfy((e: unknown) => e instanceof AiProviderError && e.isAuthError && /API key/.test(e.userMessage));
  });
  it('missing base url for compatible → 400-style error', async () => {
    await expect(chat({ provider: 'compatible', apiKey: 'k', model: 'm' }, { messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/Base URL/);
  });
  it('tool loop executes tools then returns the final answer with steps', async () => {
    state.replies.push({ toolCalls: [{ name: 'get_posts', args: { days: 7 } }] }, { text: 'มี 2 โพสต์' });
    const calls: string[] = [];
    const r = await runToolLoop(cfg(), { system: 's', messages: [{ role: 'user', content: 'โพสต์ล่าสุด' }], tools: [{ name: 'get_posts', description: 'd', parameters: { type: 'object' } }], exec: async c => { calls.push(c.name); return { posts: 2 }; } });
    expect(r.text).toBe('มี 2 โพสต์'); expect(calls).toEqual(['get_posts']); expect(r.rounds).toBe(2);
    expect(r.steps.map(s => s.type)).toEqual(['tool', 'result']);
    expect(r.usage).toEqual({ input: 240, output: 80 });
    expect(r.messages.at(-2)?.role).toBe('tool');
  });
  it('tool loop turns a throwing tool into an error message for the model and stops at maxRounds', async () => {
    state.replies.push({ toolCalls: [{ name: 'boom', args: {} }] }, { toolCalls: [{ name: 'boom', args: {} }] });
    const r = await runToolLoop(cfg(), { messages: [{ role: 'user', content: 'x' }], tools: [], exec: async () => { throw new Error('nope'); }, maxRounds: 2 });
    expect(r.stoppedByLimit).toBe(true);
    expect((r.messages.find(m => m.role === 'tool') as { content: string }).content).toContain('nope');
  });
  it('generateStructured validates and retries once with the error fed back', async () => {
    state.replies.push({ text: 'ขอโทษ นี่คือ ```json\n{"score": "สูง"}\n```' }, { text: '{"score": 7}' });
    const r = await generateStructured(cfg(), { prompt: 'ให้คะแนน', schemaDescription: '{ "score": number }', validate: v => { const o = v as { score: unknown }; if (typeof o.score !== 'number') throw new Error('score ต้องเป็นตัวเลข'); return o as { score: number }; } });
    expect(r.data.score).toBe(7); expect(r.attempts).toBe(2);
    const lastReq = state.requests.at(-1)!.messages as { role: string; content: string }[];
    expect(lastReq.at(-1)!.content).toContain('score ต้องเป็นตัวเลข');
  });
  it('extractJson handles fences and wrapped text', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('ผลลัพธ์: {"a":[1,2]} จบ')).toEqual({ a: [1, 2] });
    expect(() => extractJson('ไม่มี json')).toThrow();
  });
  it('estimates cost for known models and null for unknown', () => {
    expect(estimateCostUsd('claude-sonnet-5', { input: 1_000_000, output: 0 })).toBe(3);
    expect(estimateCostUsd('anthropic/claude-sonnet-5', { input: 0, output: 1_000_000 })).toBe(15);
    expect(estimateCostUsd('mock-1', { input: 10, output: 10 })).toBeNull();
    expect(estimateCostUsd('gpt-5-mini', { input: null, output: null })).toBeNull();
  });
});
