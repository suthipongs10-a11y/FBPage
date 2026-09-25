import { z } from 'zod';
import { CONTENT_STATUSES } from '@fbpm/shared';

const opt = (max: number) => z.string().trim().max(max).optional();
const contentFields = {
  contentType: z.enum(['post', 'photo', 'video', 'reel', 'story']),
  title: opt(200), caption: opt(5000), cta: opt(300),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30),
  mediaBrief: opt(2000), mediaPaths: z.array(z.string().trim().min(1).max(500)).max(10),
  objective: opt(300), contentPillar: opt(120),
};
export const createContentSchema = z.object({ pageId: z.string().min(1), ...contentFields, contentType: contentFields.contentType.default('post'), hashtags: contentFields.hashtags.default([]), mediaPaths: contentFields.mediaPaths.default([]) });
export type CreateContentDto = z.infer<typeof createContentSchema>;
/** partial ที่ไม่มี default — ฟิลด์ที่ไม่ส่งมาต้องไม่ถูกเขียนทับ */
export const updateContentSchema = z.object({ ...contentFields, reason: opt(300) }).partial().refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type UpdateContentDto = z.infer<typeof updateContentSchema>;

export const listContentSchema = z.object({ pageId: z.string().optional(), status: z.enum(CONTENT_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
export type ListContentDto = z.infer<typeof listContentSchema>;

export const reviewCommentSchema = z.object({ comment: z.string().trim().max(2000).optional() });
export type ReviewCommentDto = z.infer<typeof reviewCommentSchema>;

/** เวลาที่ตั้งใจในเขตเวลาของเพจ/workspace (§47) เช่น "2026-09-10T10:00" + timezone */
export const scheduleSchema = z.object({
  scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'รูปแบบเวลา YYYY-MM-DDTHH:MM'),
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type ScheduleDto = z.infer<typeof scheduleSchema>;

export const planSchema = z.object({ days: z.coerce.number().int().min(3).max(31).default(7), postsPerWeek: z.coerce.number().int().min(1).max(14).default(3), objective: opt(300), notes: opt(1000) }).optional();
export type PlanDto = z.infer<typeof planSchema>;

export const generateSchema = z.object({
  brief: opt(1500), pillar: opt(120), objective: opt(300), count: z.coerce.number().int().min(1).max(5).default(1),
  /** เลือกคีย์+โมเดลเฉพาะครั้งนี้ — ไม่ส่งมา = ใช้บทบาท content ตามที่ตั้งไว้ */
  modelOverride: z.object({ connectionId: z.string().trim().min(1), model: z.string().trim().min(1).max(120).optional() }).optional(),
}).optional();
export type GenerateDto = z.infer<typeof generateSchema>;

export const calendarSchema = z.object({ from: z.string().optional(), to: z.string().optional(), pageId: z.string().optional() });
export type CalendarDto = z.infer<typeof calendarSchema>;
