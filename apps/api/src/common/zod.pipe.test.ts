import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from './zod.pipe';

describe('ZodPipe', () => {
  const pipe = new ZodPipe(z.object({ name: z.string().min(2), age: z.coerce.number().int().optional() }));
  it('returns parsed data', () => { expect(pipe.transform({ name: 'ab', age: '3' })).toEqual({ name: 'ab', age: 3 }); });
  it('throws 400 with field paths', () => {
    try { pipe.transform({ name: 'a' }); throw new Error('should throw'); }
    catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as { issues: { path: string }[] };
      expect(body.issues[0]?.path).toBe('name');
    }
  });
});
