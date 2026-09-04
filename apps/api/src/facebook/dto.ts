import { z } from 'zod';
import { AUTOMATION_LEVELS } from '@fbpm/shared';

export const connectTokenSchema = z.object({ accessToken: z.string().trim().min(20, 'token สั้นเกินไป').max(4000) });
export type ConnectTokenDto = z.infer<typeof connectTokenSchema>;

export const connectPageSchema = z.object({
  connectionId: z.string().trim().min(1),
  facebookPageId: z.string().trim().regex(/^\d+$/, 'page id ต้องเป็นตัวเลข'),
});
export type ConnectPageDto = z.infer<typeof connectPageSchema>;

export const updatePageSchema = z.object({
  automationLevel: z.enum(AUTOMATION_LEVELS).optional(),
  publishingPaused: z.boolean().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
}).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdatePageDto = z.infer<typeof updatePageSchema>;

export const syncSchema = z.object({ days: z.coerce.number().int().min(1).max(365).optional() }).optional();
export type SyncDto = z.infer<typeof syncSchema>;

export const postsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });
export type PostsQueryDto = z.infer<typeof postsQuerySchema>;
