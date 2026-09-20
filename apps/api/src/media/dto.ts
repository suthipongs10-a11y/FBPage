import { z } from 'zod';
import { CARD_TEMPLATES, THEME_NAMES } from './card-templates';
const s = (max: number) => z.string().trim().max(max).optional();
export const cardDataSchema = z.object({
  theme: z.enum(THEME_NAMES as [string, ...string[]]).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kicker: s(60), footer: s(120), brand: s(60), big: s(12), bigUnit: s(12), quote: s(200), sub: s(220), title: s(120), lead: s(200), punch: s(60), stat: s(120), svg: z.string().max(20000).optional(),
  rows: z.array(z.object({ label: z.string().max(60), note: s(60), old: z.union([z.string().max(20), z.number(), z.null()]).optional(), new: z.union([z.string().max(20), z.number()]), unit: s(20) })).max(6).optional(),
  items: z.array(z.object({ title: z.string().max(80), text: s(160) })).max(7).optional(),
});
export const renderCardSchema = z.object({ template: z.enum(CARD_TEMPLATES), data: cardDataSchema, attach: z.boolean().default(true) });
export type RenderCardDto = z.infer<typeof renderCardSchema>;
export const aiCardSchema = z.object({ hint: z.string().trim().max(500).optional(), template: z.enum(CARD_TEMPLATES).optional(), theme: z.enum(THEME_NAMES as [string, ...string[]]).optional() }).optional();
export type AiCardDto = z.infer<typeof aiCardSchema>;
