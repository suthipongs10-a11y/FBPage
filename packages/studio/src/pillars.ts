/**
 * Content Pillars (M5)
 *
 * สเปก: "ตั้งสัดส่วน เช่น ให้ความรู้ 40% / ขาย 30% / มีส่วนร่วม 20% / เบื้องหลัง 10%
 *        → ระบบสุ่มตามสัดส่วนเวลาสร้างปฏิทินทั้งเดือน"
 *
 * ทำไมเรื่องนี้สำคัญ: เพจที่โพสต์ขายอย่างเดียวคนเลิกติดตาม เพจที่ไม่ขายเลย
 * ลูกค้าไม่รู้ว่าขายอะไร สัดส่วนคือสิ่งที่เอเจนซี่มืออาชีพต่างจากคนโพสต์มั่ว
 *
 * **ไม่สุ่มจริง** — ใช้การกระจายแบบกำหนดได้ (ดู distributePillars)
 * เพราะการสุ่มจริงทำให้บางเดือนได้โพสต์ขาย 8 วันติด ซึ่งแย่กว่าไม่ตั้งสัดส่วนเลย
 */

export type PillarKey =
  | "educate"
  | "sell"
  | "engage"
  | "behind_scenes"
  | "social_proof"
  | "seasonal";

export interface Pillar {
  key: PillarKey;
  labelTh: string;
  /** สัดส่วน 0-100 */
  percent: number;
  /** คำอธิบายให้ LLM รู้ว่าโพสต์แนวนี้หน้าตายังไง */
  guidanceTh: string;
}

export const PILLAR_LABELS: Record<PillarKey, string> = {
  educate: "ให้ความรู้",
  sell: "ขาย",
  engage: "มีส่วนร่วม",
  behind_scenes: "เบื้องหลัง",
  social_proof: "รีวิว/ความน่าเชื่อถือ",
  seasonal: "ตามเทศกาล",
};

const PILLAR_GUIDANCE: Record<PillarKey, string> = {
  educate:
    "ให้ความรู้ที่ผู้อ่านเอาไปใช้ได้จริง ไม่ต้องซื้อก็ได้ประโยชน์ ห้ามขายตรงๆ",
  sell: "เสนอสินค้า/บริการชัดเจน บอกราคาหรือโปรโมชั่น และปิดด้วย CTA",
  engage:
    "ชวนคุย ถามคำถามที่ตอบง่าย หรือให้เลือกระหว่างสองอย่าง เป้าหมายคือคอมเมนต์",
  behind_scenes:
    "เล่าเบื้องหลังการทำงาน ทีมงาน หรือขั้นตอนการผลิต ให้รู้สึกเป็นคนจริง",
  social_proof:
    "ยกรีวิวลูกค้า ผลลัพธ์ที่เกิดขึ้นจริง หรือตัวเลขที่พิสูจน์ได้ ห้ามแต่งรีวิวขึ้นเอง",
  seasonal: "ผูกกับเทศกาลหรือเหตุการณ์ในช่วงนั้น ให้รู้สึกทันเวลา",
};

/** สัดส่วนเริ่มต้นตามที่สเปกยกตัวอย่าง */
export const DEFAULT_PILLARS: Pillar[] = [
  { key: "educate", labelTh: PILLAR_LABELS.educate, percent: 40, guidanceTh: PILLAR_GUIDANCE.educate },
  { key: "sell", labelTh: PILLAR_LABELS.sell, percent: 30, guidanceTh: PILLAR_GUIDANCE.sell },
  { key: "engage", labelTh: PILLAR_LABELS.engage, percent: 20, guidanceTh: PILLAR_GUIDANCE.engage },
  {
    key: "behind_scenes",
    labelTh: PILLAR_LABELS.behind_scenes,
    percent: 10,
    guidanceTh: PILLAR_GUIDANCE.behind_scenes,
  },
];

export class PillarError extends Error {
  override readonly name = "PillarError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

/** สัดส่วนต้องรวมได้ 100 ไม่งั้นแผนเดือนจะเพี้ยน */
export function validatePillars(pillars: readonly Pillar[]): void {
  if (pillars.length === 0) {
    throw new PillarError(
      "no pillars",
      "ต้องตั้งสัดส่วนคอนเทนต์อย่างน้อย 1 ประเภท",
    );
  }
  const total = pillars.reduce((s, p) => s + p.percent, 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new PillarError(
      `pillars total ${total}`,
      `สัดส่วนรวมได้ ${total}% ต้องเป็น 100% พอดี`,
    );
  }
  for (const p of pillars) {
    if (p.percent < 0) {
      throw new PillarError(
        `negative percent for ${p.key}`,
        `สัดส่วนของ "${p.labelTh}" ติดลบไม่ได้`,
      );
    }
  }
  const keys = new Set(pillars.map((p) => p.key));
  if (keys.size !== pillars.length) {
    throw new PillarError("duplicate pillar", "มีประเภทคอนเทนต์ซ้ำกัน");
  }
}

/**
 * กระจายเสาหลักลงจำนวนโพสต์ที่กำหนด
 *
 * ใช้วิธี **largest remainder** เพื่อให้ผลรวมตรงกับจำนวนโพสต์เป๊ะ
 * (ปัดเศษแบบธรรมดาทำให้ได้ 29 หรือ 31 โพสต์ตอนขอ 30)
 *
 * แล้ว **สลับลำดับให้กระจาย** ไม่ใช่เรียงกันเป็นก้อน — โพสต์ขาย 9 วันติด
 * แย่กว่าไม่ตั้งสัดส่วนเลย
 */
export function distributePillars(
  pillars: readonly Pillar[],
  totalPosts: number,
): PillarKey[] {
  validatePillars(pillars);
  if (totalPosts <= 0) return [];

  // ขั้นที่ 1: หาจำนวนโพสต์ต่อเสา ด้วย largest remainder
  const exact = pillars.map((p) => ({
    key: p.key,
    exact: (p.percent / 100) * totalPosts,
  }));
  const counts = exact.map((e) => ({ key: e.key, count: Math.floor(e.exact) }));
  let remaining = totalPosts - counts.reduce((s, c) => s + c.count, 0);

  const byRemainder = exact
    .map((e, i) => ({ i, rem: e.exact - Math.floor(e.exact) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);

  let idx = 0;
  while (remaining > 0) {
    const target = byRemainder[idx % byRemainder.length]!;
    counts[target.i]!.count++;
    remaining--;
    idx++;
  }

  // ขั้นที่ 2: เรียงให้กระจาย — ใช้วิธีเดียวกับการแบ่งที่นั่ง (Sainte-Laguë)
  // เสาที่มีโควตาเหลือมากที่สุดเทียบกับที่ใช้ไปแล้ว ได้คิวถัดไป
  const used = new Map<PillarKey, number>(counts.map((c) => [c.key, 0]));
  const quota = new Map<PillarKey, number>(counts.map((c) => [c.key, c.count]));
  const out: PillarKey[] = [];

  for (let slot = 0; slot < totalPosts; slot++) {
    let best: PillarKey | null = null;
    let bestScore = -Infinity;
    for (const c of counts) {
      const q = quota.get(c.key)!;
      const u = used.get(c.key)!;
      if (u >= q) continue;
      // สัดส่วนที่ยังไม่ได้ใช้ ยิ่งมากยิ่งควรได้คิวก่อน
      const score = (q - u) / (u + 1);
      if (score > bestScore) {
        bestScore = score;
        best = c.key;
      }
    }
    if (best === null) break;
    out.push(best);
    used.set(best, used.get(best)! + 1);
  }
  return out;
}

export interface PillarPlanEntry {
  /** ลำดับที่เท่าไหร่ในเดือน (0-based) */
  index: number;
  pillar: PillarKey;
  labelTh: string;
  guidanceTh: string;
}

/** แผนคอนเทนต์ทั้งเดือน พร้อมคำแนะนำต่อโพสต์ */
export function buildPillarPlan(
  pillars: readonly Pillar[],
  totalPosts: number,
): PillarPlanEntry[] {
  const byKey = new Map(pillars.map((p) => [p.key, p]));
  return distributePillars(pillars, totalPosts).map((pillar, index) => {
    const p = byKey.get(pillar)!;
    return {
      index,
      pillar,
      labelTh: p.labelTh,
      guidanceTh: p.guidanceTh,
    };
  });
}

/** สรุปว่าแผนที่ได้ตรงกับสัดส่วนที่ตั้งไว้แค่ไหน — ใช้แสดงในหน้าปฏิทิน */
export function summarizePlan(
  plan: readonly PillarPlanEntry[],
): { key: PillarKey; labelTh: string; count: number; percent: number }[] {
  const counts = new Map<PillarKey, { labelTh: string; count: number }>();
  for (const e of plan) {
    const cur = counts.get(e.pillar) ?? { labelTh: e.labelTh, count: 0 };
    cur.count++;
    counts.set(e.pillar, cur);
  }
  const total = plan.length || 1;
  return [...counts.entries()]
    .map(([key, v]) => ({
      key,
      labelTh: v.labelTh,
      count: v.count,
      percent: Math.round((v.count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

export function pillarFromKey(key: PillarKey, percent: number): Pillar {
  return {
    key,
    labelTh: PILLAR_LABELS[key],
    percent,
    guidanceTh: PILLAR_GUIDANCE[key],
  };
}
