/**
 * แฟนตัวยง และคนที่คอมเมนต์ทับซ้อนกันข้ามเพจ
 *
 * ─── ข้อจำกัดที่ต้องรู้ก่อนอ่านตัวเลขพวกนี้ ───
 *
 * Meta ให้ `id` ของคนคอมเมนต์มาเป็น **page-scoped id** — คนคนเดียวกันจะได้
 * รหัสคนละตัวในแต่ละเพจโดยตั้งใจ (เป็นมาตรการความเป็นส่วนตัวของ Meta)
 *
 * ผลคือ:
 *   - **ในเพจเดียวกัน** จับ "คนเดียวกัน" ได้แม่นยำด้วยรหัส
 *   - **ข้ามเพจ** จับด้วยรหัสไม่ได้เลย เหลือแต่ชื่อซึ่งซ้ำกันได้จริง
 *     (ประเทศไทยมีคนชื่อ "สมชาย ใจดี" มากกว่าหนึ่งคนแน่นอน)
 *
 * ตัวเลข "ผู้ชมที่ทับซ้อนกัน" จึงเป็น **ค่าประมาณขอบบน** ไม่ใช่ความจริง
 * — ทุกฟังก์ชันในไฟล์นี้ที่ข้ามเพจจะบอกไว้ในชื่อและในผลลัพธ์ว่าเป็นการเดา
 * ห้ามเอาไปแสดงบนหน้าจอโดยไม่มีคำกำกับ
 */

export interface CommentAuthor {
  /** page-scoped id จาก Meta — `null` เมื่อคนคอมเมนต์ไม่ได้ให้สิทธิ์แอปเรา */
  authorId: string | null;
  authorName: string | null;
  /** เพจที่คอมเมนต์นี้อยู่ (id ภายในของเรา) */
  trackedPageId: string;
}

export interface TopFan {
  /** ชื่อที่เอาไปแสดง — คนที่ไม่รู้ชื่อจะไม่โผล่ในรายการนี้เลย */
  name: string;
  comments: number;
}

/**
 * แฟนตัวยงของเพจหนึ่ง — ใครคอมเมนต์เยอะสุด
 *
 * นับด้วย `authorId` ก่อนเสมอ เพราะในเพจเดียวกันรหัสเชื่อถือได้ ถ้าไม่มีรหัส
 * ค่อยถอยไปใช้ชื่อ — คนที่ไม่มีทั้งสองอย่างไม่ถูกนับ (ดีกว่ายุบรวมเป็นคนเดียว
 * แล้วได้ "แฟนตัวยงอันดับ 1" ที่จริงๆ คือคนละสิบคนรวมกัน)
 */
export function topFansOfPage(
  comments: readonly CommentAuthor[],
  limit = 10,
): TopFan[] {
  /** คีย์ → { ชื่อที่จะแสดง, จำนวน } */
  const byPerson = new Map<string, { name: string; comments: number }>();

  for (const c of comments) {
    const key = c.authorId ?? c.authorName;
    if (key === null) continue;
    // ไม่รู้ชื่อก็แสดงไม่ได้ — เก็บไว้ก็ไม่มีประโยชน์กับหน้าจอ
    const name = c.authorName;
    if (name === null || name.trim() === "") continue;

    const found = byPerson.get(key);
    if (found === undefined) byPerson.set(key, { name, comments: 1 });
    else found.comments += 1;
  }

  return [...byPerson.values()]
    .sort((a, b) => b.comments - a.comments || a.name.localeCompare(b.name, "th"))
    .slice(0, limit);
}

export interface OverlapPerson {
  name: string;
  /** จำนวนเพจที่ชื่อนี้ไปคอมเมนต์ */
  pages: number;
  comments: number;
}

export interface OverlapResult {
  people: OverlapPerson[];
  /**
   * เตือนว่าตัวเลขนี้เชื่อได้แค่ไหน — หน้าจอ**ต้อง**แสดงข้อความนี้
   * เพราะเป็นการจับคู่ด้วยชื่อ ไม่ใช่ด้วยรหัส
   */
  caveatTh: string;
}

/**
 * คนที่คอมเมนต์ในหลายเพจ — "ผู้ชมที่ทับซ้อนกัน"
 *
 * ⚠️ จับคู่ด้วย**ชื่อ**เท่านั้น เพราะ Meta ออกรหัสคนละตัวให้แต่ละเพจโดยตั้งใจ
 * คนชื่อซ้ำกันจะถูกนับรวมเป็นคนเดียว — เป็นค่าประมาณขอบบนเสมอ
 */
export function overlapAcrossPages(
  comments: readonly CommentAuthor[],
  opts: { minPages?: number; limit?: number } = {},
): OverlapResult {
  const minPages = opts.minPages ?? 2;
  const limit = opts.limit ?? 20;

  const byName = new Map<string, { pages: Set<string>; comments: number }>();
  for (const c of comments) {
    const name = c.authorName;
    if (name === null || name.trim() === "") continue;
    const found = byName.get(name);
    if (found === undefined) {
      byName.set(name, { pages: new Set([c.trackedPageId]), comments: 1 });
    } else {
      found.pages.add(c.trackedPageId);
      found.comments += 1;
    }
  }

  const people = [...byName.entries()]
    .map(([name, v]) => ({ name, pages: v.pages.size, comments: v.comments }))
    .filter((p) => p.pages >= minPages)
    .sort((a, b) => b.pages - a.pages || b.comments - a.comments)
    .slice(0, limit);

  return {
    people,
    caveatTh:
      "จับคู่ด้วยชื่อเท่านั้น — Meta ออกรหัสผู้ใช้คนละตัวให้แต่ละเพจโดยตั้งใจ " +
      "คนชื่อซ้ำกันจะถูกนับรวมเป็นคนเดียว ตัวเลขนี้จึงเป็นค่าประมาณขอบบน",
  };
}

export interface FanBoard {
  trackedPageId: string;
  pageName: string;
  fans: TopFan[];
}

/** แฟนตัวยงแยกตามเพจ — สำหรับวางเรียงกันบนหน้าจอ */
export function fanBoards(
  args: {
    pages: ReadonlyArray<{ id: string; name: string }>;
    comments: readonly CommentAuthor[];
    limit?: number;
  },
): FanBoard[] {
  return args.pages
    .map((p) => ({
      trackedPageId: p.id,
      pageName: p.name,
      fans: topFansOfPage(
        args.comments.filter((c) => c.trackedPageId === p.id),
        args.limit ?? 10,
      ),
    }))
    // เพจที่ยังไม่มีคอมเมนต์เลยไม่ต้องขึ้นกล่องเปล่าให้รก
    .filter((b) => b.fans.length > 0);
}
