// Phase 6 smoke — content loop ผ่าน Next proxy: ร่าง → ส่งตรวจ → อนุมัติ → ตั้งเวลา → โพสต์ (ไปยัง mock Graph ไม่แตะเพจจริง)
// ต้องเปิด API ด้วย META_GRAPH_BASE_URL=http://127.0.0.1:4998 (+ web/Postgres/Redis)   รัน:  node test/phase6-smoke.mjs
import { startMockGraph } from '../packages/facebook-core/dist/mock-graph.js';
import { startMockAi } from '../packages/ai-core/dist/mock-ai.js';
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3000';
let fail = 0; let cookie = '';
const check = (label, ok, detail = '') => { console.log(`${ok ? '✔' : '✖'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fail++; };
const api = async (method, path, body) => {
  const res = await fetch(`${WEB}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
};
const graph = await startMockGraph(4998); const ai = await startMockAi();
graph.state.validUserTokens.add('USER_OK_SMOKE_TOKEN_1234567890');
const stamp = Date.now();
const reg = await api('POST', '/auth/register', { email: `smoke6-${stamp}@test.local`, name: 'Smoke6', password: 'smoke-password-123' });
const ws = reg.json?.workspace?.id; check('register → 201', reg.status === 201);
const c = await api('POST', `/workspaces/${ws}/clients`, { name: 'ลูกค้า 6' });
const b = await api('POST', `/workspaces/${ws}/clients/${c.json.id}/brands`, { name: 'แบรนด์ 6', primaryCTA: 'ทักแชท' });
const conn = await api('POST', `/workspaces/${ws}/facebook/connections/token`, { accessToken: 'USER_OK_SMOKE_TOKEN_1234567890' });
check('connect (mock graph) → 201', conn.status === 201, conn.status !== 201 ? 'API ต้องเปิดด้วย META_GRAPH_BASE_URL=http://127.0.0.1:4998' : '');
if (conn.status !== 201) { graph.server.close(); ai.server.close(); process.exit(1); }
const pg = await api('POST', `/workspaces/${ws}/brands/${b.json.id}/pages/connect`, { connectionId: conn.json.connection.id, facebookPageId: '111' });
check('connect page 111', pg.status === 201); const pageId = pg.json.id;
for (const p of ['/content', '/calendar']) { const r = await fetch(`${WEB}${p}`); check(`web ${p} → 200`, r.status === 200); }

const d = await api('POST', `/workspaces/${ws}/content`, { pageId, title: 'smoke', caption: `โพสต์ทดสอบ ${stamp}`, hashtags: ['test'] });
check('create draft', d.status === 201 && d.json.status === 'DRAFT'); const id = d.json.id;
const s = await api('POST', `/workspaces/${ws}/content/${id}/submit`, {});
check('submit (no AI → skip review) → READY_FOR_APPROVAL', s.json?.status === 'READY_FOR_APPROVAL');
check('approval queue has 1', (await api('GET', `/workspaces/${ws}/approvals`)).json?.length === 1);
const ap = await api('POST', `/workspaces/${ws}/content/${id}/approve`, { comment: 'ok' });
check('approve → APPROVED', ap.json?.status === 'APPROVED');
const at = new Date(Date.now() + 60 * 60_000); const pad = n => String(n).padStart(2, '0');
const local = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}T${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
const sc = await api('POST', `/workspaces/${ws}/content/${id}/schedule`, { scheduledLocal: local, timezone: 'UTC' });
check('schedule → SCHEDULED + delayed job', sc.json?.status === 'SCHEDULED' && (await api('GET', `/workspaces/${ws}/content/${id}/job`)).json?.state === 'delayed');
check('calendar lists it', (await api('GET', `/workspaces/${ws}/content/calendar`)).json?.some(x => x.id === id));
const ro = await api('POST', `/workspaces/${ws}/content/${id}/reopen`, {});
check('reopen → APPROVED, job removed', ro.json?.status === 'APPROVED' && (await api('GET', `/workspaces/${ws}/content/${id}/job`)).json === null);
await api('PATCH', `/workspaces/${ws}/pages/${pageId}`, { publishingPaused: true });
const blocked = await api('POST', `/workspaces/${ws}/content/${id}/publish`, {});
check('kill switch blocks publish', blocked.json?.outcome?.status === 'SKIPPED', blocked.json?.outcome?.reason);
await api('PATCH', `/workspaces/${ws}/pages/${pageId}`, { publishingPaused: false });
const before = graph.state.published.length;
const pub = await api('POST', `/workspaces/${ws}/content/${id}/publish`, {});
check('publish now → PUBLISHED (mock graph received 1 post)', pub.json?.outcome?.status === 'PUBLISHED' && graph.state.published.length === before + 1, pub.json?.outcome?.permalink);
check('second publish is rejected (409)', (await api('POST', `/workspaces/${ws}/content/${id}/publish`, {})).status === 409);

// AI agents ผ่าน mock AI
await api('PUT', `/workspaces/${ws}/ai/providers/compatible`, { apiKey: 'MOCK_KEY', baseUrl: ai.url });
await api('PUT', `/workspaces/${ws}/ai/roles`, { roles: { strategy: { provider: 'compatible', model: 'm' }, content: { provider: 'compatible', model: 'm' }, fast: { provider: 'compatible', model: 'm' } } });
ai.state.replies.push({ text: JSON.stringify({ objective: 'o', contentPillars: ['a'], recommendedMix: { a: 1 }, rationale: '', dataLimitations: [], items: [{ dayOffset: 0, contentType: 'post', pillar: 'a', title: 'T1', objective: 'o', hook: 'h', cta: 'c' }] }) });
const plan = await api('POST', `/workspaces/${ws}/pages/${pageId}/content/plan`, { days: 7, postsPerWeek: 1 });
check('strategist plan → 1 PLANNED item', plan.status === 200 && plan.json.items?.[0]?.status === 'PLANNED', plan.text.slice(0, 100));
ai.state.replies.push({ text: JSON.stringify({ drafts: [{ headline: 'H', caption: 'ร่างจาก AI', cta: 'c', hashtags: [], mediaBrief: '', contentPillar: 'a', missingInfo: [] }] }) });
const gen = await api('POST', `/workspaces/${ws}/content/${plan.json.items[0].id}/generate`, {});
check('content agent fills draft', gen.json?.items?.[0]?.status === 'DRAFT' && gen.json.items[0].caption === 'ร่างจาก AI');
ai.state.replies.push({ text: JSON.stringify({ result: 'PASS', summary: 'ok', issues: [] }) });
const sub = await api('POST', `/workspaces/${ws}/content/${plan.json.items[0].id}/submit`, {});
check('reviewer PASS → READY_FOR_APPROVAL', sub.json?.status === 'READY_FOR_APPROVAL' && sub.json.reviewResult?.result === 'PASS');
graph.server.close(); ai.server.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nPhase 6 smoke: all checks passed');
process.exit(fail ? 1 : 0);
