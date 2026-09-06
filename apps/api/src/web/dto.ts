import { z } from 'zod';
import { CONTENT_STATUSES, SITE_CHECK_KINDS, SITE_PLATFORMS } from '@fbpm/shared';
const opt = (max: number) => z.string().trim().max(max).optional().transform(v => v || undefined);
export const createSiteSchema = z.object({ brandId: z.string().min(1), url: z.string().trim().min(3).max(500), name: opt(120), platform: z.enum(SITE_PLATFORMS).optional(), expectedText: opt(200), checkIntervalMin: z.coerce.number().int().min(5).max(1440).optional() });
export type CreateSiteDto = z.infer<typeof createSiteSchema>;
export const updateSiteSchema = z.object({ name: opt(120), platform: z.enum(SITE_PLATFORMS).optional(), expectedText: z.string().trim().max(200).nullable().optional(), checkIntervalMin: z.coerce.number().int().min(5).max(1440).optional(), monitorEnabled: z.boolean().optional(), publishingPaused: z.boolean().optional() }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateSiteDto = z.infer<typeof updateSiteSchema>;
export const runChecksSchema = z.object({ kinds: z.array(z.enum(SITE_CHECK_KINDS)).min(1).max(5).default(['UPTIME', 'SSL', 'SEO']) }).optional();
export const connectGscSchema = z.object({ connectionId: z.string().min(1), property: z.string().trim().max(300).optional() });
export const syncGscSchema = z.object({ days: z.coerce.number().int().min(7).max(90).default(28) }).optional();

// ---------- W-3 Web content ----------
const webFields = {
  title: opt(200), slug: z.string().trim().max(120).regex(/^[\p{L}\p{N}\p{M}-]*$/u, 'slug ใช้ตัวอักษร ตัวเลข และ - เท่านั้น').optional().transform(v => v || undefined), excerpt: opt(500), bodyHtml: z.string().max(200_000).optional(),
  metaTitle: opt(120), metaDescription: opt(320), targetQuery: opt(200), tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(), categories: z.array(z.string().trim().min(1).max(60)).max(10).optional(), featuredImageUrl: z.string().trim().url().max(500).optional().or(z.literal('').transform(() => undefined)),
  objective: opt(300), contentPillar: opt(120),
};
export const createWebContentSchema = z.object({ siteId: z.string().min(1), topic: opt(300), ...webFields });
export type CreateWebContentDto = z.infer<typeof createWebContentSchema>;
export const updateWebContentSchema = z.object({ ...webFields, internalTitle: opt(200), reason: opt(300) }).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateWebContentDto = z.infer<typeof updateWebContentSchema>;
export const listWebContentSchema = z.object({ siteId: z.string().optional(), status: z.enum(CONTENT_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
export type ListWebContentDto = z.infer<typeof listWebContentSchema>;
/** แหล่งที่ให้ AI ใช้ร่างบทความ — เลือกได้หลายอย่าง ไม่เลือก = ใช้หัวข้อ + ข้อมูลแบรนด์ + SEO ideas */
export const generateWebContentSchema = z.object({ youtubeContentIds: z.array(z.string().min(1)).max(3).optional(), facebookPostIds: z.array(z.string().min(1)).max(5).optional(), topic: opt(300), targetQuery: opt(200), notes: opt(1500), wordCount: z.coerce.number().int().min(300).max(3000).optional() }).optional();
export type GenerateWebContentDto = z.infer<typeof generateWebContentSchema>;
export const publishWebSchema = z.object({ asDraft: z.boolean().optional() }).optional();
export const connectWpSchema = z.object({ username: z.string().trim().min(1).max(120), appPassword: z.string().trim().min(8).max(200) });
export type ConnectWpDto = z.infer<typeof connectWpSchema>;
