'use client';
/** ตั้งค่าแจ้งเตือน LINE OA ของทีม (หน้าตั้งค่า) — admin ตั้ง OA + ดูผู้รับ · ทีมงานทุกคนผูก LINE ของตัวเองได้ */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/yt-comment';
import type { LineLinkCode, LineStatus } from '@/lib/portal';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, ErrorBox, Field, Input, Pill } from '@/components/ui';
import { LinkCodeBox, TypePicker } from '@/components/portal-view';

export function LineSettings() {
  const { ws, can } = useWorkspace(); const manage = can('workspace.manage'); const base = `/workspaces/${ws.id}/line`;
  const [st, setSt] = useState<LineStatus | null>(null); const [f, setF] = useState({ channelSecret: '', accessToken: '' }); const [editing, setEditing] = useState(false);
  const [code, setCode] = useState<LineLinkCode | null>(null); const [msg, setMsg] = useState(''); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => (manage ? api<LineStatus>(base).then(setSt).catch(setError) : Promise.resolve()), [base, manage]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>, done?: string) => { setBusy(true); setError(null); setMsg(''); try { await fn(); if (done) setMsg(done); await load(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const save = (e: FormEvent) => { e.preventDefault(); void run(async () => { await api(base, { method: 'PUT', body: f }); setF({ channelSecret: '', accessToken: '' }); setEditing(false); }, t('line.saved')); };
  const linkMe = () => void run(async () => setCode(await api<LineLinkCode>(`${base}/link-code`, { method: 'POST' })));

  if (!manage) return (
    <Card title={`🔔 ${t('line.title')}`}>
      <p className="text-sm text-slate-400">{t('line.memberHint')}</p>
      <Button className="mt-2" disabled={busy} onClick={linkMe}>{t('line.linkMine')}</Button>
      {code && <div className="mt-2"><LinkCodeBox code={code} /></div>}
      <ErrorBox error={error} />
    </Card>
  );
  if (!st) return <Card title={`🔔 ${t('line.title')}`}><ErrorBox error={error} /></Card>;
  return (
    <Card title={`🔔 ${t('line.title')}`} actions={st.configured ? <Pill tone="ok">{st.botName ?? st.botBasicId}</Pill> : <Pill>{t('line.notSet')}</Pill>}>
      <p className="text-sm text-slate-400">{t('line.intro')}</p>
      {(!st.configured || editing) ? (
        <form onSubmit={save} className="mt-3 space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-400">
            <li>{t('line.setup1')}</li><li>{t('line.setup2')}</li><li>{t('line.setup3')}</li><li>{t('line.setup4')}</li>
          </ol>
          <Field label="Channel secret"><Input required value={f.channelSecret} onChange={e => setF(v => ({ ...v, channelSecret: e.target.value }))} autoComplete="off" /></Field>
          <Field label="Channel access token (long-lived)"><Input required type="password" value={f.accessToken} onChange={e => setF(v => ({ ...v, accessToken: e.target.value }))} autoComplete="off" /></Field>
          <p className="text-xs text-slate-500">{t('line.secretNote')}</p>
          <div className="flex gap-2"><Button type="submit" disabled={busy}>{t('line.save')}</Button>{editing && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>}</div>
        </form>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <div className="rounded-lg border border-slate-800 p-3">
            <div className="text-xs text-slate-500">{t('line.webhookUrl')}</div>
            <div className="flex flex-wrap items-center gap-2"><code className="break-all text-xs">{st.webhookUrl}</code><Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copyText(st.webhookUrl ?? '').then(ok => setMsg(ok ? t('line.copied') : ''))}>{t('line.copy')}</Button></div>
            <p className="mt-1 text-xs text-slate-500">{t('line.webhookHint')}</p>
          </div>
          <p className="text-xs text-slate-500">{t('line.statMonth')} {st.sentThisMonth} · {t('line.statFailed')} {st.failedThisMonth} · {t('line.statCap')} {st.maxPerRecipientPerDay}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={linkMe}>{t('line.linkMine')}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/test`, { method: 'POST' }), t('line.testSent'))}>{t('line.test')}</Button>
            <Button variant="ghost" onClick={() => setEditing(true)}>{t('line.change')}</Button>
            <Button variant="danger" disabled={busy} onClick={() => { if (confirm(t('line.removeConfirm'))) void run(() => api(base, { method: 'DELETE' })); }}>{t('line.remove')}</Button>
          </div>
          {code && <LinkCodeBox code={code} />}
          <div>
            <h3 className="mb-1 text-sm font-semibold">{t('line.recipients')} ({st.recipients.length})</h3>
            {st.recipients.length === 0 ? <p className="text-xs text-slate-500">{t('line.noRecipients')}</p> : (
              <ul className="divide-y divide-slate-800">
                {st.recipients.map(r => (
                  <li key={r.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{r.user?.name ?? r.displayName ?? '—'}</b>
                      {r.clientId ? <Pill>{t('line.owner')} · {r.clientName}</Pill> : <Pill tone="ok">{t('line.team')}</Pill>}
                      {!r.active && <Pill tone="bad">{t('line.inactive')}</Pill>}
                      <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={r.active} onChange={e => void run(() => api(`${base}/recipients/${r.id}`, { method: 'PATCH', body: { active: e.target.checked } }))} />{t('line.active')}</label>
                      <button className="text-xs text-rose-400" onClick={() => void run(() => api(`${base}/recipients/${r.id}`, { method: 'DELETE' }))}>{t('line.unlink')}</button>
                    </div>
                    <TypePicker types={r.clientId ? st.types.client : st.types.team} current={r.types.length ? r.types : r.clientId ? st.types.clientDefault : st.types.team} onChange={types => void run(() => api(`${base}/recipients/${r.id}`, { method: 'PATCH', body: { types } }))} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-emerald-400">{msg}</p>}
      <ErrorBox error={error} />
    </Card>
  );
}
