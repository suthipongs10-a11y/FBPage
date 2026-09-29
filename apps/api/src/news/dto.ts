import { PROMPT_IMAGES, PROMPT_KINDS, PROMPT_LENGTHS } from './chatgpt-prompt';
import { z } from 'zod';
import { THEME_NAMES } from '../media/card-templates';
import { modelOverrideSchema } from '../ai/dto';

export const NEWS_STATUSES = ['NEW', 'SHORTLISTED', 'DRAFTED', 'DISMISSED'] as const;

export const EXTERNAL_PROVIDERS = ['tavily', 'pexels'] as const;
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number];
export const IMAGE_SOURCES = ['none', 'stock', 'ai'] as const;
export const searchProviderSchema = z.object({ provider: z.enum(EXTERNAL_PROVIDERS).default('tavily'), apiKey: z.string().trim().min(8).max(300) });
export const providerQuerySchema = z.object({ provider: z.enum(EXTERNAL_PROVIDERS).default('tavily') });
export type SearchProviderDto = z.infer<typeof searchProviderSchema>;

export const createSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('RSS'), label: z.string().trim().min(1).max(80), url: z.string().trim().url().max(1000) }),
  z.object({ kind: z.literal('SEARCH'), label: z.string().trim().min(1).max(80), query: z.string().trim().min(2).max(200) }),
]);
export type CreateSourceDto = z.infer<typeof createSourceSchema>;
export const updateSourceSchema = z.object({ label: z.string().trim().min(1).max(80).optional(), url: z.string().trim().url().max(1000).optional(), query: z.string().trim().min(2).max(200).optional(), enabled: z.boolean().optional() });
export type UpdateSourceDto = z.infer<typeof updateSourceSchema>;

export const listItemsSchema = z.object({ brandId: z.string().trim().min(1), status: z.enum(NEWS_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(200).default(60) });
export type ListItemsDto = z.infer<typeof listItemsSchema>;
export const updateItemSchema = z.object({ status: z.enum(['NEW', 'SHORTLISTED', 'DISMISSED']) });

export const shortlistSchema = z.object({ max: z.number().int().min(1).max(15).default(5), modelOverride: modelOverrideSchema.optional() }).default({ max: 5 });
export type ShortlistDto = z.infer<typeof shortlistSchema>;

export const draftSchema = z.object({
  pageId: z.string().trim().min(1),
  theme: z.enum(THEME_NAMES as [string, ...string[]]).default('dark'),
  /** คำแนะนำเพิ่มเติมให้คนเขียน เช่น "เน้นมุมคนไทยในต่างแดน" */
  hint: z.string().trim().max(500).optional(),
  modelOverride: modelOverrideSchema.optional(),
  /** ใส่ภาพประกอบจาก AI ลงการ์ด (ใช้โมเดลภาพที่ตั้งไว้ หรือ imageOverride) */
  aiImage: z.boolean().default(false),
  /** แหล่งภาพประกอบ: none | stock (ภาพถ่ายจริงจากคลังภาพฟรี) | ai — ไม่ระบุ = ตาม aiImage (แบบเดิม) */
  imageSource: z.enum(IMAGE_SOURCES).optional(),
  imageOverride: modelOverrideSchema.optional(),
});
export type DraftDto = z.infer<typeof draftSchema>;

export const automationSchema = z.object({
  enabled: z.boolean(),
  pageId: z.string().trim().min(1),
  fetchEveryHours: z.number().int().min(1).max(24).default(3),
  draftsPerDay: z.number().int().min(0).max(20).default(3),
  minScore: z.number().int().min(0).max(100).default(60),
  skipHighRisk: z.boolean().default(true),
  imageSource: z.enum(IMAGE_SOURCES).default('none'),
  theme: z.enum(THEME_NAMES as [string, ...string[]]).default('dark'),
  postingSlots: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'รูปแบบเวลา HH:MM')).max(8).default(['09:00', '12:30', '19:00']),
});
export type AutomationDto = z.infer<typeof automationSchema>;
export const nextSlotSchema = z.object({ pageId: z.string().trim().min(1) });
export const suggestSourcesSchema = z.object({ count: z.number().int().min(1).max(10).default(5), focus: z.string().trim().max(200).optional(), modelOverride: modelOverrideSchema.optional() }).default({ count: 5 });
export type SuggestSourcesDto = z.infer<typeof suggestSourcesSchema>;

// ---- นำเข้าแพ็กเกจคอนเทนต์จาก AI ภายนอก (fbpm-content-v1) ----
const themeEnum = z.enum(THEME_NAMES as [string, ...string[]]);
/** ชื่อไฟล์รูปในแพ็กเกจ → id ของไฟล์ที่อัปโหลดไว้ (POST news/import/files) */
const filesMap = z.record(z.string().trim().min(1).max(300), z.string().trim().min(1).max(40)).refine(m => Object.keys(m).length <= 60, 'ไฟล์แนบเกิน 60 ไฟล์');
/** รูปรายหัวข้อ: ลำดับโพสต์ (0,1,2…) → id ไฟล์ที่อัปโหลด — แทนรูปในแพ็กเกจของโพสต์นั้น */
const postImagesMap = z.record(z.string().regex(/^\d{1,2}$/), z.string().trim().min(1).max(40)).refine(m => Object.keys(m).length <= 20, 'รูปรายหัวข้อเกิน 20 รายการ');
export const importCheckSchema = z.object({ text: z.string().min(2).max(1_500_000), pageId: z.string().trim().min(1).optional(), files: filesMap.optional(), postImages: postImagesMap.optional() });
export type ImportCheckDto = z.infer<typeof importCheckSchema>;
/** cardMode: auto = การ์ดพาดหัว + รูป (เดิม) · photo = มีรูปแล้วโพสต์รูปนั้นเลย ไม่ทำการ์ด (รูปจาก ChatGPT ที่ออกแบบมาแล้ว) */
export const importSchema = importCheckSchema.extend({ theme: themeEnum.optional(), imageFallback: z.enum(IMAGE_SOURCES).optional(), draft: z.boolean().default(true), fileName: z.string().trim().max(200).optional(), cardMode: z.enum(['auto', 'photo']).optional(), include: z.array(z.number().int().min(0).max(19)).min(1).max(20).optional() });
export type ImportDto = z.infer<typeof importSchema>;
export const uploadQuerySchema = z.object({ name: z.string().trim().min(1).max(300) });
export const inboxSchema = z.object({
  pageId: z.string().trim().min(1).nullable().optional(),
  theme: themeEnum.optional(),
  imageFallback: z.enum(IMAGE_SOURCES).optional(),
  autoDraft: z.boolean().optional(),
  driveEnabled: z.boolean().optional(),
  /** ลิงก์โฟลเดอร์ Google Drive หรือรหัสโฟลเดอร์ · null = เลิกใช้ */
  driveFolder: z.string().trim().max(500).nullable().optional(),
  /** ไฟล์คีย์ JSON ของ service account (ส่งเฉพาะตอนตั้ง/เปลี่ยน — ไม่แสดงกลับ) · null = ลบ */
  driveCredentials: z.string().trim().min(20).max(12000).nullable().optional(),
});
export type InboxDto = z.infer<typeof inboxSchema>;

// ---- โต๊ะค้นคว้า ----
export const RESEARCH_MODES = ['web', 'ai', 'urls', 'text'] as const;
export const WRITE_STYLES = ['news', 'listicle', 'story', 'qa'] as const;
export const researchSchema = z.object({
  mode: z.enum(RESEARCH_MODES),
  /** หัวข้อ/คำถาม (web, ai) */
  query: z.string().trim().min(2).max(300).optional(),
  urls: z.array(z.string().trim().url().max(1000)).min(1).max(8).optional(),
  text: z.string().trim().min(50).max(30000).optional(),
  /** news = ข่าวล่าสุด 7 วัน · any = ความรู้ทั่วไปไม่จำกัดวันที่ */
  recency: z.enum(['news', 'any']).default('news'),
  maxSources: z.number().int().min(2).max(10).default(6),
  /** ให้ AI (บทบาท fast) แตกคำค้นเพิ่มเป็นไทย/อังกฤษ */
  expand: z.boolean().default(true),
  focus: z.string().trim().max(300).optional(),
  modelOverride: modelOverrideSchema.optional(),
}).superRefine((v, ctx) => {
  if ((v.mode === 'web' || v.mode === 'ai') && !v.query) ctx.addIssue({ code: 'custom', path: ['query'], message: 'ใส่หัวข้อที่จะค้นคว้า' });
  if (v.mode === 'urls' && !v.urls?.length) ctx.addIssue({ code: 'custom', path: ['urls'], message: 'ใส่ลิงก์อย่างน้อย 1 ลิงก์' });
  if (v.mode === 'text' && !v.text) ctx.addIssue({ code: 'custom', path: ['text'], message: 'วางข้อความอย่างน้อย 50 ตัวอักษร' });
});
export type ResearchDto = z.infer<typeof researchSchema>;
export const researchWriteSchema = z.object({
  count: z.number().int().min(1).max(5).default(1),
  style: z.enum(WRITE_STYLES).default('news'),
  /** มุมที่เลือกจาก brief.angles หรือพิมพ์เอง */
  angle: z.string().trim().max(300).optional(),
  pageId: z.string().trim().min(1).optional(),
  hint: z.string().trim().max(500).optional(),
  /** ให้ AI อีกตัวตรวจข้อเท็จจริงเทียบกับแหล่ง — ข้อความที่ไม่มีหลักฐานจะถูกติด [ต้องยืนยัน] */
  factCheck: z.boolean().default(true),
  theme: themeEnum.optional(),
  imageFallback: z.enum(IMAGE_SOURCES).optional(),
  modelOverride: modelOverrideSchema.optional(),
  checkOverride: modelOverrideSchema.optional(),
});
export type ResearchWriteDto = z.infer<typeof researchWriteSchema>;

// ---- ผู้ช่วยหาเรื่องโพสต์ต่อเพจ ----
export const scoutCheckSchema = z.object({ modelOverride: modelOverrideSchema.optional() }).default({});
export type ScoutCheckDto = z.infer<typeof scoutCheckSchema>;
export const scoutIdeasSchema = z.object({
  /** ai = AI ค้นเว็บเอง · web = ค้น Tavily ตามคำค้นของโปรไฟล์เพจ */
  mode: z.enum(['ai', 'web']).default('ai'),
  count: z.number().int().min(3).max(12).default(6),
  /** คำค้นที่ผู้ใช้อยากให้ค้นจริง (คั่นด้วย , หรือขึ้นบรรทัดใหม่ ≤ 5 คำ) — ใช้ก่อนคำค้นของโปรไฟล์เพจ */
  keywords: z.string().trim().max(400).optional(),
  focus: z.string().trim().max(300).optional(),
  modelOverride: modelOverrideSchema.optional(),
});
export type ScoutIdeasDto = z.infer<typeof scoutIdeasSchema>;
export const scoutResearchSchema = z.object({ modelOverride: modelOverrideSchema.optional(), searchOverride: modelOverrideSchema.optional() }).default({});
export type ScoutResearchDto = z.infer<typeof scoutResearchSchema>;
/** ไอเดีย → ค้นคว้า → เขียนโพสต์ → ร่างรออนุมัติ ในคลิกเดียว */
export const scoutWriteSchema = z.object({
  count: z.number().int().min(1).max(3).default(1),
  style: z.enum(WRITE_STYLES).optional(),
  factCheck: z.boolean().default(true),
  imageFallback: z.enum(IMAGE_SOURCES).optional(),
  modelOverride: modelOverrideSchema.optional(),
  searchOverride: modelOverrideSchema.optional(),
  writerOverride: modelOverrideSchema.optional(),
}).default({ count: 1, factCheck: true });
export type ScoutWriteDto = z.infer<typeof scoutWriteSchema>;

/** ตัวสร้างคำสั่งสำหรับ ChatGPT — docs/CONTENT_IMPORT.md "สร้างคำสั่งให้ ChatGPT" */
export const chatPromptSchema = z.object({
  pageId: z.string().trim().min(1).optional(),
  count: z.number().int().min(1).max(20),
  topic: z.string().trim().max(1000).optional(),
  kind: z.enum(PROMPT_KINDS).default('original'),
  length: z.enum(PROMPT_LENGTHS).default('medium'),
  emoji: z.boolean().default(true),
  images: z.enum(PROMPT_IMAGES).default('chatgpt'),
  recencyDays: z.number().int().min(1).max(365).optional(),
  extra: z.string().trim().max(1000).optional(),
}).strict();
export type ChatPromptDto = z.infer<typeof chatPromptSchema>;
