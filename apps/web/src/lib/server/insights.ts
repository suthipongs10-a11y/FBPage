import "server-only";

/**
 * เตรียมข้อมูลให้หน้าฟังเสียง — ของจริงจาก Postgres ไม่ใช่ข้อมูลตัวอย่าง
 *
 * ตรรกะการนับทั้งหมดอยู่ใน `@page-os/listening` ที่นี่มีหน้าที่แค่ดึงข้อมูล
 * มาป้อนแล้วจัดรูปให้หน้าจอใช้ — ไม่มีสูตรคำนวณของตัวเองแม้แต่บรรทัดเดียว
 */
import {
  shareOfVoice,
  summarizeWindow,
  type ShareOfVoice,
  type TrackedKind,
  type TrackedPlatform,
} from "@page-os/listening";
import { PrismaListeningQueries } from "@page-os/store";
import { prisma } from "@/lib/server/deps";

export interface PageInsight {
  id: string;
  externalId: string;
  platform: TrackedPlatform;
  name: string;
  kind: TrackedKind;
  followers: number | null;
  lastFetchedAtMs: number | null;
  posts: number;
  reactions: number;
  shares: number;
  comments: number;
  engagement: number;
  perPost: number;
  uniqueCommenters: number;
  /** สีประจำเพจ — คิดจากรหัสเพจ ไม่ใช่ลำดับในรายการ (สีจะได้ไม่สลับตอนเพิ่ม/ลบเพจ) */
  colorIndex: number;
}

export interface InsightsView {
  window: { fromMs: number; toMs: number; days: number };
  pages: PageInsight[];
  voice: ShareOfVoice;
  /** เวลาที่ดึงข้อมูลล่าสุดในบรรดาเพจทั้งหมด — `null` = ยังไม่เคยดึงเลย */
  lastFetchedAtMs: number | null;
  /** `null` เมื่อยังต่อฐานข้อมูลไม่ได้ — หน้าจอจะได้บอกเหตุผลแทนที่จะพัง */
  errorTh: string | null;
}

/** จำนวนสีที่หน้าจอมีให้ — ต้องตรงกับชุดสีใน globals.css */
const COLOR_COUNT = 8;

function colorIndexOf(externalId: string): number {
  let h = 0;
  for (let i = 0; i < externalId.length; i++) h = (h * 31 + externalId.charCodeAt(i)) >>> 0;
  return h % COLOR_COUNT;
}

/** แปล error ของฐานข้อมูลเป็นสิ่งที่ทำต่อได้ (เหมือนหน้า /settings) */
function describeDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Can't reach database server")) {
    return "ต่อฐานข้อมูลไม่ได้ — สั่ง docker compose up -d แล้วรีเฟรชหน้านี้";
  }
  if (msg.includes("does not exist") || msg.includes("P2021")) {
    return "ยังไม่ได้สร้างตารางในฐานข้อมูล — สั่ง pnpm db:push แล้วรีเฟรช";
  }
  return `อ่านข้อมูลไม่สำเร็จ: ${msg.split("\n")[0]}`;
}

export async function loadInsights(args: {
  nowMs: number;
  days: number;
}): Promise<InsightsView> {
  const toMs = args.nowMs;
  const fromMs = toMs - args.days * 86_400_000;
  const empty: InsightsView = {
    window: { fromMs, toMs, days: args.days },
    pages: [],
    voice: { totalEngagement: 0, shares: [], leader: null },
    lastFetchedAtMs: null,
    errorTh: null,
  };

  let rows;
  try {
    rows = await new PrismaListeningQueries(prisma()).pagesWithPosts({ fromMs, toMs });
  } catch (err) {
    return { ...empty, errorTh: describeDbError(err) };
  }

  const pages: PageInsight[] = rows.map((r) => {
    const stats = summarizeWindow(r.posts, { startMs: fromMs, endMs: toMs });
    return {
      id: r.id,
      externalId: r.externalId,
      platform: r.platform,
      name: r.name,
      kind: r.kind,
      followers: r.followers,
      lastFetchedAtMs: r.lastFetchedAtMs,
      uniqueCommenters: r.uniqueCommenters,
      colorIndex: colorIndexOf(r.externalId),
      ...stats,
    };
  });

  const fetchedTimes = pages
    .map((p) => p.lastFetchedAtMs)
    .filter((t): t is number => t !== null);

  return {
    ...empty,
    pages,
    voice: shareOfVoice(
      pages.map((p) => ({
        pageId: p.id,
        pageName: p.name,
        engagement: p.engagement,
      })),
    ),
    lastFetchedAtMs: fetchedTimes.length === 0 ? null : Math.max(...fetchedTimes),
  };
}

/**
 * ตัวเทียบทั้งหมดอยู่ใน `@/lib/insights-compare` ซึ่งเป็นฟังก์ชันบริสุทธิ์
 *
 * แยกไว้เพราะไฟล์นี้มี `import "server-only"` — อะไรที่อยู่ในนี้จะ import
 * เข้ามาในเทสต์ไม่ได้เลย ส่งต่อไว้ตรงนี้เพื่อให้ฝั่งหน้าจอ import ที่เดียวได้เหมือนเดิม
 */
export {
  gapAgainstStrongest,
  gapBetween,
  hasMixedPlatforms,
  toGapSide,
} from "@/lib/insights-compare";
