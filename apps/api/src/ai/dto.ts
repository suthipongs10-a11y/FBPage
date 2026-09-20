import { z } from 'zod';
import { AI_ROLES } from '@fbpm/shared';

const modelName = z.string().trim().min(1).max(120);
const baseUrlField = z.string().trim().url('Base URL ไม่ถูกต้อง').max(300).or(z.literal(''));

export const createConnectionSchema = z.object({
  /** id ของ preset จาก PROVIDER_PRESETS เช่น anthropic | openai | gemini | openrouter | minimax | custom */
  preset: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, 'ตั้งชื่อคีย์ให้จำง่าย').max(120),
  apiKey: z.string().trim().min(8, 'API key สั้นเกินไป').max(4000),
  baseUrl: baseUrlField.optional(),
  models: z.array(modelName).max(30).optional(),
}).strict();
export type CreateConnectionDto = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().trim().min(8, 'API key สั้นเกินไป').max(4000).optional(),
  baseUrl: baseUrlField.optional(),
  models: z.array(modelName).max(30).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
}).strict();
export type UpdateConnectionDto = z.infer<typeof updateConnectionSchema>;

const roleConfig = z.object({ connectionId: z.string().trim().min(1), model: modelName });
export const putRolesSchema = z.object({ roles: z.partialRecord(z.enum(AI_ROLES), roleConfig.nullable()) });
export type PutRolesDto = z.infer<typeof putRolesSchema>;

/** เลือกคีย์+โมเดลเฉพาะคำขอครั้งนี้ — ใช้ร่วมกับ body ของงานที่เรียก AI */
export const modelOverrideSchema = z.object({ connectionId: z.string().trim().min(1), model: modelName.optional() });
export type ModelOverrideDto = z.infer<typeof modelOverrideSchema>;

export const aiMessageSchema = z.union([
  z.object({ role: z.literal('user'), content: z.string().max(20000) }),
  z.object({ role: z.literal('assistant'), content: z.string().max(40000), toolCalls: z.array(z.object({ id: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) })).optional() }),
  z.object({ role: z.literal('tool'), toolCallId: z.string(), name: z.string(), content: z.string().max(60000) }),
]);
export const commandSchema = z.object({
  message: z.string().trim().min(1).max(20000),
  history: z.array(aiMessageSchema).max(60).default([]),
  context: z.object({
    clientId: z.string().optional(), brandId: z.string().optional(), pageId: z.string().optional(),
    days: z.coerce.number().int().min(1).max(365).default(30),
  }).default({ days: 30 }),
  role: z.enum(AI_ROLES).default('strategy'),
  /** เลือกคีย์+โมเดลเฉพาะครั้งนี้ ข้ามการเลือกตามบทบาท (งบและ log ยังทำงานเหมือนเดิม) */
  modelOverride: modelOverrideSchema.optional(),
});
export type CommandDto = z.infer<typeof commandSchema>;

export const analyzeSchema = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }).optional();
export type AnalyzeDto = z.infer<typeof analyzeSchema>;

export const tasksQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });
export type TasksQueryDto = z.infer<typeof tasksQuerySchema>;
