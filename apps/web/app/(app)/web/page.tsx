'use client';
import { useCallback, useEffect, useState } from 'react';
import { SITE_PLATFORMS } from '@fbpm/shared';
import { api, type BrandLite, type Client, type ClientDetail, type SeoAnalysisResult, type SeoIssue, type SiteDetail, type SiteRow, type SiteTrends, type YtConnection } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Bars, Line, SERIES, type Point } from '@/components/charts';
import { Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Pill, Select } from '@/components/ui';

const WEB_COLOR = SERIES.web;   // amber-700 — สีประจำโมดูลเว็บ (ตรวจกับ validator ร่วมกับสี Facebook/YouTube บนพื้นขาวแล้ว)
const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const statusTone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (s === 'UP' ? 'ok' : s === 'DOWN' ? 'bad' : s === 'DEGRADED' ? 'warn' : 'muted');
const checkTone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (s === 'OK' ? 'ok' : s === 'WARN' ? 'warn' : s === 'FAIL' ? 'bad' : 'muted');
const days = (iso: string | null) => (iso ? Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);
const wk = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

export default function WebPage() {
  const { ws, can } = useWorkspace();
  const [sites, setSites] = useState<SiteRow[] | null>(null); const [brands, setBrands] = useState<(BrandLite & { clientName: string })[]>([]); const [conns, setConns] = useState<YtConnection[]>([]);
  const [form, setForm] = useState({ brandId: '', url: '', expectedText: '', platform: 'UNKNOWN', checkIntervalMin: 15 }); const [showAdd, setShowAdd] = useState(false);
  const [sel, setSel] = useState<SiteDetail | null>(null); const [trends, setTrends] = useState<SiteTrends | null>(null); const [gscConn, setGscConn] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const [s, cl, c] = await Promise.all([api<SiteRow[]>(`/workspaces/${ws.id}/web/sites`), api<Client[]>(`/workspaces/${ws.id}/clients`), api<YtConnection[]>(`/workspaces/${ws.id}/youtube/connections`).catch(() => [] as YtConnection[])]);
      setSites(s); setConns(c.filter(x => x.status === 'ACTIVE')); setGscConn(v => v || c.find(x => x.status === 'ACTIVE')?.id || '');
      const details = await Promise.all(cl.map(x => api<ClientDetail>(`/workspaces/${ws.id}/clients/${x.id}`)));
      const bs = details.flatMap(d => d.brands.map(b => ({ ...b, clientName: d.name }))); setBrands(bs); setForm(f => ({ ...f, brandId: f.brandId || bs[0]?.id || '' }));
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => { setError(null); try { const [d, tr] = await Promise.all([api<SiteDetail>(`/workspaces/${ws.id}/web/sites/${id}`), api<SiteTrends>(`/workspaces/${ws.id}/web/sites/${id}/trends?weeks=12`).catch(() => null)]); setSel(d); setTrends(tr); } catch (e) { setError(e); } };
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); if (sel) await open(sel.id); } catch (e) { setError(e); } finally { setBusy(''); } };
  const create = () => run('create', async () => { const r = await api<SiteDetail>(`/workspaces/${ws.id}/web/sites`, { method: 'POST', body: { brandId: form.brandId, url: form.url, expectedText: form.expectedText || undefined, platform: form.platform, checkIntervalMin: form.checkIntervalMin } }); setShowAdd(false); setForm(f => ({ ...f, url: '', expectedText: '' })); setNotice(`✔ ${r.name} · ${t(`web.status.${r.lastStatus}` as MessageKey)}`); setSel(r); });
  const check = (id: string, kinds: string[]) => run(`check:${id}`, async () => { const r = await api<{ status: string; events: unknown[] }>(`/workspaces/${ws.id}/web/sites/${id}/check`, { method: 'POST', body: { kinds } }); setNotice(`${t('web.checkNow')}: ${t(`web.status.${r.status}` as MessageKey)}${r.events.length ? ` · ${r.events.length} ${t('web.incidents')}` : ''}`); });
  const connectGsc = (id: string) => run(`gsc:${id}`, async () => { const r = await api<SiteDetail & { sync: { days: number; status: string; error?: string } }>(`/workspaces/${ws.id}/web/sites/${id}/search-console`, { method: 'POST', body: { connectionId: gscConn } }); setNotice(`${t('web.search')}: ${r.searchConsoleProperty} · ${r.sync.days} ${t('web.days')}${r.sync.error ? ` · ${r.sync.error}` : ''}`); });
  const syncGsc = (id: string) => run(`sync:${id}`, async () => { const r = await api<{ days: number; status: string; error?: string }>(`/workspaces/${ws.id}/web/sites/${id}/search-console/sync`, { method: 'POST', body: { days: 28 } }); setNotice(`${t('web.syncGsc')}: ${r.status} ${r.days} ${t('web.days')}${r.error ? ` · ${r.error}` : ''}`); });
  const analyze = (id: string) => run(`an:${id}`, async () => { const r = await api<{ result: SeoAnalysisResult }>(`/workspaces/${ws.id}/web/sites/${id}/analyze`, { method: 'POST', body: {} }); setNotice(r.result.summary.slice(0, 160)); });
  const remove = (id: string) => { if (!confirm(t('web.removeConfirm'))) return; void run(`rm:${id}`, async () => { await api(`/workspaces/${ws.id}/web/sites/${id}`, { method: 'DELETE' }); setSel(null); }); };
  if (!sites) return <div><ErrorBox error={error} /><Loading /></div>;
  const manage = can('web.manage'); const active = sites.filter(s => !s.disconnectedAt);
  const seo = sel?.summary.latest.SEO?.details as { issues?: SeoIssue[] } | null | undefined; const psi = sel?.summary.latest.PAGESPEED?.details as { performance?: number | null; lcpMs?: number | null; cls?: number | null } | null | undefined; const links = sel?.summary.latest.LINKS?.details as { broken?: { url: string; status: number | null }[] } | null | undefined;
  const pts = <T,>(rows: T[], label: (r: T) => string, value: (r: T) => number | null): Point[] => rows.map(r => ({ label: label(r), value: value(r) }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('web.title')}</h1><p className="text-sm text-slate-400">{t('web.subtitle')}</p></div>
        {manage && <Button onClick={() => setShowAdd(v => !v)}>{t('web.addSite')}</Button>}
      </div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />
      {showAdd && manage && (
        <Card title={t('web.addSite')}>
          {brands.length === 0 ? <Empty text={t('yt.needBrand')} /> : (
            <div className="grid gap-2 md:grid-cols-5">
              <Field label={t('yt.brand')}><Select value={form.brandId} onChange={e => setForm(f => ({ ...f, brandId: e.target.value }))}>{brands.map(b => <option key={b.id} value={b.id}>{b.clientName} · {b.name}</option>)}</Select></Field>
              <Field label={t('web.url')}><Input placeholder="https://www.example.com" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} /></Field>
              <Field label={t('web.expectedText')} hint={t('web.expectedTextHint')}><Input value={form.expectedText} onChange={e => setForm(f => ({ ...f, expectedText: e.target.value }))} /></Field>
              <Field label={t('web.platform')}><Select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>{SITE_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}</Select></Field>
              <div className="flex items-end gap-2"><Field label={t('web.interval')}><Input type="number" min={5} max={1440} className="w-24" value={form.checkIntervalMin} onChange={e => setForm(f => ({ ...f, checkIntervalMin: Number(e.target.value) }))} /></Field><Button disabled={busy === 'create' || !form.url || !form.brandId} onClick={create}>{busy === 'create' ? t('common.loading') : t('common.save')}</Button></div>
            </div>)}
        </Card>)}
      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-2">
          {active.length === 0 ? <Empty text={t('web.noSites')} /> : active.map(s => (
            <button key={s.id} onClick={() => open(s.id)} className={`block w-full rounded-xl border p-3 text-left text-sm ${sel?.id === s.id ? 'border-sky-600 bg-slate-900' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">{s.name} <span className="text-xs font-normal text-slate-500">{s.url}</span></div><div className="flex gap-1"><Pill tone={statusTone(s.lastStatus)}>{t(`web.status.${s.lastStatus}` as MessageKey)}</Pill>{s._count.incidents > 0 && <Pill tone="bad">{s._count.incidents} {t('web.openIncident')}</Pill>}</div></div>
              <div className="mt-1 text-xs text-slate-500">{s.brand.client.name} · {s.brand.name} · {t('web.latency')} {s.lastLatencyMs ?? '—'} ms · {t('web.ssl')} {days(s.sslExpiresAt) === null ? '—' : `${days(s.sslExpiresAt)} ${t('web.days')}`} · {s.gscStatus === 'OK' ? 'Search Console ✔' : s.gscStatus === 'NO_ACCESS' ? t('web.gscNoAccess') : t('web.gscNone')} · {fmt(s.lastCheckedAt)}</div>
            </button>))}
        </div>
        <div>{sel && (
          <Card title={sel.name} actions={<div className="flex flex-wrap gap-1"><Button variant="ghost" disabled={busy === `check:${sel.id}`} onClick={() => check(sel.id, ['UPTIME', 'SSL', 'SEO'])}>{t('web.checkNow')}</Button><Button variant="ghost" disabled={busy === `check:${sel.id}`} onClick={() => check(sel.id, ['UPTIME', 'SSL', 'SEO', 'LINKS', 'PAGESPEED'])}>{t('web.checkAll')}</Button>{can('web.analytics.read') && can('ai.use') && <Button variant="ghost" disabled={busy === `an:${sel.id}`} onClick={() => analyze(sel.id)}>{t('web.analyze')}</Button>}{manage && <Button variant="danger" onClick={() => remove(sel.id)}>{t('web.remove')}</Button>}</div>}>
            <div className="space-y-3 text-sm">
              <a className="text-xs text-sky-400 hover:underline" href={sel.url} target="_blank" rel="noreferrer">{sel.url}</a>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi value={sel.summary.uptime.availabilityPct === null ? '—' : `${sel.summary.uptime.availabilityPct}%`} label={t('web.availability')} tone={sel.summary.uptime.availabilityPct !== null && sel.summary.uptime.availabilityPct < 99 ? 'warn' : undefined} />
                <Kpi value={sel.summary.uptime.medianLatencyMs === null ? '—' : `${sel.summary.uptime.medianLatencyMs} ms`} label={t('web.latency')} />
                <Kpi value={days(sel.sslExpiresAt) === null ? (sel.summary.latest.SSL?.status === 'SKIPPED' ? 'ไม่ใช่ https' : '—') : `${days(sel.sslExpiresAt)} ${t('web.days')}`} label={t('web.ssl')} tone={days(sel.sslExpiresAt) !== null && days(sel.sslExpiresAt)! <= 14 ? 'bad' : undefined} />
                <Kpi value={psi?.performance ?? '—'} label={t('web.performance')} tone={psi?.performance === undefined || psi?.performance === null ? undefined : psi.performance >= 90 ? 'ok' : psi.performance >= 50 ? 'warn' : 'bad'} />
              </div>
              {trends && <div className="grid gap-2 md:grid-cols-3"><Bars title={t('analytics.availabilityPerWeek')} unit="%" color={WEB_COLOR} height={110} points={pts(trends.weeks, w => wk(w.start), w => w.availabilityPct)} /><Bars title={t('analytics.latencyPerWeek')} unit="ms" color={WEB_COLOR} height={110} points={pts(trends.weeks, w => wk(w.start), w => w.medianLatencyMs)} /><Line title={t('analytics.clicksPerWeek')} unit={t('web.clicks')} color={WEB_COLOR} height={110} points={pts(trends.weeks, w => wk(w.start), w => w.clicks)} note={trends.limitations[0]} /></div>}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-800 p-2"><div className="mb-1 flex items-center justify-between text-xs text-slate-400"><span>{t('web.seoIssues')}</span>{sel.summary.latest.SEO && <Pill tone={checkTone(sel.summary.latest.SEO.status)}>{sel.summary.latest.SEO.status}</Pill>}</div>{seo?.issues?.length ? <ul className="space-y-1 text-xs">{seo.issues.map(i => <li key={i.code} className="flex gap-2"><Pill tone={i.severity === 'high' ? 'bad' : i.severity === 'medium' ? 'warn' : 'muted'}>{i.severity}</Pill><span>{i.message}</span></li>)}</ul> : <p className="text-xs text-slate-500">{sel.summary.latest.SEO ? '✔ ไม่พบปัญหา' : '—'}</p>}</div>
                <div className="rounded-lg border border-slate-800 p-2"><div className="mb-1 text-xs text-slate-400">{t('web.brokenLinks')} · Core Web Vitals</div>{links?.broken?.length ? <ul className="text-xs">{links.broken.map(b => <li key={b.url} className="truncate">✖ {b.status ?? 'ERR'} {b.url}</li>)}</ul> : <p className="text-xs text-slate-500">{sel.summary.latest.LINKS ? '✔ ไม่มีลิงก์เสีย' : '— ยังไม่ตรวจลิงก์'}</p>}<p className="mt-1 text-xs text-slate-500">LCP {psi?.lcpMs ?? '—'} ms · CLS {psi?.cls ?? '—'}{sel.summary.latest.PAGESPEED?.status === 'SKIPPED' && ` · ${sel.summary.latest.PAGESPEED.error}`}</p></div>
              </div>
              {/* ---- Search Console ---- */}
              <div className="rounded-lg border border-slate-800 p-2">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-400">{t('web.search')} {sel.searchConsoleProperty && <span className="text-slate-300">· {sel.searchConsoleProperty}</span>}</span><div className="flex items-center gap-1">{sel.gscStatus === 'OK' && <Pill tone="ok">OK</Pill>}{sel.gscStatus === 'NO_ACCESS' && <Pill tone="bad">{t('web.gscNoAccess')}</Pill>}{sel.searchConsoleProperty && <Button variant="ghost" disabled={busy === `sync:${sel.id}`} onClick={() => syncGsc(sel.id)}>{t('web.syncGsc')}</Button>}</div></div>
                {!sel.searchConsoleProperty && manage && (conns.length ? <div className="flex flex-wrap items-end gap-2"><Field label={t('yt.connections')}><Select className="w-auto" value={gscConn} onChange={e => setGscConn(e.target.value)}>{conns.map(c => <option key={c.id} value={c.id}>{c.email ?? c.providerUserId}</option>)}</Select></Field><Button disabled={!gscConn || busy === `gsc:${sel.id}`} onClick={() => connectGsc(sel.id)}>{t('web.connectGsc')}</Button><p className="text-xs text-slate-500">{t('web.gscHint')}</p></div> : <p className="text-xs text-amber-300">{t('web.gscHint')} — เชื่อมบัญชี Google ที่หน้า YouTube ก่อน</p>)}
                {sel.summary.search.days > 0 && <div className="mt-2 grid gap-2 sm:grid-cols-3"><Kpi value={sel.summary.search.clicks ?? '—'} label={t('web.clicks')} /><Kpi value={sel.summary.search.impressions ?? '—'} label={t('web.impressions')} /><Kpi value={sel.summary.search.avgPosition ?? '—'} label={t('web.position')} /></div>}
                {sel.summary.search.topQueries.length > 0 && <div className="mt-2 grid gap-2 md:grid-cols-2 text-xs"><div><div className="text-slate-400">{t('web.topQueries')}</div><table className="w-full">{sel.summary.search.topQueries.slice(0, 10).map(q => <tbody key={q.keys[0]}><tr className="border-t border-slate-800"><td className="py-0.5">{q.keys[0]}</td><td className="text-right">{q.clicks} / {q.impressions}</td></tr></tbody>)}</table></div><div><div className="text-slate-400">{t('web.topPages')}</div><table className="w-full">{sel.summary.search.topPages.slice(0, 10).map(p => <tbody key={p.keys[0]}><tr className="border-t border-slate-800"><td className="truncate py-0.5">{p.keys[0]?.replace(sel.url, '') || '/'}</td><td className="text-right">{p.clicks} / {p.impressions}</td></tr></tbody>)}</table></div></div>}
              </div>
              {/* ---- analysis ---- */}
              {sel.analysis && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950 p-2 text-xs"><div className="font-semibold text-emerald-300">{t('web.analysis')} · {fmt(sel.analysis.createdAt)} · {sel.analysis.model}</div><p className="mt-1 text-slate-300">{sel.analysis.result.summary}</p>
                {sel.analysis.result.recommendations.length > 0 && <div className="mt-2"><div className="text-slate-400">{t('web.recommendations')}</div><ul className="list-disc pl-4">{sel.analysis.result.recommendations.map((r, i) => <li key={i}><b>{r.title}</b> <span className="text-slate-500">[{r.actionType} · {r.confidence} · effort {r.effort}]</span> — {r.why}</li>)}</ul></div>}
                {(sel.analysis.result.contentIdeas?.length ?? 0) > 0 && <div className="mt-2"><div className="text-slate-400">{t('web.contentIdeas')}</div><ul className="list-disc pl-4">{sel.analysis.result.contentIdeas!.map((c, i) => <li key={i}>{c.topic}{c.targetQuery && <span className="text-slate-500"> · “{c.targetQuery}”</span>} — {c.why}</li>)}</ul></div>}
                {(sel.analysis.result.dataLimitations?.length ?? 0) > 0 && <p className="mt-1 text-amber-300">{sel.analysis.result.dataLimitations!.join(' · ')}</p>}</div>}
              {/* ---- incidents + history ---- */}
              <details className="text-xs"><summary className="cursor-pointer text-slate-400">{t('web.incidents')} ({sel.summary.incidents.length}) · ประวัติการตรวจ ({sel.checks.length})</summary>
                <ul className="mt-1 space-y-0.5">{sel.summary.incidents.map(i => <li key={i.id}><Pill tone={i.resolvedAt ? 'ok' : 'bad'}>{i.kind}</Pill> {fmt(i.startedAt)} {i.resolvedAt ? `→ ${fmt(i.resolvedAt)} (${t('web.resolved')})` : `(${t('web.openIncident')})`} — {i.summary}</li>)}</ul>
                <div className="mt-2 max-h-48 overflow-auto">{sel.checks.map(c => <div key={c.id} className="flex justify-between border-t border-slate-800 py-0.5"><span><Pill tone={checkTone(c.status)}>{c.kind}</Pill> {fmt(c.checkedAt)}</span><span className="text-slate-500">{c.httpStatus ?? ''} {c.latencyMs !== null ? `${c.latencyMs} ms` : ''} {c.error ?? ''}</span></div>)}</div>
              </details>
            </div>
          </Card>)}</div>
      </div>
    </div>
  );
}
