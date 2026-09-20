/**
 * lib/graph.mjs — ตัวเชื่อม Meta Graph API ที่ใช้ร่วมกันในฝั่งเซิร์ฟเวอร์
 *
 * แยกไฟล์ออกมาเพื่อให้ server.mjs ใช้ได้โดยไม่ต้องแก้ fb-pages.mjs
 * (CLI ที่ทดสอบแล้วว่าใช้งานได้ ไม่ควรไปแตะ logic การส่ง token)
 *
 * กฎเดียวกับ CLI: ห้าม log/ส่งออก token ในทุกกรณี
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = resolve(ROOT, '.env');
const PAGES_PATH = resolve(ROOT, 'pages.json');

function loadEnvFile() {
  const env = {};
  if (!existsSync(ENV_PATH)) return env;
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const fileEnv = loadEnvFile();
const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n] || fileEnv[n];
    if (v) return v;
  }
};

export const env = {
  USER_TOKEN: pick('USER_TOKEN', 'FB_USER_TOKEN'),
  API_VERSION: pick('API_VERSION', 'GRAPH_VERSION'),
};
export const API = `https://graph.facebook.com/${env.API_VERSION || 'v26.0'}`;

/** เรียก Graph API — token ถูกส่งใน body/query เท่านั้น ไม่เคยถูก log */
export async function graph(path, { token, method = 'GET', params = {}, files } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  body.set('access_token', token);
  const url = `${API}/${path}`;
  let res;
  try {
    if (files) {
      const form = new FormData();
      for (const [k, v] of body) form.set(k, v);
      for (const [k, f] of Object.entries(files)) {
        form.set(k, new Blob([readFileSync(f)]), f.split('/').pop());
      }
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
    const hint = /allowlist|not in allow|egress/i.test(text)
      ? ' — เพิ่ม graph.facebook.com ใน network egress settings'
      : '';
    throw new Error(`ตอบกลับไม่ใช่ JSON (HTTP ${res.status}): ${text.trim().slice(0, 160)}${hint}`);
  }
  if (json.error) {
    const e = json.error;
    throw new Error(`${e.message} (code ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''})`);
  }
  return json;
}

export function loadPages() {
  if (!existsSync(PAGES_PATH)) return [];
  return JSON.parse(readFileSync(PAGES_PATH, 'utf8')).pages || [];
}

/** หาเพจจาก id หรือชื่อ — คืนอ็อบเจกต์ที่ยังมี token อยู่ (ใช้ในเซิร์ฟเวอร์เท่านั้น) */
export function findPage(id) {
  const p = loadPages().find(x => x.id === id || x.name === id);
  if (!p) throw new Error(`ไม่พบเพจ "${id}" — รัน sync ก่อน`);
  return p;
}

/** เวอร์ชันที่ตัด token ออก ปลอดภัยที่จะส่งให้หน้าเว็บ */
export const publicPage = p => ({ id: p.id, name: p.name, category: p.category, tasks: p.tasks || [] });

export const PAGE_FIELDS = [
  'id', 'name', 'username', 'link', 'category', 'category_list', 'about', 'description',
  'founded', 'price_range', 'phone', 'website', 'emails', 'single_line_address', 'location',
  'hours', 'cover', 'picture{url,is_silhouette}', 'is_published', 'fan_count',
].join(',');

export const CHECKS = [
  ['username', 'ชื่อผู้ใช้ @username', 'ตั้งได้ที่การตั้งค่าเพจเท่านั้น'],
  ['category', 'หมวดหมู่ธุรกิจ', 'เปลี่ยนที่การตั้งค่าเพจ'],
  ['about', 'About (ข้อความสั้นใต้ชื่อเพจ)'],
  ['description', 'รายละเอียดเพจ'],
  ['phone', 'เบอร์โทร'],
  ['website', 'เว็บไซต์'],
  ['emails', 'อีเมลติดต่อ'],
  ['single_line_address', 'ที่อยู่'],
  ['hours', 'เวลาทำการ'],
  ['cover', 'รูปปก', 'อัปโหลดผ่าน /{page-id}/photos'],
  ['picture', 'รูปโปรไฟล์', 'อัปโหลดผ่าน /{page-id}/picture'],
];

export function isMissing(key, v) {
  if (key === 'picture') return !v?.data?.url || v.data.is_silhouette === true;
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

export function scoreOf(info) {
  const missing = CHECKS.filter(([k]) => isMissing(k, info[k]))
    .map(([key, label, hint]) => ({ key, label, hint: hint || null }));
  return { score: Math.round(((CHECKS.length - missing.length) / CHECKS.length) * 100), missing };
}

// ---------- โพสต์ ----------
export const POST_FIELDS = [
  'id', 'message', 'created_time', 'permalink_url', 'shares',
  'likes.summary(true).limit(0)', 'comments.summary(true).limit(0)',
].join(',');

const POST_EDGES = ['published_posts', 'feed', 'posts'];
const POST_FIELD_SETS = [
  POST_FIELDS,
  'id,message,created_time,permalink_url,shares',
  'id,message,created_time',
  'id,created_time',
];

/** Graph สลับ edge/ฟิลด์ที่ยอมให้อ่านไปมา — ไล่ลองจนกว่าจะได้ แล้วบอกว่าอ่านอะไรได้บ้าง */
export async function fetchPosts(p, sinceSec) {
  let lastErr;
  for (const edge of POST_EDGES) {
    for (const fields of POST_FIELD_SETS) {
      try {
        const out = [];
        let after;
        do {
          const j = await graph(`${p.id}/${edge}`, {
            token: p.access_token,
            params: { fields, limit: 100, ...(after && { after }) },
          });
          out.push(...(j.data || []));
          after = j.paging?.next ? j.paging.cursors?.after : undefined;
        } while (after);
        return {
          fields,
          can: {
            like: fields.includes('likes.summary'),
            comment: fields.includes('comments.summary'),
            share: fields.includes('shares'),
          },
          posts: out.filter(x => new Date(x.created_time).getTime() / 1000 >= sinceSec),
        };
      } catch (e) { lastErr = e; }
    }
  }
  return { fields: null, can: { like: false, comment: false, share: false }, posts: [], error: lastErr?.message };
}

/** สรุปผลรายเพจ — ตัวเลขที่อ่านไม่ได้จะเป็น null ไม่ใช่ 0 (ห้ามทำให้รายงานหลอกตา) */
export async function buildReport(p, days) {
  const info = await graph(p.id, { token: p.access_token, params: { fields: PAGE_FIELDS } });
  const sinceSec = Math.floor(Date.now() / 1000) - days * 86400;
  const { posts, can, error } = await fetchPosts(p, sinceSec);

  const rows = posts.map(x => ({
    id: x.id,
    message: (x.message || '').replace(/\s+/g, ' '),
    created_time: x.created_time,
    permalink_url: x.permalink_url || null,
    like: can.like ? (x.likes?.summary?.total_count || 0) : null,
    comment: can.comment ? (x.comments?.summary?.total_count || 0) : null,
    share: can.share ? (x.shares?.count || 0) : null,
  })).sort((a, b) => new Date(b.created_time) - new Date(a.created_time));

  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);

  // จำนวนโพสต์รายวันตลอดช่วง — ใช้วาดกราฟ
  const byDay = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDay[d] = { date: d, posts: 0, share: 0 };
  }
  for (const r of rows) {
    const d = new Date(r.created_time).toISOString().slice(0, 10);
    if (byDay[d]) { byDay[d].posts++; byDay[d].share += r.share || 0; }
  }

  const { score, missing } = scoreOf(info);
  return {
    page: { id: info.id, name: info.name, category: info.category || null, fan_count: info.fan_count || 0 },
    period_days: days,
    score, missing,
    metrics_available: can,
    posts_error: error || null,
    totals: {
      posts: rows.length,
      like: can.like ? sum('like') : null,
      comment: can.comment ? sum('comment') : null,
      share: can.share ? sum('share') : null,
      per_week: rows.length ? +(rows.length / days * 7).toFixed(1) : 0,
    },
    timeline: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    posts: rows,
  };
}
