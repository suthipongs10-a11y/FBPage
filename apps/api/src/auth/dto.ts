import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('อีเมลไม่ถูกต้อง').max(200),
  name: z.string().trim().min(1, 'กรุณาใส่ชื่อ').max(120),
  password: z.string().min(10, 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร').max(200),
  workspaceName: z.string().trim().min(1).max(120).optional(),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const acceptInviteSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  password: z.string().min(10, 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร').max(200).optional(),
});
export type AcceptInviteDto = z.infer<typeof acceptInviteSchema>;
export const resetPasswordSchema = z.object({ password: z.string().min(10, 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร').max(200) });
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export const changePasswordSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(10, 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร').max(200) });
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
