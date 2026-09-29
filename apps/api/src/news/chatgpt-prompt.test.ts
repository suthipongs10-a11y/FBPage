import { describe, expect, it } from 'vitest';
import { buildChatGptPrompt } from './chatgpt-prompt';
import { checkPackage, extractJson, pickPosts, withPostImages } from './import-format';

const brand = { name: 'Phuket Maids', industry: 'บริการทำความสะอาด', targetAudience: 'เจ้าของบ้านและ Airbnb ในภูเก็ต', toneOfVoice: 'เป็นกันเอง', primaryCTA: 'ทักแชทขอราคา', description: null };
const base = { pageName: 'Phuket Maids Service', count: 5, kind: 'original' as const, length: 'medium' as const, emoji: true, images: 'chatgpt' as const };

describe('buildChatGptPrompt', () => {
  it('ใส่ข้อมูลแบรนด์ จำนวนหัวข้อ เรื่อง และตัวอย่าง JSON ที่ตรวจผ่าน', () => {
    const p = buildChatGptPrompt(brand, { ...base, topic: 'ทำความสะอาดบ้านหน้าฝน', recencyDays: 30 });
    expect(p).toContain('"Phuket Maids Service"');
    expect(p).toContain('กลุ่มเป้าหมาย: เจ้าของบ้านและ Airbnb ในภูเก็ต');
    expect(p).toContain('คัดมา 5 หัวข้อ');
    expect(p).toContain('ในเรื่อง: ทำความสะอาดบ้านหน้าฝน — เน้นข้อมูลภายใน 30 วันล่าสุด');
    expect(p).toContain('CTA: "ทักแชทขอราคา"');
    expect(p).toContain('รูปที่ X');
    expect(p).not.toMatch(/\n\n\n/);
    // ตัวอย่างในคำสั่งต้องเป็นแพ็กเกจที่ระบบรับได้จริง
    const rep = checkPackage(p.slice(p.indexOf('{')));
    expect(rep.parseError).toBeNull();
    expect(rep.posts[0]!.post?.page).toBe('Phuket Maids Service');
    expect(rep.posts[0]!.status).not.toBe('FAIL');
  });
  it('จำนวนหัวข้อถูกจำกัด 1–20 · ไม่ใช้อีโมจิ · รูปจากคลังภาพฟรี · ข่าวต้องมีที่มา', () => {
    const p = buildChatGptPrompt({ name: 'X' }, { ...base, pageName: null, count: 99, emoji: false, images: 'stock', kind: 'news' });
    expect(p).toContain('คัดมา 20 หัวข้อ');
    expect(p).toContain('ไม่ใช้อีโมจิ');
    expect(p).toContain('photoQuery');
    expect(p).toContain('"type": "news"');
    expect(p).not.toContain('"page"');
    expect(buildChatGptPrompt({ name: 'X' }, { ...base, count: 0 })).toContain('คัดมา 1 หัวข้อ');
    expect(buildChatGptPrompt({ name: 'X' }, { ...base, images: 'own' })).toContain('อัปโหลดรูปเอง');
  });
});

describe('withPostImages', () => {
  const pkg = { format: 'fbpm-content-v1', posts: [{ caption: 'a'.repeat(30), images: ['old.png'] }, { caption: 'b'.repeat(30) }] };
  it('ผูกรูปรายหัวข้อกับข้อความจากแชต (```json) array และโพสต์เดี่ยว', () => {
    const fenced = withPostImages(`ได้เลย\n\`\`\`json\n${JSON.stringify(pkg)}\n\`\`\``, { '0': 'A1', '1': 'B2', '7': 'X' }) as typeof pkg;
    expect(fenced.posts.map(p => (p as { images?: string[] }).images)).toEqual([['upload:A1'], ['upload:B2']]);
    expect((withPostImages(pkg.posts, { '1': 'Z' }) as { images?: string[] }[])[1]!.images).toEqual(['upload:Z']);
    expect((withPostImages({ caption: 'c'.repeat(30) }, { '0': 'Q' }) as { images: string[] }).images).toEqual(['upload:Q']);
    expect(pkg.posts[0]!.images).toEqual(['old.png']);   // ไม่แก้ของเดิม
  });
  it('ไม่มีรูป หรืออ่านแพ็กเกจไม่ได้ → คืนค่าเดิม', () => {
    expect(withPostImages('ไม่ใช่ json', { '0': 'A' })).toBe('ไม่ใช่ json');
    expect(withPostImages(pkg, {})).toBe(pkg);
    expect(withPostImages(pkg, undefined)).toBe(pkg);
    expect(() => extractJson(JSON.stringify(withPostImages(pkg, { '0': 'A' })))).not.toThrow();
  });
});

describe('pickPosts', () => {
  it('เก็บเฉพาะลำดับที่ติ๊ก (หลังผูกรูปแล้ว)', () => {
    const pkg = { format: 'fbpm-content-v1', posts: [{ caption: 'a' }, { caption: 'b' }, { caption: 'c' }] };
    const out = pickPosts(withPostImages(pkg, { '2': 'C' }), [0, 2]) as { format: string; posts: { caption: string; images?: string[] }[] };
    expect(out.format).toBe('fbpm-content-v1');
    expect(out.posts.map(p => p.caption)).toEqual(['a', 'c']);
    expect(out.posts[1]!.images).toEqual(['upload:C']);
    expect(pickPosts(pkg, undefined)).toBe(pkg);
    expect((pickPosts([{ caption: 'x' }, { caption: 'y' }], [1]) as { caption: string }[])).toEqual([{ caption: 'y' }]);
  });
});
