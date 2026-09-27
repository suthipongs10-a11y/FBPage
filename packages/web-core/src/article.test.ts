import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractArticle, fetchArticle, resolveRedirect } from './article';
import { startMockWeb, type MockWebState } from './mock-web';

let mock: { url: string; state: MockWebState; server: import('node:http').Server };
beforeAll(async () => { mock = await startMockWeb(); });
afterAll(() => { mock.server.close(); });

describe('article', () => {
  it('ดึงเนื้อความหลัก ตัดเมนู/ส่วนท้าย/สคริปต์', () => {
    const a = extractArticle('<html><head><title>หัวข้อ</title></head><body><nav>เมนูยาวๆ ที่ไม่ควรติดมา หน้าแรก ข่าว กีฬา</nav><article><p>ย่อหน้าแรกของบทความที่ยาวพอจะถูกเก็บไว้เป็นเนื้อหาหลักแน่นอน</p><p>สั้น</p></article><script>x()</script></body></html>', 'https://www.x.example/a');
    expect(a.title).toBe('หัวข้อ'); expect(a.siteName).toBe('x.example');
    expect(a.text).toContain('ย่อหน้าแรก'); expect(a.text).not.toContain('เมนู'); expect(a.text).not.toContain('x()');
  });
  it('อ่านจากลิงก์ (ตาม redirect) · robots ห้าม = error · resolveRedirect ได้ปลายทาง', async () => {
    const a = await fetchArticle(`${mock.url}/article/go/elephant`, { allowPrivate: true });
    expect(a.title).toContain('ลูกช้าง'); expect(a.siteName).toBe('Mock Times');
    expect(a.text).toContain('เขาใหญ่'); expect(a.text).not.toContain('โฆษณา');
    expect(a.url).toBe(`${mock.url}/article/elephant`);
    expect(a.publishedAt?.toISOString()).toBe('2026-09-26T08:00:00.000Z');
    await expect(fetchArticle(`${mock.url}/admin/secret-article`, { allowPrivate: true })).rejects.toThrow('robots');
    await expect(fetchArticle('http://127.0.0.1:1/x')).rejects.toThrow('เครือข่ายภายใน');
    expect(await resolveRedirect(`${mock.url}/article/go/moon`, { allowPrivate: true })).toBe(`${mock.url}/article/moon`);
  });
});
