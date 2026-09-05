'use client';
import { useCallback, useEffect, useState } from 'react';
import { YT_COMMENT_CLASSES } from '@fbpm/shared';
import { api, type YtChannel, type YtCluster, type YtComment, type YtCommentInsights } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Loading, Pill, Select, Textarea } from '@/components/ui';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const classTone = (c: string | null): 'ok' | 'warn' | 'bad' | 'muted' => (c === 'PRODUCT_INTEREST' || c === 'SERVICE_INTEREST' ? 'ok' : c === 'CRITICISM' || c === 'FACT_CHALLENGE' ? 'bad' : c === 'SPAM' || c === 'PRAISE' ? 'muted' : c ? 'warn' : 'muted');

export default function YtCommentsPage() {
  const { ws, can } = useWorkspace();
  const [channels, setChannels] = useState<YtChannel[] | null>(null); const [rows, setRows] = useState<YtComment[] | null>(null); const [clusters, setClusters] = useState<YtCluster[]>([]); const [ins, setIns] = useState<YtCommentInsights | null>(null);
  const [filter, setFilter] = useState({ channelId: '', classification: '', unresolved: '1' }); const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams(); Object.entries(filter).forEach(([k, v]) => { if (v) q.set(k, v); });
      const cq = new URLSearchParams(); if (filter.channelId) cq.set('channelId', filter.channelId); const iq = new URLSearchParams({ days: '30' }); if (filter.channelId) iq.set('channelId', filter.channelId);
      const [c, r, cl, i] = await Promise.all([api<YtChannel[]>(`/workspaces/${ws.id}/youtube/channels`), api<YtComment[]>(`/workspaces/${ws.id}/youtube/comments?${q}`), api<YtCluster[]>(`/workspaces/${ws.id}/youtube/comments/clusters?${cq}`), api<YtCommentInsights>(`/workspaces/${ws.id}/youtube/comments/insights?${iq}`)]);
      setChannels(c.filter(x => !x.disconnectedAt)); setRows(r); setClusters(cl); setIns(i);
    } catch (e) { setError(e); }
  }, [ws.id, filter]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const targets = () => (filter.channelId ? [filter.channelId] : (channels ?? []).map(c => c.id));
  const sync = () => run('sync', async () => { let n = 0; for (const id of targets()) { const r = await api<{ imported: number; updated: number }>(`/workspaces/${ws.id}/youtube/channels/${id}/comments/sync`, { method: 'POST', body: {} }); n += r.imported + r.updated; } setNotice(`${t('comments.sync')}: ${n}`); });
  const classify = () => run('classify', async () => { const r = await api<{ classified: number; leads: number; autoReplied: number }>(`/workspaces/${ws.id}/youtube/comments/classify`, { method: 'POST', body: { ...(filter.channelId && { channelId: filter.channelId }), limit: 25 } }); setNotice(`${r.classified} จำแนก · ${r.leads} ลีด · ${r.autoReplied} ตอบอัตโนมัติ`); });
  const cluster = () => run('cluster', async () => { for (const id of targets()) await api(`/workspaces/${ws.id}/youtube/channels/${id}/comments/cluster`, { method: 'POST', body: {} }); });
  const idea = (cl: YtCluster) => run(`idea:${cl.id}`, async () => { await api(`/workspaces/${ws.id}/youtube/comments/clusters/${cl.id}/idea`, { method: 'POST', body: {} }); setNotice(`${t('yt.makeIdea')} ✔ ${cl.label}`); });
  const send = (c: YtComment) => run(`send:${c.id}`, async () => { await api(`/workspaces/${ws.id}/youtube/comments/${c.id}/reply`, { method: 'POST', body: { message: drafts[c.id] ?? c.draftReply ?? undefined } }); });
  const saveDraft = (c: YtComment) => run(`draft:${c.id}`, async () => { await api(`/workspaces/${ws.id}/youtube/comments/${c.id}`, { method: 'PATCH', body: { draftReply: drafts[c.id] ?? '' } }); });
  const resolve = (c: YtComment) => run(`res:${c.id}`, async () => { await api(`/workspaces/${ws.id}/youtube/comments/${c.id}`, { method: 'PATCH', body: { resolved: !c.resolvedAt } }); });
  if (!channels || !rows || !ins) return <div><ErrorBox error={error} /><Loading /></div>;
  const reply = can('youtube.comments.reply'); const oauth = channels.filter(c => !filter.channelId || c.id === filter.channelId).some(c => c.accessMode === 'OAUTH');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('yt.commentsTitle')}</h1><p className="text-sm text-slate-400">{t('yt.commentsSubtitle')}</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy === 'sync' || !channels.length} onClick={sync}>{t('comments.sync')}</Button>{can('ai.use') && <><Button disabled={busy === 'classify' || ins.unclassified === 0} onClick={classify}>{t('comments.classify')} ({ins.unclassified})</Button><Button variant="ghost" disabled={busy === 'cluster'} onClick={cluster}>{t('yt.cluster')}</Button></>}</div>
      </div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      {!oauth && channels.length > 0 && <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200">{t('yt.modeApiKey')} — อ่านคอมเมนต์สาธารณะได้ แต่ตอบไม่ได้ (ต้อง OAuth ของเจ้าของช่อง)</p>}
      <ErrorBox error={error} />
      <div className="grid gap-3 md:grid-cols-3">
        <Card title={t('comments.insights')} className="md:col-span-2">
          {ins.total === 0 ? <Empty /> : <div className="space-y-1 text-sm">{ins.distribution.map(d => <div key={d.classification} className="flex items-center gap-2"><span className="w-28 text-xs text-slate-400">{t(`ycc.${d.classification}` as MessageKey)}</span><div className="h-3 flex-1 rounded bg-slate-800"><div className="h-3 rounded bg-rose-500" style={{ width: `${d.share}%` }} /></div><span className="w-10 text-right text-xs">{d.count}</span></div>)}</div>}
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{ins.unresolved}</div><div className="text-xs text-slate-400">{t('comments.unresolved')}</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{ins.drafted}</div><div className="text-xs text-slate-400">{t('comments.draft')}</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{clusters.length}</div><div className="text-xs text-slate-400">{t('yt.clusters')}</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{ins.total}</div><div className="text-xs text-slate-400">30 วัน</div></div>
        </div>
      </div>
      {clusters.length > 0 && <Card title={t('yt.clusters')}><div className="grid gap-2 md:grid-cols-2">{clusters.map(cl => <div key={cl.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 p-2 text-sm"><div><div className="font-medium">{cl.label} <span className="text-xs text-slate-500">×{cl.count}</span> <Pill tone="muted">{cl.kind}</Pill></div>{cl.description && <div className="text-xs text-slate-400">{cl.description}</div>}</div>{can('youtube.content.create') && <Button variant="ghost" disabled={busy === `idea:${cl.id}`} onClick={() => idea(cl)}>{t('yt.makeIdea')}</Button>}</div>)}</div></Card>}
      <div className="flex flex-wrap gap-2">
        <Select className="w-auto" value={filter.channelId} onChange={e => setFilter(v => ({ ...v, channelId: e.target.value }))}><option value="">{t('yt.channel')}: {t('content.all')}</option>{channels.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>
        <Select className="w-auto" value={filter.classification} onChange={e => setFilter(v => ({ ...v, classification: e.target.value }))}><option value="">{t('comments.filterClass')}: {t('content.all')}</option>{YT_COMMENT_CLASSES.map(c => <option key={c} value={c}>{t(`ycc.${c}` as MessageKey)}</option>)}</Select>
        <Select className="w-auto" value={filter.unresolved} onChange={e => setFilter(v => ({ ...v, unresolved: e.target.value }))}><option value="1">{t('comments.unresolved')}</option><option value="">{t('content.all')}</option></Select>
      </div>
      {rows.length === 0 ? <Empty text={t('comments.empty')} /> : <div className="space-y-2">{rows.map(c => (
        <div key={c.id} className={`rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm ${c.resolvedAt ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.authorDisplayName ?? '—'}</span><Pill tone={classTone(c.classification)}>{c.classification ? t(`ycc.${c.classification}` as MessageKey) : '—'}</Pill>{c.riskFlag && <Pill tone="bad">{t('comments.risk')}</Pill>}{c.lead && <Pill tone="ok">{t('leads.title')} {c.lead.leadScore}</Pill>}{c.replyStatus === 'SENT' && <Pill tone="ok">{t('comments.sent' as MessageKey)}</Pill>}<span className="text-xs text-slate-500">{fmt(c.publishedAt)} · 👍 {c.likeCount}</span></div>
            {c.video && <a href={`https://www.youtube.com/watch?v=${c.video.youtubeVideoId}&lc=${c.youtubeCommentId}`} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">{t('yt.onVideo')}: {c.video.title.slice(0, 40)}</a>}
          </div>
          <p className="mt-1 whitespace-pre-wrap">{c.text}</p>
          {c.aiSummary && <p className="mt-1 text-xs text-slate-400">AI: {c.aiSummary}</p>}
          {reply && oauth && c.classification !== 'SPAM' && c.replyStatus !== 'SENT' && <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]"><Textarea className="min-h-14" placeholder={t('comments.draft')} value={drafts[c.id] ?? c.draftReply ?? ''} onChange={e => setDrafts(v => ({ ...v, [c.id]: e.target.value }))} /><div className="flex flex-col gap-1"><Button disabled={busy === `send:${c.id}` || !(drafts[c.id] ?? c.draftReply)} onClick={() => send(c)}>{t('comments.send')}</Button><Button variant="ghost" disabled={busy === `draft:${c.id}`} onClick={() => saveDraft(c)}>{t('common.save')}</Button></div></div>}
          <div className="mt-1 flex gap-2 text-xs"><button className="text-slate-400 hover:underline" onClick={() => resolve(c)}>{c.resolvedAt ? t('comments.reopen' as MessageKey) : t('comments.resolve' as MessageKey)}</button></div>
        </div>))}</div>}
    </div>
  );
}
