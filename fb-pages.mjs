#!/usr/bin/env node
/**
 * fb-pages.mjs — จัดการข้อมูลเพจลูกค้าผ่าน Meta Pages API
 * ต้องการ Node 18+ ไม่ต้องลง dependency ใดๆ
 *
 * ตั้งค่า token ได้ 2 ทาง (ใช้ทางใดทางหนึ่ง):
 *   1) environment variable USER_TOKEN หรือ FB_USER_TOKEN  — เช่นใส่ใน .claude/settings.local.json ของ Claude Code
 *   2) ไฟล์ .env โฟลเดอร์เดียวกับสคริปต์:  USER_TOKEN=<long-lived user token อายุ 60 วัน>
 *   (API_VERSION หรือ GRAPH_VERSION ตั้งได้ทั้งสองทาง ไม่ใส่ = v26.0)
 *
 * คำสั่ง:
 *   node fb-pages.mjs check                         ตรวจว่าเจอ token ไหม + ใช้งานได้ไหม + เห็นกี่เพจ
 *   node fb-pages.mjs sync                          ดึงเพจทั้งหมด + Page token → pages.json (ครั้งแรก / เมื่อมีลูกค้าใหม่)
 *   node fb-pages.mjs audit                         เช็คว่าแต่ละเพจขาดข้อมูลอะไรบ้าง
 *   node fb-pages.mjs show <page-id>                ดูข้อมูลปัจจุบันของเพจ (JSON)
 *   node fb-pages.mjs apply <page-id> <setup.json>  อัปเดตข้อมูลเพจจากไฟล์ (ใส่ --dry เพื่อดู payload โดยไม่ยิงจริง)
 *
 * Page token ใน pages.json ไม่หมดอายุ — audit/show/apply ใช้ได้แม้ USER_TOKEN หมดอายุแล้ว
 * อย่าลืมใส่ .env และ pages.json ใน .gitignore
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(ROOT, '.env');
const PAGES_PATH = resolve(ROOT, 'pages.json');

// ---------- .env ----------
function loadEnv() {
  const env = {};
  if (!existsSync(ENV_PATH)) return env;
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const fileEnv = loadEnv();
const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n] || fileEnv[n];
    if (v) return v;
  }
};
const env = {
  USER_TOKEN: pick('USER_TOKEN', 'FB_USER_TOKEN'),
  API_VERSION: pick('API_VERSION', 'GRAPH_VERSION'),
};
const API = `https://graph.facebook.com/${env.API_VERSION || 'v26.0'}`;

// ---------- Graph API ----------
async function graph(path, { token, method = 'GET', params = {} } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  body.set('access_token', token);
  const url = `${API}/${path}`;
  let res;
  try {
    res = method === 'GET' ? await fetch(`${url}?${body}`) : await fetch(url, { method, body });
  } catch (e) {
    throw new Error(`ต่อ graph.facebook.com ไม่ได้: ${e.cause?.message || e.message}`);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // ไม่ใช่ JSON = โดน proxy/firewall กั้น ไม่ใช่ Meta ตอบ
    const hint = /allowlist|not in allow|egress/i.test(text)
      ? ' — เพิ่ม graph.facebook.com ใน network egress settings ของ environment'
      : '';
    throw new Error(`ตอบกลับไม่ใช่ JSON (HTTP ${res.status}): ${text.trim().slice(0, 160)}${hint}`);
  }
  if (json.error) {
    const e = json.error;
    throw new Error(`${e.message} (code ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''})`);
  }
  return json;
}

async function fetchAllPages(userToken) {
  const pages = [];
  let after;
  do {
    const json = await graph('me/accounts', {
      token: userToken,
      params: { fields: 'id,name,category,access_token', limit: 100, ...(after && { after }) },
    });
    pages.push(...json.data);
    after = json.paging?.next ? json.paging.cursors?.after : undefined;
  } while (after);
  return pages;
}

function die(msg) { console.error('✖', msg); process.exit(1); }

async function loadPages() {
  if (!existsSync(PAGES_PATH)) {
    if (!env.USER_TOKEN) die('ยังไม่มี pages.json และไม่พบ token — ตั้ง USER_TOKEN หรือ FB_USER_TOKEN แล้วรัน sync');
    console.log('ไม่พบ pages.json → sync อัตโนมัติ');
    await cmdSync();
  }
  return JSON.parse(readFileSync(PAGES_PATH, 'utf8')).pages;
}

async function findPage(id) {
  const p = (await loadPages()).find(p => p.id === id || p.name === id);
  if (!p) die(`ไม่พบเพจ "${id}" ใน pages.json (ถ้าเพิ่งได้สิทธิ์เพจใหม่ ให้รัน sync ก่อน)`);
  return p;
}

// ---------- ฟิลด์ที่อ่าน + เกณฑ์ตรวจ ----------
const PAGE_FIELDS = [
  'id', 'name', 'username', 'link', 'category', 'category_list', 'about', 'description',
  'general_info', 'company_overview', 'mission', 'products', 'founded', 'price_range',
  'phone', 'website', 'emails', 'single_line_address', 'location', 'hours',
  'cover', 'picture{url,is_silhouette}', 'is_published', 'fan_count',
].join(',');

// [ฟิลด์, ป้ายภาษาไทย, คำแนะนำถ้าอัปเดตผ่าน apply ไม่ได้]
const CHECKS = [
  ['username',            'ชื่อผู้ใช้ @username (ลิงก์เพจแบบสั้น)', 'ตั้งได้ที่การตั้งค่าเพจเท่านั้น'],
  ['category',            'หมวดหมู่ธุรกิจ',                        'เปลี่ยนที่การตั้งค่าเพจ'],
  ['about',               'About (ข้อความสั้นใต้ชื่อเพจ)'],
  ['description',         'รายละเอียดเพจ'],
  ['phone',               'เบอร์โทร'],
  ['website',             'เว็บไซต์'],
  ['emails',              'อีเมลติดต่อ'],
  ['single_line_address', 'ที่อยู่'],
  ['hours',               'เวลาทำการ'],
  ['cover',               'รูปปก',                                  'อัปโหลดผ่าน /{page-id}/photos'],
  ['picture',             'รูปโปรไฟล์',                             'อัปโหลดผ่าน /{page-id}/picture'],
];

function isMissing(key, v) {
  if (key === 'picture') return !v?.data?.url || v.data.is_silhouette === true;
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

// ---------- คำสั่ง ----------
async function cmdSync() {
  if (!env.USER_TOKEN) die('ไม่พบ token — ตั้ง env USER_TOKEN หรือ FB_USER_TOKEN (หรือใส่ในไฟล์ .env)');
  const pages = await fetchAllPages(env.USER_TOKEN);
  writeFileSync(PAGES_PATH, JSON.stringify({ synced_at: new Date().toISOString(), pages }, null, 2));
  console.log(`✔ ดึงได้ ${pages.length} เพจ → pages.json`);
  for (const p of pages) console.log(`  ${p.id}  ${p.name}  [${p.category}]`);
}

async function cmdAudit() {
  for (const p of await loadPages()) {
    let info;
    try {
      info = await graph(p.id, { token: p.access_token, params: { fields: PAGE_FIELDS } });
    } catch (e) {
      console.log(`\n${p.name}  (${p.id})\n  ✖ อ่านข้อมูลไม่ได้: ${e.message}`);
      continue;
    }
    const missing = CHECKS.filter(([k]) => isMissing(k, info[k]));
    const score = Math.round(((CHECKS.length - missing.length) / CHECKS.length) * 100);
    const flag = info.is_published === false ? '  ⚠ เพจยังไม่เผยแพร่' : '';
    console.log(`\n${info.name}  (${p.id})  ข้อมูลครบ ${score}%${flag}`);
    if (!missing.length) { console.log('  ✔ ครบทุกรายการ'); continue; }
    for (const [, label, hint] of missing) console.log(`  ✖ ${label}${hint ? `  — ${hint}` : ''}`);
  }
}

async function cmdShow(id) {
  if (!id) die('ใช้: node fb-pages.mjs show <page-id>');
  const p = await findPage(id);
  const info = await graph(p.id, { token: p.access_token, params: { fields: PAGE_FIELDS } });
  console.log(JSON.stringify(info, null, 2));
}

// ฟิลด์ที่ POST /{page-id} รับได้โดยตรง (รูปปก/รูปโปรไฟล์/หมวดหมู่ ต้องใช้ endpoint อื่น)
const WRITABLE = [
  'about', 'description', 'general_info', 'company_overview', 'mission', 'products',
  'founded', 'price_range', 'phone', 'website', 'emails', 'hours',
];

async function cmdApply(id, file, dry) {
  if (!id || !file) die('ใช้: node fb-pages.mjs apply <page-id> <setup.json> [--dry]');
  const p = await findPage(id);
  const setup = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const params = {}, skipped = [];
  for (const [k, v] of Object.entries(setup)) {
    if (WRITABLE.includes(k)) params[k] = v; else skipped.push(k);
  }
  if (skipped.length) console.log(`⚠ ข้ามฟิลด์ที่คำสั่งนี้อัปเดตไม่ได้: ${skipped.join(', ')}`);
  if (typeof params.about === 'string' && params.about.length > 255) die('about ยาวเกิน 255 ตัวอักษร');
  if (!Object.keys(params).length) die('ไม่มีฟิลด์ที่อัปเดตได้ในไฟล์');
  console.log(`เพจ: ${p.name} (${p.id})\nฟิลด์ที่จะอัปเดต: ${Object.keys(params).join(', ')}`);
  if (dry) { console.log(JSON.stringify(params, null, 2)); console.log('(dry run — ยังไม่ยิงจริง)'); return; }
  const res = await graph(p.id, { token: p.access_token, method: 'POST', params });
  console.log(res.success ? '✔ อัปเดตสำเร็จ — รัน audit ซ้ำเพื่อยืนยัน' : JSON.stringify(res));
}

// ---------- check: ตรวจว่า token เจอไหม + ใช้งานได้ไหม (ไม่แสดงค่า token) ----------
const NEEDED_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'];

async function cmdCheck() {
  const varName = ['USER_TOKEN', 'FB_USER_TOKEN'].find(n => process.env[n]) ||
                  ['USER_TOKEN', 'FB_USER_TOKEN'].find(n => fileEnv[n]);
  if (!env.USER_TOKEN) die('ไม่พบ token — ตั้ง env USER_TOKEN หรือ FB_USER_TOKEN (หรือใส่ในไฟล์ .env)');
  const src = process.env[varName] ? 'environment variable' : 'ไฟล์ .env';
  console.log(`✔ เจอ token จาก ${src} ชื่อ ${varName} (ยาว ${env.USER_TOKEN.length} ตัวอักษร)`);
  console.log(`  Graph API: ${API}`);

  let me;
  try {
    me = await graph('me', { token: env.USER_TOKEN, params: { fields: 'id,name' } });
  } catch (e) {
    const network = /ไม่ใช่ JSON|ต่อ graph\.facebook\.com ไม่ได้/.test(e.message);
    die(network
      ? `ต่อ Meta ไม่ได้ (ยังไม่ได้ตรวจ token): ${e.message}`
      : `token ใช้งานไม่ได้: ${e.message}\n  → generate token ใหม่ที่ Graph API Explorer แล้ว extend เป็น long-lived`);
  }
  console.log(`✔ token ใช้งานได้ — บัญชี: ${me.name} (${me.id})`);

  try {
    const { data } = await graph('me/permissions', { token: env.USER_TOKEN });
    const granted = data.filter(p => p.status === 'granted').map(p => p.permission);
    const missing = NEEDED_SCOPES.filter(s => !granted.includes(s));
    console.log(`  สิทธิ์ที่ได้: ${granted.length} รายการ — ${granted.sort().join(', ')}`);
    if (missing.length) console.log(`  ⚠ ขาดสิทธิ์ที่จำเป็น: ${missing.join(', ')}`);
    else console.log('  ✔ สิทธิ์ครบตามที่ทูลต้องใช้');
  } catch (e) {
    console.log(`  ⚠ อ่านรายการสิทธิ์ไม่ได้: ${e.message}`);
  }

  try {
    const { data } = await graph('debug_token', {
      token: env.USER_TOKEN, params: { input_token: env.USER_TOKEN },
    });
    console.log(`  ประเภท token: ${data.type}${data.is_valid ? '' : ' (ไม่ valid)'}`);
    if (data.expires_at === 0) console.log('  วันหมดอายุ: ไม่หมดอายุ');
    else if (data.expires_at) {
      const d = new Date(data.expires_at * 1000);
      const days = Math.round((d - Date.now()) / 86400000);
      console.log(`  วันหมดอายุ: ${d.toISOString().slice(0, 10)} (อีก ${days} วัน)${days < 7 ? '  ⚠ ใกล้หมดแล้ว' : ''}`);
    }
  } catch { /* debug_token ต้องใช้ app token ในบางกรณี — ข้ามได้ */ }

  try {
    const pages = await fetchAllPages(env.USER_TOKEN);
    console.log(`✔ มองเห็น ${pages.length} เพจ — รัน sync เพื่อบันทึกลง pages.json`);
    for (const p of pages) console.log(`  ${p.id}  ${p.name}  [${p.category}]`);
  } catch (e) {
    console.log(`  ⚠ ดึงรายชื่อเพจไม่ได้: ${e.message}`);
  }
}

// ---------- main ----------
const [cmd, ...args] = process.argv.slice(2);
const dry = args.includes('--dry');
const pos = args.filter(a => !a.startsWith('--'));
const run = {
  check: cmdCheck,
  sync: cmdSync,
  audit: cmdAudit,
  show: () => cmdShow(pos[0]),
  apply: () => cmdApply(pos[0], pos[1], dry),
}[cmd];
if (!run) die('คำสั่ง: check | sync | audit | show <page-id> | apply <page-id> <setup.json> [--dry]');
run().catch(e => die(e.message));
