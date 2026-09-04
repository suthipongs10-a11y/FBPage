import { z } from 'zod';

/**
 * ตรวจค่าตั้งตั้งแต่ตอนเริ่ม — ผิดต้องล้มทันที ไม่ปล่อยให้พังกลางทาง (AGENTS.md §56 "request validation", §82)
 * ค่าที่เป็นความลับไม่ถูกส่งออกจากที่นี่ในรูปที่ log ได้
 */
export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().min(1).default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  DEFAULT_TIMEZONE: z.string().min(1).default('Asia/Bangkok'),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/, 'META_GRAPH_API_VERSION must look like v26.0').default('v26.0'),
  /** override ปลายทาง Graph (ใช้กับ mock ใน test เท่านั้น) */
  META_GRAPH_BASE_URL: z.string().url().optional(),
  /** OAuth — ไม่ใส่ก็ใช้ระบบได้ด้วยการวาง token (Phase 3) */
  META_APP_ID: z.string().trim().optional().transform(v => v || undefined),
  META_APP_SECRET: z.string().trim().optional().transform(v => v || undefined),
  META_OAUTH_REDIRECT_URI: z.string().trim().optional().transform(v => v || undefined),
  /** key ระดับแพลตฟอร์ม (§82) — workspace ที่ไม่มี BYOK จะใช้ตัวนี้ */
  OPENAI_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  ANTHROPIC_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  GOOGLE_AI_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  OPENROUTER_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  LITELLM_BASE_URL: z.string().trim().optional().transform(v => v || undefined),
  LITELLM_API_KEY: z.string().trim().optional().transform(v => v || undefined),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = envSchema.safeParse(source);
  if (!r.success) {
    const lines = r.error.issues.map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return r.data;
}

export const ENV = Symbol('ENV');
