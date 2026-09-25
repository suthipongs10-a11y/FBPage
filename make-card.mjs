#!/usr/bin/env node
/**
 * make-card.mjs — สร้างภาพประกอบโพสต์จากเทมเพลต (ไม่ต้องเขียน HTML ใหม่ทุกครั้ง)
 *
 *   node make-card.mjs <template> <data.json> <out.png> [--theme <ชื่อธีม>] [--font <path>] [--font-bold <path>]
 *
 * เทมเพลต:  quote | stat | tips | hero
 * ธีม:      fadaeng | phuketmaids | rabiangboon | dark | default
 *
 * ค่าเริ่มต้นเป็นงานต้นฉบับทั้งหมด (ไอคอน/emoji/SVG) ไม่มีภาพบุคคลจริง ไม่มีปัญหาลิขสิทธิ์
 * ใส่รูปจริงในกรอบเล็กได้ด้วยคีย์ "photo" ใน data.json (path ไฟล์ในเครื่อง) — ต้องเป็นรูปที่มีสิทธิ์ใช้
 * เชิงพาณิชย์แน่ชัด (เช่น Pexels/Unsplash License หรือรูปที่ลูกค้าถ่ายเอง) สคริปต์นี้ไม่ได้ตรวจสิทธิ์ให้
 * ต้องมี Chromium ในเครื่อง (ตั้ง path ผ่าน env CHROME_BIN ได้)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME = process.env.CHROME_BIN
  || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
// ค่าเริ่มต้นคงเดิมเสมอ (Loma) เพื่อไม่ให้การ์ดของลูกค้ารายอื่นที่ทำไว้แล้วเปลี่ยนหน้าตาโดยไม่ตั้งใจ
// ต้องการฟอนต์อื่น ระบุผ่าน --font/--font-bold (path ไฟล์ธรรมดา หรือ file:// ก็ได้)
let FONT = 'file:///usr/share/fonts/opentype/tlwg/Loma.otf';
let FONT_BOLD = 'file:///usr/share/fonts/opentype/tlwg/Loma-Bold.otf';
const SIZE = 1080;

const die = m => { console.error('✖', m); process.exit(1); };

// ---------- ธีมสี (เพิ่มลูกค้าใหม่ได้ที่นี่) ----------
const THEMES = {
  default:     { bg1: '#f7f8fa', bg2: '#e6ebf2', ink: '#1d2733', dim: '#63707f', accent: '#1f6feb', onAccent: '#ffffff', card: '#ffffff', line: '#d8e0ea' },
  fadaeng:     { bg1: '#fffaf7', bg2: '#fdeee7', ink: '#7f1d1d', dim: '#8a6a5e', accent: '#c62828', onAccent: '#ffffff', card: '#ffffff', line: '#f2d9cf' },
  phuketmaids: { bg1: '#e8f4f8', bg2: '#cfe6ef', ink: '#08394a', dim: '#3d7186', accent: '#0d5c73', onAccent: '#ffffff', card: '#ffffff', line: '#b9d7e3' },
  rabiangboon: { bg1: '#fffdf6', bg2: '#f7eeda', ink: '#4a3410', dim: '#8a7550', accent: '#a8801f', onAccent: '#ffffff', card: '#ffffff', line: '#e8dcc0' },
  dark:        { bg1: '#2a2320', bg2: '#12100e', ink: '#f4efe7', dim: '#a99b8c', accent: '#c9a227', onAccent: '#12100e', card: '#1d1916', line: '#4a3f36' },
};

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// ขึ้นบรรทัดใหม่ด้วย \n และเน้นคำด้วย *ข้อความ*
const rich = s => esc(s).replace(/\n/g, '<br>').replace(/\*(.+?)\*/g, '<span class="hl">$1</span>');

const base = t => `
  @font-face{font-family:'TH';src:url('${FONT}');font-weight:400}
  @font-face{font-family:'TH';src:url('${FONT_BOLD}');font-weight:700}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${SIZE}px;height:${SIZE}px;font-family:'TH',sans-serif}
  .card{width:${SIZE}px;height:${SIZE}px;padding:70px 74px;display:flex;flex-direction:column;
        background:linear-gradient(168deg,${t.bg1} 0%,${t.bg2} 100%);position:relative;color:${t.ink}}
  .kicker{align-self:flex-start;background:${t.accent};color:${t.onAccent};font-size:29px;
          font-weight:700;padding:12px 28px;border-radius:100px}
  .hl{color:${t.accent}}
  .foot{position:absolute;left:74px;right:74px;bottom:44px;display:flex;
        justify-content:space-between;align-items:flex-end;font-size:25px;color:${t.dim};line-height:1.5}
  .brand{font-weight:700;color:${t.accent};font-size:30px;white-space:nowrap;padding-left:24px}
  .photo-frame{position:absolute;top:70px;right:74px;width:190px;height:190px;border-radius:24px;
        overflow:hidden;border:6px solid ${t.card};box-shadow:0 10px 30px rgba(0,0,0,.18)}
  .photo-frame img{width:100%;height:100%;object-fit:cover;display:block}
`;

// ---------- เทมเพลต ----------
const TEMPLATES = {
  // ข้อความเด่นหนึ่งประโยค — ใช้กับโพสต์เล่าเรื่อง / ข้อคิด
  quote: (d, t) => ({
    css: `.big{font-size:${d.big && d.big.length > 4 ? 150 : 240}px;font-weight:700;line-height:.92;margin-top:40px}
      .big small{font-size:84px;color:${t.accent};margin-left:20px}
      .q{font-size:74px;font-weight:700;line-height:1.42;margin-top:${d.big ? 48 : 20}px}
      .rule{width:150px;height:5px;background:${t.accent};margin:52px 0 38px}
      .sub{font-size:40px;color:${t.dim};line-height:1.6}`,
    body: `
      ${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}
      ${d.big ? `<div class="big">${esc(d.big)}${d.bigUnit ? `<small>${esc(d.bigUnit)}</small>` : ''}</div>` : ''}
      <div class="q">${rich(d.quote)}</div>
      <div class="rule"></div>
      ${d.sub ? `<div class="sub">${rich(d.sub)}</div>` : ''}`,
    center: !d.big,
  }),

  // เปรียบเทียบก่อน→หลัง เป็นแถว — ใช้กับข้อมูล/สถิติ
  stat: (d, t) => ({
    css: `h1{font-size:96px;font-weight:700;line-height:1.16;margin-top:32px}
      .lead{font-size:35px;color:${t.dim};margin-top:20px;line-height:1.5}
      .rows{margin-top:42px;display:flex;flex-direction:column;gap:20px}
      .row{background:${t.card};border-radius:16px;padding:28px 32px;border:2px solid ${t.line};
           display:flex;align-items:center;gap:24px}
      .lbl{flex:1;font-size:38px;font-weight:700;line-height:1.3}
      .lbl small{display:block;font-size:25px;font-weight:400;color:${t.dim};margin-top:5px}
      .old{font-size:50px;font-weight:700;color:${t.dim};opacity:.55;text-decoration:line-through;
           min-width:120px;text-align:right}
      .arw{font-size:42px;color:${t.accent};font-weight:700}
      .new{font-size:64px;font-weight:700;color:${t.accent};min-width:180px;text-align:right;line-height:1}
      .new span{font-size:26px;color:${t.dim};font-weight:400;display:block;margin-top:5px}`,
    body: `
      ${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}
      <h1>${rich(d.title)}</h1>
      ${d.lead ? `<div class="lead">${rich(d.lead)}</div>` : ''}
      <div class="rows">${(d.rows || []).map(r => `
        <div class="row">
          <div class="lbl">${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</div>
          ${r.old != null ? `<div class="old">${esc(r.old)}</div><div class="arw">&#10145;</div>` : ''}
          <div class="new">${esc(r.new)}${r.unit ? `<span>${esc(r.unit)}</span>` : ''}</div>
        </div>`).join('')}</div>`,
  }),

  // รายการข้อแนะนำแบบมีเลขกำกับ
  tips: (d, t) => {
    // ยิ่งหลายข้อยิ่งย่อ เพื่อไม่ให้ล้นทับส่วนท้าย
    const n = (d.items || []).length;
    const z = n <= 3 ? { h1: 88, gap: 30, dot: 66, num: 34, tt: 39, tx: 30, top: 44 }
      : n === 4 ? { h1: 80, gap: 24, dot: 60, num: 31, tt: 36, tx: 28, top: 36 }
      : n === 5 ? { h1: 72, gap: 19, dot: 55, num: 29, tt: 33, tx: 26, top: 28 }
      : { h1: 64, gap: 14, dot: 48, num: 26, tt: 29, tx: 23, top: 22 };
    return {
    css: `h1{font-size:${z.h1}px;font-weight:700;line-height:1.18;margin-top:26px}
      .items{margin-top:${z.top}px;display:flex;flex-direction:column;gap:${z.gap}px}
      .item{display:flex;gap:24px;align-items:flex-start}
      .n{width:${z.dot}px;height:${z.dot}px;flex:none;border-radius:50%;background:${t.accent};color:${t.onAccent};
         font-size:${z.num}px;font-weight:700;display:flex;align-items:center;justify-content:center}
      .tx{font-size:${z.tt}px;font-weight:700;line-height:1.35;padding-top:4px}
      .tx small{display:block;font-size:${z.tx}px;font-weight:400;color:${t.dim};margin-top:6px;line-height:1.45}`,
    body: `
      ${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}
      <h1>${rich(d.title)}</h1>
      <div class="items">${(d.items || []).map((it, i) => `
        <div class="item"><div class="n">${i + 1}</div>
          <div class="tx">${esc(it.title)}${it.text ? `<small>${esc(it.text)}</small>` : ''}</div>
        </div>`).join('')}</div>`,
    };
  },

  // หัวเรื่องใหญ่ + ช่องใส่ภาพ SVG + ประโยคตอกย้ำ
  hero: (d, t) => ({
    css: `h1{font-size:116px;font-weight:700;line-height:1;margin-top:14px}
      .sub{font-size:35px;color:${t.dim};margin-top:12px}
      .art{margin-top:4px}
      .punch{background:${t.accent};color:${t.onAccent};font-size:50px;font-weight:700;
             padding:20px 46px;border-radius:14px;margin-top:8px}
      .stat{font-size:40px;font-weight:700;margin-top:24px;text-align:center;line-height:1.4}`,
    body: `
      ${d.kicker ? `<div class="kicker">${esc(d.kicker)}</div>` : ''}
      <h1>${rich(d.title)}</h1>
      ${d.sub ? `<div class="sub">${rich(d.sub)}</div>` : ''}
      ${d.svg ? `<div class="art">${d.svg}</div>` : ''}
      ${d.punch ? `<div class="punch">${esc(d.punch)}</div>` : ''}
      ${d.stat ? `<div class="stat">${rich(d.stat)}</div>` : ''}`,
    align: 'center',
  }),
};

// ---------- ประกอบ + เรนเดอร์ ----------
function buildHtml(name, data, theme) {
  const t = THEMES[theme] || die(`ไม่รู้จักธีม "${theme}" — มี: ${Object.keys(THEMES).join(', ')}`);
  const make = TEMPLATES[name] || die(`ไม่รู้จักเทมเพลต "${name}" — มี: ${Object.keys(TEMPLATES).join(', ')}`);
  const tpl = make(data, t);
  const cardStyle = [
    tpl.align === 'center' ? 'align-items:center;text-align:center' : '',
    tpl.center ? 'justify-content:center' : '',
    data.svg || data.footer || data.brand ? 'padding-bottom:150px' : '',
  ].filter(Boolean).join(';');
  return `<!doctype html><meta charset="utf-8"><style>${base(t)}${tpl.css}
    .card{${cardStyle}}</style>
    <div class="card">${tpl.body}
      ${data.photo ? `<div class="photo-frame"><img src="${asFileUrl(data.photo)}"></div>` : ''}
      ${(data.footer || data.brand) ? `<div class="foot">
        <div>${rich(data.footer || '')}</div>
        <div class="brand">${esc(data.brand || '')}</div></div>` : ''}
    </div>`;
}

const [, , name, dataPath, outPath, ...rest] = process.argv;
if (!name || !dataPath || !outPath) {
  die('ใช้: node make-card.mjs <template> <data.json> <out.png> [--theme <ธีม>] [--font <path>] [--font-bold <path>]\n' +
      `  template: ${Object.keys(TEMPLATES).join(' | ')}\n` +
      `  theme:    ${Object.keys(THEMES).join(' | ')}`);
}
const ti = rest.indexOf('--theme');
const theme = ti >= 0 ? rest[ti + 1] : (JSON.parse(readFileSync(resolve(dataPath), 'utf8')).theme || 'default');
if (!existsSync(resolve(dataPath))) die(`ไม่พบไฟล์ข้อมูล: ${dataPath}`);
const asFileUrl = p => (p.startsWith('file://') ? p : `file://${resolve(p)}`);
const fi = rest.indexOf('--font');
if (fi >= 0) FONT = asFileUrl(rest[fi + 1]);
const fbi = rest.indexOf('--font-bold');
if (fbi >= 0) FONT_BOLD = asFileUrl(rest[fbi + 1]);

const data = JSON.parse(readFileSync(resolve(dataPath), 'utf8'));
const html = buildHtml(name, data, theme);
const tmp = resolve(dirname(resolve(outPath)), `.card-${Date.now()}.html`);
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(tmp, html);
try {
  if (!existsSync(CHROME)) die(`ไม่พบ Chromium ที่ ${CHROME} — ตั้ง env CHROME_BIN ให้ถูก`);
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${SIZE},${SIZE}`,
    `--screenshot=${resolve(outPath)}`, tmp,
  ], { stdio: 'pipe' });
} finally {
  rmSync(tmp, { force: true });
}
if (!existsSync(resolve(outPath))) die('เรนเดอร์ไม่สำเร็จ');
console.log(`✔ สร้างภาพแล้ว: ${outPath}  (เทมเพลต ${name} · ธีม ${theme})`);
