import { describe, expect, it } from 'vitest';
import { PACKAGE_EXAMPLE, aiInstructions, checkPackage, extractJson } from './import-format';

const now = new Date('2026-09-27T00:00:00Z');
const good = { caption: 'ช้างน้อยพลัดหลงแม่ถูกช่วยกลับฝูงได้สำเร็จ ทีมใช้เวลาสามวันตามรอย', sources: [{ name: 'BBC', url: 'https://www.bbc.com/news/x' }] };

describe('fbpm-content-v1', () => {
  it('ตัด ```json และข้อความนำจากแชต AI', () => {
    const text = 'นี่คือผลลัพธ์ครับ\n```json\n{"posts":[{"caption":"x"}]}\n```\nหวังว่าจะช่วยได้';
    expect(extractJson(text)).toEqual({ posts: [{ caption: 'x' }] });
    expect(() => extractJson('ไม่มี json')).toThrow('ไม่พบ JSON');
  });

  it('ตัวอย่างในคู่มือผ่านการตรวจ (มีแค่คำเตือนเครดิตไม่มี)', () => {
    const r = checkPackage(PACKAGE_EXAMPLE, { now });
    expect(r.parseError).toBeNull();
    expect(r.posts[0]!.status).not.toBe('FAIL');
    expect(r.posts[0]!.post!.scheduleAt).toBe('2026-09-28T12:00:00.000Z');
    expect(aiInstructions(['เพจ A'])).toContain('"เพจ A"');
  });

  it('รับโพสต์เดี่ยว/array · ตรวจที่มา/รูป/เวลา/[ต้องยืนยัน]', () => {
    const r = checkPackage([
      good,
      { caption: 'ข่าวไม่มีที่มาแต่ยาวพอที่จะผ่านความยาวขั้นต่ำ' },
      { ...good, images: ['https://cdn.bbc.com/news/1.jpg', 'http://example.com/a.jpg', 'photo 1.jpg', 'upload:abc'] },
      { ...good, caption: `${good.caption} จำนวน [ต้องยืนยัน: กี่ตัว]`, scheduleAt: '2026-09-26T10:00:00+07:00', risk: 'HIGH', hashtags: ['#a', 'b', 'c', 'd', 'e', 'f'] },
      { type: 'original', caption: 'โพสต์ของเพจเองไม่ต้องมีที่มาก็ได้ครับ ลองดู' },
    ], { now });
    const [a, b, c, d, e] = r.posts;
    expect(a!.status).toBe('PASS');
    expect(a!.post!.card.headline).toContain('ช้างน้อย');
    expect(b!.checks.map(x => x.code)).toContain('NO_SOURCE');
    expect(c!.checks.map(x => x.code)).toEqual(expect.arrayContaining(['IMAGE_FROM_SOURCE', 'IMAGE']));
    expect(c!.post!.images.map(i => i.kind)).toEqual(['file', 'upload']);
    expect(d!.status).toBe('WARN');
    expect(d!.checks.map(x => x.code)).toEqual(expect.arrayContaining(['NEEDS_CHECK', 'SCHEDULE_PAST', 'RISK_HIGH', 'HASHTAGS_MANY']));
    expect(d!.post!.needsCheck).toEqual(['[ต้องยืนยัน: กี่ตัว]']);
    expect(d!.post!.hashtags).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(e!.status).toBe('PASS');
  });

  it('ข้อผิดพลาดระดับแพ็กเกจ', () => {
    expect(checkPackage('{"posts": [', { now }).parseError).toMatch(/JSON/);
    expect(checkPackage({ foo: 1 }, { now }).parseError).toMatch(/ไม่พบรายการโพสต์/);
    expect(checkPackage({ posts: [{ caption: 1 }] }, { now }).posts[0]!.status).toBe('FAIL');
    expect(checkPackage({ format: 'other', posts: [good] }, { now }).posts[0]!.checks[0]!.code).toBe('FORMAT');
  });
});
