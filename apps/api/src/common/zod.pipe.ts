import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * ตรวจ body/query/param ด้วย zod (AGENTS.md §56 "request validation")
 * ใช้:  @Body(new ZodPipe(schema)) dto: z.infer<typeof schema>
 * ข้อผิดพลาดตอบ 400 พร้อมรายการฟิลด์ที่ผิด อ่านรู้เรื่อง ไม่ใช่ stack trace (§59)
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    throw new BadRequestException({
      message: 'ข้อมูลไม่ถูกต้อง',
      issues: r.error.issues.map(i => ({ path: i.path.map(String).join('.') || '(root)', message: i.message })),
    });
  }
}
