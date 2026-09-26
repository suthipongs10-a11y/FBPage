'use client';
/** ภาพจาก AI (N-3) — เลือกคีย์ AI ที่มีอยู่ (OpenAI/Gemini/OpenRouter/compatible) + โมเดลภาพ + ราคาต่อภาพ + เพดานรายเดือน */
import { useCallback, useEffect, useState } from 'react';
import { api, type AiConnectionRow, type AiMediaConfig } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBox, Field, Input, Pill, Select } from '@/components/ui';

const HINT: Record<string, string> = { openai: 'gpt-image-1', gemini: 'gemini-2.5-flash-image', openrouter: 'google/gemini-2.5-flash-image', compatible: '' };

export function AiImageSettings({ wsId, connections, canConfigure }: { wsId: string; connections: AiConnectionRow[]; canConfigure: boolean }) {
  const [cfg, setCfg] = useState<AiMediaConfig | null>(null);
  const [form, setForm] = useState({ connectionId: '', model: '', unitCostUsd: '', limit: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    const c = await api<AiMediaConfig>(`/workspaces/${wsId}/media/ai-config`); setCfg(c);
    setForm({ connectionId: c.image?.connectionId ?? '', model: c.image?.model ?? '', unitCostUsd: c.image?.unitCostUsd == null ? '' : String(c.image.unitCostUsd), limit: c.monthlyImageLimit == null ? '' : String(c.monthlyImageLimit) });
  }, [wsId]);
  useEffect(() => { void load().catch(setError); }, [load]);
  if (!cfg) return null;
  const usable = connections.filter(c => cfg.supportedKinds.includes(c.kind));
  const kindOf = (id: string) => connections.find(c => c.id === id)?.kind ?? '';
  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api(`/workspaces/${wsId}/media/ai-config`, { method: 'PUT', body: { connectionId: form.connectionId || null, ...(form.connectionId && { model: form.model }), unitCostUsd: form.unitCostUsd === '' ? null : Number(form.unitCostUsd), monthlyImageLimit: form.limit === '' ? null : Number(form.limit) } });
      await load(); setSaved(true);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card title={t('aiImg.title')}>
      <p className="text-xs text-slate-400">{t('aiImg.help')}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <Pill tone={cfg.image ? 'ok' : 'muted'}>{cfg.image ? `${cfg.image.connectionLabel} · ${cfg.image.model}` : t('aiImg.notSet')}</Pill>
        <span className="text-slate-400">{t('aiImg.used')} {cfg.usedThisMonth}{cfg.monthlyImageLimit != null ? ` / ${cfg.monthlyImageLimit}` : ''} · {t('aiImg.cost')} {cfg.costThisMonthUsd == null ? t('aiImg.costUnknown') : `$${cfg.costThisMonthUsd.toFixed(2)}`}</span>
      </div>
      <ErrorBox error={error} />
      {canConfigure && (
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <Field label={t('aiImg.key')}><Select value={form.connectionId} onChange={e => setForm({ ...form, connectionId: e.target.value, model: form.model || HINT[kindOf(e.target.value)] || '' })}><option value="">{t('aiImg.off')}</option>{usable.map(c => <option key={c.id} value={c.id}>{c.label} ({c.kindLabel})</option>)}</Select></Field>
          <Field label={t('aiImg.model')} hint={HINT[kindOf(form.connectionId)] ? `เช่น ${HINT[kindOf(form.connectionId)]}` : undefined}><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} disabled={!form.connectionId} /></Field>
          <Field label={t('aiImg.unitCost')} hint={t('aiImg.unitCostHint')}><Input type="number" step="0.001" min="0" value={form.unitCostUsd} onChange={e => setForm({ ...form, unitCostUsd: e.target.value })} /></Field>
          <Field label={t('aiImg.limit')} hint={t('aiImg.limitHint')}><Input type="number" min="0" value={form.limit} onChange={e => setForm({ ...form, limit: e.target.value })} /></Field>
          <div className="md:col-span-4 flex items-center gap-2"><Button disabled={busy || (!!form.connectionId && !form.model)} onClick={save}>{t('common.save')}</Button>{saved && <span className="text-xs text-emerald-400">✔</span>}{usable.length === 0 && <span className="text-xs text-amber-400">{t('aiImg.noKey')}</span>}</div>
        </div>
      )}
    </Card>
  );
}
