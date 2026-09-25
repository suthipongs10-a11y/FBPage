/**
 * lib/ai.mjs — "สมอง" ของแดชบอร์ด: เรียก AI ผู้ให้บริการใดก็ได้ผ่าน HTTP ล้วน (ไม่มี dependency)
 *
 * รองรับ: anthropic | openai | gemini | compatible (OpenAI-compatible เช่น Groq, OpenRouter, Ollama, DeepSeek)
 * ทุกผู้ให้บริการใช้ interface เดียวกัน:  chat({ system, messages, tools }) → { text, toolCalls, usage }
 *
 * รูปแบบกลางที่ใช้ภายใน (ไม่ผูกกับเจ้าไหน):
 *   messages: [{ role:'user'|'assistant', content:string, toolCalls?:[{id,name,args}] },
 *              { role:'tool', toolCallId, name, content:string }]
 *   tools:    [{ name, description, parameters:<JSON Schema> }]
 */

const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-opus-5', url: 'https://api.anthropic.com/v1/messages' },
  openai:    { label: 'OpenAI', defaultModel: 'gpt-5', url: 'https://api.openai.com/v1/chat/completions' },
  gemini:    { label: 'Google Gemini', defaultModel: 'gemini-2.5-pro', url: 'https://generativelanguage.googleapis.com/v1beta/models' },
  compatible:{ label: 'OpenAI-compatible (Groq / OpenRouter / Ollama / DeepSeek ฯลฯ)', defaultModel: '', url: '' },
};
export const providerList = () => Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel }));

const ERR = (provider, res, body) => {
  const msg = body?.error?.message || body?.error || body?.message || JSON.stringify(body).slice(0, 200);
  const e = new Error(`${provider} ตอบ HTTP ${res.status}: ${msg}`);
  e.status = res.status;
  return e;
};

async function post(url, headers, payload, provider) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  } catch (e) {
    throw new Error(`ต่อ ${provider} ไม่ได้: ${e.cause?.message || e.message}`);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 200) }; }
  if (!res.ok) throw ERR(provider, res, body);
  return body;
}

// ---------- Anthropic Messages API ----------
// รุ่น 4.6 ขึ้นไปใช้ adaptive thinking; รุ่นเก่ากว่านั้นไม่ส่งพารามิเตอร์ thinking
const adaptiveOK = m => /(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|fable|mythos)/.test(m);

function toAnthropic(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      out.push({ role: 'assistant', content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

async function chatAnthropic(cfg, { system, messages, tools }) {
  const model = cfg.model || PROVIDERS.anthropic.defaultModel;
  const payload = {
    model, max_tokens: 8000, system,
    messages: toAnthropic(messages),
    ...(adaptiveOK(model) && { thinking: { type: 'adaptive' } }),
    ...(tools?.length && { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) }),
  };
  const body = await post(cfg.baseUrl || PROVIDERS.anthropic.url,
    { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }, payload, 'Anthropic');
  if (body.stop_reason === 'refusal') throw new Error('โมเดลปฏิเสธคำขอนี้ (refusal)');
  const text = body.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const toolCalls = body.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input }));
  return { text, toolCalls, usage: { input: body.usage?.input_tokens, output: body.usage?.output_tokens }, model };
}

// ---------- OpenAI Chat Completions (และ compatible) ----------
function toOpenAI(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant', content: m.content || null,
        tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function chatOpenAI(cfg, { system, messages, tools }, provider = 'OpenAI') {
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  const url = provider === 'OpenAI' ? (base ? `${base}/chat/completions` : PROVIDERS.openai.url) : `${base}/chat/completions`;
  if (provider !== 'OpenAI' && !base) throw new Error('ผู้ให้บริการแบบ compatible ต้องระบุ Base URL (เช่น https://api.groq.com/openai/v1)');
  const payload = {
    model: cfg.model || PROVIDERS.openai.defaultModel,
    messages: toOpenAI(system, messages),
    ...(tools?.length && { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }),
  };
  const body = await post(url, { authorization: `Bearer ${cfg.apiKey}` }, payload, provider);
  const msg = body.choices?.[0]?.message || {};
  const toolCalls = (msg.tool_calls || []).map(c => {
    let args = {};
    try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* ปล่อยว่าง */ }
    return { id: c.id, name: c.function.name, args };
  });
  return { text: msg.content || '', toolCalls, usage: { input: body.usage?.prompt_tokens, output: body.usage?.completion_tokens }, model: payload.model };
}

// ---------- Google Gemini ----------
function toGemini(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      let response;
      try { response = JSON.parse(m.content); } catch { response = { result: m.content }; }
      const part = { functionResponse: { name: m.name, response } };
      const last = out[out.length - 1];
      if (last?.role === 'user' && last.parts[0]?.functionResponse) last.parts.push(part);
      else out.push({ role: 'user', parts: [part] });
    } else if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls || []) parts.push({ functionCall: { name: c.name, args: c.args } });
      out.push({ role: 'model', parts });
    } else out.push({ role: 'user', parts: [{ text: m.content }] });
  }
  return out;
}

async function chatGemini(cfg, { system, messages, tools }) {
  const model = cfg.model || PROVIDERS.gemini.defaultModel;
  const url = `${(cfg.baseUrl || PROVIDERS.gemini.url).replace(/\/+$/, '')}/${model}:generateContent`;
  const payload = {
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
    contents: toGemini(messages),
    ...(tools?.length && { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }] }),
  };
  const body = await post(url, { 'x-goog-api-key': cfg.apiKey }, payload, 'Gemini');
  const parts = body.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text).map(p => p.text).join('\n');
  const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({ id: `gem_${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
  return { text, toolCalls, usage: { input: body.usageMetadata?.promptTokenCount, output: body.usageMetadata?.candidatesTokenCount }, model };
}

// ---------- ทางเข้ารวม ----------
export async function chat(cfg, req) {
  if (!cfg?.apiKey) throw new Error('ยังไม่ได้ตั้งค่า API key ของ AI — ไปที่หน้าตั้งค่า');
  switch (cfg.provider) {
    case 'anthropic': return chatAnthropic(cfg, req);
    case 'openai': return chatOpenAI(cfg, req, 'OpenAI');
    case 'compatible': return chatOpenAI(cfg, req, 'AI (compatible)');
    case 'gemini': return chatGemini(cfg, req);
    default: throw new Error(`ไม่รู้จักผู้ให้บริการ "${cfg.provider}"`);
  }
}

/**
 * วนลูปเรียกเครื่องมือจนกว่า AI จะตอบเป็นข้อความสุดท้าย
 * exec(name, args) → ผลลัพธ์ (object/string) — ถ้า throw จะส่งข้อความ error กลับให้ AI แทน
 * onStep(event) รับเหตุการณ์ระหว่างทางเพื่อโชว์ในหน้าเว็บ
 */
export async function runAgent(cfg, { system, messages, tools, exec, onStep, maxRounds = 8 }) {
  const history = [...messages];
  let usage = { input: 0, output: 0 };
  for (let round = 0; round < maxRounds; round++) {
    const r = await chat(cfg, { system, messages: history, tools });
    usage.input += r.usage.input || 0; usage.output += r.usage.output || 0;
    if (!r.toolCalls.length) {
      history.push({ role: 'assistant', content: r.text });
      return { text: r.text, messages: history, usage, model: r.model };
    }
    history.push({ role: 'assistant', content: r.text, toolCalls: r.toolCalls });
    for (const c of r.toolCalls) {
      onStep?.({ type: 'tool', name: c.name, args: c.args });
      let result;
      try { result = await exec(c.name, c.args); }
      catch (e) { result = { error: e.message }; }
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      onStep?.({ type: 'result', name: c.name, preview: content.slice(0, 200) });
      history.push({ role: 'tool', toolCallId: c.id, name: c.name, content });
    }
  }
  return { text: '(หยุดหลังเรียกเครื่องมือครบจำนวนรอบสูงสุด)', messages: history, usage };
}
