/**
 * นับ engagement ของเพจในช่วงเวลาหนึ่ง และคิดส่วนแบ่งเสียง
 *
 * ─── นิยามที่ต้องตกลงกันให้ชัดก่อน ───
 *
 * `engagement = รีแอ็กชัน + แชร์ + คอมเมนต์` ของ **โพสต์ที่เผยแพร่ในช่วงที่เลือก**
 *
 * ประโยคสุดท้ายสำคัญกว่าที่คิด และเป็นจุดที่เครื่องมือแต่ละตัวนิยามไม่เหมือนกัน:
 *
 *   ก) นับตามวันที่โพสต์ถูกเผยแพร่ (ที่เราใช้)
 *   ข) นับตามวันที่คนกดรีแอ็กชัน/คอมเมนต์
 *
 * แบบ (ข) "ถูกกว่า" ในเชิงบัญชี แต่ Meta ไม่ได้ให้ timestamp ของรีแอ็กชันมา
 * ให้มาแต่ยอดรวม ณ ตอนที่ดึง — ถ้าจะทำแบบ (ข) ต้องเก็บ snapshot ถี่ๆ แล้วหาผลต่าง
 * ซึ่งพลาดง่ายและข้อมูลย้อนหลังจะไม่มีวันถูก
 *
 * แบบ (ก) ตอบคำถามที่คนถามจริงได้ตรงกว่าด้วย: "คอนเทนต์เดือนนี้เวิร์กไหม"
 * ไม่ใช่ "เดือนนี้มีคนมากดของเก่ากี่ครั้ง"
 *
 * ผลข้างเคียงที่ต้องรู้: โพสต์ที่เพิ่งลงเมื่อวานยังเก็บ engagement ไม่ครบ
 * ตัวเลขของช่วงที่ชนขอบวันนี้จึงต่ำกว่าความจริงเสมอ — เทียบข้ามเพจได้
 * (ทุกเพจโดนเหมือนกัน) แต่เทียบข้ามช่วงเวลาต้องระวัง
 */

/** โพสต์หนึ่งใบพร้อมยอด ณ ตอนที่ดึงมาล่าสุด */
export interface PostStat {
  /** เวลาที่โพสต์ถูกเผยแพร่ (epoch ms, UTC — กฎข้อ 4) */
  publishedAtMs: number;
  reactions: number;
  shares: number;
  comments: number;
}

/** ช่วงเวลาแบบครึ่งเปิด `[startMs, endMs)` */
export interface Window {
  startMs: number;
  endMs: number;
}

export interface PageWindowStats {
  /** จำนวนโพสต์ที่เผยแพร่ในช่วงนี้ */
  posts: number;
  reactions: number;
  shares: number;
  comments: number;
  /** รีแอ็กชัน + แชร์ + คอมเมนต์ */
  engagement: number;
  /** engagement เฉลี่ยต่อโพสต์ — 0 โพสต์ให้เป็น 0 ไม่ใช่ NaN */
  perPost: number;
}

/** engagement ของโพสต์ใบเดียว */
export function engagementOf(post: PostStat): number {
  return post.reactions + post.shares + post.comments;
}

/**
 * โพสต์นี้อยู่ในช่วงไหม — ครึ่งเปิด `[start, end)`
 *
 * ปลายเปิดข้างขวาเพื่อให้ช่วงที่ต่อกันไม่นับซ้ำ: ช่วง ม.ค. กับ ก.พ. ที่ชนกัน
 * ตรงเที่ยงคืนวันที่ 1 ก.พ. พอดี จะไม่มีโพสต์ใบไหนถูกนับสองรอบ
 */
export function isInWindow(post: PostStat, window: Window): boolean {
  return post.publishedAtMs >= window.startMs && post.publishedAtMs < window.endMs;
}

/** สรุปยอดของเพจหนึ่งในช่วงที่กำหนด */
export function summarizeWindow(
  posts: readonly PostStat[],
  window: Window,
): PageWindowStats {
  let count = 0;
  let reactions = 0;
  let shares = 0;
  let comments = 0;

  for (const post of posts) {
    if (!isInWindow(post, window)) continue;
    count += 1;
    reactions += post.reactions;
    shares += post.shares;
    comments += post.comments;
  }

  const engagement = reactions + shares + comments;
  return {
    posts: count,
    reactions,
    shares,
    comments,
    engagement,
    perPost: count === 0 ? 0 : engagement / count,
  };
}

export interface VoiceInput {
  pageId: string;
  pageName: string;
  engagement: number;
}

export interface VoiceShare extends VoiceInput {
  /** สัดส่วนของ engagement ทั้งชุด หน่วยเป็นเปอร์เซ็นต์ (0–100) */
  sharePct: number;
}

export interface ShareOfVoice {
  totalEngagement: number;
  /** เรียงจากมากไปน้อย — เพจที่ครองเสียงมากสุดอยู่หัวเสมอ */
  shares: VoiceShare[];
  /** เพจที่ครองเสียงมากสุด — `null` เมื่อทั้งชุดยังไม่มี engagement เลย */
  leader: VoiceShare | null;
}

/**
 * ส่วนแบ่งเสียง — ใครครองบทสนทนาในกลุ่มเพจที่เฝ้าดูอยู่
 *
 * เพจที่ engagement เป็น 0 ยังต้องอยู่ในผลลัพธ์ (sharePct = 0) ไม่ใช่หายไป
 * — "เพจนี้เงียบสนิท" คือข้อมูล ไม่ใช่ความว่างเปล่า
 */
export function shareOfVoice(pages: readonly VoiceInput[]): ShareOfVoice {
  const totalEngagement = pages.reduce((sum, p) => sum + p.engagement, 0);

  const shares = pages
    .map((p) => ({
      ...p,
      // ทั้งชุดเป็น 0 → หารไม่ได้ ให้ทุกเพจเป็น 0 แทนที่จะเป็น NaN
      sharePct: totalEngagement === 0 ? 0 : (p.engagement / totalEngagement) * 100,
    }))
    // เรียงตาม engagement ไม่ใช่ตาม sharePct — ผลเท่ากันแต่ตรงกับสิ่งที่วัดจริง
    .sort((a, b) => b.engagement - a.engagement);

  return {
    totalEngagement,
    shares,
    leader: totalEngagement === 0 ? null : (shares[0] ?? null),
  };
}
