import { z } from 'zod';
import { BRAND_KNOWLEDGE_TYPES } from '@fbpm/shared';

const opt = (max: number) => z.string().trim().max(max).optional();
export const createBrandSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: opt(2000),
  industry: opt(120),
  targetAudience: opt(1000),
  toneOfVoice: opt(1000),
  preferredLanguage: z.enum(['th', 'en']).default('th'),
  serviceArea: opt(500),
  primaryCTA: opt(200),
  website: z.string().trim().url('URL ไม่ถูกต้อง').max(300).optional(),
});
export const updateBrandSchema = createBrandSchema.partial().refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type CreateBrandDto = z.infer<typeof createBrandSchema>;
export type UpdateBrandDto = z.infer<typeof updateBrandSchema>;

export const createKnowledgeSchema = z.object({
  type: z.enum(BRAND_KNOWLEDGE_TYPES),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(10000),
  source: opt(300),
  metadata: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().default(true),
});
export const updateKnowledgeSchema = createKnowledgeSchema.partial().refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type CreateKnowledgeDto = z.infer<typeof createKnowledgeSchema>;
export type UpdateKnowledgeDto = z.infer<typeof updateKnowledgeSchema>;
