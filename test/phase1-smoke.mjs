// Phase 1 smoke — ต้องเปิด API (:4000), web (:3000), Postgres, Redis ก่อน
// รัน:  node test/phase1-smoke.mjs
const API = process.env.API_URL || 'http://127.0.0.1:4000';
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3000';
let fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✔' : '✖'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail++; };

// API health
const h = await fetch(`${API}/health`);
const hj = await h.json();
check('GET /health → 200', h.status === 200, `status=${hj.status}`);
check('x-request-id header present', !!h.headers.get('x-request-id'));
check('postgres up', hj.checks?.find(c => c.name === 'postgres')?.status === 'up', JSON.stringify(hj.checks?.find(c => c.name === 'postgres')));
check('redis up', hj.checks?.find(c => c.name === 'redis')?.status === 'up', JSON.stringify(hj.checks?.find(c => c.name === 'redis')));
check('overall ok', hj.status === 'ok');

// request id passthrough
const rid = 'test-' + Date.now();
const h2 = await fetch(`${API}/health`, { headers: { 'x-request-id': rid } });
check('x-request-id echoed back', h2.headers.get('x-request-id') === rid);

// OpenAPI
const d = await fetch(`${API}/docs-json`);
const dj = await d.json().catch(() => null);
check('OpenAPI document served', d.status === 200 && !!dj?.paths?.['/health'], `paths=${Object.keys(dj?.paths || {}).join(',')}`);

// security headers
check('nosniff header', h.headers.get('x-content-type-options') === 'nosniff');

// web
const w = await fetch(`${WEB}/`);
check('web / → 200', w.status === 200);
const lg = await fetch(`${WEB}/login`); const html = await lg.text();
check('web /login renders app shell (Thai i18n)', lg.status === 200 && html.includes('เข้าสู่ระบบ'));
const wh = await fetch(`${WEB}/health`);
check('web /health liveness', wh.status === 200 && (await wh.json()).service === 'web');

console.log(fail ? `\n${fail} check(s) failed` : '\nPhase 1 smoke: all checks passed');
process.exit(fail ? 1 : 0);
