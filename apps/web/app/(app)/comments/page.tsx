'use client';
import { useCallback, useEffect, useState } from 'react';
import { COMMENT_CLASSES } from '@fbpm/shared';
import { api, type CommentInsights, type CommentRow, type PageRow } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Loading, Pill, Select, Textarea } from '@/components/ui';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const classTone = (c: string | null): 'ok' | 'warn' | 'bad' | 'muted' => (c === 'LEAD' || c === 'PRICE_QUERY' || c === 'SERVICE_QUERY' ? 'ok' : c === 'COMPLAINT' ? 'bad' : c === 'SPAM' ? 'muted' : c ? 'warn' : 'muted');

export default function CommentsPage() {
  const { ws, can } = useWorkspace();
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [filter, setFilter] = useState({ pageId: '', classification: '', unresolved: '1' });
  const [rows, setRows] = useState<CommentRow[] | null>(null); const [ins, setIns] = useState<CommentInsights | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams(); if (filter.pageId) q.set('pageId', filter.pageId); if (filter.classification) q.set('classification', filter.classification); if (filter.unresolved) q.set('unresolved', filter.unresolved);
      const iq = new URLSearchParams({ days: '30' }); if (filter.pageId) iq.set('pageId', filter.pageId);
      const [p, c, i] = await Promise.all([api<PageRow[]>(`/workspaces/${ws.id}/pages`), api<CommentRow[]>(`/workspaces/${ws.id}/comments?${q}`), api<CommentInsights>(`/workspaces/${ws.id}/comments/insights?${iq}`)]);
      setPages(p.filter(x => !x.disconnectedAt)); setRows(c); setIns(i);
    } catch (e) { setError(e); }
  }, [ws.id, filter]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const sync = () => run('sync', async () => { const targets = filter.pageId ? [filter.pageId] : (pages ?? []).map(p => p.id); let imported = 0; for (const id of targets) { const r = await api<{ imported: number }>(`/workspaces/${ws.id}/pages/${id}/comments/sync`, { method: 'POST', body: { days: 30 } }); imported += r.imported; } setNotice(`+${imported}`); });
  const classify = () => run('classify', async () => { const r = await api<{ classified: number; leads: number; autoReplied: number }>(`/workspaces/${ws.id}/comments/classify`, { method: 'POST', body: { ...(filter.pageId && { pageId: filter.pageId }), limit: 20 } }); setNotice(`${r.classified} จำแนก · ${r.leads} ลีด · ${r.autoReplied} ตอบอัตโนมัติ`); });
  const send = (c: CommentRow) => run(`send:${c.id}`, async () => { await api(`/workspaces/${ws.id}/comments/${c.id}/reply`, { method: 'POST', body: { message: drafts[c.id] ?? c.draftReply ?? undefined } }); });
  const hide = (c: CommentRow) => run(`hide:${c.id}`, async () => { await api(`/workspaces/${ws.id}/comments/${c.id}/${c.isHidden ? 'unhide' : 'hide'}`, { method: 'POST', body: {} }); });
  const resolve = (c: CommentRow) => run(`res:${c.id}`, async () => { await api(`/workspaces/${ws.id}/comments/${c.id}`, { method: 'PATCH', body: { resolved: !c.resolvedAt } }); });
  const saveDraft = (c: CommentRow) => run(`draft:${c.id}`, async () => { await api(`/workspaces/${ws.id}/comments/${c.id}`, { method: 'PATCH', body: { draftReply: drafts[c.id] ?? '' } }); });
  if (!pages || !rows || !ins) return <div><ErrorBox error={error} /><Loading /></div>;
  const noPerm = pages.filter(p => !filter.pageId || p.id === filter.pageId).some(p => p.commentsStatus === 'NO_PERMISSION');
  const reply = can('comments.reply');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('comments.title')}</h1><p className="text-sm text-slate-400">{t('comments.subtitle')}</p></div>
        <div className="flex gap-2"><Button variant="ghost" disabled={busy === 'sync'} onClick={sync}>{t('comments.sync')}</Button>{can('ai.use') && <Button disabled={busy === 'classify' || ins.unclassified === 0} onClick={classify}>{t('comments.classify')} ({ins.unclassified})</Button>}</div>
      </div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      {noPerm && <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200">{t('comments.noPermission')}</p>}
      <ErrorBox error={error} />
      <div className="grid gap-3 md:grid-cols-3">
        <Card title={t('comments.insights')} className="md:col-span-2">
          {ins.total === 0 ? <Empty /> : (
            <div className="space-y-1 text-sm">{ins.distribution.map(d => <div key={d.classification} className="flex items-center gap-2"><span className="w-24 text-xs text-slate-400">{t(`cc.${d.classification}` as MessageKey)}</span><div className="h-3 flex-1 rounded bg-slate-800"><div className="h-3 rounded bg-sky-500" style={{ width: `${d.share}%` }} /></div><span className="w-16 text-right text-xs">{d.share}% ({d.count})</span></div>)}</div>
          )}
          {ins.recommendations.length > 0 && <div className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-2 text-xs text-emerald-200"><div className="font-semibold">{t('comments.recommend')}</div><ul className="list-disc pl-4">{ins.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{ins.unresolved}</div><div className="text-xs text-slate-400">{t('comments.unresolved')}</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{ins.drafted}</div><div className="text-xs text-slate-400">{t('comments.draft')}</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{ins.leadsNew}</div><div className="text-xs text-slate-400">{t('leads.title')} ({t('ls.NEW')})</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{ins.total}</div><div className="text-xs text-slate-400">30 วัน</div></div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select className="w-auto" value={filter.pageId} onChange={e => setFilter(v => ({ ...v, pageId: e.target.value }))}><option value="">{t('content.filterPage')}: {t('content.all')}</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select className="w-auto" value={filter.classification} onChange={e => setFilter(v => ({ ...v, classification: e.target.value }))}><option value="">{t('comments.filterClass')}: {t('content.all')}</option>{COMMENT_CLASSES.map(c => <option key={c} value={c}>{t(`cc.${c}` as MessageKey)}</option>)}</Select>
        <Select className="w-auto" value={filter.unresolved} onChange={e => setFilter(v => ({ ...v, unresolved: e.target.value }))}><option value="1">{t('comments.unresolved')}</option><option value="">{t('content.all')}</option></Select>
      </div>
      {rows.length === 0 ? <Empty text={t('comments.empty')} /> : (
        <div className="space-y-2">{rows.map(c => (
          <div key={c.id} className={`rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm ${c.resolvedAt ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.fromName ?? '—'}</span><Pill tone={classTone(c.classification)}>{c.classification ? t(`cc.${c.classification}` as MessageKey) : '—'}</Pill>{c.riskFlag && <Pill tone="bad">{t('comments.risk')}</Pill>}{c.lead && <Pill tone="ok">{t('leads.title')} {c.lead.leadScore}</Pill>}{c.replyStatus === 'SENT' && <Pill tone="ok">{t('comments.sent')}</Pill>}{c.isHidden && <Pill>hidden</Pill>}<span className="text-xs text-slate-500">{c.page.name} · {fmt(c.createdTime)}</span></div>
              {c.permalink && <a href={c.permalink} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">{t('pages.openFb')}</a>}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{c.message}</p>
            {c.post?.message && <p className="mt-1 text-xs text-slate-500">{t('comments.onPost')}: {c.post.message.slice(0, 100)}</p>}
            {c.aiSummary && <p className="mt-1 text-xs text-slate-400">AI: {c.aiSummary}</p>}
            {reply && c.classification !== 'SPAM' && c.replyStatus !== 'SENT' && (
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                <Textarea className="min-h-14" placeholder={t('comments.draft')} value={drafts[c.id] ?? c.draftReply ?? ''} onChange={e => setDrafts(v => ({ ...v, [c.id]: e.target.value }))} />
                <div className="flex flex-col gap-1"><Button disabled={busy === `send:${c.id}` || !(drafts[c.id] ?? c.draftReply)} onClick={() => send(c)}>{t('comments.send')}</Button><Button variant="ghost" disabled={busy === `draft:${c.id}`} onClick={() => saveDraft(c)}>{t('common.save')}</Button></div>
              </div>
            )}
            {c.replyStatus === 'SENT' && c.draftReply && <p className="mt-2 rounded bg-emerald-950/30 p-2 text-xs text-emerald-200">↩ {c.draftReply}</p>}
            {reply && <div className="mt-2 flex gap-3 text-xs"><button onClick={() => resolve(c)} className="text-slate-400 hover:text-sky-400">{c.resolvedAt ? t('comments.reopen') : t('comments.resolve')}</button><button onClick={() => hide(c)} className="text-slate-400 hover:text-rose-400">{c.isHidden ? t('comments.unhide') : t('comments.hide')}</button></div>}
          </div>))}</div>
      )}
    </div>
  );
}
