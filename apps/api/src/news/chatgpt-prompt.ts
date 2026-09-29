/**
 * ตัวสร้างคำสั่งสำหรับ ChatGPT (หรือแชต AI ที่ค้นเว็บได้) — ผู้ใช้กำหนดจำนวนหัวข้อ เรื่อง ความยาว อีโมจิ และแหล่งรูปเอง
 * ผลลัพธ์ของแชตต้องกลับมาเป็นแพ็กเกจ fbpm-content-v1 เพื่อเข้าทางตรวจ/สร้างร่าง/ตั้งเวลาเดิม (docs/CONTENT_IMPORT.md)
 * ฟังก์ชันล้วน ไม่แตะ DB — ข้อมูลแบรนด์ส่งเข้ามาจาก service
 */
import { MAX_POSTS_PER_PACKAGE, PACKAGE_FORMAT } from './import-format';

export const PROMPT_KINDS = ['original', 'news', 'mixed'] as const;
export const PROMPT_LENGTHS = ['short', 'medium', 'long'] as const;
export const PROMPT_IMAGES = ['chatgpt', 'stock', 'own'] as const;

export interface PromptBrand {
  name: string; description?: string | null; industry?: string | null; targetAudience?: string | null; toneOfVoice?: string | null;
  serviceArea?: string | null; primaryCTA?: string | null; website?: string | null;
}
/** ข้อมูลเฉพาะเพจ (หมวด/about จาก Facebook + โปรไฟล์จากผู้ช่วยหาเรื่องโพสต์ + แฮชแท็กที่ใช้บ่อย) — ใช้แทนข้อมูลแบรนด์เมื่อแบรนด์มีหลายเพจ */
export interface PromptPage {
  category?: string | null; about?: string | null; businessType?: string | null; audience?: string | null; location?: string | null;
  pillars?: string[]; seasonalHooks?: string[]; avoid?: string[]; keywords: string[];
}
export interface PromptOptions {
  pageName: string | null; count: number; topic?: string; kind: (typeof PROMPT_KINDS)[number]; length: (typeof PROMPT_LENGTHS)[number];
  emoji: boolean; images: (typeof PROMPT_IMAGES)[number]; recencyDays?: number; extra?: string;
  page?: PromptPage | null; brandInfo?: boolean;
}

const LENGTH: Record<PromptOptions['length'], string> = { short: 'สั้น ประมาณ 300–500 ตัวอักษร', medium: 'ปานกลาง ประมาณ 600–1,000 ตัวอักษร', long: 'ยาว ประมาณ 1,000–1,800 ตัวอักษร' };
const KIND: Record<PromptOptions['kind'], string> = {
  original: 'ความรู้ / เคล็ดลับ / เรื่องน่าสนใจที่เป็นประโยชน์กับกลุ่มเป้าหมาย (type = "original")',
  news: 'ข่าวหรือความเคลื่อนไหวล่าสุด (type = "news" ต้องมีลิงก์ที่มาจริงทุกโพสต์)',
  mixed: 'ผสมระหว่างข่าวล่าสุด (type = "news") และความรู้/เคล็ดลับ (type = "original")',
};

export function buildChatGptPrompt(brand: PromptBrand, o: PromptOptions): string {
  const n = Math.min(Math.max(Math.round(o.count), 1), MAX_POSTS_PER_PACKAGE);
  const info = [
    ['ชื่อแบรนด์', brand.name], ['ธุรกิจ', brand.industry], ['รายละเอียด', brand.description], ['กลุ่มเป้าหมาย', brand.targetAudience],
    ['น้ำเสียง', brand.toneOfVoice], ['พื้นที่ให้บริการ', brand.serviceArea], ['CTA หลัก', brand.primaryCTA], ['เว็บไซต์', brand.website],
  ].filter(([k, v]) => v && String(v).trim() && (o.brandInfo !== false || k === 'ชื่อแบรนด์' || k === 'CTA หลัก' || k === 'น้ำเสียง')).map(([k, v]) => `- ${k}: ${String(v).trim().slice(0, 500)}`);
  const pg = o.page;
  const list = (xs?: string[]) => (xs ?? []).filter(Boolean).slice(0, 8).join(' · ');
  const pageInfo = pg ? [
    ['หมวดหมู่เพจ', pg.category], ['เกี่ยวกับเพจ', pg.about], ['ประเภทธุรกิจ/เนื้อหา', pg.businessType], ['กลุ่มผู้ติดตาม', pg.audience], ['พื้นที่', pg.location],
    ['เสาหลักคอนเทนต์', list(pg.pillars)], ['จังหวะ/เทศกาลที่เกี่ยวข้อง', list(pg.seasonalHooks)], ['สิ่งที่ควรเลี่ยง', list(pg.avoid)],
  ].filter(([, v]) => v && String(v).trim()).map(([k, v]) => `- ${k}: ${String(v).trim().slice(0, 500)}`) : [];
  const keywords = (pg?.keywords ?? []).filter(Boolean).slice(0, 15);
  const example = {
    format: PACKAGE_FORMAT,
    posts: [{
      type: o.kind === 'news' ? 'news' : 'original',
      ...(o.pageName && { page: o.pageName }),
      title: 'ชื่อหัวข้อสั้น ๆ',
      caption: o.emoji
        ? '🔥 ประโยคเปิดที่ทำให้อยากอ่านต่อ\n\nย่อหน้าสั้น 1–3 บรรทัด เล่าประเด็นหลัก\n\n✅ ข้อที่ 1\n✅ ข้อที่ 2\n✅ ข้อที่ 3\n\n💬 คำถามชวนคอมเมนต์ หรือ CTA'
        : 'ประโยคเปิดที่ทำให้อยากอ่านต่อ\n\nย่อหน้าสั้น 1–3 บรรทัด เล่าประเด็นหลัก\n\n1) ข้อที่ 1\n2) ข้อที่ 2\n3) ข้อที่ 3\n\nคำถามชวนคอมเมนต์ หรือ CTA',
      hashtags: ['คำ1', 'คำ2', 'คำ3'],
      sources: [{ name: 'ชื่อเว็บ', url: 'https://ลิงก์บทความที่ใช้จริง' }],
      card: { kicker: 'หมวด', headline: 'พาดหัวสั้น ≤ 60 ตัวอักษร', sub: 'สรุปหนึ่งประโยค' },
      images: [],
      ...(o.images === 'stock' && { photoQuery: 'english keywords for a free stock photo' }),
      imagePrompt: 'คำบรรยายภาพประกอบของหัวข้อนี้ (ภาษาอังกฤษ)',
      category: 'หมวดหมู่',
      risk: 'LOW', riskReasons: [], needsCheck: [],
    }],
  };
  const imageRules = o.images === 'chatgpt'
    ? [
      `หลังส่ง JSON แล้ว ให้สร้างรูปประกอบทีละหัวข้อตามลำดับ 1 ถึง ${n} (สี่เหลี่ยมจัตุรัส 1:1) โดยใช้ imagePrompt ของหัวข้อนั้น และพิมพ์กำกับทุกรูปว่า "รูปที่ X: ชื่อหัวข้อ"`,
      'รูปต้องไม่มีตัวหนังสือ ไม่มีโลโก้/ลายน้ำ ไม่เลียนแบบภาพข่าวหรือบุคคลจริง',
      'ถ้าสร้างครบทุกรูปในคำตอบเดียวไม่ได้ ให้สร้างทีละรูป แล้วรอผู้ใช้พิมพ์ "ต่อ"',
    ]
    : o.images === 'stock'
      ? ['ไม่ต้องสร้างรูป ใส่ photoQuery เป็นคำค้นภาษาอังกฤษ 2–5 คำ ระบบจะหาภาพฟรีให้เอง']
      : ['ไม่ต้องสร้างรูป เจ้าของเพจจะอัปโหลดรูปเอง — ใส่ imagePrompt อธิบายภาพที่เหมาะกับหัวข้อไว้เป็นไอเดีย'];

  return [
    `คุณคือทีมคอนเทนต์ของเพจ Facebook${o.pageName ? ` "${o.pageName}"` : ''}`,
    pageInfo.length ? ['ข้อมูลเพจ:', ...pageInfo].join('\n') : '',
    keywords.length ? `คีย์เวิร์ดของเพจ: ${keywords.join(', ')}` : '',
    info.length ? [pageInfo.length ? 'ข้อมูลแบรนด์ (ภาพรวม):' : 'ข้อมูลแบรนด์:', ...info].join('\n') : '',
    '',
    'งานของคุณ:',
    `1) ค้นหาข้อมูลจากเว็บ (เปิดใช้การค้นหาเว็บ) ${o.topic?.trim() ? `ในเรื่อง: ${o.topic.trim()}` : keywords.length ? 'ในเรื่องที่เกี่ยวกับคีย์เวิร์ดของเพจด้านบน' : 'ในเรื่องที่เหมาะกับเพจและกลุ่มเป้าหมายด้านบน'}${o.recencyDays ? ` — เน้นข้อมูลภายใน ${o.recencyDays} วันล่าสุด` : ''}`,
    `2) คัดมา ${n} หัวข้อที่ไม่ซ้ำกัน ประเภท: ${KIND[o.kind]}`,
    '3) สรุปและเขียนเป็นโพสต์ Facebook ภาษาไทย หัวข้อละ 1 โพสต์',
    ...(keywords.length ? ['- ทุกหัวข้อต้องเกี่ยวกับเพจนี้จริง ใช้คีย์เวิร์ดของเพจเป็นแนวทางค้นหา และเลือกคำที่เหมาะเป็น hashtags'] : []),
    '',
    'รูปแบบข้อความโพสต์ (caption):',
    `- ความยาว${LENGTH[o.length]}`,
    o.emoji ? '- บรรทัดแรกเป็น hook + อีโมจิ 1–2 ตัว · ใช้อีโมจินำหน้าแต่ละข้อ (เช่น ✅ 📌 💡 👉) · ไม่เกินย่อหน้าละ 1–2 ตัว' : '- ไม่ใช้อีโมจิ ใช้เลขข้อ 1) 2) 3) แทน',
    '- เว้นบรรทัดว่างระหว่างย่อหน้า ย่อหน้าละ 1–3 บรรทัด อ่านง่ายบนมือถือ',
    `- ปิดท้ายด้วยคำถามชวนคอมเมนต์${brand.primaryCTA ? ` หรือ CTA: "${brand.primaryCTA}"` : ''}`,
    '- ห้ามใช้ markdown (**ตัวหนา**, # หัวข้อ, - bullet) เพราะ Facebook ไม่แสดงผล — ใช้อีโมจิและการขึ้นบรรทัดแทน',
    '- ไม่ต้องใส่แฮชแท็กใน caption ให้ใส่ใน hashtags ไม่เกิน 5 คำ (ไม่ต้องมี #)',
    '- ไม่ต้องเขียนบรรทัด "ที่มา" ในข้อความ ระบบต่อท้ายให้จาก sources',
    '- เขียนใหม่ด้วยสำนวนของเพจ ห้ามคัดลอกประโยคต้นทางเกิน 8 คำติดกัน ใช้เฉพาะข้อเท็จจริงที่อ่านเจอจริง',
    '- ตรงไหนไม่แน่ใจ (ตัวเลข ราคา วันที่ ชื่อ) ให้เขียน [ต้องยืนยัน: ...] ในข้อความ และใส่ใน needsCheck — ห้ามเดา',
    '- เรื่องสุขภาพ การเงิน การเมือง ศาสนา กฎหมาย ให้ risk = "HIGH" พร้อมเหตุผลใน riskReasons',
    '',
    'ที่มา:',
    '- sources ใส่ลิงก์บทความจริงที่คุณเปิดอ่าน (https) อย่างน้อย 1 แหล่งต่อโพสต์ — โพสต์ข่าวไม่มีที่มาจะถูกปฏิเสธ',
    '',
    'รูปภาพ:',
    '- ใน JSON ให้ images เป็น [] เสมอ (เจ้าของเพจจะแนบรูปของแต่ละหัวข้อในระบบเอง)',
    ...imageRules.map(r => `- ${r}`),
    ...(o.extra?.trim() ? ['', `คำสั่งเพิ่มเติม: ${o.extra.trim()}`] : []),
    '',
    `ส่งผลลัพธ์เป็นโค้ดบล็อก \`\`\`json เดียว ตามรูปแบบนี้ (posts ${n} รายการ เรียงตามลำดับหัวข้อ):`,
    JSON.stringify(example, null, 2),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
