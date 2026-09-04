'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type PageRow, type ReportDetail, type ReportRow } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Pill, Select } from '@/components/ui';

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const na = (v: number | null) => (v === null ? t('pages.unavailable') : String(v));
export default function ReportsPage() {
  const { ws, can } = useWorkspace();
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [pageId, setPageId] = useState(''); const [month, setMonth] = useState(lastMonth()); const [withAi, setWithAi] = useState(true);
  const [rows, setRows] = useState<ReportRow[]>([]); const [report, setReport] = useState<ReportDetail | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [copied, setCopied] = useState(false);
  const loadPages = useCallback(async () => { try { const p = (await api<PageRow[]>(`/workspaces/${ws.id}/pages`)).filter(x => !x.disconnectedAt); setPages(p); setPageId(v => v || p[0]?.id || ''); } catch (e) { setError(e); } }, [ws.id]);
  const loadRows = useCallback(async () => { if (!pageId) return; try { setRows(await api<ReportRow[]>(`/workspaces/${ws.id}/pages/${pageId}/reports`)); } catch (e) { setError(e); } }, [ws.id, pageId]);
  useEffect(() => { void loadPages(); }, [loadPages]); useEffect(() => { void loadRows(); }, [loadRows]);
  const generate = async () => { setBusy(true); setError(null); try { const r = await api<ReportDetail>(`/workspaces/${ws.id}/pages/${pageId}/reports`, { method: 'POST', body: { month, withAi } }); setReport(r); await loadRows(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const open = (id: string) => api<ReportDetail>(`/workspaces/${ws.id}/reports/${id}`).then(setReport).catch(setError);
  const copy = async () => { if (!report) return; try { await navigator.clipboard.writeText(report.data.text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };
  if (!pages) return <div><ErrorBox error={error} /><Loading /></div>;
  const d = report?.data;
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t('reports.title')}</h1><p className="text-sm text-slate-400">{t('reports.subtitle')}</p></div>
      <ErrorBox error={error} />
      <Card>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label={t('reports.page')}><Select value={pageId} onChange={e => { setPageId(e.target.value); setReport(null); }}>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label={t('reports.month')}><Input type="month" value={month} onChange={e => setMonth(e.target.value)} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={withAi} onChange={e => setWithAi(e.target.checked)} /> {t('reports.withAi')}</label>
          <div className="flex items-end">{can('analytics.read') && <Button disabled={busy || !pageId} onClick={generate}>{busy ? t('reports.generating') : t('reports.generate')}</Button>}</div>
        </div>
        {rows.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-xs">{t('reports.history')}: {rows.map(r => <button key={r.id} onClick={() => open(r.id)} className={`rounded-full border px-2 py-0.5 ${report?.id === r.id ? 'border-sky-500 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>{r.label} · {r.posts} โพสต์{r.hasSummary ? ' · AI' : ''}</button>)}</div>}
      </Card>
      {!d ? <Empty text={t('reports.none')} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">{d.page.name} — {d.period.label}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">{report!.model && <span>AI: {report!.provider}/{report!.model}</span>}<Button variant="ghost" onClick={copy}>{copied ? `✔ ${t('reports.copied')}` : t('reports.copy')}</Button></div>
          </div>
          {d.summary && <Card title={t('reports.exec')}><p className="whitespace-pre-wrap text-sm">{d.summary.executiveSummary}</p></Card>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Kpi value={d.page.followers ?? '—'} label={t('pages.followers')} />
            <Kpi value={d.publishing.posts} label={`${t('reports.publishing')} (ก่อนหน้า ${d.publishing.postsPrevPeriod})`} tone={d.publishing.posts >= d.publishing.postsPrevPeriod ? 'ok' : 'warn'} />
            <Kpi value={d.publishing.perWeek} label="โพสต์/สัปดาห์" />
            <Kpi value={d.publishing.longestGapDays} label="เว้นนานสุด (วัน)" tone={d.publishing.longestGapDays > 7 ? 'warn' : undefined} />
            <Kpi value={na(d.engagement.sharesTotal)} label={`${t('pages.shares')} รวม`} />
            <Kpi value={`${d.page.completeness}%`} label={t('pages.completeness')} tone={d.page.completeness >= 80 ? 'ok' : 'warn'} />
          </div>
          <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200"><div className="font-semibold">{t('reports.limitations')}</div><ul className="list-disc pl-4">{d.dataLimitations.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title={t('reports.top')}>{d.topPosts.length === 0 ? <Empty /> : <ol className="space-y-2 text-sm">{d.topPosts.map((p, i) => <li key={p.facebookPostId}>{i + 1}. {p.permalink ? <a className="hover:text-sky-400" href={p.permalink} target="_blank" rel="noreferrer">{p.message || p.facebookPostId}</a> : p.message} <Pill tone="ok">{t('pages.shares')} {na(p.shares)}</Pill> <span className="text-xs text-slate-500">{p.mediaType} · {p.pillar ?? '—'}</span></li>)}</ol>}</Card>
            <div className="space-y-4">
              <Card title={t('reports.bottom')}>{d.bottomPosts.length === 0 ? <Empty /> : <ul className="space-y-1 text-sm">{d.bottomPosts.map(p => <li key={p.facebookPostId}>• {p.message || p.facebookPostId} <Pill>{na(p.shares)}</Pill></li>)}</ul>}</Card>
              <Card title={t('reports.pillars')}>{d.pillars.length === 0 ? <Empty /> : <ul className="text-sm">{d.pillars.map(p => <li key={p.pillar} className="flex justify-between border-b border-slate-800 py-1"><span>{p.pillar}</span><span className="text-slate-400">{p.posts} โพสต์ · {t('pages.shares')} {na(p.shares)}</span></li>)}</ul>}</Card>
            </div>
          </div>
          <Card title={t('reports.contentWork')}>
            <div className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">{Object.entries(d.content).map(([k, v]) => <div key={k} className="rounded-lg border border-slate-800 p-2"><div className="text-lg font-bold">{v}</div><div className="text-xs text-slate-500">{k}</div></div>)}</div>
            <p className="mt-2 text-xs text-slate-500">AI: {d.ai.tasks} tasks · ${d.ai.costUsd.toFixed(2)} · โพสต์ผ่านระบบ {d.publishing.bySystem}/{d.publishing.posts}</p>
          </Card>
          {d.summary && (
            <Card title={t('reports.next')}>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                {([['whatHappened', 'เกิดอะไรขึ้น'], ['whyItHappened', 'เพราะอะไร'], ['repeat', 'ควรทำซ้ำ'], ['stop', 'ควรหยุด'], ['experiments', 'ทดลอง'], ['nextMonthFocus', 'เดือนหน้าเน้น']] as const).map(([k, label]) => d.summary![k].length > 0 && <div key={k}><div className="mb-1 text-xs text-slate-500">{label}</div><ul className="list-disc pl-4">{d.summary![k].map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}
              </div>
            </Card>
          )}
          {!d.summary && d.analysis && <Card title={t('analysis.recommendations')}><ul className="list-disc pl-4 text-sm">{d.analysis.recommendations.slice(0, 5).map((r, i) => <li key={i}>{r.title}{r.action && ` — ${r.action}`}</li>)}</ul></Card>}
          <Card title={t('reports.text')}><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-300">{d.text}</pre></Card>
        </div>
      )}
    </div>
  );
}
