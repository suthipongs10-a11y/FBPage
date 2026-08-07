/**
 * Bot Performance (M7)
 *
 * "อัตราแก้ปัญหาได้เอง (containment rate), คำถามที่บอทตอบไม่ได้บ่อยสุด
 *  → ใช้ปรับ Knowledge Base"
 *
 * ตัวเลขนี้คือหลักฐานว่าบริการเราคุ้มค่า และเป็นตัวชี้ว่าควรเติมอะไรใน KB ต่อ
 * (เกณฑ์ผ่านของ M-F ตามสเปกคือ containment rate > 50%)
 */

export interface ConversationOutcome {
  conversationId: string;
  /** บอทตอบไปกี่ข้อความในบทสนทนานี้ */
  botMessages: number;
  /** คนตอบไปกี่ข้อความ */
  humanMessages: number;
  /** บอทยกธงส่งต่อให้คนหรือไม่ */
  escalated: boolean;
  /** ข้อความแรกของลูกค้า — ใช้จัดกลุ่มคำถามที่บอทตอบไม่ได้ */
  firstUserMessage: string;
  startedAtMs: number;
}

export interface ContainmentStats {
  total: number;
  /** บอทจบงานได้เองโดยคนไม่ต้องเข้าไปยุ่ง */
  contained: number;
  /** ต้องให้คนเข้าไปตอบ */
  escalated: number;
  /** 0-1 */
  containmentRate: number;
  th: string;
}

/**
 * นับว่าบอทจบงานได้เองกี่บทสนทนา
 *
 * นิยาม "จบเอง" ที่ใช้: บอทตอบอย่างน้อย 1 ครั้ง, ไม่ยกธง escalate,
 * และคนไม่ได้เข้าไปพิมพ์เลย
 *
 * บทสนทนาที่บอทไม่ได้ตอบเลย (เช่น ปิดบอทไว้) ไม่นับเป็นตัวหาร
 * ไม่งั้นตัวเลขจะดูแย่ทั้งที่บอทไม่ได้ทำงานตั้งแต่แรก
 */
export function computeContainment(
  conversations: readonly ConversationOutcome[],
): ContainmentStats {
  const relevant = conversations.filter((c) => c.botMessages > 0);
  const total = relevant.length;

  if (total === 0) {
    return {
      total: 0,
      contained: 0,
      escalated: 0,
      containmentRate: 0,
      th: "เดือนนี้บอทยังไม่ได้ทำงานเลย (อาจปิดไว้หรือยังไม่มีคนทัก)",
    };
  }

  const contained = relevant.filter(
    (c) => !c.escalated && c.humanMessages === 0,
  ).length;
  const escalated = total - contained;
  const rate = contained / total;

  return {
    total,
    contained,
    escalated,
    containmentRate: rate,
    th: `บอทจบงานได้เอง ${contained} จาก ${total} บทสนทนา (${(rate * 100).toFixed(1)}%)${
      rate >= 0.5
        ? " — ผ่านเกณฑ์ที่ตั้งไว้"
        : " — ยังต่ำกว่าเกณฑ์ 50% ควรเติมข้อมูลใน Knowledge Base"
    }`,
  };
}

export interface UnansweredQuestion {
  /** ข้อความตัวแทนของกลุ่มนี้ */
  sample: string;
  count: number;
  /** คำที่ใช้จัดกลุ่ม */
  keywords: string[];
}

/** คำที่ไม่มีความหมายในการจัดกลุ่มคำถาม */
const STOPWORDS = new Set([
  "ค่ะ",
  "คะ",
  "ครับ",
  "นะ",
  "จ้า",
  "ๆ",
  "ที่",
  "และ",
  "หรือ",
  "แล้ว",
  "ได้",
  "มี",
  "เป็น",
  "ของ",
  "ให้",
  "กับ",
  "ไหม",
  "มั้ย",
  "อะ",
  "หน่อย",
  "ขอ",
]);

/**
 * หาคำถามที่บอทตอบไม่ได้บ่อยที่สุด เพื่อเอาไปเติม Knowledge Base
 *
 * จัดกลุ่มด้วยคำสำคัญที่ใช้ร่วมกัน — ไม่ใช้ embedding เพราะตัวเลขนี้ดูเดือนละครั้ง
 * ความแม่นระดับ "พอรู้ว่าควรเติมเรื่องอะไร" ก็เพียงพอแล้ว
 */
export function findUnansweredQuestions(
  conversations: readonly ConversationOutcome[],
  topN = 10,
): UnansweredQuestion[] {
  const escalated = conversations.filter(
    (c) => c.escalated && c.firstUserMessage.trim() !== "",
  );
  if (escalated.length === 0) return [];

  // จัดกลุ่มตามคำสำคัญที่เจอร่วมกัน
  const groups = new Map<
    string,
    { sample: string; count: number; keywords: Set<string> }
  >();

  for (const c of escalated) {
    const words = tokenize(c.firstUserMessage);
    if (words.length === 0) continue;
    // ใช้คำสำคัญ 2 ตัวแรกเป็นกุญแจกลุ่ม
    const key = words.slice(0, 2).sort().join("|");
    const g = groups.get(key);
    if (g) {
      g.count++;
      for (const w of words) g.keywords.add(w);
    } else {
      groups.set(key, {
        sample: c.firstUserMessage.trim(),
        count: 1,
        keywords: new Set(words),
      });
    }
  }

  return [...groups.values()]
    .map((g) => ({
      sample: g.sample,
      count: g.count,
      keywords: [...g.keywords].slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count || a.sample.localeCompare(b.sample, "th"))
    .slice(0, topN);
}

/**
 * ตัดคำแบบหยาบๆ — ภาษาไทยไม่เว้นวรรค จึงตัดตามช่องว่างที่มี
 * แล้วเก็บเฉพาะคำที่ยาวพอจะมีความหมาย
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}
