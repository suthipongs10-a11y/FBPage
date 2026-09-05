'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type YtChannel, type YtReportDetail, type YtReportRow } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Pill, Select } from '@/components/ui';

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const na = (v: number | null) => (v === null ? 'ไม่มีข้อมูล' : Math.round(v).toLocaleString('th-TH'));
export default function YtReportsPage() {
  const { ws, can } = useWorkspace();
  const [channels, setChannels] = useState<YtChannel[] | null>(null); const [channelId, setChannelId] = useState(''); const [month, setMonth] = useState(lastMonth()); const [withAi, setWithAi] = useState(true);
  const [rows, setRows] = useState<YtReportRow[]>([]); const [report, setReport] = useState<YtReportDetail | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [copied, setCopied] = useState(false);
  const loadChannels = useCallback(async () => { try { const c = (await api<YtChannel[]>(`/workspaces/${ws.id}/youtube/channels`)); setChannels(c); setChannelId(v => v || c[0]?.id || ''); } catch (e) { setError(e); } }, [ws.id]);
  const loadRows = useCallback(async () => { if (!channelId) return; try { setRows(await api<YtReportRow[]>(`/workspaces/${ws.id}/youtube/reports?channelId=${channelId}`)); } catch (e) { setError(e); } }, [ws.id, channelId]);
  useEffect(() => { void loadChannels(); }, [loadChannels]); useEffect(() => { void loadRows(); }, [loadRows]);
  const generate = async () => { setBusy(true); setError(null); try { setReport(await api<YtReportDetail>(`/workspaces/${ws.id}/youtube/channels/${channelId}/reports`, { method: 'POST', body: { month, withAi } })); await loadRows(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const open = (id: string) => api<YtReportDetail>(`/workspaces/${ws.id}/youtube/reports/${id}`).then(setReport).catch(setError);
  const [shared, setShared] = useState('');
  const shareLink = async () => { if (!report) return; try { const r = await api<{ url: string }>(`/workspaces/${ws.id}/youtube/reports/${report.id}/share`, { method: 'POST', body: { days: 30 } }); await navigator.clipboard.writeText(r.url).catch(() => undefined); setShared(r.url); setTimeout(() => setShared(''), 6000); } catch (e) { setError(e); } };
  const copy = async () => { if (!report) return; try { await navigator.clipboard.writeText(report.data.text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };
  if (!channels) return <div><ErrorBox error={error} /><Loading /></div>;
  const d = report?.data;
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t('yt.reportsTitle')}</h1><p className="text-sm text-slate-400">{t('yt.reportsSubtitle')}</p></div>
      <ErrorBox error={error} />
      {channels.length === 0 ? <Empty text={t('yt.noChannels')} /> : <Card>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label={t('yt.channel')}><Select value={channelId} onChange={e => { setChannelId(e.target.value); setReport(null); }}>{channels.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
          <Field label={t('reports.month')}><Input type="month" value={month} onChange={e => setMonth(e.target.value)} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={withAi} onChange={e => setWithAi(e.target.checked)} /> {t('reports.withAi')}</label>
          <div className="flex items-end">{can('youtube.analytics.read') && <Button disabled={busy || !channelId} onClick={generate}>{busy ? t('reports.generating') : t('reports.generate')}</Button>}</div>
        </div>
        {rows.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-xs">{t('reports.history')}: {rows.map(r => <button key={r.id} onClick={() => open(r.id)} className={`rounded-full border px-2 py-0.5 ${report?.id === r.id ? 'border-sky-500 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>{r.label} · {r.videos} {t('yt.videos')}{r.hasSummary && ' · AI'}</button>)}</div>}
      </Card>}
      {!d ? <Empty text={t('reports.none')} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{d.channel.title} — {d.period.label}</h2><div className="flex items-center gap-2"><Pill tone={d.channel.accessMode === 'OAUTH' ? 'ok' : 'muted'}>{d.channel.accessMode}</Pill><Button variant="ghost" onClick={copy}>{copied ? t('reports.copied' as MessageKey) : t('reports.copy' as MessageKey)}</Button><a className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800" href={`/api/workspaces/${ws.id}/youtube/reports/${report!.id}/pdf`} target="_blank" rel="noreferrer">{t('reports.pdf')}</a><Button variant="ghost" onClick={shareLink}>{shared ? `✔ ${t('reports.shareCopied')}` : t('reports.share')}</Button></div></div>
          {shared && <p className="break-all text-xs text-sky-300">{shared}</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi value={d.publishing.videos} label={`${t('yt.videos')} (ก่อน ${d.publishing.videosPrevPeriod})`} />
            <Kpi value={na(d.channelMetrics.views)} label={t('yt.views')} tone={d.channelMetrics.views === null ? 'warn' : undefined} />
            <Kpi value={na(d.channelMetrics.watchMinutes)} label="watch time (นาที)" tone={d.channelMetrics.watchMinutes === null ? 'warn' : undefined} />
            <Kpi value={na(d.channelMetrics.subscribersGained)} label={t('yt.subsGained')} tone={d.channelMetrics.subscribersGained === null ? 'warn' : undefined} />
            <Kpi value={d.comments.total} label={`${t('yt.comments')} · ${t('comments.unresolved')} ${d.comments.unresolved}`} />
          </div>
          {d.dataLimitations.length > 0 && <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200"><ul className="list-disc pl-4">{d.dataLimitations.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="วิดีโอเด่น">{d.topVideos.length === 0 ? <Empty /> : <ul className="space-y-1 text-sm">{d.topVideos.map(v => <li key={v.youtubeVideoId} className="flex justify-between gap-2"><a className="text-sky-400 hover:underline" href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer">{v.title}</a><span className="text-xs text-slate-400">{t('yt.views')} {na(v.views)} · AVD {na(v.avgViewDuration)} · sub+ {na(v.subscribersGained)}</span></li>)}</ul>}</Card>
            <Card title="ตามรูปแบบ / งานในระบบ">
              <div className="space-y-1 text-sm">{d.formats.map(f => <div key={f.format} className="flex justify-between"><span>{t(`ytf.${f.format}` as MessageKey)} ×{f.videos}</span><span className="text-xs text-slate-400">วิวกลาง {na(f.medianViews)} · AVD กลาง {na(f.medianAvd)}</span></div>)}</div>
              <div className="mt-2 text-xs text-slate-400">ร่าง {d.content.created} · อนุมัติ {d.content.approved} · อัปโหลด {d.content.uploaded} · เผยแพร่ {d.content.published} · ตั้งเวลา {d.content.scheduledNext} · AI ร่าง {d.content.aiDrafted}</div>
              {d.recommendations.top.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs">{d.recommendations.top.map((r, i) => <li key={i}>{r.title} <span className="text-slate-500">({r.actionType}, {r.confidence})</span></li>)}</ul>}
            </Card>
          </div>
          {d.summary && <Card title={t('reports.exec')}><p className="text-sm">{d.summary.executiveSummary}</p><div className="mt-3 grid gap-3 md:grid-cols-3 text-xs">{([['เกิดอะไรขึ้น', d.summary.whatHappened], ['ทำไม', d.summary.whyItHappened], ['ควรทำซ้ำ', d.summary.repeat], ['ควรหยุด', d.summary.stop], ['ควรทดลอง', d.summary.experiments], ['เดือนหน้าเน้น', d.summary.nextMonthFocus]] as [string, string[]][]).filter(([, xs]) => xs.length).map(([h, xs]) => <div key={h}><div className="font-semibold text-slate-300">{h}</div><ul className="list-disc pl-4">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}</div></Card>}
          <details><summary className="cursor-pointer text-sm text-slate-400">{t('reports.text' as MessageKey)}</summary><pre className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">{d.text}</pre></details>
        </div>)}
    </div>
  );
}
