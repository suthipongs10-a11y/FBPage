import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FacebookService } from './facebook.service';
import { startMockGraph } from './mock-graph';
import { fakeMp4, inspectVideo, reelProblems, sniffVideo } from './video';
import { insideMediaDir } from './publisher';

describe('video inspection (ไม่ใช้ ffmpeg)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reels-'));
  it('อ่านความยาวและขนาดจาก moov', async () => {
    const f = join(dir, 'a.mp4'); writeFileSync(f, fakeMp4({ durationSec: 42.5, width: 1080, height: 1920 }));
    expect(await inspectVideo(f)).toEqual({ container: 'mp4', durationSec: 42.5, width: 1080, height: 1920 });
    expect(reelProblems(await inspectVideo(f))).toEqual({ errors: [], warnings: [] });
  });
  it('คลิปยาวเกิน/แนวนอน/ไม่ใช่วิดีโอ', async () => {
    const f = join(dir, 'b.mp4'); writeFileSync(f, fakeMp4({ durationSec: 120, width: 1920, height: 1080 }));
    const p = reelProblems(await inspectVideo(f));
    expect(p.errors[0]).toContain('120 วินาที'); expect(p.warnings[0]).toContain('แนวนอน');
    expect(sniffVideo(Buffer.from('not a video at all'))).toBeNull();
    const g = join(dir, 'c.mp4'); writeFileSync(g, Buffer.from('GIF89a........'));
    await expect(inspectVideo(g)).rejects.toThrow('ไม่ใช่คลิป');
  });
  it('insideMediaDir กัน path นอกโฟลเดอร์สื่อ', () => {
    expect(insideMediaDir('/data/media/ws1/a.mp4', '/data/media')).toBe(true);
    expect(insideMediaDir('/data/media/../secret', '/data/media')).toBe(false);
    expect(insideMediaDir('/etc/passwd', '/data/media')).toBe(false);
    expect(insideMediaDir('/data/media-evil/x', '/data/media')).toBe(false);
  });
});

describe('FacebookService.createReel (mock Graph)', () => {
  let graph: Awaited<ReturnType<typeof startMockGraph>>; let fb: FacebookService;
  beforeAll(async () => { graph = await startMockGraph(); fb = new FacebookService({ baseUrl: graph.url }); });
  afterAll(() => graph.server.close());
  const token = () => graph.state.pageTokens['111']!;
  it('start → อัปโหลดไฟล์ → finish (PUBLISHED) พร้อมคำบรรยาย', async () => {
    const video = fakeMp4({ padBytes: 5000 });
    const r = await fb.createReel('111', token(), { video, description: 'คลิปแรก 🎬 #reels' });
    expect(r.permalink).toBe(`https://www.facebook.com/reel/${r.externalId}`);
    expect(graph.state.reels.at(-1)).toMatchObject({ pageId: '111', videoId: r.externalId, bytes: video.length, description: 'คลิปแรก 🎬 #reels', published: true });
  });
  it('อัปโหลดล้ม = ไม่ finish (ไม่ขึ้นเพจ) · token ผิด', async () => {
    graph.state.reelError = { phase: 'upload', status: 400, code: 100, message: 'Invalid video' };
    await expect(fb.createReel('111', token(), { video: fakeMp4(), description: 'x' })).rejects.toThrow('อัปโหลดคลิปไม่สำเร็จ');
    expect(graph.state.reels.at(-1)!.published).toBe(false);
    graph.state.reelError = null;
    await expect(fb.createReel('111', 'WRONG', { video: fakeMp4(), description: 'x' })).rejects.toThrow();
  });
  it('ไม่ส่ง token ไปปลายทางอัปโหลดที่ไม่ใช่ของ Meta', async () => {
    const other = new FacebookService({ baseUrl: graph.url, fetchImpl: (async (u: string | URL | Request, init?: RequestInit) => {
      const res = await fetch(u, init);
      if (String(u).includes('video_reels') && init?.body && String(init.body).includes('upload_phase=start')) return new Response(JSON.stringify({ video_id: 'rv_x', upload_url: 'https://evil.example.com/steal' }), { status: 200 });
      return res;
    }) as typeof fetch });
    await expect(other.createReel('111', token(), { video: fakeMp4(), description: 'x' })).rejects.toThrow('ไม่ใช่ของ Meta');
  });
});
