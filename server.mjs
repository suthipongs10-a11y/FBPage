#!/usr/bin/env node
/**
 * server.mjs — เซิร์ฟเวอร์ของแดชบอร์ด (Node 18+, ไม่มี dependency)
 *
 *   node server.mjs            → http://127.0.0.1:8787
 *   PORT=9000 node server.mjs
 *
 * หลักความปลอดภัย
 *   - ผูกกับ 127.0.0.1 เท่านั้น ไม่เปิดออกเน็ตเวิร์ก
 *   - token ทุกชนิด (เพจ / AI / โฆษณา) อยู่ฝั่งเซิร์ฟเวอร์ ไม่เคยส่งไปหน้าเว็บ
 *   - ทุก /api ต้องมี header x-app-token ที่สุ่มใหม่ทุกครั้งที่เปิด (กัน CSRF จากเว็บอื่นในเครื่อง)
 *   - AI เตรียมโพสต์ได้ แต่โพสต์จริงต้องกดยืนยันในหน้าเว็บเสมอ
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  ROOT, env, graph, loadPages, findPage, publicPage, PAGE_FIELDS, scoreOf, buildReport,
} from './lib/graph.mjs';
import { chat, runAgent, providerList } from './lib/ai.mjs';
import { listAdAccounts, campaignReport, dailySpend } from './lib/ads.mjs';

const PORT = Number(process.env.PORT) || 8787;
const WEB = resolve(ROOT, 'web');
const CONFIG_PATH = resolve(ROOT, 'config.json');
const IMG_DIR = resolve(ROOT, 'post/img');
const APP_TOKEN = randomBytes(24).toString('hex');

// ---------- config (เก็บ key ของ AI / โฆษณา — ไฟล์นี้อยู่ใน .gitignore) ----------
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ai: {}, ads: {} };
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { return { ai: {}, ads: {} }; }
}
function saveConfig(c) {
  writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* windows */ }
}
const mask = s => (s ? `••••${String(s).slice(-4)}` : '');

// ---------- helpers ----------
const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const readBody = req => new Promise((ok, no) => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 25e6) no(new Error('body ใหญ่เกิน')); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { no(new Error('body ไม่ใช่ JSON')); } });
});
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

async function fetchAllPages(userToken) {
  const pages = []; let after;
  do {
    const j = await graph('me/accounts', { token: userToken, params: { fields: 'id,name,category,tasks,access_token', limit: 100, ...(after && { after }) } });
    pages.push(...j.data); after = j.paging?.next ? j.paging.cursors?.after : undefined;
  } while (after);
  return pages;
}

/** รับรูปจากหน้าเว็บ: data URL → เขียนไฟล์; path ในเครื่อง → ใช้ตามนั้น (จำกัดอยู่ใน post/img) */
function materializePhotos(list = []) {
  mkdirSync(IMG_DIR, { recursive: true });
  return list.map((p, i) => {
    if (/^data:image\/(png|jpe?g|webp);base64,/.test(p)) {
      const ext = p.startsWith('data:image/png') ? 'png' : p.startsWith('data:image/webp') ? 'webp' : 'jpg';
      const file = resolve(IMG_DIR, `upload-${Date.now()}-${i}.${ext}`);
      writeFileSync(file, Buffer.from(p.split(',')[1], 'base64'));
      return file;
    }
    if (/^https?:\/\//.test(p)) return p;
    const abs = resolve(ROOT, p);
    if (!abs.startsWith(IMG_DIR) || !existsSync(abs)) throw new Error(`ไม่พบรูปหรืออยู่นอกโฟลเดอร์ post/img: ${p}`);
    return abs;
  });
}

function renderCard({ template, data, theme }) {
  mkdirSync(IMG_DIR, { recursive: true });
  const stamp = Date.now();
  const dataPath = resolve(IMG_DIR, `.card-${stamp}.json`);
  const out = resolve(IMG_DIR, `card-${stamp}.png`);
  writeFileSync(dataPath, JSON.stringify({ ...data, theme: theme || data.theme || 'default' }));
  try {
    execFileSync(process.execPath, [resolve(ROOT, 'make-card.mjs'), template, dataPath, out], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(`สร้างภาพไม่สำเร็จ: ${(e.stderr || e.stdout || '').toString().trim() || e.message}`);
  } finally { try { execFileSync('rm', ['-f', dataPath]); } catch { /* ข้าม */ } }
  const rel = `post/img/card-${stamp}.png`;
  return { path: rel, dataUrl: `data:image/png;base64,${readFileSync(out).toString('base64')}` };
}

async function publishPost(p, { message, link, photos = [], scheduled_publish_time, dry }) {
  if (!message && !link && !photos.length) throw new Error('ต้องมีอย่างน้อย message, link หรือ photos');
  if (photos.length > 10) throw new Error('แนบรูปได้สูงสุด 10 ใบ');
  let schedule;
  if (scheduled_publish_time) {
    const ms = new Date(scheduled_publish_time).getTime();
    if (!Number.isFinite(ms)) throw new Error('รูปแบบเวลาไม่ถูกต้อง');
    const mins = (ms - Date.now()) / 60000;
    if (mins < 10 || mins > 75 * 1440) throw new Error('ตั้งเวลาต้องล่วงหน้า 10 นาที ถึง 75 วัน');
    schedule = Math.floor(ms / 1000);
  }
  const files = materializePhotos(photos);
  if (dry) return { dry: true, page: publicPage(p), message, link, photos: files.map(f => f.replace(ROOT + '/', '')), schedule };
  const media = [];
  for (const f of files) {
    const r = /^https?:\/\//.test(f)
      ? await graph(`${p.id}/photos`, { token: p.access_token, method: 'POST', params: { url: f, published: false } })
      : await graph(`${p.id}/photos`, { token: p.access_token, method: 'POST', params: { published: false }, files: { source: f } });
    media.push(r.id);
  }
  const params = {};
  if (message) params.message = message;
  if (link && !media.length) params.link = link;
  media.forEach((id, i) => { params[`attached_media[${i}]`] = { media_fbid: id }; });
  if (schedule) { params.published = false; params.scheduled_publish_time = schedule; }
  const r = await graph(`${p.id}/feed`, { token: p.access_token, method: 'POST', params });
  return { id: r.id, url: `https://www.facebook.com/${r.id}`, scheduled: !!schedule };
}

const WRITABLE = ['about', 'description', 'founded', 'price_range', 'phone', 'website', 'emails', 'hours'];
async function applyFields(p, body) {
  const params = {};
  for (const k of WRITABLE) if (body[k] !== undefined && body[k] !== '') params[k] = body[k];
  if (typeof params.about === 'string' && params.about.length > 255) throw new Error('about ยาวเกิน 255 ตัวอักษร');
  if (typeof params.description === 'string' && /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(params.description))
    throw new Error('description ห้ามมี emoji (Facebook จะแปลงเป็น �)');
  if (!Object.keys(params).length) throw new Error('ไม่มีฟิลด์ที่อัปเดตได้');
  if (body.dry) return { dry: true, params };
  const r = await graph(p.id, { token: p.access_token, method: 'POST', params });
  return { ok: !!r.success, params: Object.keys(params) };
}

// ---------- เครื่องมือที่ AI เรียกได้ (อ่านได้เต็มที่ / เขียนได้แค่ "เตรียม") ----------
const AI_TOOLS = [
  { name: 'list_pages', description: 'รายชื่อเพจทั้งหมดที่ดูแลอยู่ พร้อม id และสิทธิ์', parameters: { type: 'object', properties: {} } },
  { name: 'audit_page', description: 'ตรวจว่าข้อมูลเพจครบกี่ % และขาดอะไร', parameters: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
  { name: 'page_info', description: 'ดูข้อมูลปัจจุบันของเพจ (about, description, เบอร์, เวลาทำการ ฯลฯ)', parameters: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
  { name: 'page_report', description: 'สรุปผลเพจย้อนหลัง N วัน: โพสต์ ยอดแชร์ ผู้ติดตาม', parameters: { type: 'object', properties: { page_id: { type: 'string' }, days: { type: 'integer', default: 30 } }, required: ['page_id'] } },
  { name: 'ads_report', description: 'ข้อมูลโฆษณา: แคมเปญ ค่าใช้จ่าย ต้นทุนต่อผลลัพธ์ CPM สถานะ', parameters: { type: 'object', properties: { date_preset: { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month', 'maximum'] } } } },
  { name: 'create_card', description: 'สร้างภาพประกอบโพสต์ 1080x1080 จากเทมเพลต (quote/stat/tips) ได้ path ไฟล์กลับมา', parameters: { type: 'object', properties: { template: { type: 'string', enum: ['quote', 'stat', 'tips'] }, theme: { type: 'string', enum: ['fadaeng', 'phuketmaids', 'rabiangboon', 'dark', 'default'] }, data: { type: 'object', description: 'ข้อมูลตามเทมเพลต เช่น {kicker,title,items:[{title,text}],brand} หรือ {kicker,big,bigUnit,quote,sub,brand} หรือ {kicker,title,lead,rows:[{label,note,old,new,unit}],footer,brand}' } }, required: ['template', 'data'] } },
  { name: 'prepare_post', description: 'เตรียมโพสต์ให้ผู้ใช้กดยืนยัน (ไม่โพสต์จริง) — ใช้เมื่อร่างเนื้อหาเสร็จแล้ว', parameters: { type: 'object', properties: { page_id: { type: 'string' }, message: { type: 'string' }, photos: { type: 'array', items: { type: 'string' }, description: 'path ภาพจาก create_card' }, scheduled_publish_time: { type: 'string', description: 'ISO 8601 เช่น 2026-09-05T10:00:00+07:00 (ไม่ใส่ = โพสต์ทันทีเมื่อผู้ใช้ยืนยัน)' } }, required: ['page_id', 'message'] } },
];

function makeExec(cfg, drafts) {
  return async (name, a) => {
    switch (name) {
      case 'list_pages': return loadPages().map(publicPage);
      case 'audit_page': { const p = findPage(a.page_id); const info = await graph(p.id, { token: p.access_token, params: { fields: PAGE_FIELDS } }); return { page: publicPage(p), ...scoreOf(info) }; }
      case 'page_info': { const p = findPage(a.page_id); const i = await graph(p.id, { token: p.access_token, params: { fields: PAGE_FIELDS } }); delete i.cover; delete i.picture; return i; }
      case 'page_report': { const r = await buildReport(findPage(a.page_id), Math.min(365, Math.max(1, a.days || 30))); return { ...r, timeline: undefined, posts: r.posts.slice(0, 10) }; }
      case 'ads_report': {
        if (!cfg.ads?.token || !cfg.ads?.accountId) return { error: 'ยังไม่ได้ตั้งค่า token/บัญชีโฆษณาในหน้าตั้งค่า' };
        return campaignReport(cfg.ads.token, cfg.ads.accountId, a.date_preset || 'last_30d');
      }
      case 'create_card': { const r = renderCard({ template: a.template, data: a.data, theme: a.theme }); drafts.cards.push(r); return { path: r.path }; }
      case 'prepare_post': { const p = findPage(a.page_id); const d = { page: publicPage(p), message: a.message, photos: a.photos || [], scheduled_publish_time: a.scheduled_publish_time || null }; drafts.posts.push(d); return { prepared: true, note: 'รอผู้ใช้กดยืนยันในหน้าเว็บ' }; }
      default: throw new Error(`ไม่รู้จักเครื่องมือ ${name}`);
    }
  };
}

const SYSTEM = `คุณคือผู้ช่วยดูแลเพจ Facebook ของลูกค้า ตอบเป็นภาษาไทย กระชับ ตรงประเด็น
กฎ:
- ใช้เครื่องมืออ่านข้อมูลจริงก่อนสรุปเสมอ ห้ามเดาตัวเลข ตัวเลขที่อ่านไม่ได้ให้บอกว่า "อ่านไม่ได้" ไม่ใช่ 0
- เขียนคอนเทนต์ภาษาไทยให้ตรงกับประเภทธุรกิจและน้ำเสียงของเพจ (ดูจาก page_info)
- ห้ามอ้างสรรพคุณสุขภาพ/รักษาโรค ห้ามใช้ข้อมูลหรือรูปที่คัดลอกจากเพจอื่น ห้ามพาดพิงบุคคลจริงในทางเสียหาย
- ทุกข้อเท็จจริงที่ใส่ในโพสต์ต้องระบุที่มาได้ ถ้าไม่มั่นใจให้เว้นไว้และบอกผู้ใช้
- description ของเพจห้ามใส่ emoji แต่ในโพสต์ใส่ได้
- คุณ "โพสต์จริง" ไม่ได้ — ใช้ prepare_post เพื่อส่งให้ผู้ใช้กดยืนยัน และบอกผู้ใช้ว่ารอการยืนยัน
- ถ้าต้องการภาพ ให้ใช้ create_card แล้วส่ง path ที่ได้ไปใน prepare_post`;

// ---------- routing ----------
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

on('GET', '/api/status', async () => {
  const cfg = loadConfig(); const pages = loadPages();
  let me = null;
  if (env.USER_TOKEN) { try { me = await graph('me', { token: env.USER_TOKEN, params: { fields: 'id,name' } }); } catch (e) { me = { error: e.message }; } }
  return {
    user_token: !!env.USER_TOKEN, me, pages: pages.length,
    ai: { configured: !!cfg.ai?.apiKey, provider: cfg.ai?.provider || null, model: cfg.ai?.model || null },
    ads: { configured: !!cfg.ads?.token, accountId: cfg.ads?.accountId || null },
    chrome: existsSync(process.env.CHROME_BIN || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'),
  };
});
on('GET', '/api/settings', async () => {
  const c = loadConfig();
  return { providers: providerList(), ai: { provider: c.ai?.provider || 'anthropic', model: c.ai?.model || '', baseUrl: c.ai?.baseUrl || '', apiKey: mask(c.ai?.apiKey) }, ads: { accountId: c.ads?.accountId || '', token: mask(c.ads?.token) } };
});
on('POST', '/api/settings', async ({ body }) => {
  const c = loadConfig();
  c.ai = { ...c.ai, provider: body.ai?.provider || c.ai?.provider, model: body.ai?.model ?? c.ai?.model, baseUrl: body.ai?.baseUrl ?? c.ai?.baseUrl };
  if (body.ai?.apiKey && !body.ai.apiKey.startsWith('••••')) c.ai.apiKey = body.ai.apiKey.trim();
  c.ads = { ...c.ads, accountId: body.ads?.accountId ?? c.ads?.accountId };
  if (body.ads?.token && !body.ads.token.startsWith('••••')) c.ads.token = body.ads.token.trim();
  saveConfig(c);
  return { ok: true };
});
on('POST', '/api/settings/test-ai', async () => {
  const c = loadConfig();
  const r = await chat(c.ai, { system: 'ตอบสั้นที่สุด', messages: [{ role: 'user', content: 'ตอบว่า OK' }] });
  return { ok: true, model: r.model, text: r.text.slice(0, 80) };
});

on('POST', '/api/sync', async () => {
  if (!env.USER_TOKEN) throw new Error('ไม่พบ USER_TOKEN/FB_USER_TOKEN ในสภาพแวดล้อมหรือ .env');
  const pages = await fetchAllPages(env.USER_TOKEN);
  writeFileSync(resolve(ROOT, 'pages.json'), JSON.stringify({ synced_at: new Date().toISOString(), pages }, null, 2));
  return { pages: pages.map(publicPage) };
});
on('GET', '/api/pages', async () => loadPages().map(publicPage));
on('GET', '/api/audit', async () => {
  const pages = loadPages();
  return Promise.all(pages.map(async p => {
    try { const info = await graph(p.id, { token: p.access_token, params: { fields: PAGE_FIELDS } }); return { ...publicPage(p), fan_count: info.fan_count || 0, ...scoreOf(info) }; }
    catch (e) { return { ...publicPage(p), error: e.message }; }
  }));
});
on('GET', '/api/pages/:id', async ({ params }) => {
  const p = findPage(params.id);
  const i = await graph(p.id, { token: p.access_token, params: { fields: PAGE_FIELDS } });
  return { ...i, picture: i.picture?.data?.url || null, cover: i.cover?.source || null, tasks: p.tasks || [] };
});
on('GET', '/api/pages/:id/report', async ({ params, query }) => buildReport(findPage(params.id), Math.min(365, Math.max(1, Number(query.get('days')) || 30))));
on('POST', '/api/pages/:id/post', async ({ params, body }) => publishPost(findPage(params.id), body));
on('POST', '/api/pages/:id/apply', async ({ params, body }) => applyFields(findPage(params.id), body));
on('POST', '/api/card', async ({ body }) => renderCard(body));

on('GET', '/api/ads/accounts', async () => { const c = loadConfig(); if (!c.ads?.token) throw new Error('ยังไม่ได้ตั้งค่า token โฆษณา'); return listAdAccounts(c.ads.token); });
on('GET', '/api/ads/report', async ({ query }) => {
  const c = loadConfig(); const acc = query.get('account') || c.ads?.accountId;
  if (!c.ads?.token || !acc) throw new Error('ยังไม่ได้ตั้งค่า token/บัญชีโฆษณา');
  return campaignReport(c.ads.token, acc, query.get('preset') || 'last_30d');
});
on('GET', '/api/ads/daily', async ({ query }) => {
  const c = loadConfig(); const acc = query.get('account') || c.ads?.accountId;
  if (!c.ads?.token || !acc) throw new Error('ยังไม่ได้ตั้งค่า token/บัญชีโฆษณา');
  return dailySpend(c.ads.token, acc, Math.min(90, Number(query.get('days')) || 30));
});

on('POST', '/api/ai/chat', async ({ body }) => {
  const cfg = loadConfig();
  const drafts = { posts: [], cards: [] }; const steps = [];
  const msgs = (body.messages || []).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: String(m.content || '') }));
  if (!msgs.length) throw new Error('ไม่มีข้อความ');
  const system = SYSTEM + (body.page_id ? `\nเพจที่กำลังทำงานอยู่: page_id=${body.page_id}` : '');
  const r = await runAgent(cfg.ai, { system, messages: msgs, tools: AI_TOOLS, exec: makeExec(cfg, drafts), onStep: s => steps.push(s) });
  return { text: r.text, steps, drafts, usage: r.usage, model: r.model };
});

// ---------- HTTP ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (req.headers['x-app-token'] !== APP_TOKEN) return json(res, 401, { error: 'ไม่ได้รับอนุญาต — รีเฟรชหน้าเว็บ' });
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    if (!r) return json(res, 404, { error: 'ไม่พบเส้นทาง' });
    try {
      const params = url.pathname.match(r.re).groups || {};
      const body = req.method === 'POST' ? await readBody(req) : {};
      json(res, 200, await r.fn({ params, query: url.searchParams, body }));
    } catch (e) { json(res, e.status || 400, { error: e.message }); }
    return;
  }
  // รูปที่สร้าง/อัปโหลด — ให้หน้าเว็บดูได้
  if (url.pathname.startsWith('/img/')) {
    const f = resolve(IMG_DIR, url.pathname.slice(5));
    if (!f.startsWith(IMG_DIR) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); return res.end(readFileSync(f));
  }
  // static PWA
  let file = resolve(WEB, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  if (!file.startsWith(WEB) || !existsSync(file)) file = resolve(WEB, 'index.html');
  let data = readFileSync(file);
  if (file.endsWith('index.html')) data = Buffer.from(data.toString('utf8').replace('__APP_TOKEN__', APP_TOKEN));
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('sw.js') ? 'no-store' : 'no-cache' });
  res.end(data);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✔ FB Page Ops Dashboard → http://127.0.0.1:${PORT}`);
  console.log(`  token ผู้ใช้: ${env.USER_TOKEN ? 'พบ' : 'ไม่พบ'} · เพจใน pages.json: ${loadPages().length}`);
  console.log('  ปิดด้วย Ctrl+C');
});
