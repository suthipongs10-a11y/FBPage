/** ตัวช่วยของหน้าคอมเมนต์ YouTube: เวลาแบบ "4 สัปดาห์ที่ผ่านมา" และข้อความคัดลอกไปถาม AI ภายนอก (ChatGPT ฯลฯ) */

const rtf = new Intl.RelativeTimeFormat('th', { numeric: 'auto' });

/** เวลาที่ผ่านมาแบบเดียวกับ YouTube — ใส่ title เป็นวันเวลาจริงไว้ให้ชี้ดู */
export function timeAgo(iso: string, now = Date.now()): string {
  const sec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return 'เมื่อสักครู่';
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(sec / 86_400), 'day');
  if (abs < 30 * 86_400) return rtf.format(Math.round(sec / (7 * 86_400)), 'week');
  if (abs < 365 * 86_400) return rtf.format(Math.round(sec / (30 * 86_400)), 'month');
  return rtf.format(Math.round(sec / (365 * 86_400)), 'year');
}
export const fullDate = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

export interface PromptMessage { author: string | null; text: string; publishedAt: string; fromChannel: boolean }

/** ข้อความสำหรับวางใน ChatGPT: คลิปอะไร + บทสนทนา + คอมเมนต์ที่ต้องตอบ → ขอคำตอบ 3 แบบ */
export function replyPrompt(o: { channel?: string | null; videoTitle?: string | null; videoUrl?: string | null; target: PromptMessage; thread?: PromptMessage[] }): string {
  const who = (m: PromptMessage) => (m.fromChannel ? 'ช่องของเรา' : m.author ?? 'ผู้ชม');
  const earlier = (o.thread ?? []).filter(m => !(m.text === o.target.text && m.publishedAt === o.target.publishedAt));
  return [
    `ฉันเป็นเจ้าของช่อง YouTube${o.channel ? ` "${o.channel}"` : ''} ช่วยร่างคำตอบคอมเมนต์ให้หน่อย`,
    '',
    `คลิป: ${o.videoTitle ? `"${o.videoTitle}"` : '(ไม่ทราบชื่อคลิป)'}`,
    ...(o.videoUrl ? [`ลิงก์: ${o.videoUrl}`] : []),
    ...(earlier.length ? ['', 'บทสนทนาก่อนหน้าในเธรด (เก่า → ใหม่):', ...earlier.map(m => `- [${who(m)} · ${timeAgo(m.publishedAt)}] ${m.text}`)] : []),
    '',
    `คอมเมนต์ที่ต้องตอบ (${who(o.target)} · ${timeAgo(o.target.publishedAt)}):`,
    `"${o.target.text}"`,
    '',
    'ขอคำตอบภาษาไทย 3 แบบ ในนามเจ้าของช่อง:',
    '1) สั้น กระชับ เป็นกันเอง',
    '2) ให้ข้อมูล/อธิบายเพิ่ม — ถ้าไม่แน่ใจข้อเท็จจริงให้บอกตรงๆ ห้ามเดาตัวเลขหรือราคา',
    '3) ชวนคุยต่อ หรือชวนดูคลิปอื่น/กดติดตาม แบบไม่ขายของเกินไป',
    'แต่ละแบบไม่เกิน 3 ประโยค ไม่ใส่แฮชแท็ก และไม่ต้องขึ้นต้นด้วย @ชื่อ',
  ].join('\n');
}

/** คัดลอกลงคลิปบอร์ด — เบราว์เซอร์ที่บล็อก API ใช้วิธีเลือกข้อความแทน */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* ลองวิธีสำรอง */ }
  try {
    const el = document.createElement('textarea'); el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.select(); const ok = document.execCommand('copy'); document.body.removeChild(el); return ok;
  } catch { return false; }
}
