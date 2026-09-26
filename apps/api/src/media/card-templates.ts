/**
 * เทมเพลตการ์ดภาพ 1080×1080 — พอร์ตจาก make-card.mjs ที่ใช้กับเพจจริงแล้ว (ADR-001)
 * ภาพเป็นงานต้นฉบับทั้งหมด (ตัวอักษร + SVG) ไม่มีภาพบุคคล ไม่มีปัญหาลิขสิทธิ์
 */
export const CARD_SIZE = 1080;
export const CARD_TEMPLATES = ['quote', 'stat', 'tips', 'hero', 'news'] as const;
export type CardTemplate = (typeof CARD_TEMPLATES)[number];
export interface Theme { bg1: string; bg2: string; ink: string; dim: string; accent: string; onAccent: string; card: string; line: string }
export const THEMES: Record<string, Theme> = {
  default:     { bg1: '#f7f8fa', bg2: '#e6ebf2', ink: '#1d2733', dim: '#63707f', accent: '#1f6feb', onAccent: '#ffffff', card: '#ffffff', line: '#d8e0ea' },
  warm:        { bg1: '#fffaf7', bg2: '#fdeee7', ink: '#7f1d1d', dim: '#8a6a5e', accent: '#c62828', onAccent: '#ffffff', card: '#ffffff', line: '#f2d9cf' },
  ocean:       { bg1: '#e8f4f8', bg2: '#cfe6ef', ink: '#08394a', dim: '#3d7186', accent: '#0d5c73', onAccent: '#ffffff', card: '#ffffff', line: '#b9d7e3' },
  gold:        { bg1: '#fffdf6', bg2: '#f7eeda', ink: '#4a3410', dim: '#8a7550', accent: '#a8801f', onAccent: '#ffffff', card: '#ffffff', line: '#e8dcc0' },
  forest:      { bg1: '#f1f8f2', bg2: '#d9ecdc', ink: '#173b22', dim: '#4f7a5a', accent: '#1f7a3a', onAccent: '#ffffff', card: '#ffffff', line: '#bcdcc3' },
  dark:        { bg1: '#2a2320', bg2: '#12100e', ink: '#f4efe7', dim: '#a99b8c', accent: '#c9a227', onAccent: '#12100e', card: '#1d1916', line: '#4a3f36' },
};
export const THEME_NAMES = Object.keys(THEMES);

export interface CardData { theme?: string; kicker?: string; footer?: string; brand?: string; big?: string; bigUnit?: string; quote?: string; sub?: string; title?: string; lead?: string; rows?: { label: string; note?: string; old?: string | number | null; new: string | number; unit?: string }[]; items?: { title: string; text?: string }[]; svg?: string; punch?: string; stat?: string; accent?: string }

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = (s: unknown) => esc(s).replace(/\n/g, '<br>').replace(/\*(.+?)\*/g, '<span class="hl">$1</span>');
/** อนุญาตเฉพาะ SVG ที่ไม่มีสคริปต์/ลิงก์ภายนอก */
const safeSvg = (s: string | undefined) => (s && /^\s*<svg[\s\S]*<\/svg>\s*$/i.test(s) && !/<script|on\w+=|href\s*=\s*["']?(?!#)|<foreignObject|<image/i.test(s) ? s : '');

const base = (t: Theme, font: string, fontBold: string) => `
  @font-face{font-family:'TH';src:url('${font}');font-weight:400}
  @font-face{font-family:'TH';src:url('${fontBold}');font-weight:700}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${CARD_SIZE}px;height:${CARD_SIZE}px;font-family:'TH',sans-serif}
  .card{width:${CARD_SIZE}px;height:${CARD_SIZE}px;padding:70px 74px;display:flex;flex-direction:column;background:linear-gradient(168deg,${t.bg1} 0%,${t.bg2} 100%);position:relative;color:${t.ink}}
  .kicker{align-self:flex-start;background:${t.accent};color:${t.onAccent};font-size:29px;font-weight:700;padding:12px 28px;border-radius:100px}
  .hl{color:${t.accent}}
  .foot{position:absolute;left:74px;right:74px;bottom:44px;display:flex;justify-content:space-between;align-items:flex-end;font-size:25px;color:${t.dim};line-height:1.5}
  .brand{font-weight:700;color:${t.accent};font-size:30px;white-space:nowrap;padding-left:24px}`;

type Tpl = (d: CardData, t: Theme) => { css: string; body: string; center?: boolean; align?: 'center' };
const TEMPLATES: Record<CardTemplate, Tpl> = {
  quote: (d, t) => ({
    css: `.big{font-size:${d.big && d.big.length > 4 ? 150 : 240}px;font-weight:700;line-height:.92;margin-top:40px}.big small{font-size:84px;color:${t.accent};margin-left:20px}.q{font-size:74px;font-weight:700;line-height:1.42;margin-top:${d.big ? 48 : 20}px}.rule{width:150px;height:5px;background:${t.accent};margin:52px 0 38px}.sub{font-size:40px;color:${t.dim};line-height:1.6}`,
    body: `${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}${d.big ? `<div class="big">${esc(d.big)}${d.bigUnit ? `<small>${esc(d.bigUnit)}</small>` : ''}</div>` : ''}<div class="q">${rich(d.quote)}</div><div class="rule"></div>${d.sub ? `<div class="sub">${rich(d.sub)}</div>` : ''}`,
    center: !d.big,
  }),
  stat: (d, t) => ({
    css: `h1{font-size:96px;font-weight:700;line-height:1.16;margin-top:32px}.lead{font-size:35px;color:${t.dim};margin-top:20px;line-height:1.5}.rows{margin-top:42px;display:flex;flex-direction:column;gap:20px}.row{background:${t.card};border-radius:16px;padding:28px 32px;border:2px solid ${t.line};display:flex;align-items:center;gap:24px}.lbl{flex:1;font-size:38px;font-weight:700;line-height:1.3}.lbl small{display:block;font-size:25px;font-weight:400;color:${t.dim};margin-top:5px}.old{font-size:50px;font-weight:700;color:${t.dim};opacity:.55;text-decoration:line-through;min-width:120px;text-align:right}.arw{font-size:42px;color:${t.accent};font-weight:700}.new{font-size:64px;font-weight:700;color:${t.accent};min-width:180px;text-align:right;line-height:1}.new span{font-size:26px;color:${t.dim};font-weight:400;display:block;margin-top:5px}`,
    body: `${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}<h1>${rich(d.title)}</h1>${d.lead ? `<div class="lead">${rich(d.lead)}</div>` : ''}<div class="rows">${(d.rows ?? []).map(r => `<div class="row"><div class="lbl">${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</div>${r.old != null ? `<div class="old">${esc(r.old)}</div><div class="arw">&#10145;</div>` : ''}<div class="new">${esc(r.new)}${r.unit ? `<span>${esc(r.unit)}</span>` : ''}</div></div>`).join('')}</div>`,
  }),
  tips: (d, t) => {
    const n = (d.items ?? []).length;
    const z = n <= 3 ? { h1: 88, gap: 30, dot: 66, num: 34, tt: 39, tx: 30, top: 44 } : n === 4 ? { h1: 80, gap: 24, dot: 60, num: 31, tt: 36, tx: 28, top: 36 } : n === 5 ? { h1: 72, gap: 19, dot: 55, num: 29, tt: 33, tx: 26, top: 28 } : { h1: 64, gap: 14, dot: 48, num: 26, tt: 29, tx: 23, top: 22 };
    return {
      css: `h1{font-size:${z.h1}px;font-weight:700;line-height:1.18;margin-top:26px}.items{margin-top:${z.top}px;display:flex;flex-direction:column;gap:${z.gap}px}.item{display:flex;gap:24px;align-items:flex-start}.n{width:${z.dot}px;height:${z.dot}px;flex:none;border-radius:50%;background:${t.accent};color:${t.onAccent};font-size:${z.num}px;font-weight:700;display:flex;align-items:center;justify-content:center}.tx{font-size:${z.tt}px;font-weight:700;line-height:1.35;padding-top:4px}.tx small{display:block;font-size:${z.tx}px;font-weight:400;color:${t.dim};margin-top:6px;line-height:1.45}`,
      body: `${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}<h1>${rich(d.title)}</h1><div class="items">${(d.items ?? []).map((it, i) => `<div class="item"><div class="n">${i + 1}</div><div class="tx">${esc(it.title)}${it.text ? `<small>${esc(it.text)}</small>` : ''}</div></div>`).join('')}</div>`,
    };
  },
  hero: (d, t) => ({
    css: `h1{font-size:116px;font-weight:700;line-height:1;margin-top:14px}.sub{font-size:35px;color:${t.dim};margin-top:12px}.art{margin-top:4px}.punch{background:${t.accent};color:${t.onAccent};font-size:50px;font-weight:700;padding:20px 46px;border-radius:14px;margin-top:8px}.stat{font-size:40px;font-weight:700;margin-top:24px;text-align:center;line-height:1.4}`,
    body: `${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}<h1>${rich(d.title)}</h1>${d.sub ? `<div class="sub">${rich(d.sub)}</div>` : ''}${d.svg ? `<div class="art">${safeSvg(d.svg)}</div>` : ''}${d.punch ? `<div class="punch">${esc(d.punch)}</div>` : ''}${d.stat ? `<div class="stat">${rich(d.stat)}</div>` : ''}`,
    align: 'center',
  }),
  /** การ์ดหัวข่าวของเพจ — ตัวอักษรล้วน ไม่ใช้รูปของสำนักข่าว (footer ใส่ "ที่มา: ...") */
  news: (d, t) => {
    const n = (d.title ?? '').length;
    return {
      css: `.bar{position:absolute;left:0;right:0;top:0;height:16px;background:${t.accent}}h1{font-size:${n > 70 ? 70 : n > 44 ? 82 : 100}px;font-weight:700;line-height:1.24;margin-top:38px}.rule{width:130px;height:7px;background:${t.accent};margin-top:46px}.sub{font-size:40px;color:${t.dim};margin-top:34px;line-height:1.55}`,
      body: `<div class="bar"></div>${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}<h1>${rich(d.title)}</h1><div class="rule"></div>${d.sub ? `<div class="sub">${rich(d.sub)}</div>` : ''}`,
      center: true,
    };
  },
};

export function buildCardHtml(name: CardTemplate, data: CardData, themeName: string, fonts: { regular: string; bold: string }): string {
  const t = { ...(THEMES[themeName] ?? THEMES.default!), ...(data.accent && /^#[0-9a-f]{6}$/i.test(data.accent) && { accent: data.accent }) };
  const tpl = TEMPLATES[name](data, t);
  const cardStyle = [tpl.align === 'center' ? 'align-items:center;text-align:center' : '', tpl.center ? 'justify-content:center' : '', data.svg || data.footer || data.brand ? 'padding-bottom:150px' : ''].filter(Boolean).join(';');
  return `<!doctype html><meta charset="utf-8"><style>${base(t, fonts.regular, fonts.bold)}${tpl.css}.card{${cardStyle}}</style><div class="card">${tpl.body}${(data.footer || data.brand) ? `<div class="foot"><div>${rich(data.footer ?? '')}</div><div class="brand">${esc(data.brand ?? '')}</div></div>` : ''}</div>`;
}
