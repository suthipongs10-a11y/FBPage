import { z } from 'zod';

const optionalUrl = z.preprocess(v => v === '' ? undefined : v, z.string().url().optional());

/**
 * ตรวจค่าตั้งตั้งแต่ตอนเริ่ม — ผิดต้องล้มทันที ไม่ปล่อยให้พังกลางทาง (AGENTS.md §56 "request validation", §82)
 * ค่าที่เป็นความลับไม่ถูกส่งออกจากที่นี่ในรูปที่ log ได้
 */
export const envSchema = z.object({
  MESSENGER_AUTO_SEND_ENABLED: z.enum(['true', 'false']).default('false'),
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().min(1).default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  DEFAULT_TIMEZONE: z.string().min(1).default('Asia/Bangkok'),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/, 'META_GRAPH_API_VERSION must look like v26.0').default('v26.0'),
  /** override ปลายทาง Graph (ใช้กับ mock ใน test เท่านั้น) */
  META_GRAPH_BASE_URL: optionalUrl,
  /** OAuth — ไม่ใส่ก็ใช้ระบบได้ด้วยการวาง token (Phase 3) */
  META_APP_ID: z.string().trim().optional().transform(v => v || undefined),
  META_APP_SECRET: z.string().trim().optional().transform(v => v || undefined),
  META_OAUTH_REDIRECT_URI: z.string().trim().optional().transform(v => v || undefined),
  META_WEBHOOK_VERIFY_TOKEN: z.string().trim().optional().transform(v => v || undefined),
  /** key ระดับแพลตฟอร์ม (§82) — workspace ที่ไม่มี BYOK จะใช้ตัวนี้ */
  OPENAI_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  ANTHROPIC_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  GOOGLE_AI_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  GOOGLE_AI_MODEL: z.string().trim().optional().transform(v => v || undefined),
  TIKTOK_CLIENT_KEY: z.string().trim().optional().transform(v => v || undefined),
  TIKTOK_CLIENT_SECRET: z.string().trim().optional().transform(v => v || undefined),
  TIKTOK_REDIRECT_URI: optionalUrl,
  TIKTOK_MOCK_BASE_URL: optionalUrl,
  TIKTOK_VERIFIED_MEDIA_PREFIXES: z.string().default(''),
  SOCIAL_PUBLISHING_ENABLED: z.string().optional().transform(v => v === 'true'),
  OPENROUTER_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  LITELLM_BASE_URL: z.string().trim().optional().transform(v => v || undefined),
  LITELLM_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  /** YouTube module (AGENTS_YOUTUBE.md §144) — ไม่ใส่ก็เปิดระบบได้ แต่โมดูล YouTube จะขึ้น "ยังไม่ตั้งค่า" */
  GOOGLE_CLIENT_ID: z.string().trim().optional().transform(v => v || undefined),
  GOOGLE_CLIENT_SECRET: z.string().trim().optional().transform(v => v || undefined),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().trim().optional().transform(v => v || undefined),
  YOUTUBE_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  YOUTUBE_UPLOAD_ENABLED: z.string().optional().transform(v => v === 'true' || v === '1'),
  YOUTUBE_DEFAULT_SYNC_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  YOUTUBE_QUOTA_SOFT_LIMIT: z.coerce.number().int().min(100).default(10000),
  /** override ปลายทาง Google/YouTube สำหรับ mock ใน test */
  YOUTUBE_MOCK_BASE_URL: optionalUrl,
  /** Website Care (AGENTS_WEB.md §7) */
  PAGESPEED_API_KEY: z.string().trim().optional().transform(v => v || undefined),
  WEB_MOCK_BASE_URL: optionalUrl,
  WEB_ALLOW_PRIVATE_TARGETS: z.string().optional().transform(v => v === 'true' || v === '1'),
  /** W-3: เปิดให้โพสต์บทความขึ้น WordPress ของลูกค้าจริง (ค่าเริ่มต้นปิด — เปิดเมื่อพร้อม) · WEB_WP_ALLOW_INSECURE = ยอม http:// (mock/test เท่านั้น) */
  WEB_PUBLISH_ENABLED: z.string().optional().transform(v => v === 'true' || v === '1'),
  WEB_WP_ALLOW_INSECURE: z.string().optional().transform(v => v === 'true' || v === '1'),
  /** W-4: เปิดให้ส่งอีเมลการตลาดจริงผ่าน Brevo/Resend (ค่าเริ่มต้นปิด) · EMAIL_MOCK_BASE_URL = mock ผู้ให้บริการ (test เท่านั้น) */
  EMAIL_SEND_ENABLED: z.string().optional().transform(v => v === 'true' || v === '1'),
  EMAIL_MOCK_BASE_URL: optionalUrl,
  /** อีเมล (§65) — ไม่ตั้ง SMTP_HOST = ปิดอีเมล (ลิงก์เชิญ/รีเซ็ตยังคัดลอกส่งเองได้) */
  SMTP_HOST: z.string().trim().optional().transform(v => v || undefined),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().trim().optional().transform(v => v || undefined),
  SMTP_PASS: z.string().optional().transform(v => v || undefined),
  SMTP_FROM: z.string().trim().optional().transform(v => v || undefined),
  SMTP_SECURE: z.string().optional().transform(v => v === 'true' || v === '1'),
  SMTP_ALLOW_INSECURE: z.string().optional().transform(v => v === 'true' || v === '1'),
  /** Media service (§63): โฟลเดอร์เก็บไฟล์ + Chromium สำหรับเรนเดอร์การ์ดภาพ */
  MEDIA_DIR: z.string().min(1).default('./data/media'),
  CHROME_BIN: z.string().trim().optional().transform(v => v || undefined),
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
