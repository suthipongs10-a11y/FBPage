import { z } from 'zod';
import { AUTOMATION_LEVELS, YT_COMMENT_CLASSES, YT_RECOMMENDATION_ACTIONS, YT_VIDEO_TYPES } from '@fbpm/shared';
const opt = (max: number) => z.string().trim().max(max).optional();
export const pasteTokenSchema = z.object({ refreshToken: z.string().trim().min(10).max(2000), accessToken: z.string().trim().min(10).max(4000).optional() });
export const connectChannelSchema = z.object({ brandId: z.string().min(1), mode: z.enum(['OAUTH', 'PUBLIC_API_KEY']).default('PUBLIC_API_KEY'), connectionId: z.string().optional(), channelId: z.string().trim().max(64).optional(), handle: z.string().trim().max(64).optional() });
export type ConnectChannelDto = z.infer<typeof connectChannelSchema>;
export const updateChannelSchema = z.object({ automationLevel: z.enum(AUTOMATION_LEVELS).optional(), automationPaused: z.boolean().optional(), uploadsPaused: z.boolean().optional(), timezone: z.string().trim().min(1).max(64).optional(), policy: z.object({ defaultPrivacy: z.enum(['private', 'unlisted', 'public']).optional(), defaultMadeForKids: z.boolean().optional(), requireSyntheticMediaReview: z.boolean().optional(), requirePaidPlacementReview: z.boolean().optional(), allowAutoUpload: z.boolean().optional(), allowAutoMetadataUpdate: z.boolean().optional(), allowAutoReply: z.boolean().optional(), targetAudience: opt(500), defaultLanguage: opt(10), defaultCategoryId: opt(4), longFormMaxPerWeek: z.number().int().min(0).max(50).optional(), shortsMaxPerDay: z.number().int().min(0).max(50).optional(), factualNiche: z.boolean().optional() }).optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateChannelDto = z.infer<typeof updateChannelSchema>;
export const syncSchema = z.object({ stage: z.enum(['quick', 'videos', 'history', 'analytics', 'comments', 'playlists', 'all']).default('all'), maxVideos: z.coerce.number().int().min(1).max(500).optional(), days: z.coerce.number().int().min(1).max(365).optional() }).optional();
export type SyncDto = z.infer<typeof syncSchema>;
export const listVideosSchema = z.object({ channelId: z.string().optional(), type: z.enum(YT_VIDEO_TYPES).optional(), pillar: z.string().optional(), q: z.string().optional(), sort: z.enum(['published', 'views', 'subs', 'avd']).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
export type ListVideosDto = z.infer<typeof listVideosSchema>;
export const updateVideoMetaSchema = z.object({ title: opt(100), description: opt(5000), tags: z.array(z.string().trim().min(1).max(60)).max(60).optional(), categoryId: opt(4), privacyStatus: z.enum(['private', 'unlisted', 'public']).optional(), publishAt: z.string().datetime().nullable().optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateVideoMetaDto = z.infer<typeof updateVideoMetaSchema>;
export const setPillarSchema = z.object({ contentPillar: z.string().trim().min(1).max(80).nullable() });
export const analyzeSchema = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }).optional();
export const daysSchema = z.object({ channelId: z.string().optional(), days: z.coerce.number().int().min(1).max(365).default(28) });
export const listYtCommentsSchema = z.object({ channelId: z.string().optional(), videoId: z.string().optional(), classification: z.enum(YT_COMMENT_CLASSES).optional(), unresolved: z.enum(['1', '0']).optional(), unclassified: z.enum(['1', '0']).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
export type ListYtCommentsDto = z.infer<typeof listYtCommentsSchema>;
export const classifyYtSchema = z.object({ channelId: z.string().optional(), commentIds: z.array(z.string()).max(50).optional(), limit: z.coerce.number().int().min(1).max(50).default(25) }).optional();
export type ClassifyYtDto = z.infer<typeof classifyYtSchema>;
export const updateYtCommentSchema = z.object({ draftReply: z.string().trim().max(5000).optional(), resolved: z.boolean().optional(), classification: z.enum(YT_COMMENT_CLASSES).optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateYtCommentDto = z.infer<typeof updateYtCommentSchema>;
export const replyYtSchema = z.object({ message: z.string().trim().min(1).max(5000).optional() });
// ---- Content Lab ----
export const ideasSchema = z.object({ count: z.coerce.number().int().min(1).max(10).default(5), objective: opt(300), notes: opt(1000) }).optional();
export type IdeasDto = z.infer<typeof ideasSchema>;
export const createYtContentSchema = z.object({ channelId: z.string().min(1), title: opt(200), format: z.enum(['LONG_FORM', 'SHORT', 'LIVE']).default('LONG_FORM'), objective: opt(300), contentPillar: opt(120), hook: opt(500), notes: opt(2000) });
export type CreateYtContentDto = z.infer<typeof createYtContentSchema>;
export const updateYtContentSchema = z.object({
  title: opt(100), description: opt(5000), tags: z.array(z.string().trim().min(1).max(60)).max(60).optional(), categoryId: opt(4), privacyStatus: z.enum(['private', 'unlisted', 'public']).optional(), scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).nullable().optional(), timezone: opt(64),
  madeForKids: z.boolean().nullable().optional(), syntheticMedia: z.boolean().nullable().optional(), paidPlacement: z.boolean().nullable().optional(), format: z.enum(['LONG_FORM', 'SHORT', 'LIVE']).optional(), targetDurationSec: z.number().int().min(10).max(43200).nullable().optional(),
  hook: opt(500), script: z.string().max(60000).optional(), outline: z.array(z.object({ section: z.string().max(120), points: z.array(z.string().max(300)).max(20), visual: opt(300) })).max(30).optional(), objective: opt(300), contentPillar: opt(120), internalTitle: opt(200), reason: opt(300),
}).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateYtContentDto = z.infer<typeof updateYtContentSchema>;
export const titlesSchema = z.object({ count: z.coerce.number().int().min(2).max(8).default(5) }).optional();
export const scriptSchema = z.object({ targetDurationSec: z.number().int().min(15).max(7200).optional(), notes: opt(1000), research: z.array(z.object({ claim: z.string().max(500), source: z.string().max(500) })).max(20).optional() }).optional();
export type ScriptDto = z.infer<typeof scriptSchema>;
export const attachAssetSchema = z.object({ assetId: z.string().min(1), kind: z.enum(['video', 'thumbnail']) });
export const ytTransitionSchema = z.object({ to: z.string().min(1) });
export const recStatusSchema = z.object({ status: z.enum(['OPEN', 'ACCEPTED', 'IGNORED', 'DONE']), outcome: z.record(z.string(), z.unknown()).optional() });
export const createRecSchema = z.object({ actionType: z.enum(YT_RECOMMENDATION_ACTIONS), title: z.string().max(200), why: z.string().max(2000), videoId: z.string().optional() });
export const repurposeSchema = z.object({ targetPageId: z.string().min(1), count: z.coerce.number().int().min(1).max(5).default(3) });
export type RepurposeDto = z.infer<typeof repurposeSchema>;
export const reportSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), withAi: z.boolean().default(true) }).optional();
