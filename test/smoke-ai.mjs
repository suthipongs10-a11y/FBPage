const BASE = 'http://127.0.0.1:8787';
const TOKEN = (await (await fetch(BASE + '/')).text()).match(/APP_TOKEN = '([a-f0-9]+)'/)[1];
const api = async (path, body) => {
  const res = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'x-app-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};

// token-leak check ที่แม่นขึ้น: key ชื่อ access_token หรือสตริงตัวอักษร/ตัวเลขล้วนยาว ≥150 ที่ขึ้นต้น EAA
const leaks = obj => { const s = JSON.stringify(obj); return /"access_token"/.test(s) || /EAA[A-Za-z0-9]{150,}/.test(s); };
const pages = (await api('/api/pages')).data;
const info = (await api(`/api/pages/${pages[0].id}`)).data;
const rep = (await api(`/api/pages/${pages[0].id}/report?days=7`)).data;
const audit = (await api('/api/audit')).data;
console.log('token หลุด? pages:', leaks(pages), '· detail:', leaks(info), '· report:', leaks(rep), '· audit:', leaks(audit));

// traversal: ต้องไม่ได้เนื้อหา .env / pages.json
for (const p of ['/img/../../.env', '/../.env', '/img/%2e%2e/%2e%2e/pages.json', '/..%2f..%2fpages.json', '/pages.json', '/config.json', '/.env']) {
  const r = await fetch(BASE + p); const t = await r.text();
  console.log(`traversal ${p} → ${r.status} · เนื้อหาอันตราย? ${/USER_TOKEN=|"access_token"|apiKey/.test(t)} · index? ${t.includes('<title>FB Page Ops')}`);
}

// sync (ให้ tasks กลับมา)
const sync = await api('/api/sync', {});
console.log('sync →', sync.status, '· tasks ของเพจแรก:', sync.data.pages[0].tasks);

// ตั้งค่า AI ให้ชี้ไป mock แล้วทดสอบลูปเครื่องมือ
console.log('settings save →', (await api('/api/settings', { ai: { provider: 'compatible', apiKey: 'mock-key', model: 'mock', baseUrl: 'http://127.0.0.1:8790/v1' } })).status);
console.log('settings (masked) →', JSON.stringify((await api('/api/settings')).data.ai));
const chat = await api('/api/ai/chat', { messages: [{ role: 'user', content: 'ร่างโพสต์ให้เพจแรก' }] });
console.log('\nai chat →', chat.status);
console.log('steps:', chat.data.steps.map(s => `${s.type}:${s.name}`).join(' → '));
console.log('text:', chat.data.text);
console.log('drafts.posts:', chat.data.drafts.posts.length, '· drafts.cards:', chat.data.drafts.cards.length);
console.log('draft:', JSON.stringify({ ...chat.data.drafts.posts[0] }).slice(0, 200));
console.log('usage:', JSON.stringify(chat.data.usage));
