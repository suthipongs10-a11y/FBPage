import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, dbHealth, SCHEMA_VERSION, type VideoRecord } from './db';
import { videoKey } from './adapters/types';

function makeVideo(videoId: string): VideoRecord {
  return {
    id: videoKey('tiktok', videoId),
    schemaVersion: SCHEMA_VERSION,
    platform: 'tiktok',
    videoId,
    url: `https://www.tiktok.com/@somebody/video/${videoId}`,
    authorId: 'author-1',
    authorHandle: 'somebody',
    authorFollowers: 3000,
    caption: 'ทดสอบ #hook',
    hashtags: ['hook'],
    soundId: null,
    soundName: null,
    thumbnailUrl: null,
    postedAt: 1_754_000_000_000,
    metrics: {
      views: 120_000,
      likes: 8_000,
      comments: 300,
      shares: 120,
      saves: null,
    },
    firstSubtitleText: null,
    capturedAt: 1_754_600_000_000,
    outlierIndex: null,
    tags: ['ทดสอบ'],
    hook: null,
    hookType: null,
    note: null,
    updatedAt: 1_754_600_000_000,
  };
}

describe('videoKey', () => {
  it('รวม platform กับ videoId เป็น id เดียว', () => {
    expect(videoKey('tiktok', '123')).toBe('tiktok:123');
    expect(videoKey('instagram', 'abc')).toBe('instagram:abc');
  });
});

describe('db', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([
      db.videos.clear(),
      db.authors.clear(),
      db.snapshots.clear(),
      db.collections.clear(),
      db.items.clear(),
    ]);
  });

  it('เขียนแล้วอ่านกลับได้ครบ', async () => {
    const video = makeVideo('123');
    await db.videos.put(video);
    await expect(db.videos.get('tiktok:123')).resolves.toEqual(video);
  });

  it('id ซ้ำต้องทับของเดิม ไม่เพิ่มแถวใหม่', async () => {
    await db.videos.put(makeVideo('123'));
    await db.videos.put({ ...makeVideo('123'), outlierIndex: 4.2 });
    await expect(db.videos.count()).resolves.toBe(1);
  });

  it('ค้นด้วย index authorId ได้', async () => {
    await db.videos.bulkPut([makeVideo('1'), makeVideo('2')]);
    const found = await db.videos.where('authorId').equals('author-1').toArray();
    expect(found).toHaveLength(2);
  });

  it('ค้นด้วย multi-entry index tags ได้', async () => {
    await db.videos.put(makeVideo('1'));
    const found = await db.videos.where('tags').equals('ทดสอบ').toArray();
    expect(found).toHaveLength(1);
  });

  it('dbHealth คืนจำนวนจริง', async () => {
    await db.videos.put(makeVideo('9'));
    const result = await dbHealth();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.videos).toBe(1);
  });
});
