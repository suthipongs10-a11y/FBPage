import { z } from 'zod';

const phone = z.string().trim().regex(/^\+?[0-9\s-]{6,20}$/, 'เบอร์โทรไม่ถูกต้อง');
export const createClientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  phone: phone.optional(),
  notes: z.string().max(4000).optional(),
});
export const updateClientSchema = createClientSchema.partial().extend({
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
}).refine(o => Object.keys(o).length > 0, 'ไม่มีฟิลด์ให้แก้');
export type CreateClientDto = z.infer<typeof createClientSchema>;
export type UpdateClientDto = z.infer<typeof updateClientSchema>;
