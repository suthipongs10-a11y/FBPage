'use client';
import { useCallback, useEffect, useState } from 'react';
import { LEAD_STATUSES } from '@fbpm/shared';
import { api, type LeadRow } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Empty, ErrorBox, Input, Loading, Pill, Select } from '@/components/ui';

const fmt = (d: string) => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
export default function LeadsPage() {
  const { ws } = useWorkspace();
  const [rows, setRows] = useState<LeadRow[] | null>(null); const [status, setStatus] = useState(''); const [notes, setNotes] = useState<Record<string, string>>({}); const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => { try { setRows(await api<LeadRow[]>(`/workspaces/${ws.id}/leads${status ? `?status=${status}` : ''}`)); } catch (e) { setError(e); } }, [ws.id, status]);
  useEffect(() => { void load(); }, [load]);
  const patch = (id: string, body: Record<string, unknown>) => api(`/workspaces/${ws.id}/leads/${id}`, { method: 'PATCH', body }).then(load).catch(setError);
  if (!rows) return <div><ErrorBox error={error} /><Loading /></div>;
  const tone = (s: number): 'ok' | 'warn' | 'muted' => (s >= 70 ? 'ok' : s >= 40 ? 'warn' : 'muted');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h1 className="text-2xl font-semibold">{t('leads.title')}</h1><p className="text-sm text-slate-400">{t('leads.subtitle')}</p></div>
        <Select className="w-auto" value={status} onChange={e => setStatus(e.target.value)}><option value="">{t('leads.status')}: {t('content.all')}</option>{LEAD_STATUSES.map(s => <option key={s} value={s}>{t(`ls.${s}` as MessageKey)}</option>)}</Select></div>
      <ErrorBox error={error} />
      {rows.length === 0 ? <Empty text={t('leads.empty')} /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-3">{t('leads.score')}</th><th className="pr-3">{t('leads.from')}</th><th className="pr-3">ความต้องการ</th><th className="pr-3">รายละเอียด</th><th className="pr-3">{t('leads.status')}</th><th>{t('leads.notes')}</th></tr></thead>
          <tbody className="divide-y divide-slate-800">{rows.map(l => (
            <tr key={l.id} className="align-top">
              <td className="py-2 pr-3"><Pill tone={tone(l.leadScore)}>{l.leadScore}</Pill><div className="text-[10px] text-slate-500">conf {Math.round(l.confidence * 100)}%</div></td>
              <td className="pr-3"><div className="font-medium">{l.name ?? '—'}</div><div className="text-xs text-slate-500">{l.page.name} · {fmt(l.createdAt)}</div>{l.comment?.permalink && <a href={l.comment.permalink} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">{t('pages.openFb')}</a>}</td>
              <td className="pr-3"><div>{l.intent ?? '—'}</div><div className="text-xs text-slate-400">{[l.service, l.product].filter(Boolean).join(' · ')}</div>{l.comment?.message && <div className="mt-1 max-w-xs text-xs text-slate-500">“{l.comment.message.slice(0, 120)}”</div>}</td>
              <td className="pr-3 text-xs text-slate-300">{[['จำนวน', l.quantity], ['วันที่', l.requestedDate], ['พื้นที่', l.location], ['งบ', l.budget], ['เบอร์', l.phone], ['เร่งด่วน', l.urgency]].filter(([, v]) => v).map(([k, v]) => <div key={k}>{k}: {v}</div>)}</td>
              <td className="pr-3"><Select className="w-32" value={l.status} onChange={e => patch(l.id, { status: e.target.value })}>{LEAD_STATUSES.map(s => <option key={s} value={s}>{t(`ls.${s}` as MessageKey)}</option>)}</Select></td>
              <td><Input value={notes[l.id] ?? l.notes ?? ''} onChange={e => setNotes(v => ({ ...v, [l.id]: e.target.value }))} onBlur={() => { if ((notes[l.id] ?? l.notes ?? '') !== (l.notes ?? '')) void patch(l.id, { notes: notes[l.id] ?? '' }); }} placeholder={t('leads.notes')} /></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
