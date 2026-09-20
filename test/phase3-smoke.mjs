// Phase 3–4 smoke — เชื่อมเพจจริงแบบอ่านอย่างเดียว ผ่าน Next proxy (/api/*)
// ต้องเปิด API (:4000) + web (:3000) + Postgres + Redis ก่อน และมี USER_TOKEN / FB_USER_TOKEN ใน env
// ไม่โพสต์ ไม่แก้อะไรบนเพจจริง — ตอนจบจะตัดการเชื่อมต่อ + ยกเลิกบัญชีเพื่อไม่ทิ้ง token ไว้ในฐานข้อมูล dev
// รัน:  node test/phase3-smoke.mjs        (ไม่พิมพ์ token ออกทางหน้าจอในทุกกรณี)
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3000';
const TOKEN = process.env.USER_TOKEN || process.env.FB_USER_TOKEN || '';
let fail = 0; let cookie = '';
const check = (label, ok, detail = '') => { console.log(`${ok ? '✔' : '✖'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail++; };
const redact = (s) => String(s).replaceAll(TOKEN, '[TOKEN]');
const api = async (method, path, body) => {
  const res = await fetch(`${WEB}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
};
if (!TOKEN) { console.log('✖ ไม่พบ USER_TOKEN/FB_USER_TOKEN ใน env — ข้าม smoke นี้'); process.exit(2); }

const stamp = Date.now();
const reg = await api('POST', '/auth/register', { email: `smoke3-${stamp}@test.local`, name: 'Smoke3', password: 'smoke-password-123', workspaceName: 'Smoke3 Agency' });
check('register → 201', reg.status === 201, redact(JSON.stringify(reg.json)).slice(0, 80));
const ws = reg.json?.workspace?.id;
const c = await api('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้าทดสอบ' });
const b = await api('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'แบรนด์ทดสอบ' });
check('client + brand created', c.status === 201 && b.status === 201);

// เว็บเรนเดอร์หน้า Pages ได้
for (const p of ['/pages']) { const r = await fetch(`${WEB}${p}`); check(`web ${p} → 200`, r.status === 200); }

// เชื่อมด้วย token จริง (อ่านอย่างเดียว)
const conn = await api('POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: TOKEN });
check('connect with real user token → 201', conn.status === 201, redact(JSON.stringify(conn.json?.connection ?? conn.json)).slice(0, 160));
check('response never contains the token or any access_token', !conn.text.includes(TOKEN) && !/access_?token/i.test(conn.text));
const connId = conn.json?.connection?.id;
const pages = conn.json?.pages ?? [];
check('sees ≥1 page with tasks', pages.length >= 1 && Array.isArray(pages[0]?.tasks), `${pages.length} pages: ${pages.map(p => p.name).join(', ')}`);

const target = pages.find(p => p.tasks.includes('CREATE_CONTENT')) ?? pages[0];
const pg = await api('POST', `/workspaces/${ws}/brands/${b.json.id}/pages/connect`, { connectionId: connId, facebookPageId: target.id });
check(`connect page "${target.name}" → 201 + initial sync ok`, pg.status === 201 && pg.json?.initialSync?.ok === true, redact(JSON.stringify(pg.json?.initialSync)));
check('page token not in response', !/PAGE_|pageAccessTokenEncrypted|access_token/i.test(pg.text));
const pageId = pg.json?.id;
check('completeness score computed', typeof pg.json?.completeness?.score === 'number', `score=${pg.json?.completeness?.score}% missing=${pg.json?.completeness?.missing?.map(m => m.key).join(',')}`);
check('tokenStatus VALID', pg.json?.tokenStatus === 'VALID');

const posts = await api('GET', `/workspaces/${ws}/pages/${pageId}/posts?limit=5`);
check('posts listed', posts.status === 200 && Array.isArray(posts.json), `${posts.json?.length} posts`);
if (posts.json?.length) {
  const m = posts.json[0].metrics;
  const shown = Object.entries(m ?? {}).map(([k, v]) => `${k}=${v.value === null ? 'อ่านไม่ได้' : v.value}`).join(' ');
  check('metrics carry null (not 0) for unavailable values', m && Object.values(m).every(v => v.value === null || typeof v.value === 'number'), shown);
}
const detail = await api('GET', `/workspaces/${ws}/pages/${pageId}`);
check('page detail with stats/availability', detail.status === 200 && detail.json?.stats && 'availability' in detail.json.stats, `posts30d=${detail.json?.stats?.posts30d} avail=${JSON.stringify(detail.json?.stats?.availability)} fans=${detail.json?.fanCount}`);
const val = await api('POST', `/workspaces/${ws}/pages/${pageId}/validate`, {});
check('validate token → valid', val.json?.valid === true);
const sync = await api('POST', `/workspaces/${ws}/pages/${pageId}/sync`, { days: 30 });
check('re-sync → 200', sync.status === 200, redact(JSON.stringify(sync.json)));
for (const p of [`/pages/${pageId}`]) { const r = await fetch(`${WEB}${p}`); check(`web ${p} → 200`, r.status === 200); }

const audit = await api('GET', `/workspaces/${ws}/audit`);
check('audit has facebook.* entries and no token', audit.status === 200 && audit.json.some(a => a.action.startsWith('facebook.')) && !audit.text.includes(TOKEN));

// เก็บกวาด: ตัดการเชื่อมต่อ + ยกเลิกบัญชี (ลบ token ออกจาก DB)
const dc = await api('DELETE', `/workspaces/${ws}/pages/${pageId}`);
const rv = await api('DELETE', `/workspaces/${ws}/facebook/connections/${connId}`);
check('cleanup: disconnect page + revoke connection', dc.status === 200 && rv.status === 200);

console.log(fail ? `\n${fail} check(s) failed` : '\nPhase 3–4 smoke: all checks passed');
process.exit(fail ? 1 : 0);
