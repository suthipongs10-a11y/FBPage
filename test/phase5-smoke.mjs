// Phase 5 smoke — AI Gateway ผ่าน Next proxy กับ mock AI (OpenAI-compatible) ที่สคริปต์นี้เปิดเอง
// ต้องเปิด API (:4000) + web (:3000) + Postgres + Redis ก่อน   รัน:  node test/phase5-smoke.mjs
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
const mock = await startMockAi();
const stamp = Date.now();
const reg = await api('POST', '/auth/register', { email: `smoke5-${stamp}@test.local`, name: 'Smoke5', password: 'smoke-password-123' });
const ws = reg.json?.workspace?.id; check('register → 201', reg.status === 201);
for (const p of ['/ai', '/ai-models']) { const r = await fetch(`${WEB}${p}`); check(`web ${p} → 200`, r.status === 200); }

const none = await api('POST', `/workspaces/${ws}/ai/command`, { message: 'สวัสดี' });
check('command without key → 422', none.status === 422, none.json?.message);
const key = await api('PUT', `/workspaces/${ws}/ai/providers/compatible`, { apiKey: 'MOCK_KEY', baseUrl: mock.url, label: 'mock' });
check('save BYOK key → 200, key not echoed', key.status === 200 && !key.text.includes('MOCK_KEY'), `hint=${key.json?.keyHint}`);
const roles = await api('PUT', `/workspaces/${ws}/ai/roles`, { roles: { strategy: { provider: 'compatible', model: 'mock-1' }, analysis: { provider: 'compatible', model: 'mock-1' } } });
check('set roles → 200', roles.status === 200);
const ping = await api('POST', `/workspaces/${ws}/ai/providers/compatible/validate`, {});
check('validate key → ok', ping.json?.ok === true, JSON.stringify(ping.json));

mock.state.replies.push({ toolCalls: [{ name: 'list_clients_brands', args: {} }] }, { text: 'workspace นี้ยังไม่มีลูกค้า' });
const cmd = await api('POST', `/workspaces/${ws}/ai/command`, { message: 'มีลูกค้ากี่ราย' });
check('command with tool loop → 200', cmd.status === 200 && cmd.json?.text.includes('ยังไม่มีลูกค้า'), `steps=${cmd.json?.steps?.map(s => s.type + ':' + s.name).join(',')}`);
check('task logged with tokens/cost fields', (await api('GET', `/workspaces/${ws}/ai/tasks?limit=3`)).json?.some(x => x.taskType === 'ai.command' && x.inputTokens > 0));
const usage = await api('GET', `/workspaces/${ws}/ai/usage`);
check('usage endpoint', usage.status === 200 && usage.json?.monthToDate?.tasks >= 2, `tasks=${usage.json?.monthToDate?.tasks}`);
await api('PATCH', `/workspaces/${ws}`, { aiMonthlyBudgetUsd: 0 });
const blocked = await api('POST', `/workspaces/${ws}/ai/command`, { message: 'x' });
check('budget 0 → 402', blocked.status === 402);
const rm = await api('DELETE', `/workspaces/${ws}/ai/providers/compatible`);
check('remove key → 200', rm.status === 200);
mock.server.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nPhase 5 smoke: all checks passed');
process.exit(fail ? 1 : 0);
