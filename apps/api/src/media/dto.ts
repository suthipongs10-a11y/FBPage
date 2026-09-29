import { z } from 'zod';
import { CARD_TEMPLATES, THEME_NAMES } from './card-templates';
import { modelOverrideSchema } from '../ai/dto';
const s = (max: number) => z.string().trim().max(max).optional();
export const cardDataSchema = z.object({
  theme: z.enum(THEME_NAMES as [string, ...string[]]).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kicker: s(60), footer: s(120), brand: s(60), big: s(12), bigUnit: s(12), quote: s(200), sub: s(220), title: s(120), lead: s(200), punch: s(60), stat: s(120), svg: z.string().max(20000).optional(),
  rows: z.array(z.object({ label: z.string().max(60), note: s(60), old: z.union([z.string().max(20), z.number(), z.null()]).optional(), new: z.union([z.string().max(20), z.number()]), unit: s(20) })).max(6).optional(),
  items: z.array(z.object({ title: z.string().max(80), text: s(160) })).max(7).optional(),
  /** ภาพประกอบในการ์ด (เทมเพลต news) — data URL เท่านั้น ห้ามเป็น path/URL เพื่อไม่ให้เรนเดอร์อ่านไฟล์หรือยิงเน็ตเอง */
  photoLabel: s(80),
  photo: z.string().max(22_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
});
export const renderCardSchema = z.object({ template: z.enum(CARD_TEMPLATES), data: cardDataSchema, attach: z.boolean().default(true) });
export type RenderCardDto = z.infer<typeof renderCardSchema>;
export const aiCardSchema = z.object({ hint: z.string().trim().max(500).optional(), template: z.enum(CARD_TEMPLATES).optional(), theme: z.enum(THEME_NAMES as [string, ...string[]]).optional() }).optional();
export type AiCardDto = z.infer<typeof aiCardSchema>;

export const aiImageSchema = z.object({
  contentId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(3).max(1500),
  attach: z.boolean().default(true),
  modelOverride: modelOverrideSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});
export type AiImageDto = z.infer<typeof aiImageSchema>;
export const aiMediaConfigSchema = z.object({
  connectionId: z.string().trim().min(1).nullable().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  unitCostUsd: z.number().min(0).max(100).nullable().optional(),
  monthlyImageLimit: z.number().int().min(0).max(100_000).nullable().optional(),
});
export type AiMediaConfigDto = z.infer<typeof aiMediaConfigSchema>;
export const attachVideoSchema = z.object({ assetId: z.string().trim().min(1).max(40) }).strict();
