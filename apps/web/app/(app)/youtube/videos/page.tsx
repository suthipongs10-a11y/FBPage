'use client';
import { useCallback, useEffect, useState } from 'react';
import { YT_VIDEO_TYPES } from '@fbpm/shared';
import { api, type YtChannel, type YtVideo, type YtVideoDetail } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select, Textarea } from '@/components/ui';

const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('th-TH'));
const dur = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '—');

export default function YtVideosPage() {
  const { ws, can } = useWorkspace();
  const [channels, setChannels] = useState<YtChannel[] | null>(null); const [rows, setRows] = useState<YtVideo[] | null>(null);
  const [filter, setFilter] = useState({ channelId: '', type: '', sort: 'published', q: '' });
  const [sel, setSel] = useState<YtVideoDetail | null>(null); const [edit, setEdit] = useState<{ title: string; description: string; tags: string; privacyStatus: string } | null>(null); const [pillar, setPillar] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams(); Object.entries(filter).forEach(([k, v]) => { if (v) q.set(k, v); });
      const [c, v] = await Promise.all([api<YtChannel[]>(`/workspaces/${ws.id}/youtube/channels`), api<YtVideo[]>(`/workspaces/${ws.id}/youtube/videos?${q}`)]);
      setChannels(c); setRows(v);
    } catch (e) { setError(e); }
  }, [ws.id, filter]);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => { setError(null); try { const d = await api<YtVideoDetail>(`/workspaces/${ws.id}/youtube/videos/${id}`); setSel(d); setEdit(null); setPillar(d.contentPillar ?? ''); } catch (e) { setError(e); } };
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); if (sel) await open(sel.id); } catch (e) { setError(e); } finally { setBusy(''); } };
  const saveMeta = () => sel && edit && run('meta', async () => { await api(`/workspaces/${ws.id}/youtube/videos/${sel.id}/metadata`, { method: 'PATCH', body: { title: edit.title, description: edit.description, tags: edit.tags.split(',').map(x => x.trim()).filter(Boolean), privacyStatus: edit.privacyStatus } }); setNotice(t('common.saved' as MessageKey)); setEdit(null); });
  const savePillar = () => sel && run('pillar', async () => { await api(`/workspaces/${ws.id}/youtube/videos/${sel.id}/pillar`, { method: 'PATCH', body: { contentPillar: pillar || null } }); });
  if (!channels || !rows) return <div><ErrorBox error={error} /><Loading /></div>;
  const canEdit = can('youtube.metadata.edit') && sel?.channel.accessMode === 'OAUTH';
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t('yt.videosTitle')}</h1><p className="text-sm text-slate-400">{t('yt.videosSubtitle')}</p></div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        <Select className="w-auto" value={filter.channelId} onChange={e => setFilter(f => ({ ...f, channelId: e.target.value }))}><option value="">{t('yt.channel')}: {t('content.all')}</option>{channels.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>
        <Select className="w-auto" value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}><option value="">{t('yt.type')}: {t('content.all')}</option>{YT_VIDEO_TYPES.map(x => <option key={x} value={x}>{t(`ytf.${x}` as MessageKey)}</option>)}</Select>
        <Select className="w-auto" value={filter.sort} onChange={e => setFilter(f => ({ ...f, sort: e.target.value }))}><option value="published">{t('yt.sort')}: {t('yt.sortPublished')}</option><option value="views">{t('yt.sortViews')}</option><option value="subs">{t('yt.sortSubs')}</option><option value="avd">{t('yt.sortAvd')}</option></Select>
        <Input className="w-56" placeholder="ค้นหาชื่อ…" value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_420px]">
        {rows.length === 0 ? <Empty text={t('yt.noVideos')} /> : (
          <div className="overflow-x-auto rounded-xl border border-slate-800"><table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs text-slate-400"><tr><th className="p-2">{t('yt.videos')}</th><th className="p-2">{t('yt.type')}</th><th className="p-2 text-right">{t('yt.views')}</th><th className="p-2 text-right">{t('yt.avd')}</th><th className="p-2 text-right">{t('yt.avp')}</th><th className="p-2 text-right">{t('yt.subsGained')}</th><th className="p-2 text-right">{t('yt.comments')}</th><th className="p-2">{t('yt.pillar')}</th></tr></thead>
            <tbody>{rows.map(v => (
              <tr key={v.id} onClick={() => open(v.id)} className={`cursor-pointer border-t border-slate-800 hover:bg-slate-900 ${sel?.id === v.id ? 'bg-slate-900' : ''}`}>
                <td className="p-2"><div className="flex items-center gap-2">{v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="h-9 w-16 rounded object-cover" />}<div><div className="font-medium">{v.title}</div><div className="text-xs text-slate-500">{fmt(v.publishedAt)} · {dur(v.durationSeconds)} · {v.channel.title}{v.source === 'app' && ' · ระบบ'}{v.availability !== 'AVAILABLE' && ` · ${v.availability}`}</div></div></div></td>
                <td className="p-2"><Pill tone={v.videoType === 'SHORT' ? 'warn' : 'muted'}>{t(`ytf.${v.videoType}` as MessageKey)}</Pill></td>
                <td className="p-2 text-right">{num(v.stats.views)}</td><td className="p-2 text-right">{dur(v.stats.avgViewDuration)}</td><td className="p-2 text-right">{v.stats.avgViewPct === null ? '—' : `${Math.round(v.stats.avgViewPct)}%`}</td><td className="p-2 text-right">{num(v.stats.subscribersGained)}</td><td className="p-2 text-right">{num(v.stats.comments ?? v.commentCount)}</td>
                <td className="p-2 text-xs">{v.contentPillar ?? '—'}{v.pillarManual && ' ✎'}</td>
              </tr>))}</tbody>
          </table></div>)}
        <div>{sel && (
          <Card title={sel.title} actions={<a className="text-xs text-sky-400 hover:underline" href={`https://www.youtube.com/watch?v=${sel.youtubeVideoId}`} target="_blank" rel="noreferrer">{t('yt.openYt')}</a>}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">{([['yt.views', num(sel.stats.views)], ['yt.avd', dur(sel.stats.avgViewDuration)], ['yt.avp', sel.stats.avgViewPct === null ? '—' : `${Math.round(sel.stats.avgViewPct)}%`], ['yt.subsGained', num(sel.stats.subscribersGained)], ['yt.likes', num(sel.stats.likes)], ['yt.comments', num(sel.stats.comments ?? sel.commentCount)]] as [MessageKey, string][]).map(([k, v]) => <div key={k} className="rounded-lg border border-slate-800 p-2"><div className="text-base font-semibold">{v}</div><div className="text-slate-500">{t(k)}</div></div>)}</div>
              {sel.channel.accessMode !== 'OAUTH' && <p className="text-xs text-amber-300">{t('yt.modeApiKey')} — AVD / sub+ / watch time ไม่มีข้อมูล</p>}
              {sel.packaging && <div className="rounded-lg border border-slate-800 p-2"><div className="text-xs text-slate-400">{t('yt.packaging')}</div><div className="font-medium">{sel.packaging.diagnosis} <Pill tone="muted">{sel.packaging.confidence}</Pill></div><div className="text-xs text-slate-400">{sel.packaging.hypothesis}</div></div>}
              <div className="flex items-end gap-2"><Field label={t('yt.pillar')}><Input value={pillar} onChange={e => setPillar(e.target.value)} /></Field>{can('youtube.content.edit') && <Button variant="ghost" disabled={busy === 'pillar'} onClick={savePillar}>{t('common.save')}</Button>}</div>
              {sel.recommendations.length > 0 && <div><div className="text-xs text-slate-400">{t('yt.recommendations')}</div><ul className="list-disc pl-4 text-xs">{sel.recommendations.map(r => <li key={r.id}><span className="text-slate-300">{r.actionType}</span> {r.title} <span className="text-slate-500">({r.status})</span></li>)}</ul></div>}
              <details><summary className="cursor-pointer text-xs text-slate-400">{t('yt.timeline')} ({sel.timeline.length})</summary><div className="mt-1 max-h-40 overflow-auto text-xs">{sel.timeline.map((s, i) => <div key={i} className="flex justify-between border-t border-slate-800 py-0.5"><span>{new Date(s.capturedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })} · {s.window} · {s.source}</span><span>{t('yt.views')} {num(s.metricsJson.views?.value ?? null)}</span></div>)}</div></details>
              {canEdit && (edit ? (
                <div className="space-y-2 rounded-lg border border-slate-800 p-2">
                  <Field label={t('content.titleField')}><Input value={edit.title} maxLength={100} onChange={e => setEdit(v => v && ({ ...v, title: e.target.value }))} /></Field>
                  <Field label={t('yt.description')}><Textarea className="min-h-32" value={edit.description} onChange={e => setEdit(v => v && ({ ...v, description: e.target.value }))} /></Field>
                  <Field label={t('yt.tags')}><Input value={edit.tags} onChange={e => setEdit(v => v && ({ ...v, tags: e.target.value }))} /></Field>
                  <Field label={t('yt.privacy')}><Select value={edit.privacyStatus} onChange={e => setEdit(v => v && ({ ...v, privacyStatus: e.target.value }))}><option value="public">public</option><option value="unlisted">unlisted</option><option value="private">private</option></Select></Field>
                  <div className="flex gap-2"><Button disabled={busy === 'meta'} onClick={saveMeta}>{t('common.save')}</Button><Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</Button></div>
                </div>
              ) : <Button variant="ghost" onClick={() => setEdit({ title: sel.title, description: sel.description ?? '', tags: sel.tags.join(', '), privacyStatus: sel.privacyStatus ?? 'public' })}>{t('yt.editMeta')}</Button>)}
            </div>
          </Card>)}</div>
      </div>
    </div>
  );
}
