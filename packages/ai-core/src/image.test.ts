import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateImage } from './image';
import { startMockAi } from './mock-ai';

describe('generateImage (mock providers)', () => {
  let mock: Awaited<ReturnType<typeof startMockAi>>;
  beforeAll(async () => { mock = await startMockAi(); });
  afterAll(() => mock.server.close());

  it('OpenAI-style images/generations returns a checked PNG', async () => {
    const r = await generateImage({ provider: 'openai', apiKey: 'MOCK_KEY', model: 'gpt-image-1', baseUrl: mock.url }, { prompt: 'ภาพประกอบช้าง' });
    expect(r.mimeType).toBe('image/png'); expect(r.bytes.byteLength).toBeGreaterThan(20);
    expect(mock.state.imageRequests.at(-1)).toMatchObject({ style: 'openai', model: 'gpt-image-1', prompt: 'ภาพประกอบช้าง' });
  });
  it('Gemini generateContent with IMAGE modality returns inlineData', async () => {
    const r = await generateImage({ provider: 'gemini', apiKey: 'MOCK_KEY', model: 'gemini-2.5-flash-image', baseUrl: mock.url }, { prompt: 'x' });
    expect(r.mimeType).toBe('image/png'); expect(mock.state.imageRequests.at(-1)!.style).toBe('gemini');
  });
  it('clear errors: Claude cannot draw, wrong key, safety refusal, missing model', async () => {
    await expect(generateImage({ provider: 'anthropic', apiKey: 'k', model: 'claude' }, { prompt: 'x' })).rejects.toThrow(/Claude สร้างภาพไม่ได้/);
    await expect(generateImage({ provider: 'openai', apiKey: 'WRONG', model: 'gpt-image-1', baseUrl: mock.url }, { prompt: 'x' })).rejects.toThrow(/401/);
    mock.state.imageFailNext = 1;
    await expect(generateImage({ provider: 'gemini', apiKey: 'MOCK_KEY', model: 'g', baseUrl: mock.url }, { prompt: 'x' })).rejects.toThrow(/IMAGE_SAFETY/);
    await expect(generateImage({ provider: 'openai', apiKey: 'MOCK_KEY', model: '', baseUrl: mock.url }, { prompt: 'x' })).rejects.toThrow(/ชื่อโมเดล/);
  });
});
