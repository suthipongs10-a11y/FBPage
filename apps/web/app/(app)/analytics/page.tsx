'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type PageRow, type YtChannel } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Bars, Line, SERIES, type Point } from '@/components/charts';
import { Card, Empty, ErrorBox, Kpi, Loading, Select } from '@/components/ui';

interface FbTrends { page: { id: string; name: string; followers: number | null }; weeks: { start: string; posts: number; bySystem: number; shares: number | null; reactions: number | null; comments: number | null }[]; available: { shares: boolean; reactions: boolean; comments: boolean }; limitations: string[] }
interface YtTrends { channel: { id: string; title: string; subscribers: number | null; accessMode: string }; weeks: { start: string; videos: number; shorts: number; bySystem: number; views: number | null }[]; channelSeries: { at: string; subscribers: number | null; views: number | null }[]; limitations: string[] }
const wk = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

/** วิเคราะห์แนวโน้ม (§36) — กราฟจากข้อมูลที่ซิงก์ไว้เท่านั้น ไม่ยิง API ตอนเปิด; series เดียวต่อกราฟ */
export default function AnalyticsPage() {
  const { ws } = useWorkspace();
  const [pages, setPages] = useState<PageRow[] | null>(null); const [channels, setChannels] = useState<YtChannel[] | null>(null);
  const [pageId, setPageId] = useState(''); const [channelId, setChannelId] = useState(''); const [weeks, setWeeks] = useState(12);
  const [fb, setFb] = useState<FbTrends | null>(null); const [yt, setYt] = useState<YtTrends | null>(null); const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<PageRow[]>(`/workspaces/${ws.id}/pages`).then(p => { const a = p.filter(x => !x.disconnectedAt); setPages(a); setPageId(v => v || a[0]?.id || ''); }).catch(e => { setError(e); setPages([]); });
    api<YtChannel[]>(`/workspaces/${ws.id}/youtube/channels`).then(c => { const a = c.filter(x => !x.disconnectedAt); setChannels(a); setChannelId(v => v || a[0]?.id || ''); }).catch(() => setChannels([]));
  }, [ws.id]);
  const load = useCallback(async () => {
    try {
      setFb(pageId ? await api<FbTrends>(`/workspaces/${ws.id}/pages/${pageId}/trends?weeks=${weeks}`) : null);
      setYt(channelId ? await api<YtTrends>(`/workspaces/${ws.id}/youtube/channels/${channelId}/trends?weeks=${weeks}`) : null);
    } catch (e) { setError(e); }
  }, [ws.id, pageId, channelId, weeks]);
  useEffect(() => { void load(); }, [load]);
  if (!pages || !channels) return <div><ErrorBox error={error} /><Loading /></div>;
  const pts = <T,>(rows: T[], label: (r: T) => string, value: (r: T) => number | null, hint?: (r: T) => string): Point[] => rows.map(r => ({ label: label(r), value: value(r), hint: hint?.(r) }));
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t('analytics.title')}</h1><p className="text-sm text-slate-400">{t('analytics.subtitle')}</p></div>
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        <Select className="w-auto" value={pageId} onChange={e => setPageId(e.target.value)}><option value="">{t('content.filterPage')}: —</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select className="w-auto" value={channelId} onChange={e => setChannelId(e.target.value)}><option value="">{t('yt.channel')}: —</option>{channels.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>
        <Select className="w-auto" value={weeks} onChange={e => setWeeks(Number(e.target.value))}>{[8, 12, 26, 52].map(w => <option key={w} value={w}>{w} {t('analytics.weeks')}</option>)}</Select>
      </div>
      {pages.length === 0 && channels.length === 0 && <Empty text={t('analytics.empty')} />}
      {fb && (
        <Card title={`Facebook · ${fb.page.name}`}>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi value={fb.page.followers ?? '—'} label={t('pages.followers')} />
            <Kpi value={fb.weeks.reduce((n, w) => n + w.posts, 0)} label={`${t('analytics.posts')} · ${weeks} ${t('analytics.weeks')}`} />
            <Kpi value={fb.available.shares ? fb.weeks.reduce((n, w) => n + (w.shares ?? 0), 0) : '—'} label={t('pages.shares')} tone={fb.available.shares ? undefined : 'warn'} />
            <Kpi value={fb.weeks.reduce((n, w) => n + w.bySystem, 0)} label={t('analytics.bySystem')} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Bars title={t('analytics.postsPerWeek')} unit={t('analytics.posts')} color={SERIES.facebook} points={pts(fb.weeks, w => wk(w.start), w => w.posts, w => `${t('analytics.bySystem')} ${w.bySystem}`)} />
            <Bars title={t('analytics.sharesPerWeek')} unit={t('pages.shares')} color={SERIES.facebook} points={pts(fb.weeks, w => wk(w.start), w => w.shares)} note={fb.available.shares ? undefined : t('analytics.unavailable')} />
          </div>
          <ul className="mt-2 list-disc pl-4 text-[11px] text-slate-500">{fb.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Card>)}
      {yt && (
        <Card title={`YouTube · ${yt.channel.title}`}>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi value={yt.channel.subscribers ?? '—'} label={t('yt.subscribers')} />
            <Kpi value={yt.weeks.reduce((n, w) => n + w.videos, 0)} label={`${t('yt.videos')} · ${weeks} ${t('analytics.weeks')}`} />
            <Kpi value={yt.weeks.reduce((n, w) => n + w.shorts, 0)} label="Shorts" />
            <Kpi value={yt.weeks.reduce((n, w) => n + w.bySystem, 0)} label={t('analytics.bySystem')} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Bars title={t('analytics.videosPerWeek')} unit={t('yt.videos')} color={SERIES.youtube} points={pts(yt.weeks, w => wk(w.start), w => w.videos, w => `Shorts ${w.shorts}`)} />
            <Bars title={t('analytics.viewsPerWeek')} unit={t('yt.views')} color={SERIES.youtube} points={pts(yt.weeks, w => wk(w.start), w => w.views)} note={yt.limitations[0]} />
            <Line title={t('analytics.subscribers')} unit={t('yt.subscribers')} color={SERIES.youtube} points={pts(yt.channelSeries, s => new Date(s.at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }), s => s.subscribers)} note={yt.channelSeries.length < 2 ? yt.limitations[1] : undefined} />
          </div>
        </Card>)}
    </div>
  );
}
