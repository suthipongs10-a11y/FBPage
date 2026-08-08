import { describe, expect, it } from 'vitest';
import { formatAgo, formatInt } from './format';

describe('formatInt', () => {
  it('คั่นหลักพัน', () => {
    expect(formatInt(1234567)).toBe('1,234,567');
  });

  it('ปัดเศษ', () => {
    expect(formatInt(12.6)).toBe('13');
  });
});

describe('formatAgo', () => {
  const now = 1_754_600_000_000;

  it('ต่ำกว่านาที = เมื่อครู่', () => {
    expect(formatAgo(now - 30_000, now)).toBe('เมื่อครู่');
  });

  it('นับเป็นนาที', () => {
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 นาทีที่แล้ว');
  });

  it('นับเป็นชั่วโมง', () => {
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 ชม.ที่แล้ว');
  });

  it('นับเป็นวัน', () => {
    expect(formatAgo(now - 2 * 86_400_000, now)).toBe('2 วันที่แล้ว');
  });

  it('เวลาในอนาคตไม่ติดลบ', () => {
    expect(formatAgo(now + 10_000, now)).toBe('เมื่อครู่');
  });
});
