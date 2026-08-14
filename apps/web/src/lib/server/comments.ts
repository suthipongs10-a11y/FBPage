import "server-only";

/**
 * เตรียมข้อมูลให้หน้า "อ่านคอมเมนต์"
 *
 * เหมือน `insights.ts` — ที่นี่ไม่มีสูตรของตัวเอง ตรรกะการจัดหมวดและการนับ
 * แฟนตัวยงอยู่ใน `@page-os/listening` ทั้งหมด
 */
import {
  fanBoards,
  overlapAcrossPages,
  tallyTopics,
  type FanBoard,
  type OverlapResult,
  type TopicSummary,
} from "@page-os/listening";
import {
  PrismaListeningQueries,
  type CommentRow,
  type TrackedPageRow,
} from "@page-os/store";
import { prisma } from "@/lib/server/deps";

export interface CommentsView {
  window: { fromMs: number; toMs: number; days: number };
  pages: TrackedPageRow[];
  /** เพจที่กำลังกรองอยู่ — `null` = ทุกเพจ */
  selectedPageId: string | null;
  keyword: string;
  rows: CommentRow[];
  /** จำนวนคอมเมนต์ทั้งหมดที่ตรงเงื่อนไข (ไม่ใช่แค่หน้านี้) */
  total: number;
  page: number;
  pageSize: number;
  topics: TopicSummary;
  /** `true` = ตัวเลขหัวข้อคิดจากตัวอย่างบางส่วน ไม่ใช่ทั้งหมด */
  topicsFromSample: boolean;
  fans: FanBoard[];
  overlap: OverlapResult;
  errorTh: string | null;
}

export const COMMENTS_PAGE_SIZE = 25;

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

export async function loadComments(args: {
  nowMs: number;
  days: number;
  trackedPageId?: string | undefined;
  keyword?: string | undefined;
  page?: number | undefined;
}): Promise<CommentsView> {
  const toMs = args.nowMs;
  const fromMs = toMs - args.days * 86_400_000;
  const keyword = args.keyword?.trim() ?? "";
  const page = Math.max(1, args.page ?? 1);

  const base: CommentsView = {
    window: { fromMs, toMs, days: args.days },
    pages: [],
    selectedPageId: args.trackedPageId ?? null,
    keyword,
    rows: [],
    total: 0,
    page,
    pageSize: COMMENTS_PAGE_SIZE,
    topics: { total: 0, topics: [], questions: 0, questionPct: 0, uncategorized: 0 },
    topicsFromSample: false,
    fans: [],
    overlap: { people: [], caveatTh: "" },
    errorTh: null,
  };

  try {
    const q = new PrismaListeningQueries(prisma());
    const filter = {
      fromMs,
      toMs,
      ...(args.trackedPageId !== undefined ? { trackedPageId: args.trackedPageId } : {}),
      ...(keyword === "" ? {} : { keyword }),
    };

    const [pages, found, digest] = await Promise.all([
      q.listPages(),
      q.searchComments({
        ...filter,
        limit: COMMENTS_PAGE_SIZE,
        offset: (page - 1) * COMMENTS_PAGE_SIZE,
      }),
      q.commentDigest(filter),
    ]);

    /**
     * แฟนตัวยงกับผู้ชมทับซ้อน **ไม่กรองตามคำค้น** โดยตั้งใจ — สองอย่างนี้ตอบคำถาม
     * "ใครคือขาประจำของเพจนี้" ซึ่งไม่เกี่ยวกับคำที่กำลังค้นอยู่ ถ้ากรองตามคำค้นด้วย
     * ตัวเลขจะกลายเป็น "ใครพูดคำนี้บ่อยสุด" ซึ่งเป็นคนละคำถามและทำให้เข้าใจผิด
     */
    const fanDigest =
      keyword === ""
        ? digest
        : await q.commentDigest({
            fromMs,
            toMs,
            ...(args.trackedPageId !== undefined
              ? { trackedPageId: args.trackedPageId }
              : {}),
          });

    return {
      ...base,
      pages,
      rows: found.rows,
      total: found.total,
      topics: tallyTopics(digest.messages),
      topicsFromSample: digest.truncated,
      fans: fanBoards({
        pages: pages.map((p) => ({ id: p.id, name: p.name })),
        comments: fanDigest.authors,
      }),
      overlap: overlapAcrossPages(fanDigest.authors),
    };
  } catch (err) {
    return { ...base, errorTh: describeDbError(err) };
  }
}
