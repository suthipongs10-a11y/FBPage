// ทดสอบแดชบอร์ดแบบ end-to-end ผ่าน HTTP (ไม่ใช้ curl)
const BASE = 'http://127.0.0.1:8787';
const html = await (await fetch(BASE + '/')).text();
const TOKEN = html.match(/APP_TOKEN = '([a-f0-9]+)'/)?.[1];
console.log('app token length:', TOKEN?.length);

const api = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-app-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const show = (label, r, max = 300) => console.log(`\n=== ${label} → HTTP ${r.status}\n` + JSON.stringify(r.data).slice(0, max));

// 1) auth
const noTok = await fetch(BASE + '/api/status'); console.log('\n=== ไม่มี token → HTTP', noTok.status, '(ต้อง 401)');
show('status', await api('/api/status'));

// 2) pages — ต้องไม่มี access_token หลุดออกมา
const pages = await api('/api/pages');
console.log('\n=== pages:', pages.data.length, 'เพจ · มี access_token หลุดไหม:', JSON.stringify(pages.data).includes('access_token'));

// 3) audit
const audit = await api('/api/audit');
console.log('\n=== audit:', audit.data.map(a => `${a.name} ${a.score}%`).join(' | '));

// 4) page detail + report
const pid = pages.data.find(p => p.name.includes('Phuket'))?.id || pages.data[0].id;
const info = await api(`/api/pages/${pid}`);
console.log('\n=== page detail: ', info.data.name, '· about:', (info.data.about || '').slice(0, 40), '· มี token หลุดไหม:', JSON.stringify(info.data).includes('EAA'));
const rep = await api(`/api/pages/${pid}/report?days=30`);
console.log('=== report: posts', rep.data.totals.posts, '· share', rep.data.totals.share, '· like', rep.data.totals.like, '· timeline', rep.data.timeline.length, 'วัน');

// 5) post dry run
show('post dry', await api(`/api/pages/${pid}/post`, { message: 'ทดสอบจากแดชบอร์ด', dry: true }));
show('post validation (เวลาย้อนหลัง)', await api(`/api/pages/${pid}/post`, { message: 'x', scheduled_publish_time: '2020-01-01T00:00:00Z', dry: true }));

// 6) apply dry run + emoji guard
show('apply dry', await api(`/api/pages/${pid}/apply`, { about: 'ทดสอบ', dry: true }));
show('apply emoji guard', await api(`/api/pages/${pid}/apply`, { description: 'มี emoji 🎉', dry: true }));

// 7) card
const card = await api('/api/card', { template: 'quote', theme: 'phuketmaids', data: { kicker: 'ทดสอบ', quote: 'สร้างจาก *แดชบอร์ด*', sub: 'ผ่าน API', brand: 'Test' } });
console.log('\n=== card → HTTP', card.status, '· path:', card.data.path, '· dataUrl:', card.data.dataUrl?.slice(0, 30));
const img = await fetch(BASE + '/img/' + card.data.path.split('/').pop()); console.log('=== /img/ serve → HTTP', img.status, img.headers.get('content-type'));

// 8) settings (mask) + ads/ai ยังไม่ตั้งค่า → ต้อง error ที่อ่านรู้เรื่อง
show('settings', await api('/api/settings'));
show('ads ยังไม่ตั้ง', await api('/api/ads/accounts'));
show('ai ยังไม่ตั้ง', await api('/api/ai/chat', { messages: [{ role: 'user', content: 'สวัสดี' }] }));

// 9) path traversal
const trav = await fetch(BASE + '/img/../../.env'); console.log('\n=== traversal /img/../../.env → HTTP', trav.status, '(ต้อง 404)');
const trav2 = await fetch(BASE + '/../.env'); console.log('=== traversal /../.env → HTTP', trav2.status, '· คืน index?', (await trav2.text()).includes('<title>FB Page Ops'));
