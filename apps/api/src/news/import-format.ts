/**
 * แพ็กเกจคอนเทนต์มาตรฐาน (fbpm-content-v1) — ให้ ChatGPT / Claude / Gemini ค้นและเรียบเรียงข้างนอก แล้วส่งเข้าระบบ
 * (วาง/อัปโหลด, URL รับไฟล์ของ workspace, หรือโฟลเดอร์ Google Drive) → ระบบตรวจว่าครบ/ผ่านกฎไหม → สร้างร่างรออนุมัติ
 * ไฟล์นี้เป็นฟังก์ชันล้วน (ไม่แตะ DB/เครือข่าย) — การตรวจที่ต้องใช้ DB (เพจ, ซ้ำ, ไฟล์อัปโหลด) อยู่ใน import.service.ts
 */
import { z } from 'zod';

export const PACKAGE_FORMAT = 'fbpm-content-v1';
export const MAX_POSTS_PER_PACKAGE = 20;
export const MAX_IMAGES_PER_POST = 6;
const MIN_LEAD_MS = 10 * 60_000;

const imageIn = z.union([
  z.string().trim().min(1).max(2000),
  z.object({ url: z.string().trim().max(2000).optional(), file: z.string().trim().max(300).optional(), credit: z.string().trim().max(200).optional() }),
]);
const postIn = z.object({
  /** news = เรียบเรียงจากข่าว (ต้องมีที่มา) · original = โพสต์ของเพจเอง */
  type: z.enum(['news', 'original']).default('news'),
  /** ชื่อเพจตรงตัว หรือ page id — ไม่ใส่ = ใช้เพจที่เลือกตอนนำเข้า */
  page: z.string().trim().max(200).optional(),
  title: z.string().trim().max(200).optional(),
  caption: z.string().max(20000),
  hashtags: z.array(z.string().trim().max(80)).max(30).default([]),
  sources: z.array(z.object({ name: z.string().trim().max(120).optional(), url: z.string().trim().max(1000) })).max(10).default([]),
  card: z.object({ kicker: z.string().trim().max(60).optional(), headline: z.string().trim().max(200), sub: z.string().trim().max(300).optional() }).optional(),
  images: z.array(imageIn).max(20).default([]),
  imageCredit: z.string().trim().max(200).optional(),
  /** ไม่มีรูป → ค้นคลังภาพฟรีด้วยคำนี้ (ถ้าเลือกแหล่งภาพสำรองเป็นคลังภาพ) */
  photoQuery: z.string().trim().max(120).optional(),
  imagePrompt: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(60).optional(),
  /** เวลาที่เสนอ ISO-8601 พร้อมเขตเวลา เช่น 2026-09-28T19:00:00+07:00 — เป็นแค่ค่าเริ่มต้นตอนอนุมัติ */
  scheduleAt: z.string().trim().max(40).optional(),
  risk: z.enum(['LOW', 'HIGH']).optional(),
  riskReasons: z.array(z.string().trim().max(300)).max(10).default([]),
  needsCheck: z.array(z.string().trim().max(300)).max(20).default([]),
  /** คีย์กันซ้ำแทนลิงก์ที่มา — ใช้เมื่อหลายโพสต์มาจากแหล่งเดียวกันโดยตั้งใจ (เช่นโต๊ะค้นคว้าเขียนหลายมุม) */
  dedupeKey: z.string().trim().min(3).max(300).optional(),
  /** มุมที่โพสต์นี้เพิ่มจากแหล่งต้นทาง (คำสั่ง ChatGPT แบบเจาะลึก) — ให้คนตรวจดูคุณภาพ ไม่ลงในโพสต์ */
  angle: z.string().trim().max(400).optional(),
});
export type PostIn = z.infer<typeof postIn>;

export type CheckLevel = 'error' | 'warn' | 'info';
export interface Check { level: CheckLevel; code: string; message: string }
export type ImageRef = { kind: 'url'; url: string; credit?: string } | { kind: 'upload'; id: string; credit?: string } | { kind: 'file'; name: string; credit?: string };
export interface NormalizedPost {
  type: 'news' | 'original'; page?: string; title: string; caption: string; hashtags: string[];
  sources: { name: string; url: string }[]; card: { kicker?: string; headline: string; sub?: string };
  images: ImageRef[]; imageCredit?: string; photoQuery?: string; imagePrompt?: string; category?: string;
  scheduleAt: string | null; risk: 'LOW' | 'HIGH'; riskReasons: string[]; needsCheck: string[]; dedupeKey?: string; angle?: string;
}
export interface PostReport { index: number; status: 'PASS' | 'WARN' | 'FAIL'; title: string; checks: Check[]; post: NormalizedPost | null }
export interface PackageReport { format: string | null; parseError: string | null; posts: PostReport[] }

/** ตัด ```json ... ``` และข้อความนำ/ท้ายที่แชต AI ชอบใส่ แล้ว parse JSON */
export function extractJson(text: string): unknown {
  let s = text.replace(/^\uFEFF/, '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error('ไม่พบ JSON ในข้อความ');
  const open = s[start]!; const close = open === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  if (end <= start) throw new Error('JSON ไม่ครบ (วงเล็บปิดหาย)');
  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { throw new Error(`JSON ผิดรูปแบบ: ${(e as Error).message}`); }
}

/** รับได้ทั้ง { format, posts: [...] } · [...] · โพสต์เดี่ยว { caption, ... } */
function postsOf(doc: unknown): { format: string | null; posts: unknown[] } {
  if (Array.isArray(doc)) return { format: null, posts: doc };
  if (doc && typeof doc === 'object') {
    const o = doc as Record<string, unknown>;
    const format = typeof o.format === 'string' ? o.format : null;
    if (Array.isArray(o.posts)) return { format, posts: o.posts };
    if ('caption' in o) return { format, posts: [o] };
  }
  throw new Error('ไม่พบรายการโพสต์ — ต้องมี "posts": [ ... ] หรือเป็นโพสต์เดียวที่มี "caption"');
}

const httpsUrl = (v: string) => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' ? u : null; } catch { return null; } };
const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');
/** โดเมนหลัก (ตัด subdomain) — กันรูปจาก cdn.สำนักข่าว.com เมื่อที่มาคือ www.สำนักข่าว.com */
const rootDomain = (h: string) => { const p = h.split('.'); const n = p.length >= 3 && /^(co|com|or|ac|go|net|org|in)$/.test(p[p.length - 2]!) && p[p.length - 1]!.length === 2 ? 3 : 2; return p.slice(-n).join('.'); };

function imageRef(v: z.infer<typeof imageIn>, credit: string | undefined, allowHttp: boolean): ImageRef | { bad: string } {
  const o = typeof v === 'string' ? (v.startsWith('upload:') ? { upload: v.slice(7) } : httpsUrl(v) ? { url: v } : { file: v }) : v.url ? { url: v.url } : v.file ? (v.file.startsWith('upload:') ? { upload: v.file.slice(7) } : { file: v.file }) : {};
  const c = (typeof v === 'object' && v.credit) || credit;
  if ('upload' in o && o.upload) return { kind: 'upload', id: o.upload, ...(c && { credit: c }) };
  if ('url' in o && o.url) { const u = httpsUrl(o.url); return u && (u.protocol === 'https:' || allowHttp) ? { kind: 'url', url: u.toString(), ...(c && { credit: c }) } : { bad: `รูปต้องเป็นลิงก์ https: ${o.url.slice(0, 80)}` }; }
  if ('file' in o && o.file) return /^[\w\-. ()ก-๙]+\.(jpe?g|png|webp)$/i.test(o.file) ? { kind: 'file', name: o.file, ...(c && { credit: c }) } : { bad: `ชื่อไฟล์รูปไม่ถูกต้อง (ต้องเป็น .jpg/.png/.webp): ${o.file.slice(0, 80)}` };
  return { bad: 'รายการรูปว่าง' };
}

/**
 * ผูกรูปที่ผู้ใช้อัปโหลดรายหัวข้อ (index → id จาก POST news/import/files) เข้ากับโพสต์ในแพ็กเกจ แทนรูปเดิมของโพสต์นั้น
 * แพ็กเกจอ่านไม่ได้ → คืนค่าเดิมให้ checkPackage รายงานข้อผิดพลาดเอง
 */
export function withPostImages(input: unknown, images: Record<string, string> | undefined): unknown {
  if (!images || !Object.keys(images).length) return input;
  let doc: unknown;
  try { doc = JSON.parse(JSON.stringify(typeof input === 'string' ? extractJson(input) : input)); } catch { return input; }
  let posts: unknown[];
  try { posts = postsOf(doc).posts; } catch { return input; }
  for (const [k, id] of Object.entries(images)) {
    const p = posts[Number(k)];
    if (p && typeof p === 'object' && /^\d+$/.test(k)) (p as Record<string, unknown>).images = [`upload:${id}`];
  }
  return doc;
}

/** เลือกเฉพาะโพสต์ลำดับที่ต้องการ (ผู้ใช้ติ๊กออกบางหัวข้อ) — เรียกหลัง withPostImages เพราะลำดับจะเลื่อน */
export function pickPosts(input: unknown, include: number[] | undefined): unknown {
  if (!include) return input;
  let doc: unknown;
  try { doc = JSON.parse(JSON.stringify(typeof input === 'string' ? extractJson(input) : input)); } catch { return input; }
  let posts: unknown[];
  try { posts = postsOf(doc).posts; } catch { return input; }
  const keep = new Set(include);
  const picked = posts.filter((_, i) => keep.has(i));
  if (Array.isArray(doc)) return picked;
  const o = doc as Record<string, unknown>;
  return Array.isArray(o.posts) ? { ...o, posts: picked } : picked;
}

/** ตรวจโพสต์เดียว (ไม่ใช้ DB) */
/** allowHttpImages: เฉพาะ test (mock เป็น http) — ใช้งานจริงรูปต้อง https */
export interface CheckOptions { now?: Date; allowHttpImages?: boolean }
export function checkPost(raw: unknown, index: number, o: CheckOptions = {}): PostReport {
  const now = o.now ?? new Date();
  const checks: Check[] = [];
  const parsed = postIn.safeParse(raw);
  const guessTitle = (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).title === 'string') ? String((raw as Record<string, unknown>).title).slice(0, 100) : `โพสต์ที่ ${index + 1}`;
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) checks.push({ level: 'error', code: 'SCHEMA', message: `${i.path.join('.') || '(ทั้งโพสต์)'}: ${i.message}` });
    return { index, status: 'FAIL', title: guessTitle, checks, post: null };
  }
  const p = parsed.data;
  const caption = p.caption.replace(/\r\n/g, '\n').trim();
  if (caption.length < 20) checks.push({ level: 'error', code: 'CAPTION_SHORT', message: 'ข้อความโพสต์สั้นเกินไป (ต้อง ≥ 20 ตัวอักษร)' });

  const sources: { name: string; url: string }[] = [];
  for (const s of p.sources) {
    const u = httpsUrl(s.url);
    if (!u) { checks.push({ level: 'error', code: 'SOURCE_URL', message: `ลิงก์ที่มาไม่ถูกต้อง: ${s.url.slice(0, 80)}` }); continue; }
    sources.push({ name: s.name || host(u), url: u.toString() });
  }
  if (p.type === 'news' && sources.length === 0) checks.push({ level: 'error', code: 'NO_SOURCE', message: 'โพสต์ข่าวต้องมีที่มาอย่างน้อย 1 แหล่ง (sources: [{ name, url }])' });

  const images: ImageRef[] = [];
  const sourceRoots = new Set(sources.map(s => rootDomain(host(new URL(s.url)))));
  for (const v of p.images) {
    const r = imageRef(v, p.imageCredit, !!o.allowHttpImages);
    if ('bad' in r) { checks.push({ level: 'error', code: 'IMAGE', message: r.bad }); continue; }
    if (r.kind === 'url' && sourceRoots.has(rootDomain(host(new URL(r.url))))) { checks.push({ level: 'error', code: 'IMAGE_FROM_SOURCE', message: `ห้ามใช้รูปจากเว็บสำนักข่าวต้นทาง (${host(new URL(r.url))}) — ใช้รูปของเพจเอง คลังภาพฟรี หรือภาพ AI` }); continue; }
    images.push(r);
  }
  if (images.length > MAX_IMAGES_PER_POST) { checks.push({ level: 'warn', code: 'IMAGES_MANY', message: `รูปเกิน ${MAX_IMAGES_PER_POST} ใบ — ใช้ ${MAX_IMAGES_PER_POST} ใบแรก` }); images.length = MAX_IMAGES_PER_POST; }
  if (images.some(i => i.kind === 'url' && !i.credit) && !p.imageCredit) checks.push({ level: 'warn', code: 'IMAGE_CREDIT', message: 'รูปจากลิงก์ไม่มีเครดิต — ตรวจว่ามีสิทธิ์ใช้ (ภาพของเพจเอง/คลังภาพฟรี) และใส่ imageCredit' });

  const headline = (p.card?.headline || p.title || caption.split('\n')[0] || '').trim();
  if (!p.card) checks.push({ level: 'info', code: 'CARD_AUTO', message: 'ไม่มี card — ใช้ title/บรรทัดแรกเป็นพาดหัวการ์ด' });
  if (headline.length > 90) checks.push({ level: 'warn', code: 'HEADLINE_LONG', message: `พาดหัวการ์ดยาว ${headline.length} ตัวอักษร (แนะนำ ≤ 90) — จะถูกตัด` });

  let scheduleAt: string | null = null;
  if (p.scheduleAt) {
    const d = new Date(p.scheduleAt);
    if (Number.isNaN(d.getTime()) || !/[zZ]|[+-]\d\d:?\d\d$/.test(p.scheduleAt)) checks.push({ level: 'warn', code: 'SCHEDULE_FORMAT', message: `เวลา "${p.scheduleAt}" ต้องเป็น ISO พร้อมเขตเวลา เช่น 2026-09-28T19:00:00+07:00 — จะใช้ช่องเวลาว่างถัดไปแทน` });
    else if (d.getTime() < now.getTime() + MIN_LEAD_MS) checks.push({ level: 'warn', code: 'SCHEDULE_PAST', message: 'เวลาที่เสนอผ่านไปแล้ว/ใกล้เกินไป — จะใช้ช่องเวลาว่างถัดไปแทน' });
    else scheduleAt = d.toISOString();
  }

  const markers = [...caption.matchAll(/\[ต้องยืนยัน[^\]]*\]/g)].map(m => m[0]);
  const needsCheck = [...new Set([...p.needsCheck, ...markers])];
  if (markers.length) checks.push({ level: 'warn', code: 'NEEDS_CHECK', message: `มี ${markers.length} จุด [ต้องยืนยัน] — ต้องแก้ข้อความก่อนถึงจะอนุมัติได้` });
  if (p.risk === 'HIGH') checks.push({ level: 'warn', code: 'RISK_HIGH', message: `เนื้อหาเสี่ยง${p.riskReasons.length ? `: ${p.riskReasons.join(' · ')}` : ''} — อ่านทวนก่อนอนุมัติ` });
  const hashtags = [...new Set(p.hashtags.map(h => h.replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean))];
  if (hashtags.length > 5) checks.push({ level: 'warn', code: 'HASHTAGS_MANY', message: `แฮชแท็ก ${hashtags.length} คำ — ใช้ 5 คำแรก` });

  const post: NormalizedPost = {
    type: p.type, ...(p.page && { page: p.page }), title: (p.title || headline).slice(0, 200), caption, hashtags: hashtags.slice(0, 5), sources,
    card: { ...(p.card?.kicker && { kicker: p.card.kicker.slice(0, 24) }), headline: headline.slice(0, 90), ...(p.card?.sub && { sub: p.card.sub.slice(0, 140) }) },
    images, ...(p.imageCredit && { imageCredit: p.imageCredit }), ...(p.photoQuery && { photoQuery: p.photoQuery }), ...(p.imagePrompt && { imagePrompt: p.imagePrompt }), ...(p.category && { category: p.category }),
    scheduleAt, risk: p.risk ?? 'LOW', riskReasons: p.riskReasons, needsCheck, ...(p.dedupeKey && { dedupeKey: p.dedupeKey }), ...(p.angle && { angle: p.angle }),
  };
  return { index, status: statusOf(checks), title: post.title, checks, post };
}

export const statusOf = (checks: Check[]): PostReport['status'] => checks.some(c => c.level === 'error') ? 'FAIL' : checks.some(c => c.level === 'warn') ? 'WARN' : 'PASS';

/** ตรวจทั้งแพ็กเกจจากข้อความ (JSON ล้วน หรือข้อความจากแชตที่มี ```json) หรือ object ที่ parse แล้ว */
export function checkPackage(input: string | unknown, o: CheckOptions = {}): PackageReport {
  let doc: unknown;
  try { doc = typeof input === 'string' ? extractJson(input) : input; } catch (e) { return { format: null, parseError: (e as Error).message, posts: [] }; }
  let list: { format: string | null; posts: unknown[] };
  try { list = postsOf(doc); } catch (e) { return { format: null, parseError: (e as Error).message, posts: [] }; }
  if (list.posts.length === 0) return { format: list.format, parseError: 'ไม่มีโพสต์ในแพ็กเกจ', posts: [] };
  if (list.posts.length > MAX_POSTS_PER_PACKAGE) return { format: list.format, parseError: `โพสต์เกิน ${MAX_POSTS_PER_PACKAGE} รายการต่อแพ็กเกจ — แบ่งเป็นหลายไฟล์`, posts: [] };
  const posts = list.posts.map((p, i) => checkPost(p, i, o));
  if (list.format && list.format !== PACKAGE_FORMAT) for (const r of posts) { r.checks.unshift({ level: 'warn', code: 'FORMAT', message: `format "${list.format}" ไม่ใช่ ${PACKAGE_FORMAT} — ตรวจแบบเดียวกัน` }); r.status = statusOf(r.checks); }
  return { format: list.format, parseError: null, posts };
}

/** ตัวอย่างแพ็กเกจ — แสดงในหน้าเว็บและในคำสั่งสำหรับแชต AI */
export const PACKAGE_EXAMPLE = {
  format: PACKAGE_FORMAT,
  posts: [{
    type: 'news',
    page: 'ชื่อเพจตรงตัว (ไม่ใส่ก็ได้)',
    title: 'ชื่อเรื่องสั้น ๆ สำหรับค้นหาภายใน',
    caption: 'ข้อความโพสต์ภาษาไทย เปิดด้วย hook เล่าเป็นเรื่อง ย่อหน้าสั้น ปิดด้วยคำถามชวนคอมเมนต์ (ไม่ต้องใส่ที่มา ระบบต่อท้ายให้)',
    hashtags: ['ข่าวรอบโลก', 'เรื่องแปลก'],
    sources: [{ name: 'BBC News', url: 'https://www.bbc.com/news/...' }],
    card: { kicker: 'ข่าวแปลก', headline: 'พาดหัวบนการ์ด ≤ 90 ตัวอักษร ใช้ *คำ* เน้นสีได้ 1 จุด', sub: 'สรุปหนึ่งประโยค' },
    images: [{ url: 'https://images.pexels.com/photos/.../photo.jpg', credit: 'ชื่อช่างภาพ / Pexels' }],
    photoQuery: 'baby elephant rescue',
    category: 'สัตว์',
    scheduleAt: '2026-09-28T19:00:00+07:00',
    risk: 'LOW',
    riskReasons: [],
    needsCheck: [],
  }],
};

/** คำสั่งสำเร็จรูปให้ ChatGPT / Claude / Gemini — คัดลอกไปวางต่อท้ายคำขอค้นข่าว */
export function aiInstructions(pageNames: string[]): string {
  return [
    'เมื่อค้นและเรียบเรียงเสร็จ ให้ส่งผลลัพธ์เป็น JSON ตามรูปแบบนี้เท่านั้น (บันทึกเป็นไฟล์ .json ได้) ห้ามมีข้อความอื่นปน:',
    JSON.stringify(PACKAGE_EXAMPLE, null, 2),
    '',
    'กฎ:',
    '1) caption เขียนใหม่ด้วยสำนวนของเพจ ห้ามคัดลอกประโยคต้นทางเกิน 8 คำติดกัน ใช้เฉพาะข้อเท็จจริงที่อ่านเจอจริง · อย่าสรุปแค่เว็บเดียว — เสริมข้อมูลจากแหล่งอื่น (ไทย+ต่างประเทศ) และเพิ่มมุมมอง/วิเคราะห์ของเพจว่าทำไมเรื่องนี้สำคัญกับผู้อ่าน',
    '2) ไม่แน่ใจตรงไหนให้เขียน [ต้องยืนยัน: ...] ในข้อความ และใส่ใน needsCheck — ห้ามเดาตัวเลข ชื่อ วันที่',
    '3) sources ต้องเป็นลิงก์บทความจริงที่เปิดได้ อย่างน้อย 1 แหล่งต่อโพสต์ข่าว',
    '4) images ห้ามใช้รูปจากเว็บสำนักข่าว — ใช้ลิงก์ https จากคลังภาพฟรี (Pexels/Unsplash) พร้อม credit หรือเว้นว่างแล้วใส่ photoQuery ภาษาอังกฤษให้ระบบหาเอง',
    '5) ข่าวอาชญากรรม/อุบัติเหตุ ห้ามระบุชื่อบุคคลธรรมดา ห้ามตัดสินว่าใครผิด · เรื่องการเมือง ศาสนา สุขภาพ การเงิน ให้ risk = "HIGH" และระบุเหตุผลใน riskReasons',
    '6) ไม่ต้องใส่บรรทัด "ที่มา" ใน caption ระบบต่อท้ายให้เอง · hashtags ไม่เกิน 5 คำ ไม่ต้องมี #',
    '7) scheduleAt เป็นเวลาที่เสนอ (ISO พร้อม +07:00) ไม่ใส่ก็ได้ — คนอนุมัติเป็นคนกำหนดเวลาจริง',
    pageNames.length ? `8) page เลือกจาก: ${pageNames.map(n => `"${n}"`).join(', ')}` : '',
    'ส่งหลายเรื่องได้ในไฟล์เดียว (posts สูงสุด 20 รายการ)',
  ].filter(Boolean).join('\n');
}
