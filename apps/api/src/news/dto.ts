import { z } from 'zod';
import { THEME_NAMES } from '../media/card-templates';
import { modelOverrideSchema } from '../ai/dto';

export const NEWS_STATUSES = ['NEW', 'SHORTLISTED', 'DRAFTED', 'DISMISSED'] as const;

export const searchProviderSchema = z.object({ provider: z.literal('tavily').default('tavily'), apiKey: z.string().trim().min(8).max(300) });
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
});
export type DraftDto = z.infer<typeof draftSchema>;
