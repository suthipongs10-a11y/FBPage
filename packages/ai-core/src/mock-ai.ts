/**
 * Mock ผู้ให้บริการ AI แบบ OpenAI-compatible สำหรับ test (§77) — ใช้กับ provider 'compatible' + baseUrl
 * script: ตอบตามลำดับที่ตั้งไว้; ถ้าไม่ตั้ง จะสะท้อนข้อความล่าสุดกลับ
 */
import { createServer, type Server } from 'node:http';

export interface MockAiReply { text?: string; toolCalls?: { name: string; args: Record<string, unknown> }[]; status?: number; citations?: { url: string; title?: string }[] }
export interface MockAiState { replies: MockAiReply[]; requests: { model: string; messages: unknown[]; tools?: unknown[]; auth?: string; style?: 'openai' | 'gemini' | 'anthropic'; extra?: Record<string, unknown> }[]; failNext: number; imageRequests: { style: 'openai' | 'gemini'; model: string; prompt: string }[]; imageFailNext: number }
/** PNG 1×1 — ภาพจำลองที่ endpoint สร้างภาพส่งกลับ */
export const MOCK_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export async function startMockAi(): Promise<{ server: Server; url: string; state: MockAiState }> {
  const state: MockAiState = { replies: [], requests: [], failNext: 0, imageRequests: [], imageFailNext: 0 };
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    // ---- สร้างภาพ: แบบ OpenAI (/images/generations) และแบบ Gemini (/<model>:generateContent) ----
    if (req.url?.endsWith('/images/generations')) {
      if (req.headers.authorization !== 'Bearer MOCK_KEY') return json(401, { error: { message: 'Incorrect API key provided' } });
      const p = JSON.parse(body) as { model: string; prompt: string };
      state.imageRequests.push({ style: 'openai', model: p.model, prompt: p.prompt });
      if (state.imageFailNext > 0) { state.imageFailNext--; return json(400, { error: { message: 'Your request was rejected by the safety system' } }); }
      return json(200, { created: 1, data: [{ b64_json: MOCK_PNG_BASE64 }] });
    }
    const gm = /\/([^/]+):generateContent$/.exec(req.url ?? '');
    // ---- Gemini แบบข้อความ (ไม่ขอภาพ) — ค้นเว็บด้วย tools: [{ google_search: {} }] ได้ groundingMetadata กลับ ----
    if (gm && !(JSON.parse(body) as { generationConfig?: { responseModalities?: string[] } }).generationConfig?.responseModalities) {
      if (req.headers['x-goog-api-key'] !== 'MOCK_KEY') return json(403, { error: { message: 'API key not valid' } });
      const p = JSON.parse(body) as { contents: { parts: { text?: string }[] }[]; tools?: unknown[]; generationConfig?: Record<string, unknown> };
      state.requests.push({ model: decodeURIComponent(gm[1]!), messages: p.contents, tools: p.tools, style: 'gemini', extra: { generationConfig: p.generationConfig } });
      const reply = state.replies.shift();
      if (reply?.status) return json(reply.status, { error: { message: `mock error ${reply.status}` } });
      return json(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: reply?.text ?? 'ok' }] }, ...(reply?.citations && { groundingMetadata: { groundingChunks: reply.citations.map(c => ({ web: { uri: c.url, title: c.title ?? '' } })) } }) }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30 } });
    }
    // ---- Anthropic Messages — web_search tool ได้ citations ในบล็อกข้อความ ----
    if (req.url?.endsWith('/messages')) {
      if (req.headers['x-api-key'] !== 'MOCK_KEY') return json(401, { error: { message: 'invalid x-api-key' } });
      const p = JSON.parse(body) as { model: string; messages: unknown[]; tools?: unknown[] };
      state.requests.push({ model: p.model, messages: p.messages, tools: p.tools, style: 'anthropic' });
      const reply = state.replies.shift();
      if (reply?.status) return json(reply.status, { error: { message: `mock error ${reply.status}` } });
      const content = [
        ...(reply?.citations ? [{ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'q' } }, { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: reply.citations.map(c => ({ type: 'web_search_result', url: c.url, title: c.title ?? '' })) }] : []),
        { type: 'text', text: reply?.text ?? 'ok', ...(reply?.citations && { citations: [{ type: 'web_search_result_location', url: reply.citations[0]!.url, title: reply.citations[0]!.title ?? '', cited_text: '…' }] }) },
      ];
      return json(200, { id: 'msg_mock', model: p.model, content, stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 30 } });
    }
    if (gm) {
      if (req.headers['x-goog-api-key'] !== 'MOCK_KEY') return json(403, { error: { message: 'API key not valid' } });
      const p = JSON.parse(body) as { contents: { parts: { text: string }[] }[] };
      state.imageRequests.push({ style: 'gemini', model: decodeURIComponent(gm[1]!), prompt: p.contents[0]?.parts[0]?.text ?? '' });
      if (state.imageFailNext > 0) { state.imageFailNext--; return json(200, { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }); }
      return json(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: MOCK_PNG_BASE64 } }] } }] });
    }
    if (!req.url?.endsWith('/chat/completions')) return json(404, { error: { message: 'not found' } });
    if (req.headers.authorization !== 'Bearer MOCK_KEY') return json(401, { error: { message: 'Incorrect API key provided' } });
    const payload = JSON.parse(body) as { model: string; messages: { role: string; content?: string }[]; tools?: unknown[]; response_format?: unknown; web_search_options?: unknown; plugins?: unknown };
    state.requests.push({ model: payload.model, messages: payload.messages, tools: payload.tools, auth: req.headers.authorization, style: 'openai', extra: { response_format: payload.response_format, web_search_options: payload.web_search_options, plugins: payload.plugins } });
    if (state.failNext > 0) { state.failNext--; return json(503, { error: { message: 'temporarily overloaded' } }); }
    const reply = state.replies.shift();
    if (reply?.status) return json(reply.status, { error: { message: `mock error ${reply.status}` } });
    const lastUser = [...payload.messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const message = reply?.toolCalls?.length
      ? { role: 'assistant', content: reply.text ?? null, tool_calls: reply.toolCalls.map((c, i) => ({ id: `call_${state.requests.length}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
      : { role: 'assistant', content: reply?.text ?? `echo: ${lastUser}`, ...(reply?.citations && { annotations: reply.citations.slice(0, 1).map(c => ({ type: 'url_citation', url_citation: { url: c.url, title: c.title ?? '' } })) }) };
    // แบบ Perplexity: citations (URL ล้วน) + search_results
    json(200, { id: 'chatcmpl-mock', model: payload.model, choices: [{ index: 0, message, finish_reason: reply?.toolCalls?.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 40 }, ...(reply?.citations && { citations: reply.citations.map(c => c.url), search_results: reply.citations.map(c => ({ url: c.url, title: c.title ?? '' })) }) });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${addr.port}/v1`, state };
}
