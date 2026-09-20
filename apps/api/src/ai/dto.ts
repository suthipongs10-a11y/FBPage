import { z } from 'zod';
import { AI_PROVIDERS } from '@fbpm/ai-core';
import { AI_ROLES } from '@fbpm/shared';

export const providerParam = z.enum(AI_PROVIDERS);
export const upsertProviderKeySchema = z.object({
  apiKey: z.string().trim().min(8, 'API key สั้นเกินไป').max(4000).optional(),
  baseUrl: z.string().trim().url('Base URL ไม่ถูกต้อง').max(300).optional().or(z.literal('')),
  label: z.string().trim().max(120).optional(),
});
export type UpsertProviderKeyDto = z.infer<typeof upsertProviderKeySchema>;

const roleConfig = z.object({ provider: z.enum(AI_PROVIDERS), model: z.string().trim().min(1).max(120) });
export const putRolesSchema = z.object({ roles: z.partialRecord(z.enum(AI_ROLES), roleConfig.nullable()) });
export type PutRolesDto = z.infer<typeof putRolesSchema>;

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
});
export type CommandDto = z.infer<typeof commandSchema>;

export const analyzeSchema = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }).optional();
export type AnalyzeDto = z.infer<typeof analyzeSchema>;

export const tasksQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });
export type TasksQueryDto = z.infer<typeof tasksQuerySchema>;
