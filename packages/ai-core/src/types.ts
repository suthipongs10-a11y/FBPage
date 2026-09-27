/**
 * รูปแบบกลางของ AI Gateway (AGENTS.md §4) — แอปพึ่ง interface นี้เท่านั้น ห้ามพึ่ง SDK ของผู้ให้บริการตรงๆ
 * พอร์ตจาก lib/ai.mjs ที่ใช้งานจริงกับแดชบอร์ดเดิม (ADR-001)
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'openrouter', 'compatible'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export interface ProviderMeta { id: AiProviderId; label: string; defaultModel: string; baseUrl: string; needsBaseUrl: boolean; keyHelp: string }
export const PROVIDERS: Record<AiProviderId, ProviderMeta> = {
  anthropic:  { id: 'anthropic', label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-5', baseUrl: 'https://api.anthropic.com/v1/messages', needsBaseUrl: false, keyHelp: 'console.anthropic.com → API Keys' },
  openai:     { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-5-mini', baseUrl: 'https://api.openai.com/v1', needsBaseUrl: false, keyHelp: 'platform.openai.com → API keys' },
  gemini:     { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', needsBaseUrl: false, keyHelp: 'aistudio.google.com → Get API key' },
  openrouter: { id: 'openrouter', label: 'OpenRouter', defaultModel: 'anthropic/claude-sonnet-5', baseUrl: 'https://openrouter.ai/api/v1', needsBaseUrl: false, keyHelp: 'openrouter.ai → Keys' },
  compatible: { id: 'compatible', label: 'OpenAI-compatible (LiteLLM / Groq / Ollama / DeepSeek ฯลฯ)', defaultModel: '', baseUrl: '', needsBaseUrl: true, keyHelp: 'ต้องระบุ Base URL เช่น http://litellm:4000/v1' },
};

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export type AiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface AiToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ProviderConfig { provider: AiProviderId; apiKey: string; model?: string; baseUrl?: string; timeoutMs?: number }
/** ให้โมเดลค้นเว็บเองแล้วตอบพร้อมแหล่งอ้างอิง — Gemini (Google Search), Claude (web search tool), OpenAI (รุ่น *-search-*), OpenRouter (web plugin), Perplexity (ค้นเสมอ) */
export interface ChatRequest { system?: string; messages: AiMessage[]; tools?: AiToolDef[]; maxTokens?: number; temperature?: number; jsonMode?: boolean; webSearch?: boolean }
export interface Citation { url: string; title: string | null }
export interface Usage { input: number | null; output: number | null }
export interface ChatResult { text: string; toolCalls: ToolCall[]; usage: Usage; model: string; provider: AiProviderId; citations?: Citation[] }

/** ผู้ให้บริการ/โมเดลนี้ค้นเว็บเองได้ไหม (ใช้บอกผู้ใช้ก่อนยิงจริง) */
export function supportsWebSearch(provider: AiProviderId, model: string, baseUrl?: string | null): boolean {
  if (provider === 'gemini' || provider === 'anthropic' || provider === 'openrouter') return true;
  if (provider === 'openai') return /search/i.test(model);
  return /perplexity\.ai/i.test(baseUrl ?? '') || /^sonar/i.test(model);
}
/** รวมแหล่งอ้างอิง ตัดซ้ำตาม URL คงลำดับเดิม */
export function mergeCitations(...lists: (Citation[] | undefined)[]): Citation[] {
  const seen = new Set<string>(); const out: Citation[] = [];
  for (const l of lists) for (const c of l ?? []) { if (!c.url || seen.has(c.url)) continue; seen.add(c.url); out.push(c); }
  return out;
}

export interface AIProvider { chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResult> }

export class AiProviderError extends Error {
  constructor(message: string, public readonly provider: AiProviderId, public readonly status: number | null = null) { super(message); this.name = 'AiProviderError'; }
  get isAuthError(): boolean { return this.status === 401 || this.status === 403; }
  get isRateLimited(): boolean { return this.status === 429; }
  get isRetryable(): boolean { return this.status === null || this.status === 429 || (this.status >= 500 && this.status < 600); }
  /** ข้อความสำหรับผู้ใช้ (§59) */
  get userMessage(): string {
    if (this.isAuthError) return `API key ของ ${PROVIDERS[this.provider].label} ใช้ไม่ได้หรือไม่มีสิทธิ์ — ตรวจที่หน้า "โมเดล AI"`;
    if (this.isRateLimited) return `${PROVIDERS[this.provider].label} จำกัดจำนวนคำขอชั่วคราว ลองใหม่ภายหลัง`;
    if (this.status === null) return `ติดต่อ ${PROVIDERS[this.provider].label} ไม่ได้ — ตรวจเครือข่าย/Base URL`;
    return this.message;
  }
}
