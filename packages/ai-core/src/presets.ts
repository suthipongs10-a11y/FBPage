/**
 * แคตตาล็อกผู้ให้บริการที่ตั้งค่าได้คลิกเดียว — ข้อมูลล้วน ไม่มี logic (CONTENT_ENGINE_PLAN §12.2)
 *
 * ผู้ให้บริการที่พูดโปรโตคอลเดียวกับ OpenAI (MiniMax, DeepSeek, Groq, Together, LiteLLM, Ollama ฯลฯ)
 * ใช้อะแดปเตอร์ `compatible` ที่มีอยู่แล้วได้ทั้งหมด — เพิ่มเจ้าใหม่คือเพิ่มแถวในตารางนี้ ไม่ใช่เขียนโค้ดใหม่
 *
 * `models` เป็นเพียงรายการที่เสนอให้เลือกใน dropdown ผู้ใช้พิมพ์ชื่อโมเดลอื่นเองได้เสมอ
 * และ `baseUrl` ที่ใส่ไว้เป็นค่าเริ่มต้นที่ผู้ใช้แก้ได้ ไม่ได้บังคับ
 */
import { PROVIDERS, type AiProviderId } from './types';

export interface ProviderPreset {
  id: string;
  label: string;
  kind: AiProviderId;
  /** เติมให้อัตโนมัติตอนสร้าง — null = อะแดปเตอร์รู้ปลายทางเองอยู่แล้ว */
  baseUrl: string | null;
  /** ผู้ใช้ต้องกรอก baseUrl เอง (ระบบไม่มีค่าเริ่มต้นให้) */
  needsBaseUrl: boolean;
  models: string[];
  keyHelp: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: null, needsBaseUrl: false,
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    keyHelp: 'console.anthropic.com → API Keys',
  },
  {
    id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: null, needsBaseUrl: false,
    models: ['gpt-5', 'gpt-5-mini'],
    keyHelp: 'platform.openai.com → API keys',
  },
  {
    id: 'gemini', label: 'Google Gemini', kind: 'gemini', baseUrl: null, needsBaseUrl: false,
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    keyHelp: 'aistudio.google.com → Get API key',
  },
  {
    id: 'openrouter', label: 'OpenRouter', kind: 'openrouter', baseUrl: null, needsBaseUrl: false,
    models: ['anthropic/claude-sonnet-5', 'openai/gpt-5-mini', 'google/gemini-2.5-flash'],
    keyHelp: 'openrouter.ai → Keys (ชื่อโมเดลดูได้ที่ openrouter.ai/models)',
  },
  {
    id: 'deepseek', label: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com/v1', needsBaseUrl: false,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyHelp: 'platform.deepseek.com → API keys',
  },
  {
    id: 'groq', label: 'Groq', kind: 'compatible', baseUrl: 'https://api.groq.com/openai/v1', needsBaseUrl: false,
    models: [],
    keyHelp: 'console.groq.com → API Keys (ชื่อโมเดลดูที่ console.groq.com/docs/models)',
  },
  {
    id: 'minimax', label: 'MiniMax', kind: 'compatible', baseUrl: null, needsBaseUrl: true,
    models: [],
    keyHelp: 'สร้างคีย์ในคอนโซลของ MiniMax แล้วกรอก Base URL ของ endpoint แบบ OpenAI-compatible จากเอกสารของผู้ให้บริการ',
  },
  {
    id: 'custom', label: 'อื่น ๆ (OpenAI-compatible)', kind: 'compatible', baseUrl: null, needsBaseUrl: true,
    models: [],
    keyHelp: 'ใส่ Base URL ของ endpoint แบบ OpenAI เช่น http://litellm:4000/v1 หรือ http://localhost:11434/v1 (Ollama)',
  },
];

export const presetById = (id: string | null | undefined): ProviderPreset | undefined =>
  PROVIDER_PRESETS.find(p => p.id === id);

/** ป้ายชื่อชนิดอะแดปเตอร์ ใช้ตอนแสดงผลคีย์ที่ไม่มี preset ติดมา */
export const kindLabel = (kind: string): string => PROVIDERS[kind as AiProviderId]?.label ?? kind;
