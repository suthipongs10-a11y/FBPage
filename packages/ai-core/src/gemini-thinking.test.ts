import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateStructured } from './gateway';

/** Gemini 2.5 นับโทเค็นที่ใช้คิดรวมใน maxOutputTokens — ต้องเผื่อและจำกัดงบคิด ไม่งั้นงาน JSON สั้น ๆ ได้คำตอบว่าง */
describe('gemini thinking budget', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('adds thinking headroom + caps thinkingBudget for 2.5 models, and counts thought tokens in usage', async () => {
    const seen: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { seen.push(JSON.parse(String(init.body))); return reply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 300 } }); }));
    const r = await generateStructured({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-pro' }, { prompt: 'x', schemaDescription: '{ok:boolean}', validate: v => v as { ok: boolean }, maxTokens: 1500 });
    expect(r.data).toEqual({ ok: true });
    expect(seen[0]!.generationConfig).toMatchObject({ maxOutputTokens: 1500 + 2048, thinkingConfig: { thinkingBudget: 2048 }, responseMimeType: 'application/json' });
    expect(r.usage.output).toBe(305);
  });

  it('an empty answer cut off by MAX_TOKENS is reported as such, not as "invalid JSON"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] })));
    await expect(generateStructured({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-pro' }, { prompt: 'x', schemaDescription: '{}', validate: v => v })).rejects.toThrow(/โควตาคำตอบหมด/);
  });

  it('non-thinking models get no thinkingConfig', async () => {
    const seen: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { seen.push(JSON.parse(String(init.body))); return reply({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }); }));
    await generateStructured({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.0-flash' }, { prompt: 'x', schemaDescription: '{}', validate: v => v, maxTokens: 100 });
    expect(seen[0]!.generationConfig.thinkingConfig).toBeUndefined(); expect(seen[0]!.generationConfig.maxOutputTokens).toBe(100);
  });
});
