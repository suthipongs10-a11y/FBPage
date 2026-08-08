/**
 * Brand Brief ต่อเพจ (M5)
 *
 * สเปก: "กลุ่มเป้าหมาย, โทน, คำต้องห้าม, CTA ประจำ, สินค้า/บริการ"
 *
 * นี่คือไฟล์ที่ตัดสินว่าคอนเทนต์ที่ AI สร้างจะ "เหมือนเพจนั้นเขียนเอง" หรือ
 * "เหมือน AI เขียน" — ซึ่งเป็นเส้นแบ่งว่าลูกค้าจะจ่ายต่อหรือเลิกจ้าง
 */

export interface BrandBrief {
  pageId: string;
  /** ชื่อที่ใช้เรียกในคอนเทนต์ */
  brandName: string;
  /** ธุรกิจอะไร — บอกให้ชัดพอที่ AI จะไม่เขียนกว้างจนไร้ประโยชน์ */
  business: string;
  /** กลุ่มเป้าหมาย เช่น "แม่บ้านวัย 30-45 ในกรุงเทพ ที่ใส่ใจสุขภาพ" */
  audience: string;
  /** สินค้า/บริการหลัก */
  products: string[];
  /** จุดขายที่ต่างจากคู่แข่ง */
  differentiators?: string[];
  /** CTA ประจำ เช่น "ทักแชทเลย" "กดสั่งที่ลิงก์ในโพสต์" */
  ctas: string[];
  /** คำที่ห้ามใช้เด็ดขาด (กฎหมาย/แบรนด์) */
  bannedWords: string[];
  /** ตัวอย่างโพสต์ที่ลูกค้าชอบ — ช่วยให้ AI จับโทนได้ตรงกว่าคำอธิบาย */
  samplePosts?: string[];
  /** ห้ามพูดถึงหัวข้อพวกนี้ */
  avoidTopics?: string[];
}

export class BrandBriefError extends Error {
  override readonly name = "BrandBriefError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface BriefCompleteness {
  score: number;
  missing: string[];
  /** พร้อมให้ AI สร้างคอนเทนต์ได้ไหม */
  ready: boolean;
  th: string;
}

/**
 * ตรวจว่า Brand Brief ครบพอจะสร้างคอนเทนต์ดีๆ ได้หรือยัง
 *
 * เหตุผลที่ต้องมี: brief ที่กรอกครึ่งๆ ทำให้ AI เขียนคอนเทนต์กลางๆ ที่ใช้กับ
 * เพจไหนก็ได้ ลูกค้าอ่านแล้วรู้ทันทีว่าไม่ได้ตั้งใจทำให้ — แล้วเลิกจ้าง
 * บอกตั้งแต่ตอนตั้งค่าดีกว่าปล่อยให้สร้างของห่วยออกมา
 */
export function checkBrief(brief: BrandBrief): BriefCompleteness {
  const missing: string[] = [];

  if (brief.brandName.trim() === "") missing.push("ชื่อแบรนด์");
  if (brief.business.trim().length < 5) missing.push("ประเภทธุรกิจ");
  if (brief.audience.trim().length < 10) missing.push("กลุ่มเป้าหมาย");
  if (brief.products.length === 0) missing.push("สินค้า/บริการ");
  if (brief.ctas.length === 0) missing.push("CTA ประจำ");

  // ไม่ใช่ของบังคับ แต่ขาดแล้วคอนเทนต์จืดลงชัดเจน
  const optional: string[] = [];
  if (!brief.differentiators?.length) optional.push("จุดขายที่ต่างจากคู่แข่ง");
  if (!brief.samplePosts?.length) optional.push("ตัวอย่างโพสต์ที่ชอบ");

  const required = 5;
  const score = Math.max(0, (required - missing.length) / required);
  const ready = missing.length === 0;

  let th: string;
  if (!ready) {
    th = `ยังกรอกไม่ครบ ขาด: ${missing.join(", ")} — กรอกให้ครบก่อนให้ AI สร้างคอนเทนต์ ไม่งั้นจะได้ของกลางๆ ที่ใช้กับเพจไหนก็ได้`;
  } else if (optional.length > 0) {
    th = `ครบพอใช้งานแล้ว แต่ถ้าเพิ่ม ${optional.join(" และ ")} คอนเทนต์จะตรงกับเพจมากขึ้นอีก`;
  } else {
    th = "Brand Brief ครบถ้วน พร้อมสร้างคอนเทนต์";
  }

  return { score, missing, ready, th };
}

/** ประกอบ brief เป็นคำสั่งให้ LLM — ภาษาไทยทั้งหมด */
export function briefToPrompt(brief: BrandBrief): string {
  const lines = [
    `แบรนด์: ${brief.brandName}`,
    `ธุรกิจ: ${brief.business}`,
    `กลุ่มเป้าหมาย: ${brief.audience}`,
    `สินค้า/บริการ: ${brief.products.join(", ")}`,
  ];

  if (brief.differentiators?.length) {
    lines.push(`จุดขายที่ต่างจากคู่แข่ง: ${brief.differentiators.join(", ")}`);
  }
  lines.push(`CTA ที่ใช้ประจำ: ${brief.ctas.join(" / ")}`);

  if (brief.bannedWords.length > 0) {
    lines.push(`ห้ามใช้คำเหล่านี้เด็ดขาด: ${brief.bannedWords.join(", ")}`);
  }
  if (brief.avoidTopics?.length) {
    lines.push(`ห้ามพูดถึงหัวข้อ: ${brief.avoidTopics.join(", ")}`);
  }
  if (brief.samplePosts?.length) {
    lines.push(
      "",
      "ตัวอย่างโพสต์ที่ลูกค้าชอบ (จับโทนจากตรงนี้):",
      ...brief.samplePosts.slice(0, 3).map((p, i) => `${i + 1}. ${p}`),
    );
  }
  return lines.join("\n");
}

export function emptyBrief(pageId: string, brandName = ""): BrandBrief {
  return {
    pageId,
    brandName,
    business: "",
    audience: "",
    products: [],
    ctas: [],
    bannedWords: [],
  };
}
