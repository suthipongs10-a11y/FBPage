/**
 * ทางเข้ารวมของ AI Gateway (§4, §5) — เลือก adapter ตาม provider, วนลูปเครื่องมือ, ขอผลลัพธ์แบบโครงสร้าง, ประเมินค่าใช้จ่าย (§50)
 */
import { AiProviderError, PROVIDERS, type AIProvider, type AiMessage, type AiProviderId, type AiToolDef, type ChatRequest, type ChatResult, type ProviderConfig, type ToolCall, type Usage } from './types';
import { anthropicProvider } from './providers/anthropic';
import { openAICompatible } from './providers/openai';
import { geminiProvider } from './providers/gemini';

const ADAPTERS: Record<AiProviderId, AIProvider> = {
  anthropic: anthropicProvider, openai: openAICompatible('openai'), gemini: geminiProvider, openrouter: openAICompatible('openrouter'), compatible: openAICompatible('compatible'),
};

export function chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
  if (!cfg.apiKey && cfg.provider !== 'compatible') throw new AiProviderError(`ยังไม่ได้ตั้งค่า API key ของ ${PROVIDERS[cfg.provider]?.label ?? cfg.provider}`, cfg.provider, 401);
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) throw new AiProviderError(`ไม่รู้จักผู้ให้บริการ "${cfg.provider}"`, cfg.provider, 400);
  return adapter.chat(cfg, req);
}

export interface ToolStep { type: 'tool' | 'result'; name: string; args?: Record<string, unknown>; preview?: string }
export interface ToolLoopInput {
  system?: string; messages: AiMessage[]; tools: AiToolDef[];
  exec: (call: ToolCall) => Promise<unknown>;
  onStep?: (s: ToolStep) => void; maxRounds?: number; maxTokens?: number;
}
export interface ToolLoopResult { text: string; messages: AiMessage[]; usage: Usage; model: string; rounds: number; steps: ToolStep[]; stoppedByLimit: boolean }

/** วนลูปเรียกเครื่องมือจนกว่าโมเดลจะตอบข้อความสุดท้าย — exec ที่ throw จะส่งข้อความ error กลับให้โมเดลแทน */
export async function runToolLoop(cfg: ProviderConfig, input: ToolLoopInput): Promise<ToolLoopResult> {
  const history: AiMessage[] = [...input.messages];
  const usage: Usage = { input: 0, output: 0 }; const steps: ToolStep[] = [];
  const maxRounds = input.maxRounds ?? 8; let model = cfg.model ?? '';
  for (let round = 1; round <= maxRounds; round++) {
    const r = await chat(cfg, { system: input.system, messages: history, tools: input.tools, maxTokens: input.maxTokens });
    model = r.model; usage.input = (usage.input ?? 0) + (r.usage.input ?? 0); usage.output = (usage.output ?? 0) + (r.usage.output ?? 0);
    if (!r.toolCalls.length) { history.push({ role: 'assistant', content: r.text }); return { text: r.text, messages: history, usage, model, rounds: round, steps, stoppedByLimit: false }; }
    history.push({ role: 'assistant', content: r.text, toolCalls: r.toolCalls });
    for (const c of r.toolCalls) {
      const s1: ToolStep = { type: 'tool', name: c.name, args: c.args }; steps.push(s1); input.onStep?.(s1);
      let result: unknown;
      try { result = await c.name ? await input.exec(c) : { error: 'missing tool name' }; } catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
      const content = typeof result === 'string' ? result : JSON.stringify(result ?? null);
      const s2: ToolStep = { type: 'result', name: c.name, preview: content.slice(0, 200) }; steps.push(s2); input.onStep?.(s2);
      history.push({ role: 'tool', toolCallId: c.id, name: c.name, content });
    }
  }
  const text = '(หยุดหลังเรียกเครื่องมือครบจำนวนรอบสูงสุด — ลองถามให้แคบลง)';
  history.push({ role: 'assistant', content: text });
  return { text, messages: history, usage, model, rounds: maxRounds, steps, stoppedByLimit: true };
}

/** ดึง JSON จากคำตอบของโมเดล — รองรับ ```json fences และข้อความห่อหุ้ม */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1), text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)];
  for (const c of candidates) { if (!c) continue; try { return JSON.parse(c.trim()); } catch { /* ลองตัวถัดไป */ } }
  throw new Error('โมเดลไม่ได้ตอบเป็น JSON ที่อ่านได้');
}

export interface StructuredInput<T> { system?: string; prompt: string; schemaDescription: string; validate: (v: unknown) => T; maxTokens?: number; retries?: number }
export interface StructuredResult<T> { data: T; usage: Usage; model: string; attempts: number; raw: string }

/** ขอผลลัพธ์แบบโครงสร้าง — ตรวจด้วย validate (เช่น zod) ถ้าไม่ผ่านจะส่ง error กลับให้โมเดลแก้ (สูงสุด retries ครั้ง) */
export async function generateStructured<T>(cfg: ProviderConfig, input: StructuredInput<T>): Promise<StructuredResult<T>> {
  const system = `${input.system ?? ''}\n\nตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่นนอก JSON ตามโครงสร้างนี้:\n${input.schemaDescription}`.trim();
  const messages: AiMessage[] = [{ role: 'user', content: input.prompt }];
  const usage: Usage = { input: 0, output: 0 }; let model = cfg.model ?? ''; let lastErr = '';
  const attempts = 1 + (input.retries ?? 1);
  for (let i = 1; i <= attempts; i++) {
    const r = await chat(cfg, { system, messages, maxTokens: input.maxTokens ?? 8000, jsonMode: true });
    model = r.model; usage.input = (usage.input ?? 0) + (r.usage.input ?? 0); usage.output = (usage.output ?? 0) + (r.usage.output ?? 0);
    try { return { data: input.validate(extractJson(r.text)), usage, model, attempts: i, raw: r.text }; }
    catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      messages.push({ role: 'assistant', content: r.text }, { role: 'user', content: `JSON ไม่ผ่านการตรวจ: ${lastErr.slice(0, 500)}\nส่ง JSON ใหม่ทั้งก้อนให้ถูกต้องตามโครงสร้าง` });
    }
  }
  throw new Error(`ผลลัพธ์จากโมเดลไม่ตรงโครงสร้างหลังลอง ${attempts} ครั้ง: ${lastErr}`);
}

// ---------- ค่าใช้จ่ายโดยประมาณ (USD ต่อ 1M token) — ใช้เปรียบเทียบโมเดล ไม่ใช่ใบแจ้งหนี้ (§50) ----------
const PRICING: [RegExp, number, number][] = [
  [/claude-opus-5|claude-opus-4/, 15, 75], [/claude-sonnet-5|claude-sonnet-4/, 3, 15], [/claude-haiku-4-5|claude-haiku/, 1, 5],
  [/gpt-5-nano/, 0.05, 0.4], [/gpt-5-mini/, 0.25, 2], [/gpt-5/, 1.25, 10], [/gpt-4o-mini/, 0.15, 0.6], [/gpt-4o/, 2.5, 10],
  [/gemini-2\.5-pro/, 1.25, 10], [/gemini-2\.5-flash-lite/, 0.1, 0.4], [/gemini-2\.5-flash|gemini-2\.0-flash/, 0.3, 2.5],
  [/deepseek/, 0.27, 1.1], [/llama|mistral|qwen|gemma/, 0.2, 0.6],
];
export function estimateCostUsd(model: string, usage: Usage): number | null {
  if (usage.input == null && usage.output == null) return null;
  const m = model.toLowerCase().replace(/^[a-z-]+\//, '');
  const p = PRICING.find(([re]) => re.test(m));
  if (!p) return null;
  return ((usage.input ?? 0) * p[1] + (usage.output ?? 0) * p[2]) / 1_000_000;
}
