import { z } from 'zod';
export const generateReportSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'รูปแบบเดือน YYYY-MM').optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  withAi: z.boolean().default(true),
}).optional();
export type GenerateReportDto = z.infer<typeof generateReportSchema>;
