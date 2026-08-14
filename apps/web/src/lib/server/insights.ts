import "server-only";

/**
 * เตรียมข้อมูลให้หน้าฟังเสียง — ของจริงจาก Postgres ไม่ใช่ข้อมูลตัวอย่าง
 *
 * ตรรกะการนับทั้งหมดอยู่ใน `@page-os/listening` ที่นี่มีหน้าที่แค่ดึงข้อมูล
 * มาป้อนแล้วจัดรูปให้หน้าจอใช้ — ไม่มีสูตรคำนวณของตัวเองแม้แต่บรรทัดเดียว
 */
import {
  compareGap,
  compareWithStrongest,
  shareOfVoice,
  summarizeWindow,
  type GapResult,
  type GapSide,
  type ShareOfVoice,
  type TrackedKind,
} from "@page-os/listening";
import { PrismaListeningQueries } from "@page-os/store";
import { prisma } from "@/lib/server/deps";

export interface PageInsight {
  id: string;
  fbPageId: string;
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

function colorIndexOf(fbPageId: string): number {
  let h = 0;
  for (let i = 0; i < fbPageId.length; i++) h = (h * 31 + fbPageId.charCodeAt(i)) >>> 0;
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
      fbPageId: r.fbPageId,
      name: r.name,
      kind: r.kind,
      followers: r.followers,
      lastFetchedAtMs: r.lastFetchedAtMs,
      uniqueCommenters: r.uniqueCommenters,
      colorIndex: colorIndexOf(r.fbPageId),
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

/** แปลง `PageInsight` เป็นรูปที่ตัวเทียบช่องว่างรับ */
export function toGapSide(p: PageInsight): GapSide {
  return {
    pageId: p.id,
    pageName: p.name,
    posts: p.posts,
    followers: p.followers ?? 0,
    engagement: p.engagement,
  };
}

/**
 * เทียบเพจของเรากับคู่แข่งที่แรงที่สุด
 *
 * "เพจของเรา" = เพจที่ `kind === "OWNED"` ตัวแรก ถ้าไม่ได้ระบุมา — คนที่ยังไม่เคย
 * ตั้งค่าอะไรเลยจะได้เห็นของที่มีความหมายทันทีโดยไม่ต้องเลือกก่อน
 */
export function gapAgainstStrongest(args: {
  pages: PageInsight[];
  ourPageId?: string | undefined;
}): { ours: PageInsight | null; result: GapResult } {
  const ours =
    args.pages.find((p) => p.id === args.ourPageId) ??
    args.pages.find((p) => p.kind === "OWNED") ??
    null;

  if (ours === null) {
    return {
      ours: null,
      result: {
        ok: false,
        reasonTh: 'ยังไม่ได้บอกว่าเพจไหนเป็นของเรา — เพิ่มเพจแบบ "เพจของเรา" ก่อน',
      },
    };
  }

  return {
    ours,
    result: compareWithStrongest({
      ours: toGapSide(ours),
      others: args.pages.map(toGapSide),
    }),
  };
}

/** เทียบสองเพจที่เลือกมาเอง */
export function gapBetween(args: {
  pages: PageInsight[];
  ourId: string;
  theirId: string;
}): GapResult {
  const ours = args.pages.find((p) => p.id === args.ourId);
  const theirs = args.pages.find((p) => p.id === args.theirId);
  if (ours === undefined || theirs === undefined) {
    return { ok: false, reasonTh: "ไม่พบเพจที่เลือก — อาจถูกเอาออกจากระบบไปแล้ว" };
  }
  return compareGap({ ours: toGapSide(ours), theirs: toGapSide(theirs) });
}
