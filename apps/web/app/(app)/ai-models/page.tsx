'use client';
import { useCallback, useEffect, useState } from 'react';
import { AI_ROLES } from '@fbpm/shared';
import { api, type AiConnectionRow, type AiConnectionsView, type AiRoleCfg, type AiRoles, type AiTaskRow, type AiUsage, type WorkspaceDetail } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select } from '@/components/ui';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const usd = (v: string | number | null | undefined) => (v == null ? '—' : `$${Number(v).toFixed(4)}`);
const parseModels = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean).slice(0, 30);

const emptyForm = { preset: '', label: '', apiKey: '', baseUrl: '', models: '' };

export default function AiModelsPage() {
  const { ws, can, refresh } = useWorkspace();
  const [view, setView] = useState<AiConnectionsView | null>(null);
  const [roles, setRoles] = useState<Record<string, AiRoleCfg | null>>({});
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [tasks, setTasks] = useState<AiTaskRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);
  const [editKey, setEditKey] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState({ monthly: '', perTask: '' });
  const [ping, setPing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState('');
  const configure = can('ai.configure');

  const load = useCallback(async () => {
    try {
      const [c, r, u, tk, d] = await Promise.all([
        api<AiConnectionsView>(`/workspaces/${ws.id}/ai/connections`), api<AiRoles>(`/workspaces/${ws.id}/ai/roles`),
        api<AiUsage>(`/workspaces/${ws.id}/ai/usage`), api<AiTaskRow[]>(`/workspaces/${ws.id}/ai/tasks?limit=30`), api<WorkspaceDetail>(`/workspaces/${ws.id}`),
      ]);
      setView(c); setRoles(r.roles); setUsage(u); setTasks(tk);
      setBudget({ monthly: d.aiMonthlyBudgetUsd == null ? '' : String(d.aiMonthlyBudgetUsd), perTask: d.aiMaxCostPerTaskUsd == null ? '' : String(d.aiMaxCostPerTaskUsd) });
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setSaved(''); try { await fn(); } catch (e) { setError(e); } finally { setBusy(''); } };

  const preset = view?.presets.find(p => p.id === form.preset);
  const addConnection = () => run('add', async () => {
    await api(`/workspaces/${ws.id}/ai/connections`, { method: 'POST', body: { preset: form.preset, label: form.label, apiKey: form.apiKey, ...(form.baseUrl && { baseUrl: form.baseUrl }), ...(form.models && { models: parseModels(form.models) }) } });
    setForm(emptyForm); setAdding(false); setSaved('add'); await load();
  });
  const patch = (id: string, body: Record<string, unknown>, key = `save:${id}`) => run(key, async () => { await api(`/workspaces/${ws.id}/ai/connections/${id}`, { method: 'PATCH', body }); setEditKey(v => ({ ...v, [id]: '' })); setSaved(id); await load(); });
  const validate = (id: string) => run(`ping:${id}`, async () => {
    const r = await api<{ ok: boolean; model: string; latencyMs: number; error?: string }>(`/workspaces/${ws.id}/ai/connections/${id}/validate`, { method: 'POST', body: {} });
    setPing(v => ({ ...v, [id]: r.ok ? `✔ ${t('aiModels.pingOk')} · ${r.model} · ${r.latencyMs} ms` : `✖ ${t('aiModels.pingFail')}: ${r.error ?? ''}` }));
    await load();
  });
  const removeConnection = (id: string) => { if (!confirm(t('aiModels.confirmRemove'))) return; void run(`rm:${id}`, async () => { await api(`/workspaces/${ws.id}/ai/connections/${id}`, { method: 'DELETE' }); await load(); }); };
  const saveRoles = () => run('roles', async () => { await api(`/workspaces/${ws.id}/ai/roles`, { method: 'PUT', body: { roles: Object.fromEntries(AI_ROLES.map(r => [r, roles[r]?.connectionId && roles[r]?.model ? roles[r] : null])) } }); setSaved('roles'); await load(); });
  const saveBudget = () => run('budget', async () => { await api(`/workspaces/${ws.id}`, { method: 'PATCH', body: { aiMonthlyBudgetUsd: budget.monthly === '' ? null : Number(budget.monthly), aiMaxCostPerTaskUsd: budget.perTask === '' ? null : Number(budget.perTask) } }); setSaved('budget'); await refresh(); await load(); });

  if (!view || !usage) return <div><ErrorBox error={error} /><Loading /></div>;
  const active = view.connections.filter(c => c.status === 'ACTIVE');
  const modelsOf = (id: string) => view.connections.find(c => c.id === id)?.models ?? [];

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">{t('aiModels.title')}</h1><p className="text-sm text-slate-400">{t('aiModels.subtitle')}</p></div>
      <ErrorBox error={error} />
      {saved && <p className="text-sm text-emerald-400">✔ {t('common.saved')}</p>}

      <Card title={t('aiModels.providers')}>
        <p className="mb-3 text-xs text-slate-500">{t('aiModels.sameKindHint')}</p>
        {view.connections.length === 0 && <Empty text={t('aiModels.noKeys')} />}
        <div className="grid gap-3 md:grid-cols-2">
          {view.connections.map(c => (
            <ConnectionCard
              key={c.id} c={c} configure={configure} busy={busy} ping={ping[c.id]}
              keyValue={editKey[c.id] ?? ''} onKeyChange={v => setEditKey(s => ({ ...s, [c.id]: v }))}
              onSaveKey={() => patch(c.id, { apiKey: editKey[c.id] })}
              onToggle={() => patch(c.id, { status: c.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }, `toggle:${c.id}`)}
              onModels={models => patch(c.id, { models }, `models:${c.id}`)}
              onValidate={() => validate(c.id)} onRemove={() => removeConnection(c.id)}
            />
          ))}
        </div>

        {configure && !adding && <Button className="mt-3" onClick={() => setAdding(true)}>{t('aiModels.addKey')}</Button>}
        {configure && adding && (
          <div className="mt-3 space-y-3 rounded-lg border border-slate-300 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t('aiModels.provider')}>
                <Select value={form.preset} onChange={e => { const p = view.presets.find(x => x.id === e.target.value); setForm(f => ({ ...f, preset: e.target.value, label: f.label || (p?.label ?? ''), baseUrl: p?.baseUrl ?? '', models: p?.models.join(', ') ?? '' })); }}>
                  <option value="">—</option>{view.presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label={t('aiModels.name')}><Input placeholder={t('aiModels.namePlaceholder')} maxLength={120} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></Field>
            </div>
            {preset && <p className="text-xs text-slate-500">{preset.keyHelp}</p>}
            <Field label={t('aiModels.apiKey')}><Input type="password" autoComplete="off" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} /></Field>
            {(preset?.needsBaseUrl || form.baseUrl) && <Field label={t('aiModels.baseUrl')}><Input value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} /></Field>}
            <Field label={t('aiModels.models')}><Input value={form.models} onChange={e => setForm(f => ({ ...f, models: e.target.value }))} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy === 'add' || !form.preset || !form.label.trim() || form.apiKey.trim().length < 8 || (!!preset?.needsBaseUrl && !form.baseUrl.trim())} onClick={addConnection}>{t('common.save')}</Button>
              <Button variant="ghost" onClick={() => { setAdding(false); setForm(emptyForm); }}>{t('common.cancel')}</Button>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('aiModels.roles')}>
          <p className="mb-2 text-xs text-slate-500">{t('aiModels.rolesHint')}</p>
          <div className="space-y-2">
            {AI_ROLES.map(r => (
              <div key={r} className="grid grid-cols-[1fr_1fr_1.4fr] items-center gap-2 text-sm">
                <span>{t(`role.${r}` as MessageKey)}</span>
                <Select aria-label={t(`role.${r}` as MessageKey)} value={roles[r]?.connectionId ?? ''} disabled={!configure} onChange={e => setRoles(v => ({ ...v, [r]: e.target.value ? { connectionId: e.target.value, model: v[r]?.model || (modelsOf(e.target.value)[0] ?? '') } : null }))}>
                  <option value="">—</option>{active.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
                <Input placeholder={t('aiModels.model')} list={roles[r]?.connectionId ? `models-${roles[r]!.connectionId}` : undefined} disabled={!configure || !roles[r]} value={roles[r]?.model ?? ''} onChange={e => setRoles(v => ({ ...v, [r]: { connectionId: v[r]?.connectionId ?? '', model: e.target.value } }))} />
              </div>
            ))}
          </div>
          {active.map(c => <datalist key={c.id} id={`models-${c.id}`}>{c.models.map(m => <option key={m} value={m} />)}</datalist>)}
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
            <tbody className="divide-y divide-slate-800">{tasks.map(x => {
              const conn = x.connectionId ? view.connections.find(c => c.id === x.connectionId) : null;
              return <tr key={x.id}><td className="py-1 pr-2 whitespace-nowrap text-slate-400">{fmt(x.createdAt)}</td><td className="pr-2">{x.taskType}</td><td className="pr-2">{x.role}</td><td className="pr-2">{conn ? `${conn.label} / ${x.model}` : `${x.provider}/${x.model}`}</td><td className="pr-2 text-right">{x.latencyMs}</td><td className="pr-2 text-right">{(x.inputTokens ?? 0) + (x.outputTokens ?? 0)}</td><td className="pr-2 text-right">{usd(x.estimatedCost)}</td><td>{x.success ? <Pill tone="ok">ok</Pill> : <Pill tone="bad">{x.error?.slice(0, 60) ?? 'fail'}</Pill>}</td></tr>;
            })}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

function ConnectionCard({ c, configure, busy, ping, keyValue, onKeyChange, onSaveKey, onToggle, onModels, onValidate, onRemove }: {
  c: AiConnectionRow; configure: boolean; busy: string; ping?: string;
  keyValue: string; onKeyChange: (v: string) => void; onSaveKey: () => void;
  onToggle: () => void; onModels: (models: string[]) => void; onValidate: () => void; onRemove: () => void;
}) {
  const [models, setModels] = useState(c.models.join(', '));
  useEffect(() => { setModels(c.models.join(', ')); }, [c.models]);
  const dirty = parseModels(models).join(',') !== c.models.join(',');
  return (
    <div className="rounded-lg border border-slate-300 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{c.label}</div>
        {c.status === 'ACTIVE' ? <Pill tone="ok">{c.kindLabel} · {t('aiModels.keyHint')} …{c.keyHint}</Pill> : <Pill tone="warn">{t('aiModels.disabled')}</Pill>}
      </div>
      {c.baseUrl && <p className="mt-1 break-all text-xs text-slate-500">{c.baseUrl}</p>}
      {c.lastError && <p className="mt-1 text-xs text-rose-500">{c.lastError}</p>}
      {ping && <p className="mt-1 text-xs text-sky-600">{ping}</p>}
      {configure && (
        <div className="mt-2 space-y-2">
          <Field label={t('aiModels.models')}><Input value={models} onChange={e => setModels(e.target.value)} /></Field>
          {dirty && <Button disabled={busy === `models:${c.id}`} onClick={() => onModels(parseModels(models))}>{t('common.save')}</Button>}
          <Input type="password" autoComplete="off" placeholder={t('aiModels.editKey')} value={keyValue} onChange={e => onKeyChange(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            {keyValue.trim().length >= 8 && <Button disabled={busy === `save:${c.id}`} onClick={onSaveKey}>{t('aiModels.saveKey')}</Button>}
            <Button variant="ghost" disabled={busy === `ping:${c.id}`} onClick={onValidate}>{t('aiModels.validate')}</Button>
            <Button variant="ghost" disabled={busy === `toggle:${c.id}`} onClick={onToggle}>{c.status === 'ACTIVE' ? t('aiModels.disable') : t('aiModels.enable')}</Button>
            <button className="text-xs text-rose-500 hover:underline" onClick={onRemove}>{t('aiModels.remove')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
