'use client';
import { useCallback, useEffect, useState } from 'react';
import { AI_ROLES } from '@fbpm/shared';
import { api, type AiProviderRow, type AiRoles, type AiTaskRow, type AiUsage, type WorkspaceDetail } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select } from '@/components/ui';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const usd = (v: string | number | null | undefined) => (v == null ? '—' : `$${Number(v).toFixed(4)}`);

export default function AiModelsPage() {
  const { ws, can, refresh } = useWorkspace();
  const [providers, setProviders] = useState<AiProviderRow[] | null>(null);
  const [roles, setRoles] = useState<Record<string, { provider: string; model: string } | null>>({});
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [tasks, setTasks] = useState<AiTaskRow[]>([]);
  const [keys, setKeys] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});
  const [budget, setBudget] = useState({ monthly: '', perTask: '' });
  const [ping, setPing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState('');
  const configure = can('ai.configure');

  const load = useCallback(async () => {
    try {
      const [p, r, u, tk, d] = await Promise.all([api<AiProviderRow[]>(`/workspaces/${ws.id}/ai/providers`), api<AiRoles>(`/workspaces/${ws.id}/ai/roles`), api<AiUsage>(`/workspaces/${ws.id}/ai/usage`), api<AiTaskRow[]>(`/workspaces/${ws.id}/ai/tasks?limit=30`), api<WorkspaceDetail>(`/workspaces/${ws.id}`)]);
      setProviders(p); setRoles(r.roles); setUsage(u); setTasks(tk);
      setBudget({ monthly: d.aiMonthlyBudgetUsd == null ? '' : String(d.aiMonthlyBudgetUsd), perTask: d.aiMaxCostPerTaskUsd == null ? '' : String(d.aiMaxCostPerTaskUsd) });
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setSaved(''); try { await fn(); } catch (e) { setError(e); } finally { setBusy(''); } };

  const saveKey = (id: string) => run(`key:${id}`, async () => {
    const k = keys[id] ?? { apiKey: '', baseUrl: '' };
    await api(`/workspaces/${ws.id}/ai/providers/${id}`, { method: 'PUT', body: { ...(k.apiKey && { apiKey: k.apiKey }), ...(k.baseUrl !== '' && { baseUrl: k.baseUrl }) } });
    setKeys(v => ({ ...v, [id]: { apiKey: '', baseUrl: k.baseUrl } })); setSaved(id); await load();
  });
  const validate = (id: string) => run(`ping:${id}`, async () => { const r = await api<{ ok: boolean; model: string; latencyMs: number; error?: string }>(`/workspaces/${ws.id}/ai/providers/${id}/validate`, { method: 'POST', body: {} }); setPing(v => ({ ...v, [id]: r.ok ? `✔ ${t('aiModels.pingOk')} · ${r.model} · ${r.latencyMs} ms` : `✖ ${t('aiModels.pingFail')}: ${r.error ?? ''}` })); await load(); });
  const removeKey = (id: string) => { if (!confirm(t('aiModels.confirmRemove'))) return; void run(`rm:${id}`, async () => { await api(`/workspaces/${ws.id}/ai/providers/${id}`, { method: 'DELETE' }); await load(); }); };
  const saveRoles = () => run('roles', async () => { await api(`/workspaces/${ws.id}/ai/roles`, { method: 'PUT', body: { roles: Object.fromEntries(AI_ROLES.map(r => [r, roles[r]?.model ? roles[r] : null])) } }); setSaved('roles'); await load(); });
  const saveBudget = () => run('budget', async () => { await api(`/workspaces/${ws.id}`, { method: 'PATCH', body: { aiMonthlyBudgetUsd: budget.monthly === '' ? null : Number(budget.monthly), aiMaxCostPerTaskUsd: budget.perTask === '' ? null : Number(budget.perTask) } }); setSaved('budget'); await refresh(); await load(); });

  if (!providers || !usage) return <div><ErrorBox error={error} /><Loading /></div>;
  const configured = providers.filter(p => p.configured || p.platformKey);
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">{t('aiModels.title')}</h1><p className="text-sm text-slate-400">{t('aiModels.subtitle')}</p></div>
      <ErrorBox error={error} />
      {saved && <p className="text-sm text-emerald-400">✔ {t('common.saved')}</p>}

      <Card title={t('aiModels.providers')}>
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map(p => (
            <div key={p.id} className="rounded-lg border border-slate-800 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{p.label}</div>
                <div className="flex items-center gap-1">
                  {p.configured ? <Pill tone="ok">{t('aiModels.configured')} · {t('aiModels.keyHint')} …{p.keyHint}</Pill> : p.platformKey ? <Pill tone="warn">{t('aiModels.platformKey')}</Pill> : <Pill>{t('aiModels.notConfigured')}</Pill>}
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">{p.keyHelp}{p.defaultModel && ` · default: ${p.defaultModel}`}</p>
              {p.lastError && <p className="mt-1 text-xs text-rose-400">{p.lastError}</p>}
              {ping[p.id] && <p className="mt-1 text-xs text-sky-300">{ping[p.id]}</p>}
              {configure && (
                <div className="mt-2 space-y-2">
                  <Input type="password" autoComplete="off" placeholder={p.configured ? '•••••••• (ใส่ใหม่เพื่อเปลี่ยน)' : t('aiModels.apiKey')} value={keys[p.id]?.apiKey ?? ''} onChange={e => setKeys(v => ({ ...v, [p.id]: { apiKey: e.target.value, baseUrl: v[p.id]?.baseUrl ?? p.customBaseUrl ?? '' } }))} />
                  {(p.needsBaseUrl || p.customBaseUrl || keys[p.id]?.baseUrl) && <Input placeholder={t('aiModels.baseUrl')} value={keys[p.id]?.baseUrl ?? p.customBaseUrl ?? ''} onChange={e => setKeys(v => ({ ...v, [p.id]: { apiKey: v[p.id]?.apiKey ?? '', baseUrl: e.target.value } }))} />}
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy === `key:${p.id}` || (!keys[p.id]?.apiKey && !p.configured)} onClick={() => saveKey(p.id)}>{t('aiModels.saveKey')}</Button>
                    {(p.configured || p.platformKey) && <Button variant="ghost" disabled={busy === `ping:${p.id}`} onClick={() => validate(p.id)}>{t('aiModels.validate')}</Button>}
                    {p.configured && <button className="text-xs text-rose-400 hover:underline" onClick={() => removeKey(p.id)}>{t('aiModels.remove')}</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('aiModels.roles')}>
          <p className="mb-2 text-xs text-slate-500">{t('aiModels.rolesHint')}</p>
          <div className="space-y-2">
            {AI_ROLES.map(r => (
              <div key={r} className="grid grid-cols-[1fr_1fr_1.4fr] items-center gap-2 text-sm">
                <span>{t(`role.${r}` as MessageKey)}</span>
                <Select value={roles[r]?.provider ?? ''} disabled={!configure} onChange={e => setRoles(v => ({ ...v, [r]: e.target.value ? { provider: e.target.value, model: v[r]?.model ?? providers.find(p => p.id === e.target.value)?.defaultModel ?? '' } : null }))}>
                  <option value="">—</option>{configured.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
                <Input placeholder={t('aiModels.model')} disabled={!configure || !roles[r]} value={roles[r]?.model ?? ''} onChange={e => setRoles(v => ({ ...v, [r]: { provider: v[r]?.provider ?? '', model: e.target.value } }))} />
              </div>
            ))}
          </div>
          {configure && <Button className="mt-3" disabled={busy === 'roles'} onClick={saveRoles}>{t('aiModels.saveRoles')}</Button>}
        </Card>
        <Card title={t('aiModels.budget')}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-800 p-3"><div className="text-xl font-bold">{usd(usage.monthToDate.costUsd)}</div><div className="text-xs text-slate-400">{t('aiModels.mtd')} · {usage.monthToDate.tasks} tasks · {usage.monthToDate.failed} failed</div></div>
            <div className="rounded-lg border border-slate-800 p-3"><div className="text-xl font-bold">{usage.monthlyBudgetUsd == null ? t('aiModels.unlimited') : `$${usage.monthlyBudgetUsd}`}</div><div className="text-xs text-slate-400">{t('aiModels.monthlyBudget')}</div></div>
          </div>
          {configure && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Field label={t('aiModels.monthlyBudget')}><Input type="number" min={0} step="0.5" value={budget.monthly} onChange={e => setBudget(v => ({ ...v, monthly: e.target.value }))} placeholder={t('aiModels.unlimited')} /></Field>
              <Field label={t('aiModels.maxPerTask')}><Input type="number" min={0} step="0.05" value={budget.perTask} onChange={e => setBudget(v => ({ ...v, perTask: e.target.value }))} placeholder={t('aiModels.unlimited')} /></Field>
              <div className="flex items-end"><Button disabled={busy === 'budget'} onClick={saveBudget}>{t('common.save')}</Button></div>
            </div>
          )}
          {usage.byModel.length > 0 && (
            <table className="mt-3 w-full text-xs"><thead className="text-left text-slate-500"><tr><th>{t('aiModels.byModel')}</th><th className="text-right">tasks</th><th className="text-right">{t('ai.tokens')}</th><th className="text-right">{t('ai.cost')}</th><th className="text-right">ms</th></tr></thead>
              <tbody>{usage.byModel.map(m => <tr key={m.provider + m.model} className="border-t border-slate-800"><td className="py-1">{m.provider} / {m.model}</td><td className="text-right">{m.tasks}</td><td className="text-right">{m.inputTokens + m.outputTokens}</td><td className="text-right">{usd(m.costUsd)}</td><td className="text-right">{m.avgLatencyMs}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>

      <Card title={t('aiModels.tasks')}>
        {tasks.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead className="text-left text-slate-500"><tr><th className="py-1 pr-2">เวลา</th><th className="pr-2">task</th><th className="pr-2">{t('ai.role')}</th><th className="pr-2">{t('aiModels.model')}</th><th className="pr-2 text-right">ms</th><th className="pr-2 text-right">{t('ai.tokens')}</th><th className="pr-2 text-right">{t('ai.cost')}</th><th>สถานะ</th></tr></thead>
            <tbody className="divide-y divide-slate-800">{tasks.map(x => <tr key={x.id}><td className="py-1 pr-2 whitespace-nowrap text-slate-400">{fmt(x.createdAt)}</td><td className="pr-2">{x.taskType}</td><td className="pr-2">{x.role}</td><td className="pr-2">{x.provider}/{x.model}</td><td className="pr-2 text-right">{x.latencyMs}</td><td className="pr-2 text-right">{(x.inputTokens ?? 0) + (x.outputTokens ?? 0)}</td><td className="pr-2 text-right">{usd(x.estimatedCost)}</td><td>{x.success ? <Pill tone="ok">ok</Pill> : <Pill tone="bad" >{x.error?.slice(0, 60) ?? 'fail'}</Pill>}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
