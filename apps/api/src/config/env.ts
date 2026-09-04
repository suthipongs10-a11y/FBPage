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
