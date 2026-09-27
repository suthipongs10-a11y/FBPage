import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clip, upTo } from './lenient';

describe('schema ผ่อนปรนสำหรับผลลัพธ์ AI', () => {
  const idea = z.object({ title: clip(20, 1), angle: clip(10).default('') });
  const out = z.object({ ideas: upTo(idea, 2, 1) });
  it('ข้อความยาวเกินถูกตัด (ไม่ปัดตกทั้งชุด) · รายการเกินถูกตัดส่วนท้าย', () => {
    const r = out.parse({ ideas: [{ title: 'ก', angle: 'มุมเล่าที่ยาวมากเกินกำหนด' }, { title: 'ข' }, { title: 'ค' }] });
    expect(r.ideas).toHaveLength(2);
    expect(r.ideas[0]!.angle).toHaveLength(10); expect(r.ideas[0]!.angle.endsWith('…')).toBe(true);
    expect(r.ideas[1]!.angle).toBe('');
  });
  it('ยังบังคับขั้นต่ำ', () => {
    expect(() => out.parse({ ideas: [] })).toThrow();
    expect(() => out.parse({ ideas: [{ title: '' }] })).toThrow();
  });
});
