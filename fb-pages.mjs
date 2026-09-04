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
import { resolve, dirname, basename } from 'node:path';
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
async function graph(path, { token, method = 'GET', params = {}, files } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  body.set('access_token', token);
  const url = `${API}/${path}`;
  let res;
  try {
    if (files) {
      // อัปโหลดไฟล์ต้องใช้ multipart — ค่าอื่นๆ (รวม access_token) ยกมาจาก body ชุดเดิม
      const form = new FormData();
      for (const [k, v] of body) form.set(k, v);
      for (const [k, f] of Object.entries(files)) form.set(k, new Blob([readFileSync(f)]), basename(f));
      res = await fetch(url, { method, body: form });
    } else {
      res = method === 'GET' ? await fetch(`${url}?${body}`) : await fetch(url, { method, body });
    }
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
      params: { fields: 'id,name,category,tasks,access_token', limit: 100, ...(after && { after }) },
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

// ---------- report: สรุปผลรายเพจ (ข้อมูลเพจ + โพสต์ + ยอดมีส่วนร่วม) ----------
const POST_FIELDS = [
  'id', 'message', 'created_time', 'permalink_url', 'shares',
  'likes.summary(true).limit(0)', 'comments.summary(true).limit(0)',
].join(',');

const nf = n => n.toLocaleString('th-TH');

// Graph เปลี่ยน edge ที่ใช้ดึงโพสต์ของเพจไปมาในแต่ละเวอร์ชัน — ลองไล่จนกว่าจะได้
const POST_EDGES = ['published_posts', 'feed', 'posts'];

const POST_FIELD_SETS = [
  POST_FIELDS,
  'id,message,created_time,permalink_url,shares',
  'id,message,created_time',
  'id,created_time',
];

async function fetchPosts(p, sinceSec, debug) {
  let lastErr;
  for (const edge of POST_EDGES) {
    for (const fields of POST_FIELD_SETS) {
      try {
        const posts = [];
        let after;
        do {
          const j = await graph(`${p.id}/${edge}`, {
            token: p.access_token,
            params: { fields, limit: 100, ...(after && { after }) },
          });
          posts.push(...(j.data || []));
          after = j.paging?.next ? j.paging.cursors?.after : undefined;
        } while (after);
        if (debug) console.log(`  (ใช้ ${edge} · fields: ${fields.slice(0, 40)}…)`);
        return { edge, fields, posts: posts.filter(x => new Date(x.created_time).getTime() / 1000 >= sinceSec) };
      } catch (e) {
        lastErr = e;
        if (debug) console.log(`  ✖ ${edge} [${fields.slice(0, 34)}…] → ${e.message.slice(0, 70)}`);
      }
    }
  }
  return { edge: null, posts: [], error: lastErr?.message };
}

function scoreOf(info) {
  const missing = CHECKS.filter(([k]) => isMissing(k, info[k]));
  return { missing, score: Math.round(((CHECKS.length - missing.length) / CHECKS.length) * 100) };
}

async function cmdReport(id, days, asJson, debug) {
  if (!id) die('ใช้: node fb-pages.mjs report <page-id> [--days 30] [--json]');
  const p = await findPage(id);
  const info = await graph(p.id, { token: p.access_token, params: { fields: PAGE_FIELDS } });
  const sinceSec = Math.floor(Date.now() / 1000) - days * 86400;
  const { posts, fields: usedFields, error: postErr } = await fetchPosts(p, sinceSec, debug);

  // ฟิลด์ไหนอ่านได้จริงบ้าง ขึ้นกับชุดฟิลด์ที่ Graph ยอมให้ผ่าน
  const can = {
    like: !!usedFields?.includes('likes.summary'),
    comment: !!usedFields?.includes('comments.summary'),
    share: !!usedFields?.includes('shares'),
  };
  const rows = posts.map(x => ({
    ...x,
    like: can.like ? (x.likes?.summary?.total_count || 0) : null,
    comment: can.comment ? (x.comments?.summary?.total_count || 0) : null,
    share: can.share ? (x.shares?.count || 0) : null,
  })).map(r => ({ ...r, total: (r.like || 0) + (r.comment || 0) + (r.share || 0) }))
    .sort((a, b) => b.total - a.total);

  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const totals = {
    like: can.like ? sum('like') : null,
    comment: can.comment ? sum('comment') : null,
    share: can.share ? sum('share') : null,
  };
  const NA = 'อ่านไม่ได้ (ต้องขอสิทธิ์เพิ่ม)';
  const val = (v) => v === null ? NA : nf(v);
  const { missing, score } = scoreOf(info);

  if (asJson) {
    console.log(JSON.stringify({
      page: { id: info.id, name: info.name, fan_count: info.fan_count || 0 },
      period_days: days, score, missing: missing.map(([, label]) => label),
      posts: rows.length, posts_error: postErr || null,
      engagement: totals, metrics_available: can,
      posts_per_week: rows.length ? +(rows.length / days * 7).toFixed(1) : 0,
      top: rows.slice(0, 5).map(r => ({
        message: (r.message || '(ไม่มีข้อความ)').replace(/\s+/g, ' ').slice(0, 90),
        created_time: r.created_time, permalink_url: r.permalink_url,
        like: r.like, comment: r.comment, share: r.share,
      })),
    }, null, 2));
    return;
  }

  const line = '─'.repeat(46);
  console.log(`\n${line}\nรายงานเพจ: ${info.name}  (${info.id})\nช่วงเวลา: ${days} วันล่าสุด\n${line}`);
  console.log(`\n[ ความสมบูรณ์ของข้อมูลเพจ ]  ${score}%`);
  if (!missing.length) console.log('  ✔ ข้อมูลครบทุกรายการ');
  else for (const [, label, hint] of missing) console.log(`  ✖ ${label}${hint ? `  — ${hint}` : ''}`);

  console.log(`\n[ ผู้ติดตาม ]  ${nf(info.fan_count || 0)} คน`);

  console.log(`\n[ โพสต์ในช่วงเวลา ]  ${postErr ? 'ดึงข้อมูลไม่ได้' : rows.length + ' โพสต์'}`);
  if (postErr) {
    console.log(`  ⚠ ${postErr}`);
  } else if (!rows.length) {
    console.log('  — ไม่มีโพสต์ในช่วงนี้');
  } else {
    console.log(`  ถูกใจ: ${val(totals.like)}`);
    console.log(`  ความคิดเห็น: ${val(totals.comment)}`);
    console.log(`  แชร์: ${val(totals.share)}`);
    console.log(`  ความถี่: ${(rows.length / days * 7).toFixed(1)} โพสต์ต่อสัปดาห์`);
    console.log('\n[ โพสต์ล่าสุด ]');
    for (const [i, r] of rows.slice(0, 5).entries()) {
      const msg = (r.message || '(ไม่มีข้อความ)').replace(/\s+/g, ' ').slice(0, 68);
      const d = new Date(r.created_time).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
      console.log(`  ${i + 1}. ${msg}${msg.length >= 68 ? '…' : ''}`);
      console.log(`     ${d}${can.share ? `  ·  แชร์ ${nf(r.share)}` : ''}`);
    }
  }
  console.log(`\n${line}\nหมายเหตุ: ยอดถูกใจ/ความคิดเห็นรายโพสต์ และตัวเลขการเข้าถึง ต้องขอสิทธิ์เพิ่ม\n(pages_read_engagement ระดับ App Review และ read_insights) · ค่าโฆษณาดูแยกที่ Ads Manager\n${line}\n`);
}

// ---------- post: โพสต์ลงเพจ (ข้อความ / ลิงก์ / รูปหลายใบ / ตั้งเวลา) ----------
const isUrl = v => /^https?:\/\//.test(v);

function readPostFile(file) {
  const post = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const photos = post.photos || [];
  if (!Array.isArray(photos)) die('photos ต้องเป็น array');
  if (!post.message && !post.link && !photos.length) die('ต้องมีอย่างน้อย message, link หรือ photos');
  if (photos.length > 10) die('แนบรูปได้สูงสุด 10 ใบต่อโพสต์');
  for (const ph of photos) {
    if (!isUrl(ph) && !existsSync(resolve(ph))) die(`ไม่พบไฟล์รูป: ${ph}`);
  }
  let schedule;
  if (post.scheduled_publish_time) {
    const ms = new Date(post.scheduled_publish_time).getTime();
    if (!Number.isFinite(ms)) die('scheduled_publish_time อ่านไม่ได้ — ใช้รูปแบบ 2026-09-05T10:00:00+07:00');
    const mins = (ms - Date.now()) / 60000;
    if (mins < 10) die('ตั้งเวลาโพสต์ต้องล่วงหน้าอย่างน้อย 10 นาที');
    if (mins > 75 * 24 * 60) die('ตั้งเวลาโพสต์ล่วงหน้าได้ไม่เกิน 75 วัน');
    schedule = Math.floor(ms / 1000);
  }
  if (post.link && photos.length) console.log('⚠ มีทั้ง link และ photos — Facebook จะแสดงรูปและไม่แสดงการ์ดลิงก์');
  return { post, photos, schedule };
}

async function cmdPost(id, file, dry) {
  if (!id || !file) die('ใช้: node fb-pages.mjs post <page-id> <post.json> [--dry]');
  const p = await findPage(id);
  const { post, photos, schedule } = readPostFile(file);

  console.log(`เพจ: ${p.name} (${p.id})`);
  console.log(`รูปแนบ: ${photos.length ? photos.join(', ') : 'ไม่มี'}`);
  console.log(`เวลาโพสต์: ${schedule ? new Date(schedule * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) + ' (เวลาไทย)' : 'ทันที'}`);
  if (post.link) console.log(`ลิงก์: ${post.link}`);
  if (post.message) console.log(`\n--- ข้อความ (${[...post.message].length} ตัวอักษร) ---\n${post.message}\n---`);
  if (dry) { console.log('(dry run — ยังไม่โพสต์จริง)'); return; }

  const media = [];
  for (const [i, ph] of photos.entries()) {
    process.stdout.write(`อัปโหลดรูป ${i + 1}/${photos.length} ... `);
    const r = isUrl(ph)
      ? await graph(`${p.id}/photos`, { token: p.access_token, method: 'POST', params: { url: ph, published: false } })
      : await graph(`${p.id}/photos`, { token: p.access_token, method: 'POST', params: { published: false }, files: { source: resolve(ph) } });
    media.push(r.id);
    console.log('✔');
  }

  const params = {};
  if (post.message) params.message = post.message;
  if (post.link && !media.length) params.link = post.link;
  media.forEach((fbid, i) => { params[`attached_media[${i}]`] = { media_fbid: fbid }; });
  if (schedule) { params.published = false; params.scheduled_publish_time = schedule; }

  const res = await graph(`${p.id}/feed`, { token: p.access_token, method: 'POST', params });
  if (!res.id) die(`โพสต์ไม่สำเร็จ: ${JSON.stringify(res)}`);
  console.log(schedule ? `✔ ตั้งเวลาโพสต์แล้ว — post id ${res.id}` : `✔ โพสต์แล้ว — https://www.facebook.com/${res.id}`);
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
    for (const p of pages) console.log(`  ${p.id}  ${p.name}  [${p.category}]  สิทธิ์บนเพจ: ${(p.tasks || []).join(',') || '—'}`);
  } catch (e) {
    console.log(`  ⚠ ดึงรายชื่อเพจไม่ได้: ${e.message}`);
  }
}

// ---------- main ----------
const [cmd, ...args] = process.argv.slice(2);
const dry = args.includes('--dry');
const daysIdx = args.indexOf('--days');
const pos = args.filter((a, i) => !a.startsWith('--') && i !== daysIdx + 1);
const daysArg = (() => {
  const v = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 30;
  return Number.isFinite(v) && v > 0 && v <= 365 ? Math.floor(v) : 30;
})();
const run = {
  check: cmdCheck,
  sync: cmdSync,
  audit: cmdAudit,
  show: () => cmdShow(pos[0]),
  apply: () => cmdApply(pos[0], pos[1], dry),
  post: () => cmdPost(pos[0], pos[1], dry),
  report: () => cmdReport(pos[0], daysArg, args.includes('--json'), args.includes('--debug')),
}[cmd];
if (!run) die('คำสั่ง: check | sync | audit | show <page-id> | apply <page-id> <setup.json> [--dry] | post <page-id> <post.json> [--dry] | report <page-id> [--days 30] [--json]');
run().catch(e => die(e.message));
