import Dexie, { type Table } from 'dexie';
import type { CapturedVideo, Platform } from './adapters/types';
import { attempt, type Result } from './result';

/** ทุก entity ต้องมี schemaVersion ไว้ migrate (CLAUDE.md ข้อ 5) */
export const SCHEMA_VERSION = 1;

/** เก็บ snapshot ต่อคลิปไม่เกิน 30 แถว แล้ว downsample ของเก่า (CLAUDE.md ข้อ 5) */
export const MAX_SNAPSHOTS_PER_VIDEO = 30;

export type HookType =
  | 'question' // คำถาม
  | 'number' // ตัวเลข
  | 'twist' // ขัดความคาดหมาย
  | 'before-after' // ก่อน-หลัง
  | 'warning' // เตือน
  | 'story'; // เล่าเรื่อง

export interface VideoRecord extends CapturedVideo {
  /** `${platform}:${videoId}` */
  id: string;
  schemaVersion: number;
  /** ค่า OI ที่คำนวณไว้ล่าสุด — null = ยังคำนวณไม่ได้ (ข้อมูลไม่พอ) */
  outlierIndex: number | null;
  tags: string[];
  /** ฮุกที่ผู้ใช้ได้ยิน/พิมพ์เอง */
  hook: string | null;
  hookType: HookType | null;
  note: string | null;
  updatedAt: number;
}

export interface AuthorRecord {
  /** `${platform}:${authorId}` */
  id: string;
  schemaVersion: number;
  platform: Platform;
  handle: string;
  followers: number | null;
  lastSeenAt: number;
}

export interface SnapshotRecord {
  id?: number;
  schemaVersion: number;
  videoId: string;
  takenAt: number;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface CollectionRecord {
  id?: number;
  schemaVersion: number;
  name: string;
  createdAt: number;
}

export interface ItemRecord {
  id?: number;
  schemaVersion: number;
  collectionId: number;
  videoId: string;
  addedAt: number;
}

export class HookInsightDb extends Dexie {
  videos!: Table<VideoRecord, string>;
  authors!: Table<AuthorRecord, string>;
  snapshots!: Table<SnapshotRecord, number>;
  collections!: Table<CollectionRecord, number>;
  items!: Table<ItemRecord, number>;

  constructor(name = 'hook-insight') {
    super(name);
    // schema ตาม CLAUDE.md ข้อ 5 — ห้ามแก้โดยไม่ bump version
    this.version(1).stores({
      videos: '&id, platform, authorId, capturedAt, outlierIndex, *tags',
      authors: '&id, platform, handle, lastSeenAt',
      snapshots: '++id, videoId, takenAt',
      collections: '++id, name, createdAt',
      items: '++id, collectionId, videoId',
    });
  }
}

export const db = new HookInsightDb();

export interface DbHealth {
  videos: number;
  authors: number;
  snapshots: number;
  collections: number;
}

/** ใช้พิสูจน์ว่า Dexie ต่อติดจริง + โชว์จำนวนในคลัง */
export async function dbHealth(): Promise<Result<DbHealth>> {
  return attempt(
    'db/health',
    'เปิดคลังข้อมูลในเครื่องไม่ได้ — ลองปิดแล้วเปิดส่วนขยายใหม่อีกครั้ง',
    async () => ({
      videos: await db.videos.count(),
      authors: await db.authors.count(),
      snapshots: await db.snapshots.count(),
      collections: await db.collections.count(),
    }),
  );
}
