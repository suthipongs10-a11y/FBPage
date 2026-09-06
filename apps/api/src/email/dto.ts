import { z } from 'zod';
import { EMAIL_CAMPAIGN_STATUSES, EMAIL_PROVIDERS } from '@fbpm/shared';
const opt = (max: number) => z.string().trim().max(max).optional().transform(v => v || undefined);
const email = z.string().trim().toLowerCase().email().max(254);

export const providerConfigSchema = z.object({ provider: z.enum(EMAIL_PROVIDERS), apiKey: z.string().trim().min(8).max(500), webhookSecret: opt(500) });
export type ProviderConfigDto = z.infer<typeof providerConfigSchema>;
export const providerPauseSchema = z.object({ sendingPaused: z.boolean() });

export const createListSchema = z.object({ brandId: z.string().min(1), name: z.string().trim().min(1).max(120), description: opt(500), fromEmail: email, fromName: z.string().trim().min(1).max(120), replyTo: email.optional().or(z.literal('').transform(() => undefined)), consentText: opt(1000) });
export type CreateListDto = z.infer<typeof createListSchema>;
export const updateListSchema = z.object({ name: opt(120), description: opt(500), fromEmail: email.optional(), fromName: opt(120), replyTo: email.nullable().optional().or(z.literal('').transform(() => null)), consentText: opt(1000), archived: z.boolean().optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateListDto = z.infer<typeof updateListSchema>;

/** นำเข้าผู้รับ — ต้องยืนยันว่ามี consent ทุกคน (PDPA) และระบุที่มา/วันที่ยินยอม */
export const importSubscribersSchema = z.object({
  subscribers: z.array(z.object({ email, name: opt(120), consentAt: z.string().datetime().optional(), attributes: z.record(z.string(), z.string().max(200)).optional() })).min(1).max(5000),
  consentConfirmed: z.literal(true, { message: 'ต้องยืนยันว่าผู้รับทุกคนให้ความยินยอมรับอีเมลแล้ว' }),
  consentSource: z.string().trim().min(1).max(200),
  consentNote: opt(500),
});
export type ImportSubscribersDto = z.infer<typeof importSubscribersSchema>;
export const listSubscribersSchema = z.object({ status: z.string().optional(), q: z.string().trim().max(120).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() });
export const subscriberStatusSchema = z.object({ status: z.enum(['SUBSCRIBED', 'UNSUBSCRIBED']) });

const campaignFields = { name: opt(160), subject: opt(200), preheader: opt(200), bodyHtml: z.string().max(300_000).optional(), bodyText: z.string().max(100_000).optional() };
export const createCampaignSchema = z.object({ listId: z.string().min(1), ...campaignFields, name: z.string().trim().min(1).max(160), sourceContentId: opt(40) });
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;
export const updateCampaignSchema = z.object({ ...campaignFields, reason: opt(300) }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;
export const listCampaignsSchema = z.object({ listId: z.string().optional(), status: z.enum(EMAIL_CAMPAIGN_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
export type ListCampaignsDto = z.infer<typeof listCampaignsSchema>;
export const generateCampaignSchema = z.object({ goal: opt(300), sourceContentIds: z.array(z.string().min(1)).max(5).optional(), notes: opt(1500), tone: opt(120) }).optional();
export type GenerateCampaignDto = z.infer<typeof generateCampaignSchema>;
export const testSendSchema = z.object({ to: email });
export const scheduleCampaignSchema = z.object({ scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'รูปแบบเวลา YYYY-MM-DDTHH:MM'), timezone: z.string().trim().min(1).max(64).optional() });
export type ScheduleCampaignDto = z.infer<typeof scheduleCampaignSchema>;
