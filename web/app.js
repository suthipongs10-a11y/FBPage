/* FB Page Ops — front-end (vanilla JS, ไม่มี framework) */
'use strict';

// ---------- API ----------
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'x-app-token': window.APP_TOKEN, ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
const get = p => api(p);
const post = (p, body) => api(p, { method: 'POST', body });

// ---------- utils ----------
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const nf = n => (n == null ? '—' : Number(n).toLocaleString('th-TH'));
const money = n => (n == null ? '—' : '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dateTH = s => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const toast = (m, ms = 2600) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms); };
const busy = (btn, on) => { btn.disabled = on; btn._label ??= btn.textContent; btn.innerHTML = on ? '<span class="spin"></span> กำลังทำงาน…' : btn._label; };
const err = e => el('div', { class: 'alert bad' }, '✖ ' + e.message);
const pill = (txt, kind = '') => el('span', { class: `pill ${kind}` }, txt);
const scoreKind = s => (s >= 80 ? 'good' : s >= 50 ? 'warn' : 'bad');

// ---------- SVG charts (ไม่มี dependency) ----------
function lineChart(series, { height = 180, fmt = nf, colors = ['#38bdf8', '#f59e0b', '#4ade80'] } = {}) {
  // series: [{ name, points:[{x:'2026-09-01', y:12}] }]
  const W = 720, H = height, L = 44, R = 12, T = 14, B = 28;
  const xs = series[0]?.points.map(p => p.x) || [];
  const all = series.flatMap(s => s.points.map(p => p.y || 0));
  const max = Math.max(1, ...all);
  const sx = i => L + (xs.length > 1 ? i / (xs.length - 1) : 0.5) * (W - L - R);
  const sy = v => T + (1 - v / max) * (H - T - B);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart');
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, y = sy(v);
    g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke-dasharray="2 4"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${fmt(Math.round(v))}</text>`;
  }
  const step = Math.max(1, Math.ceil(xs.length / 8));
  xs.forEach((x, i) => { if (i % step === 0 || i === xs.length - 1) g += `<text x="${sx(i)}" y="${H - 8}" text-anchor="middle">${dateTH(x)}</text>`; });
  series.forEach((s, si) => {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.y || 0).toFixed(1)}`).join(' ');
    g += `<path d="${d}" fill="none" stroke="${colors[si % colors.length]}" stroke-width="2.2" stroke-linejoin="round"/>`;
    s.points.forEach((p, i) => { if (p.y) g += `<circle cx="${sx(i)}" cy="${sy(p.y)}" r="3" fill="${colors[si % colors.length]}"><title>${p.x}: ${fmt(p.y)}</title></circle>`; });
  });
  svg.innerHTML = g;
  const legend = el('div', { class: 'row small muted' }, ...series.map((s, i) => el('span', {}, el('span', { style: `display:inline-block;width:10px;height:10px;border-radius:2px;background:${colors[i % colors.length]};margin-right:6px` }), s.name)));
  return el('div', {}, svg, legend);
}
function barChart(items, { height = 200, fmt = nf, color = '#38bdf8' } = {}) {
  // items: [{ label, value, sub? }]
  const W = 720, H = height, L = 8, R = 8, T = 24, B = 50;
  const max = Math.max(1, ...items.map(i => i.value || 0));
  const bw = (W - L - R) / Math.max(1, items.length);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart');
  let g = '';
  items.forEach((it, i) => {
    const h = ((it.value || 0) / max) * (H - T - B), x = L + i * bw + bw * 0.15, y = H - B - h;
    g += `<rect x="${x}" y="${y}" width="${bw * 0.7}" height="${h}" rx="4" fill="${it.color || color}"><title>${it.label}: ${fmt(it.value)}</title></rect>`;
    g += `<text x="${x + bw * 0.35}" y="${y - 4}" text-anchor="middle">${fmt(it.value)}</text>`;
    const lab = it.label.length > 14 ? it.label.slice(0, 13) + '…' : it.label;
    g += `<text x="${x + bw * 0.35}" y="${H - B + 16}" text-anchor="middle">${lab}</text>`;
    if (it.sub) g += `<text x="${x + bw * 0.35}" y="${H - B + 30}" text-anchor="middle" opacity=".7">${it.sub}</text>`;
  });
  svg.innerHTML = g; return svg;
}

// ---------- state / router ----------
const state = { pages: [], status: null, view: 'home', pageId: null, chat: [] };
const view = $('#view');
const render = (node) => { view.replaceChildren(node); window.scrollTo(0, 0); };
async function go(name, arg) {
  state.view = name;
  document.querySelectorAll('#nav nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  render(el('p', { class: 'muted' }, el('span', { class: 'spin' }), ' กำลังโหลด…'));
  try { await VIEWS[name](arg); } catch (e) { render(err(e)); }
}
document.querySelectorAll('#nav nav button').forEach(b => b.onclick = () => go(b.dataset.view));

async function refreshStatus() {
  try {
    const s = await get('/api/status'); state.status = s;
    $('#status').innerHTML =
      `Token: <b>${s.user_token ? (s.me?.error ? '⚠ ใช้ไม่ได้' : '✔ ' + (s.me?.name || '')) : '✖ ไม่พบ'}</b><br>` +
      `เพจ: <b>${s.pages}</b> · AI: <b>${s.ai.configured ? s.ai.provider : '✖'}</b><br>` +
      `โฆษณา: <b>${s.ads.configured ? '✔' : '✖'}</b> · รูป: <b>${s.chrome ? '✔' : '✖ ไม่มี Chromium'}</b>`;
  } catch (e) { $('#status').textContent = '✖ ' + e.message; }
}

// ---------- VIEWS ----------
const VIEWS = {};

VIEWS.home = async () => {
  const audit = await get('/api/audit');
  state.pages = audit;
  const ok = audit.filter(a => !a.error);
  const avg = ok.length ? Math.round(ok.reduce((t, a) => t + a.score, 0) / ok.length) : 0;
  const fans = ok.reduce((t, a) => t + (a.fan_count || 0), 0);
  const wrap = el('div', {},
    el('h1', {}, 'ภาพรวม'),
    el('p', { class: 'sub' }, `ดูแลอยู่ ${audit.length} เพจ · ข้อมูลสดจาก Graph API`),
    el('div', { class: 'grid' },
      kpi(nf(audit.length), 'เพจทั้งหมด'),
      kpi(avg + '%', 'ข้อมูลครบเฉลี่ย', scoreKind(avg)),
      kpi(nf(fans), 'ผู้ติดตามรวม'),
      kpi(nf(ok.filter(a => a.score < 50).length), 'เพจที่ต้องเร่งแก้', 'bad'),
    ),
    el('h2', {}, 'ความสมบูรณ์ของข้อมูลแต่ละเพจ'),
    el('div', { class: 'card' }, barChart(ok.map(a => ({ label: a.name, value: a.score, sub: a.score + '%', color: a.score >= 80 ? '#4ade80' : a.score >= 50 ? '#f59e0b' : '#f87171' })), { fmt: v => v + '%' })),
    el('h2', {}, 'รายการที่ยังขาด'),
    el('div', { class: 'grid' }, ...audit.map(a => el('div', { class: 'card' },
      el('div', { class: 'row spread' }, el('h3', {}, a.name), a.error ? pill('อ่านไม่ได้', 'bad') : pill(a.score + '%', scoreKind(a.score))),
      a.error ? el('p', { class: 'small muted' }, a.error) : el('div', {},
        el('div', { class: 'bar' }, el('i', { style: `width:${a.score}%` })),
        el('ul', { class: 'list small' }, ...(a.missing.length ? a.missing.map(m => el('li', {}, '✖ ' + m.label, m.hint ? el('span', { class: 'muted' }, ' — ' + m.hint) : null)) : [el('li', { class: 'muted' }, '✔ ครบทุกรายการ')])),
        el('div', { class: 'row', style: 'margin-top:10px' },
          el('button', { class: 'btn sm', onclick: () => go('pages', a.id) }, 'ดูรายละเอียด'),
          el('button', { class: 'btn sm ghost', onclick: () => go('post', a.id) }, 'โพสต์'))),
    ))),
  );
  render(wrap);
};
const kpi = (v, l, kind) => el('div', { class: 'card kpi' }, el('div', { class: 'v', style: kind === 'bad' ? 'color:var(--bad)' : kind === 'warn' ? 'color:var(--warn)' : kind === 'good' ? 'color:var(--good)' : '' }, v), el('div', { class: 'l' }, l));
const na = (v, fmt = nf) => (v == null ? el('span', { class: 'na' }, 'อ่านไม่ได้') : fmt(v));

VIEWS.pages = async (pageId) => {
  if (!state.pages.length) state.pages = await get('/api/pages');
  const id = pageId || state.pageId || state.pages[0]?.id;
  if (!id) return render(el('div', {}, el('h1', {}, 'เพจ'), el('div', { class: 'alert' }, 'ยังไม่มีเพจ — ไปที่ตั้งค่า → Sync เพจ')));
  state.pageId = id;
  const days = state.days || 30;
  const [info, rep] = await Promise.all([get(`/api/pages/${id}`), get(`/api/pages/${id}/report?days=${days}`)]);
  const sel = el('select', { onchange: e => go('pages', e.target.value) }, ...state.pages.map(p => el('option', { value: p.id, selected: p.id === id ? '' : null }, p.name)));
  const daysSel = el('select', { onchange: e => { state.days = Number(e.target.value); go('pages', id); } }, ...[7, 14, 30, 60, 90].map(d => el('option', { value: d, selected: d === days ? '' : null }, `${d} วัน`)));
  const m = rep.metrics_available;
  const wrap = el('div', {},
    el('div', { class: 'row spread' }, el('h1', {}, info.name), el('div', { class: 'row' }, sel, daysSel)),
    el('p', { class: 'sub' }, `${info.category || ''} · ${info.link || ''} · สิทธิ์: ${(info.tasks || []).join(', ') || '—'}`),
    el('div', { class: 'grid' },
      kpi(rep.score + '%', 'ข้อมูลครบ', scoreKind(rep.score)),
      kpi(nf(rep.page.fan_count), 'ผู้ติดตาม'),
      kpi(nf(rep.totals.posts), `โพสต์ใน ${days} วัน`),
      kpi(rep.totals.per_week, 'โพสต์/สัปดาห์'),
      el('div', { class: 'card kpi' }, el('div', { class: 'v' }, na(rep.totals.share)), el('div', { class: 'l' }, 'แชร์รวม')),
      el('div', { class: 'card kpi' }, el('div', { class: 'v' }, na(rep.totals.like)), el('div', { class: 'l' }, 'ถูกใจรวม')),
    ),
    (!m.like || !m.comment) ? el('div', { class: 'alert' }, '⚠ ยอดถูกใจ/ความคิดเห็นรายโพสต์อ่านไม่ได้ด้วยสิทธิ์ปัจจุบัน (ต้องยื่น App Review ขอ pages_read_engagement) — แสดงเป็น "อ่านไม่ได้" ไม่ใช่ 0') : null,
    rep.posts_error ? el('div', { class: 'alert bad' }, '✖ ดึงโพสต์ไม่ได้: ' + rep.posts_error) : null,
    el('h2', {}, 'ความถี่การโพสต์และยอดแชร์รายวัน'),
    el('div', { class: 'card' }, lineChart([
      { name: 'โพสต์', points: rep.timeline.map(t => ({ x: t.date, y: t.posts })) },
      { name: 'แชร์', points: rep.timeline.map(t => ({ x: t.date, y: t.share })) },
    ])),
    el('div', { class: 'two' },
      el('div', {},
        el('h2', {}, 'ข้อมูลเพจ'),
        el('div', { class: 'card small' },
          ...[['about', 'About'], ['description', 'รายละเอียด'], ['phone', 'เบอร์โทร'], ['website', 'เว็บไซต์'], ['emails', 'อีเมล'], ['single_line_address', 'ที่อยู่'], ['username', '@username'], ['price_range', 'ช่วงราคา']].map(([k, l]) =>
            el('div', { style: 'margin-bottom:8px' }, el('b', {}, l + ': '), el('span', { class: info[k] ? '' : 'muted' }, Array.isArray(info[k]) ? info[k].join(', ') : (info[k] || '— ว่าง')))),
          el('div', { style: 'margin-top:8px' }, el('b', {}, 'เวลาทำการ: '), el('span', { class: 'mono' }, info.hours ? Object.entries(info.hours).map(([k, v]) => `${k}=${v}`).join(' ') : '— ว่าง')),
        ),
        el('h2', {}, 'ยังขาด'),
        el('ul', { class: 'list small' }, ...(rep.missing.length ? rep.missing.map(x => el('li', {}, '✖ ' + x.label, x.hint ? el('span', { class: 'muted' }, ' — ' + x.hint) : null)) : [el('li', {}, '✔ ครบ')])),
        el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn', onclick: () => renderApply(info) }, 'แก้ไขข้อมูลเพจ'), el('button', { class: 'btn ghost', onclick: () => go('post', id) }, 'สร้างโพสต์')),
      ),
      el('div', {},
        el('h2', {}, `โพสต์ล่าสุด (${rep.posts.length})`),
        el('div', { class: 'card' }, rep.posts.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'วันที่'), el('th', {}, 'ข้อความ'), el('th', { class: 'num' }, 'แชร์'))),
          el('tbody', {}, ...rep.posts.slice(0, 20).map(p => el('tr', {}, el('td', { class: 'muted small' }, dateTH(p.created_time)), el('td', {}, p.permalink_url ? el('a', { href: p.permalink_url, target: '_blank' }, p.message.slice(0, 80) || '(ไม่มีข้อความ)') : (p.message.slice(0, 80) || '(ไม่มีข้อความ)')), el('td', { class: 'num' }, na(p.share))))))
          : el('p', { class: 'muted' }, 'ไม่มีโพสต์ในช่วงนี้')),
      ),
    ),
  );
  render(wrap);
};

function renderApply(info) {
  const f = {};
  const field = (k, label, type = 'input', hint) => { const n = el(type, { value: type === 'input' ? (Array.isArray(info[k]) ? info[k].join(', ') : (info[k] || '')) : undefined }); if (type === 'textarea') n.value = info[k] || ''; f[k] = n; return el('div', {}, el('label', {}, label, hint ? el('span', { class: 'muted' }, ' — ' + hint) : null), n); };
  const out = el('div', {});
  const wrap = el('div', { class: 'form' },
    el('h1', {}, 'แก้ไขข้อมูลเพจ: ' + info.name),
    el('p', { class: 'sub' }, 'ฟิลด์ที่ API รับ: about, description, phone, website, emails, hours, price_range, founded — ที่อยู่/หมวดหมู่/@username/รูป ต้องแก้ในหน้าเพจ'),
    field('about', 'About (≤255 ตัวอักษร)'),
    field('description', 'รายละเอียดเพจ (ห้ามใส่ emoji)', 'textarea'),
    el('div', { class: 'two' }, field('phone', 'เบอร์โทร', 'input', '+66812345678'), field('website', 'เว็บไซต์')),
    el('div', { class: 'two' }, field('emails', 'อีเมล (คั่นด้วย ,)'), field('price_range', 'ช่วงราคา', 'input', '$ / $$ / $$$ / $$$$')),
    field('hours', 'เวลาทำการ (JSON)', 'textarea', '{"mon_1_open":"09:00","mon_1_close":"18:00"}'),
    el('div', { class: 'row', style: 'margin-top:14px' },
      el('button', { class: 'btn ghost', onclick: e => run(e.target, true) }, 'ดูก่อน (dry run)'),
      el('button', { class: 'btn warn', onclick: e => { if (confirm('อัปเดตข้อมูลเพจจริง?')) run(e.target, false); } }, 'อัปเดตจริง'),
      el('button', { class: 'btn ghost', onclick: () => go('pages', info.id) }, 'ยกเลิก')),
    out);
  f.hours.value = info.hours ? JSON.stringify(info.hours) : '';
  async function run(btn, dry) {
    const body = { dry };
    for (const k of ['about', 'description', 'phone', 'website', 'price_range']) if (f[k].value.trim()) body[k] = f[k].value.trim();
    if (f.emails.value.trim()) body.emails = f.emails.value.split(',').map(s => s.trim()).filter(Boolean);
    if (f.hours.value.trim()) { try { body.hours = JSON.parse(f.hours.value); } catch { return out.replaceChildren(err(new Error('เวลาทำการไม่ใช่ JSON'))); } }
    busy(btn, true);
    try { const r = await post(`/api/pages/${info.id}/apply`, body); out.replaceChildren(el('div', { class: 'alert ' + (dry ? '' : 'good') }, dry ? 'จะอัปเดต: ' : '✔ อัปเดตแล้ว: ', el('pre', { class: 'mono' }, JSON.stringify(r.params, null, 2)))); if (!dry) toast('อัปเดตข้อมูลเพจแล้ว'); }
    catch (e) { out.replaceChildren(err(e)); } finally { busy(btn, false); }
  }
  render(wrap);
}

VIEWS.post = async (pageId) => {
  if (!state.pages.length) state.pages = await get('/api/pages');
  const id = pageId || state.pageId || state.pages[0]?.id;
  state.pageId = id;
  const photos = []; // { path | dataUrl, preview }
  const sel = el('select', { onchange: e => { state.pageId = e.target.value; } }, ...state.pages.map(p => el('option', { value: p.id, selected: p.id === id ? '' : null }, p.name)));
  const msg = el('textarea', { placeholder: 'ข้อความโพสต์ — ใส่ emoji ได้' });
  const link = el('input', { placeholder: 'https:// (ถ้ามีรูป Facebook จะไม่แสดงการ์ดลิงก์)' });
  const when = el('input', { type: 'datetime-local' });
  const gallery = el('div', { class: 'row' });
  const out = el('div', {});
  const drawGallery = () => gallery.replaceChildren(...photos.map((p, i) => el('div', { style: 'position:relative' }, el('img', { src: p.preview, class: 'preview', style: 'max-width:150px' }), el('button', { class: 'btn sm danger', style: 'position:absolute;top:4px;right:4px', onclick: () => { photos.splice(i, 1); drawGallery(); } }, '✕'))));
  const file = el('input', { type: 'file', accept: 'image/*', multiple: '', onchange: e => { for (const f of e.target.files) { const r = new FileReader(); r.onload = () => { photos.push({ dataUrl: r.result, preview: r.result }); drawGallery(); }; r.readAsDataURL(f); } e.target.value = ''; } });

  // card builder
  const tpl = el('select', {}, ...['quote', 'stat', 'tips'].map(t => el('option', { value: t }, t)));
  const theme = el('select', {}, ...['default', 'fadaeng', 'phuketmaids', 'rabiangboon', 'dark'].map(t => el('option', { value: t }, t)));
  const cardJson = el('textarea', { class: 'mono', style: 'min-height:120px' });
  const samples = {
    quote: { kicker: 'หัวข้อเล็ก', big: '5', bigUnit: 'วินาที', quote: 'ประโยคเด่น\nเน้นคำด้วย *ดอกจัน*', sub: 'บรรทัดรอง', brand: 'ชื่อเพจ' },
    stat: { kicker: 'หัวข้อเล็ก', title: 'หัวเรื่อง\n*เน้น*', lead: 'คำอธิบายสั้น', rows: [{ label: 'รายการ', note: 'หมายเหตุ', old: '7.3', new: '3.7', unit: 'หน่วย' }], footer: 'ที่มา', brand: 'ชื่อเพจ' },
    tips: { kicker: 'หัวข้อเล็ก', title: '5 วิธี\n*ได้ผลจริง*', items: [{ title: 'ข้อ 1', text: 'รายละเอียด' }, { title: 'ข้อ 2', text: 'รายละเอียด' }], footer: 'ที่มา', brand: 'ชื่อเพจ' },
  };
  cardJson.value = JSON.stringify(samples.quote, null, 2);
  tpl.onchange = () => { cardJson.value = JSON.stringify(samples[tpl.value], null, 2); };
  const makeCard = async btn => {
    let data; try { data = JSON.parse(cardJson.value); } catch { return toast('JSON ไม่ถูกต้อง'); }
    busy(btn, true);
    try { const r = await post('/api/card', { template: tpl.value, theme: theme.value, data }); photos.push({ path: r.path, preview: r.dataUrl }); drawGallery(); toast('สร้างภาพแล้ว'); }
    catch (e) { out.replaceChildren(err(e)); } finally { busy(btn, false); }
  };

  const submit = async (btn, dry) => {
    const body = { message: msg.value, link: link.value.trim() || undefined, photos: photos.map(p => p.path || p.dataUrl), dry };
    if (when.value) body.scheduled_publish_time = new Date(when.value).toISOString();
    busy(btn, true);
    try {
      const r = await post(`/api/pages/${state.pageId}/post`, body);
      if (dry) out.replaceChildren(el('div', { class: 'alert' }, el('b', {}, 'ตัวอย่าง (ยังไม่โพสต์)'), el('div', { class: 'small', style: 'margin-top:6px' }, `เพจ: ${r.page.name} · รูป: ${r.photos.length} ใบ · เวลา: ${r.schedule ? new Date(r.schedule * 1000).toLocaleString('th-TH') : 'ทันที'}`), el('pre', { style: 'white-space:pre-wrap;margin:8px 0 0' }, r.message || '')));
      else { out.replaceChildren(el('div', { class: 'alert good' }, r.scheduled ? '✔ ตั้งเวลาโพสต์แล้ว' : '✔ โพสต์แล้ว — ', el('a', { href: r.url, target: '_blank' }, r.url))); toast('โพสต์สำเร็จ'); }
    } catch (e) { out.replaceChildren(err(e)); } finally { busy(btn, false); }
  };

  render(el('div', {},
    el('h1', {}, 'สร้างโพสต์'),
    el('p', { class: 'sub' }, 'ทุกโพสต์ต้องผ่าน "ดูก่อน" แล้วกดยืนยัน — ระบบไม่โพสต์อัตโนมัติ'),
    el('div', { class: 'two' },
      el('div', { class: 'form' },
        el('label', {}, 'เพจ'), sel,
        el('label', {}, 'ข้อความ'), msg,
        el('label', {}, 'ลิงก์แนบ (ไม่บังคับ)'), link,
        el('label', {}, 'ตั้งเวลาโพสต์ (ไม่บังคับ · ล่วงหน้า 10 นาที–75 วัน)'), when,
        el('label', {}, 'รูปแนบ (สูงสุด 10 ใบ)'), file, gallery,
        el('div', { class: 'row', style: 'margin-top:16px' },
          el('button', { class: 'btn ghost', onclick: e => submit(e.target, true) }, 'ดูก่อน (dry run)'),
          el('button', { class: 'btn warn', onclick: e => { if (confirm('โพสต์ลงเพจจริง?')) submit(e.target, false); } }, 'โพสต์จริง')),
        out),
      el('div', { class: 'card' },
        el('h3', {}, '🎨 สร้างภาพจากเทมเพลต'),
        el('p', { class: 'small muted' }, 'ภาพต้นฉบับ 1080×1080 ไม่ติดลิขสิทธิ์ · ใช้ \\n ขึ้นบรรทัด และ *คำ* เพื่อเน้นสี'),
        el('div', { class: 'two' }, el('div', {}, el('label', {}, 'เทมเพลต'), tpl), el('div', {}, el('label', {}, 'ธีม'), theme)),
        el('label', {}, 'ข้อมูล (JSON)'), cardJson,
        el('button', { class: 'btn', style: 'margin-top:10px', onclick: e => makeCard(e.target) }, 'สร้างภาพ → แนบโพสต์')),
    )));
};

VIEWS.ads = async () => {
  const s = state.status || await get('/api/status');
  if (!s.ads.configured) return render(el('div', {}, el('h1', {}, 'โฆษณา'), el('div', { class: 'alert' }, 'ยังไม่ได้ตั้งค่า token โฆษณา (ต้องมีสิทธิ์ ads_read) — ไปที่ ⚙️ ตั้งค่า')));
  const preset = state.preset || 'last_30d';
  let accounts = [];
  try { accounts = await get('/api/ads/accounts'); } catch (e) { return render(el('div', {}, el('h1', {}, 'โฆษณา'), err(e))); }
  const acc = state.account || s.ads.accountId || accounts[0]?.id;
  const accSel = el('select', { onchange: e => { state.account = e.target.value; go('ads'); } }, ...accounts.map(a => el('option', { value: a.id, selected: a.id === acc ? '' : null }, `${a.name} (${a.currency}) — ${a.status}`)));
  const preSel = el('select', { onchange: e => { state.preset = e.target.value; go('ads'); } }, ...[['today', 'วันนี้'], ['yesterday', 'เมื่อวาน'], ['last_7d', '7 วัน'], ['last_14d', '14 วัน'], ['last_30d', '30 วัน'], ['this_month', 'เดือนนี้'], ['last_month', 'เดือนก่อน'], ['maximum', 'ทั้งหมด']].map(([v, l]) => el('option', { value: v, selected: v === preset ? '' : null }, l)));
  const cur = accounts.find(a => a.id === acc);
  const [rep, daily] = await Promise.all([get(`/api/ads/report?account=${acc}&preset=${preset}`), get(`/api/ads/daily?account=${acc}&days=30`)]);
  const pageName = pid => state.pages.find(p => p.id === pid)?.name || (pid ? pid : '—');
  const RT = { 'onsite_conversion.messaging_conversation_started_7d': 'ข้อความ', lead: 'ลีด', purchase: 'ซื้อ', link_click: 'คลิกลิงก์', post_engagement: 'มีส่วนร่วม', page_engagement: 'มีส่วนร่วม' };
  render(el('div', {},
    el('div', { class: 'row spread' }, el('h1', {}, 'โฆษณา'), el('div', { class: 'row' }, accSel, preSel)),
    cur?.status && cur.status !== 'ACTIVE' ? el('div', { class: 'alert bad' }, `⚠ สถานะบัญชี: ${cur.status}${cur.status === 'IN_GRACE_PERIOD' ? ' — เก็บเงินไม่ผ่าน ต้องแก้วิธีชำระเงินไม่งั้นโฆษณาจะหยุด' : ''}`) : null,
    el('div', { class: 'grid' },
      kpi(money(rep.total.spend), 'ใช้จ่ายรวม'),
      kpi(nf(rep.total.results), 'ผลลัพธ์รวม'),
      kpi(rep.total.results ? money(rep.total.spend / rep.total.results) : '—', 'ต้นทุน/ผลลัพธ์เฉลี่ย'),
      kpi(nf(rep.total.impressions), 'การมองเห็นรวม'),
      kpi(nf(rep.campaigns.filter(c => c.status === 'ACTIVE').length), 'แคมเปญที่ยิงอยู่', 'good'),
    ),
    el('h2', {}, 'ค่าใช้จ่ายและข้อความรายวัน (30 วัน)'),
    el('div', { class: 'card' }, lineChart([
      { name: 'ค่าใช้จ่าย (฿)', points: daily.map(d => ({ x: d.date, y: d.spend })) },
      { name: 'ข้อความ', points: daily.map(d => ({ x: d.date, y: d.messages })) },
    ], { fmt: v => nf(Math.round(v)) })),
    el('h2', {}, 'ต้นทุนต่อผลลัพธ์รายแคมเปญ'),
    el('div', { class: 'card' }, barChart(rep.campaigns.filter(c => c.cost_per_result != null).map(c => ({ label: c.name.replace(/^โพสต์: "?/, '').slice(0, 20), value: +c.cost_per_result.toFixed(2), sub: pageName(c.page_id), color: c.status === 'ACTIVE' ? '#38bdf8' : '#64748b' })), { fmt: v => '฿' + v })),
    el('h2', {}, 'แคมเปญ'),
    el('div', { class: 'card', style: 'overflow-x:auto' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'แคมเปญ'), el('th', {}, 'เพจ'), el('th', {}, 'สถานะ'), el('th', { class: 'num' }, 'งบ/วัน'), el('th', { class: 'num' }, 'ใช้จ่าย'), el('th', { class: 'num' }, 'ผลลัพธ์'), el('th', { class: 'num' }, 'ต้นทุน/ผล'), el('th', { class: 'num' }, 'CPM'), el('th', { class: 'num' }, 'CTR'))),
      el('tbody', {}, ...rep.campaigns.map(c => el('tr', {},
        el('td', {}, c.name.slice(0, 60)), el('td', { class: 'small muted' }, pageName(c.page_id)),
        el('td', {}, pill(c.status || '—', c.status === 'ACTIVE' ? 'good' : c.status === 'PAUSED' ? 'warn' : '')),
        el('td', { class: 'num' }, c.daily_budget != null ? money(c.daily_budget) : '—'),
        el('td', { class: 'num' }, money(c.spend)),
        el('td', { class: 'num' }, c.results != null ? `${nf(c.results)} ${RT[c.result_type] || ''}` : '—'),
        el('td', { class: 'num' }, c.cost_per_result != null ? money(c.cost_per_result) : '—'),
        el('td', { class: 'num' }, c.cpm != null ? money(c.cpm) : '—'),
        el('td', { class: 'num' }, c.ctr != null ? c.ctr.toFixed(2) + '%' : '—')))))),
  ));
};

VIEWS.ai = async () => {
  if (!state.pages.length) state.pages = await get('/api/pages');
  const s = state.status || await get('/api/status');
  const msgs = el('div', { class: 'msgs' });
  const input = el('textarea', { placeholder: s.ai.configured ? 'เช่น "สรุปสถานะทุกเพจ" / "ร่างโพสต์ให้เพจ ฝาแดง เรื่องลดน้ำตาล พร้อมทำภาพ" / "แคมเปญไหนต้นทุนแพงสุด"' : 'ยังไม่ได้ตั้งค่า AI — ไปที่ ⚙️ ตั้งค่า' });
  const pageSel = el('select', {}, el('option', { value: '' }, 'ทุกเพจ'), ...state.pages.map(p => el('option', { value: p.id }, p.name)));
  const add = (cls, text) => { const m = el('div', { class: `msg ${cls}` }, text); msgs.append(m); msgs.scrollTop = msgs.scrollHeight; return m; };
  for (const m of state.chat) add(m.role === 'user' ? 'user' : 'ai', m.content);
  const send = async () => {
    const q = input.value.trim(); if (!q) return; input.value = '';
    state.chat.push({ role: 'user', content: q }); add('user', q);
    const thinking = add('tool', '⏳ กำลังคิด…');
    try {
      const r = await post('/api/ai/chat', { messages: state.chat, page_id: pageSel.value || undefined });
      thinking.remove();
      for (const st of r.steps) if (st.type === 'tool') add('tool', `🔧 ${st.name}(${JSON.stringify(st.args).slice(0, 120)})`);
      state.chat.push({ role: 'assistant', content: r.text }); add('ai', r.text);
      for (const c of r.drafts.cards) msgs.append(el('img', { src: '/img/' + c.path.split('/').pop(), class: 'preview' }));
      for (const d of r.drafts.posts) msgs.append(draftBox(d));
      if (r.usage) add('tool', `tokens: ${nf(r.usage.input)} in / ${nf(r.usage.output)} out · ${r.model || ''}`);
      msgs.scrollTop = msgs.scrollHeight;
    } catch (e) { thinking.remove(); add('ai', '✖ ' + e.message); }
  };
  const draftBox = d => {
    const out = el('div', {});
    const box = el('div', { class: 'draft' },
      el('b', {}, `📝 โพสต์ที่เตรียมไว้ → ${d.page.name}`), d.scheduled_publish_time ? el('span', { class: 'muted small' }, ` · ตั้งเวลา ${new Date(d.scheduled_publish_time).toLocaleString('th-TH')}`) : null,
      el('pre', { style: 'white-space:pre-wrap;margin:8px 0' }, d.message),
      d.photos.length ? el('div', { class: 'row' }, ...d.photos.map(p => el('img', { src: '/img/' + p.split('/').pop(), class: 'preview', style: 'max-width:140px' }))) : null,
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'btn warn sm', onclick: async e => { if (!confirm(`โพสต์ลงเพจ ${d.page.name} จริง?`)) return; busy(e.target, true); try { const r = await post(`/api/pages/${d.page.id}/post`, { message: d.message, photos: d.photos, scheduled_publish_time: d.scheduled_publish_time || undefined }); out.replaceChildren(el('div', { class: 'alert good' }, '✔ โพสต์แล้ว ', el('a', { href: r.url, target: '_blank' }, r.url))); } catch (er) { out.replaceChildren(err(er)); } finally { busy(e.target, false); } } }, 'ยืนยันโพสต์'),
        el('button', { class: 'btn ghost sm', onclick: () => { state.pageId = d.page.id; go('post', d.page.id).then(() => { const t = view.querySelector('textarea'); if (t) t.value = d.message; }); } }, 'แก้ไขก่อน')),
      out);
    return box;
  };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  render(el('div', {},
    el('div', { class: 'row spread' }, el('h1', {}, 'ผู้ช่วย AI'), el('div', { class: 'row' }, el('span', { class: 'small muted' }, s.ai.configured ? `${s.ai.provider} · ${s.ai.model || 'default'}` : ''), pageSel, el('button', { class: 'btn ghost sm', onclick: () => { state.chat = []; go('ai'); } }, 'ล้างแชท'))),
    el('p', { class: 'sub' }, 'AI อ่านข้อมูลจริงผ่านเครื่องมือ · เตรียมโพสต์ได้ แต่โพสต์จริงต้องกดยืนยันเสมอ'),
    el('div', { class: 'chat' }, msgs, el('div', { class: 'composer' }, input, el('button', { class: 'btn', onclick: send, disabled: s.ai.configured ? null : '' }, 'ส่ง'))),
  ));
};

VIEWS.settings = async () => {
  const st = await get('/api/settings');
  const prov = el('select', {}, ...st.providers.map(p => el('option', { value: p.id, selected: p.id === st.ai.provider ? '' : null }, p.label)));
  const key = el('input', { type: 'password', value: st.ai.apiKey, placeholder: 'sk-… (เก็บฝั่งเซิร์ฟเวอร์เท่านั้น)' });
  const model = el('input', { value: st.ai.model, placeholder: 'เว้นว่าง = ค่าเริ่มต้นของผู้ให้บริการ' });
  const base = el('input', { value: st.ai.baseUrl, placeholder: 'สำหรับ compatible เช่น https://api.groq.com/openai/v1' });
  const adsTok = el('input', { type: 'password', value: st.ads.token, placeholder: 'token ที่มีสิทธิ์ ads_read' });
  const adsAcc = el('input', { value: st.ads.accountId, placeholder: 'เลขบัญชีโฆษณา (ไม่ต้องมี act_)' });
  const out = el('div', {});
  const defModel = () => { const p = st.providers.find(x => x.id === prov.value); model.placeholder = p?.defaultModel ? `ค่าเริ่มต้น: ${p.defaultModel}` : 'ต้องระบุชื่อโมเดล'; };
  prov.onchange = defModel; defModel();
  const save = async btn => { busy(btn, true); try { await post('/api/settings', { ai: { provider: prov.value, apiKey: key.value, model: model.value.trim(), baseUrl: base.value.trim() }, ads: { token: adsTok.value, accountId: adsAcc.value.trim() } }); toast('บันทึกแล้ว'); refreshStatus(); } catch (e) { out.replaceChildren(err(e)); } finally { busy(btn, false); } };
  const test = async btn => { busy(btn, true); try { await save(btn); const r = await post('/api/settings/test-ai'); out.replaceChildren(el('div', { class: 'alert good' }, `✔ AI ตอบกลับ (${r.model}): ${r.text}`)); } catch (e) { out.replaceChildren(err(e)); } finally { busy(btn, false); } };
  const sync = async btn => { busy(btn, true); try { const r = await post('/api/sync'); state.pages = []; toast(`Sync แล้ว ${r.pages.length} เพจ`); refreshStatus(); } catch (e) { out.replaceChildren(err(e)); } finally { busy(btn, false); } };
  render(el('div', { class: 'form' },
    el('h1', {}, 'ตั้งค่า'),
    el('p', { class: 'sub' }, 'คีย์ทั้งหมดถูกเก็บใน config.json ฝั่งเซิร์ฟเวอร์ (อยู่ใน .gitignore) ไม่เคยส่งมาหน้าเว็บ'),
    el('div', { class: 'card' }, el('h3', {}, '🤖 AI (สมองของระบบ)'),
      el('label', {}, 'ผู้ให้บริการ'), prov, el('label', {}, 'API key'), key, el('label', {}, 'โมเดล'), model, el('label', {}, 'Base URL'), base,
      el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn', onclick: e => save(e.target) }, 'บันทึก'), el('button', { class: 'btn ghost', onclick: e => test(e.target) }, 'บันทึก + ทดสอบ'))),
    el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', {}, '💰 โฆษณา (Marketing API)'),
      el('p', { class: 'small muted' }, 'token เพจปกติไม่มีสิทธิ์ ads_read — สร้าง token แยกจาก Graph API Explorer โดยติ๊ก ads_read'),
      el('label', {}, 'Access token'), adsTok, el('label', {}, 'บัญชีโฆษณา'), adsAcc,
      el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn', onclick: e => save(e.target) }, 'บันทึก'))),
    el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', {}, '📄 เพจ'),
      el('p', { class: 'small muted' }, 'Page token อ่านจาก USER_TOKEN / FB_USER_TOKEN ในสภาพแวดล้อมหรือไฟล์ .env ของเซิร์ฟเวอร์ — ไม่ใส่ในหน้านี้เพื่อความปลอดภัย'),
      el('button', { class: 'btn', onclick: e => sync(e.target) }, 'Sync เพจจาก Facebook')),
    out));
};

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refreshStatus().then(() => go('home'));
