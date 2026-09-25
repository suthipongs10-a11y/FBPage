// Phase 2 smoke ผ่าน Next proxy (/api/*) — ทดสอบ rewrite + cookie same-origin + flow ลูกค้า→แบรนด์→ความรู้
// ต้องเปิด API (:4000) + web (:3000) + Postgres + Redis ก่อน   รัน:  node test/phase2-smoke.mjs
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3000';
let fail = 0; let cookie = '';
const check = (label, ok, detail = '') => { console.log(`${ok ? '✔' : '✖'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail++; };
const api = async (method, path, body) => {
  const res = await fetch(`${WEB}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: res.status, json: await res.json().catch(() => null), sc };
};

const stamp = Date.now();
const u = { email: `smoke-${stamp}@test.local`, name: 'Smoke', password: 'smoke-password-123', workspaceName: 'Smoke Agency' };

// หน้าเว็บสาธารณะ
for (const p of ['/login', '/register']) { const r = await fetch(`${WEB}${p}`); check(`web ${p} → 200`, r.status === 200); }

// register ผ่าน proxy → cookie ต้องกลับมา
const reg = await api('POST', '/auth/register', u);
check('register via /api proxy → 201', reg.status === 201, JSON.stringify(reg.json).slice(0, 120));
check('session cookie set (HttpOnly, SameSite)', /fbpm_session=.*HttpOnly.*SameSite=Lax/.test(reg.sc || ''));
const wsId = reg.json?.workspace?.id;

const me = await api('GET', '/auth/me');
check('GET /auth/me with cookie → 200', me.status === 200 && me.json?.workspaces?.[0]?.role === 'owner');

// ลูกค้า → แบรนด์ → ความรู้ (flow ของ Milestone 1 ข้อ 2–4)
const c = await api('POST', `/workspaces/${wsId}/clients`, { name: 'Phuket Maids Service', phone: '+66812345678' });
check('create client → 201', c.status === 201);
const b = await api('POST', `/workspaces/${wsId}/clients/${c.json.id}/brands`, { name: 'Phuket Maids', industry: 'cleaning', serviceArea: 'ภูเก็ต', preferredLanguage: 'th' });
check('create brand → 201, kb EMPTY', b.status === 201 && b.json.knowledgeBaseStatus === 'EMPTY');
for (const [type, title, content] of [['business_info', 'บริษัท', 'บริการทำความสะอาดครบวงจรทั่วภูเก็ต'], ['brand_voice', 'น้ำเสียง', 'สุภาพ มืออาชีพ อบอุ่น'], ['service', 'ทำความสะอาดวิลล่า', 'รายครั้ง/รายเดือน']]) {
  const k = await api('POST', `/workspaces/${wsId}/brands/${b.json.id}/knowledge`, { type, title, content });
  check(`add knowledge ${type} → 201`, k.status === 201);
}
const bAfter = await api('GET', `/workspaces/${wsId}/brands/${b.json.id}`);
check('kb status becomes READY after info+voice+service', bAfter.json?.knowledgeBaseStatus === 'READY', bAfter.json?.knowledgeBaseStatus);

// validation ผ่าน proxy
const bad = await api('POST', `/workspaces/${wsId}/brands/${b.json.id}/knowledge`, { type: 'nope', title: '', content: '' });
check('validation error surfaces issues', bad.status === 400 && Array.isArray(bad.json?.issues) && bad.json.issues.length >= 2);

// audit + kill switch
const audit = await api('GET', `/workspaces/${wsId}/audit`);
check('audit log has client/brand/knowledge actions', audit.status === 200 && ['client.create', 'brand.create', 'brand.knowledge.add'].every(a => audit.json.some(x => x.action === a)));
const pause = await api('PATCH', `/workspaces/${wsId}`, { automationPaused: true });
check('kill switch toggles + audited as automation.change', pause.json?.automationPaused === true && (await api('GET', `/workspaces/${wsId}/audit`)).json.some(x => x.action === 'automation.change'));

// ไม่มี secret หลุดใน response ใดๆ
const all = JSON.stringify([me.json, c.json, b.json, bAfter.json, audit.json]);
check('no passwordHash / tokenHash in any response', !/passwordHash|tokenHash|scrypt\$/.test(all));

// logout
const out = await api('POST', '/auth/logout');
check('logout → 200 and session revoked', out.status === 200 && (await api('GET', '/auth/me')).status === 401);

console.log(fail ? `\n${fail} check(s) failed` : '\nPhase 2 smoke: all checks passed');
process.exit(fail ? 1 : 0);
