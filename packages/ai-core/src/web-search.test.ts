import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chat, generateStructured } from './gateway';
import { startMockAi, type MockAiState } from './mock-ai';
import { supportsWebSearch } from './types';

let mock: { url: string; state: MockAiState; server: import('node:http').Server };
beforeAll(async () => { mock = await startMockAi(); });
afterAll(() => { mock.server.close(); });
const cites = [{ url: 'https://a.example/1', title: 'A' }, { url: 'https://b.example/2', title: 'B' }];

describe('AI ค้นเว็บเอง (webSearch)', () => {
  it('รู้ว่าผู้ให้บริการ/โมเดลไหนค้นเว็บได้', () => {
    expect(supportsWebSearch('gemini', 'gemini-2.5-flash')).toBe(true);
    expect(supportsWebSearch('anthropic', 'claude-sonnet-5')).toBe(true);
    expect(supportsWebSearch('openai', 'gpt-5-mini')).toBe(false);
    expect(supportsWebSearch('openai', 'gpt-5-search-api')).toBe(true);
    expect(supportsWebSearch('compatible', 'sonar', 'https://api.perplexity.ai')).toBe(true);
    expect(supportsWebSearch('compatible', 'deepseek-chat', 'https://api.deepseek.com/v1')).toBe(false);
  });

  it('OpenAI/Perplexity: ส่ง web_search_options ไม่ส่ง response_format · อ่าน annotations + citations', async () => {
    mock.state.replies.push({ text: '{"ok":true}', citations: cites });
    const r = await generateStructured({ provider: 'openai', apiKey: 'MOCK_KEY', model: 'gpt-5-search-api', baseUrl: mock.url }, { prompt: 'x', schemaDescription: '{ok}', validate: v => v as { ok: boolean }, webSearch: true });
    expect(r.citations.map(c => c.url)).toEqual(['https://a.example/1', 'https://b.example/2']);
    const req = mock.state.requests.at(-1)!;
    expect(req.extra).toMatchObject({ web_search_options: {} }); expect(req.extra!.response_format).toBeUndefined();
    mock.state.replies.push({ text: 'hi' });
    await chat({ provider: 'openrouter', apiKey: 'MOCK_KEY', model: 'x/y', baseUrl: mock.url }, { messages: [{ role: 'user', content: 'x' }], webSearch: true });
    expect(mock.state.requests.at(-1)!.extra!.plugins).toEqual([{ id: 'web', max_results: 5 }]);
  });

  it('Gemini: tools google_search แทน JSON mode · อ่าน groundingChunks', async () => {
    mock.state.replies.push({ text: '{"ok":true}', citations: cites });
    const r = await generateStructured({ provider: 'gemini', apiKey: 'MOCK_KEY', model: 'gemini-2.5-flash', baseUrl: mock.url }, { prompt: 'x', schemaDescription: '{ok}', validate: v => v, webSearch: true });
    expect(r.citations).toEqual([{ url: 'https://a.example/1', title: 'A' }, { url: 'https://b.example/2', title: 'B' }]);
    const req = mock.state.requests.at(-1)!;
    expect(req.tools).toEqual([{ google_search: {} }]);
    expect((req.extra!.generationConfig as Record<string, unknown>).responseMimeType).toBeUndefined();
  });

  it('Claude: web_search tool · citations จากบล็อกข้อความและผลค้น', async () => {
    mock.state.replies.push({ text: '{"ok":true}', citations: cites });
    const r = await chat({ provider: 'anthropic', apiKey: 'MOCK_KEY', model: 'claude-sonnet-5', baseUrl: `${mock.url}/messages` }, { messages: [{ role: 'user', content: 'x' }], webSearch: true });
    expect(r.text).toBe('{"ok":true}');
    expect(r.citations!.map(c => c.url)).toEqual(['https://a.example/1', 'https://b.example/2']);
    expect(mock.state.requests.at(-1)!.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
  });

  it('ไม่ขอค้นเว็บ = ไม่ส่งเครื่องมือค้นเว็บ', async () => {
    mock.state.replies.push({ text: '{"ok":1}' });
    await generateStructured({ provider: 'gemini', apiKey: 'MOCK_KEY', model: 'gemini-2.5-flash', baseUrl: mock.url }, { prompt: 'x', schemaDescription: '{ok}', validate: v => v });
    const req = mock.state.requests.at(-1)!;
    expect(req.tools).toBeUndefined();
    expect((req.extra!.generationConfig as Record<string, unknown>).responseMimeType).toBe('application/json');
  });
});
