/**
 * Adapter contract (CLAUDE.md ข้อ 4)
 *
 * ทุก adapter ต้อง return CapturedVideo เท่านั้น
 * ส่วนอื่นของระบบห้ามรู้ว่าข้อมูลมาจากแพลตฟอร์มไหน
 */

export type Platform = 'tiktok' | 'instagram';

export interface CapturedVideo {
  platform: Platform;
  videoId: string;
  url: string;
  authorId: string;
  authorHandle: string;
  authorFollowers: number | null;
  caption: string;
  hashtags: string[];
  soundId: string | null;
  soundName: string | null;
  thumbnailUrl: string | null; // เก็บ URL เท่านั้น ห้ามเก็บ blob
  postedAt: number | null; // epoch ms
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  firstSubtitleText: string | null; // ถ้าหน้าเว็บมี subtitle data มาให้ (best effort)
  capturedAt: number;
}

/** id กลางของคลิป — ใช้เป็น primary key ใน Dexie (CLAUDE.md ข้อ 5) */
export function videoKey(platform: Platform, videoId: string): string {
  return `${platform}:${videoId}`;
}
