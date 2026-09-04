import { z } from 'zod';
import { WORKSPACE_ROLES } from '@fbpm/shared';

const tz = z.string().trim().min(1).max(64).refine(v => { try { Intl.DateTimeFormat(undefined, { timeZone: v }); return true; } catch { return false; } }, 'เขตเวลาไม่ถูกต้อง');

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: tz.optional(),
});
export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  timezone: tz.optional(),
  automationPaused: z.boolean().optional(),
  aiMonthlyBudgetUsd: z.number().min(0).max(1_000_000).nullable().optional(),
  aiMaxCostPerTaskUsd: z.number().min(0).max(10_000).nullable().optional(),
}).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(WORKSPACE_ROLES).refine(r => r !== 'owner', 'ให้บทบาท owner ผ่านการโอนสิทธิ์เท่านั้น'),
});
export const updateMemberSchema = z.object({
  role: z.enum(WORKSPACE_ROLES).refine(r => r !== 'owner', 'ให้บทบาท owner ผ่านการโอนสิทธิ์เท่านั้น'),
});
export type CreateWorkspaceDto = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceSchema>;
export type AddMemberDto = z.infer<typeof addMemberSchema>;
export type UpdateMemberDto = z.infer<typeof updateMemberSchema>;
