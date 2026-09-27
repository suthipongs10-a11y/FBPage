'use client';
/** โต๊ะค้นคว้า — ค้นเว็บ / AI ค้นเอง / จากลิงก์ / จากข้อความ → สรุปประเด็นพร้อมอ้างอิง → เขียนโพสต์ + ตรวจข้อเท็จจริง → ร่างรออนุมัติ */
import { useCallback, useEffect, useState } from 'react';
import { api, type AiConnectionsView, type ContentImportRow, type PageRow, type ResearchBriefRow, type ResearchCaps } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { Button, Card, ErrorBox, Field, Input, Pill, Select } from '@/components/ui';
import { ReportView } from '@/components/content-import';

const MODES = ['web', 'ai', 'urls', 'text'] as const;
const STYLES = ['news', 'listicle', 'story', 'qa'] as const;
const FALLBACKS = ['stock', 'ai', 'none'] as const;
type Mode = (typeof MODES)[number];
const toOverride = (v: string) => { if (!v) return undefined; const [connectionId, model] = v.split('|'); return { connectionId: connectionId!, ...(model && { model }) }; };
const fmt = (d: string) => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });

export function ResearchDesk({ base, brandId, pages, conns, onDrafted }: { base: string; brandId: string; pages: PageRow[]; conns: AiConnectionsView | null; onDrafted: () => void }) {
  const [caps, setCaps] = useState<ResearchCaps | null>(null);
  const [history, setHistory] = useState<ResearchBriefRow[]>([]);
  const [mode, setMode] = useState<Mode>('web');
  const [f, setF] = useState({ query: '', focus: '', urls: '', text: '', recency: 'news' as 'news' | 'any', maxSources: 6, expand: true, searchModel: '', model: '' });
  const [cur, setCur] = useState<ResearchBriefRow | null>(null);
  const [w, setW] = useState({ count: 1, style: 'news' as (typeof STYLES)[number], angle: '', pageId: '', hint: '', factCheck: true, imageFallback: 'stock' as (typeof FALLBACKS)[number], writer: '' });
  const [result, setResult] = useState<{ import: ContentImportRow; factCheck: { ran: boolean; flagged: number; error: string | null }; model: string; costUsd: number | null } | null>(null);
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null);
  const modelOptions = (conns?.connections ?? []).filter(c => c.status !== 'DISABLED').flatMap(c => (c.models.length ? c.models : ['']).map(m => ({ value: `${c.id}|${m}`, label: `${c.label}${m ? ` · ${m}` : ''}` })));

  const load = useCallback(async () => {
    const [c, h] = await Promise.all([api<ResearchCaps>(`${base}/news/research/capabilities`), api<ResearchBriefRow[]>(`${base}/brands/${brandId}/news/research`)]);
    setCaps(c); setHistory(h);
    setF(x => ({ ...x, searchModel: x.searchModel || (c.webSearch[0] ? `${c.webSearch[0].connectionId}|${c.webSearch[0].model}` : '') }));
  }, [base, brandId]);
  useEffect(() => { setCur(null); setResult(null); void load().catch(setError); }, [load]);
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(''); } };

  const research = () => run('research', async () => {
    const override = mode === 'ai' ? (caps?.researchRoleSearches && !f.searchModel ? undefined : toOverride(f.searchModel)) : toOverride(f.model);
    const body = {
      mode, ...(f.query && { query: f.query }), ...(f.focus && { focus: f.focus }), recency: f.recency, maxSources: f.maxSources, expand: f.expand,
      ...(mode === 'urls' && { urls: f.urls.split(/\s+/).map(x => x.trim()).filter(Boolean).slice(0, 8) }), ...(mode === 'text' && { text: f.text }),
      ...(override && { modelOverride: override }),
    };
    const r = await api<ResearchBriefRow>(`${base}/brands/${brandId}/news/research`, { method: 'POST', body });
    setCur(r); setResult(null); setW(x => ({ ...x, angle: '' })); await load();
  });
  const write = () => run('write', async () => {
    if (!cur) return;
    const r = await api<NonNullable<typeof result>>(`${base}/news/research/${cur.id}/write`, { method: 'POST', body: { count: w.count, style: w.style, factCheck: w.factCheck, imageFallback: w.imageFallback, ...(w.angle && { angle: w.angle }), ...(w.pageId && { pageId: w.pageId }), ...(w.hint && { hint: w.hint }), ...(toOverride(w.writer) && { modelOverride: toOverride(w.writer) }) } });
    setResult(r); if (r.import.draftCount) onDrafted(); await load();
  });
  const remove = (h: ResearchBriefRow) => run(`del:${h.id}`, async () => { await api(`${base}/news/research/${h.id}`, { method: 'DELETE' }); if (cur?.id === h.id) setCur(null); await load(); });

  const canRun = mode === 'web' ? !!f.query && !!caps?.tavily : mode === 'ai' ? !!f.query && (!!f.searchModel || !!caps?.researchRoleSearches) : mode === 'urls' ? !!f.urls.trim() : f.text.trim().length >= 50;
  const src = (n: number) => cur?.sources.find(s => s.n === n);

  return (
    <Card title={t('rs.title')}>
      <p className="text-xs text-slate-400">{t('rs.help')}</p>
      <ErrorBox error={error} />
      <div className="mt-3 flex flex-wrap gap-2">{MODES.map(m => <Button key={m} variant={mode === m ? 'primary' : 'ghost'} onClick={() => setMode(m)}>{t(`rs.mode.${m}` as MessageKey)}</Button>)}</div>
      <p className="mt-2 text-xs text-slate-400">{t(`rs.modeHelp.${mode}` as MessageKey)}</p>

      <div className="mt-2 space-y-2">
        {(mode === 'web' || mode === 'ai' || mode === 'text') && <Field label={t('rs.query')}><Input value={f.query} placeholder={mode === 'text' ? '(ไม่ใส่ก็ได้)' : 'เช่น ข่าวสัตว์น่ารักสัปดาห์นี้ / ประโยชน์ของการนอนกลางวัน'} onChange={e => setF({ ...f, query: e.target.value })} /></Field>}
        {mode === 'urls' && <Field label={t('rs.urls')}><textarea className="h-24 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs" value={f.urls} placeholder="https://…" onChange={e => setF({ ...f, urls: e.target.value })} /></Field>}
        {mode === 'text' && <Field label={t('rs.text')}><textarea className="h-32 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm" value={f.text} onChange={e => setF({ ...f, text: e.target.value })} /></Field>}
        <div className="grid gap-2 md:grid-cols-4">
          <Field label={t('rs.focus')}><Input value={f.focus} onChange={e => setF({ ...f, focus: e.target.value })} /></Field>
          {(mode === 'web' || mode === 'ai') && <Field label=" "><Select value={f.recency} onChange={e => setF({ ...f, recency: e.target.value as 'news' | 'any' })}><option value="news">{t('rs.recency.news')}</option><option value="any">{t('rs.recency.any')}</option></Select></Field>}
          {mode === 'web' && <Field label={t('rs.maxSources')}><Select value={f.maxSources} onChange={e => setF({ ...f, maxSources: Number(e.target.value) })}>{[3, 4, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>}
          {mode === 'ai'
            ? <Field label={t('rs.searchModel')}><Select value={f.searchModel} onChange={e => setF({ ...f, searchModel: e.target.value })}>{caps?.researchRoleSearches && <option value="">{t('news.aiDefault')} (research · {caps.researchRole?.model})</option>}{(caps?.webSearch ?? []).map(o => <option key={`${o.connectionId}|${o.model}`} value={`${o.connectionId}|${o.model}`}>{o.label} · {o.model}</option>)}</Select></Field>
            : <Field label={t('news.aiResearch')}><Select value={f.model} onChange={e => setF({ ...f, model: e.target.value })}><option value="">{t('news.aiDefault')} (research)</option>{modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>}
        </div>
        {mode === 'web' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.expand} onChange={e => setF({ ...f, expand: e.target.checked })} /> {t('rs.expand')}</label>}
        {mode === 'web' && caps && !caps.tavily && <p className="text-xs text-amber-300">{t('rs.noTavily')}</p>}
        {mode === 'ai' && caps && !caps.webSearch.length && !caps.researchRoleSearches && <p className="text-xs text-amber-300">{t('rs.noSearchModel')}</p>}
        <div className="flex items-center gap-3"><Button disabled={!canRun || !!busy} onClick={research}>{busy === 'research' ? '…' : t('rs.run')}</Button>{busy === 'research' && <span className="text-xs text-slate-400">{t('rs.running')}</span>}</div>
      </div>

      {cur && (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-800 p-3">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{cur.brief.headline}</h3><Pill>{cur.brief.category}</Pill>{cur.brief.risk === 'HIGH' && <Pill tone="bad">{t('news.risk.HIGH')}</Pill>}<span className="text-xs text-slate-500">{cur.model}{cur.costUsd != null ? ` · $${cur.costUsd.toFixed(4)}` : ''}</span></div>
          <p className="text-sm text-slate-300">{cur.brief.summary}</p>
          {cur.brief.riskReasons.length > 0 && <p className="text-xs text-rose-300">⚠ {cur.brief.riskReasons.join(' · ')}</p>}
          <div><div className="text-sm font-semibold">{t('rs.keyPoints')}</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{cur.brief.keyPoints.map((k, i) => <li key={i}>{k.text} {k.sources.map(n => { const s = src(n); return s?.url ? <a key={n} href={s.url} target="_blank" rel="noreferrer" className="text-xs text-sky-400">[{n}]</a> : <span key={n} className="text-xs text-slate-500">[{n}]</span>; })}{!k.sources.length && <span className="text-xs text-amber-300"> (ไม่มีแหล่ง)</span>}</li>)}</ul></div>
          {cur.brief.openQuestions.length > 0 && <div className="text-xs text-amber-300">{t('rs.open')}: {cur.brief.openQuestions.join(' · ')}</div>}
          <details><summary className="cursor-pointer text-xs text-sky-400">{t('rs.sources')} ({cur.sources.length})</summary>
            <ol className="mt-1 space-y-1 text-xs">{cur.sources.map(s => <li key={s.n}>[{s.n}] {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{s.title}</a> : s.title} <span className="text-slate-500">{s.siteName ?? ''}{s.publishedAt ? ` · ${s.publishedAt.slice(0, 10)}` : ''}</span>{!s.fetched && <span className="text-amber-300"> · {t('rs.snippetOnly')}</span>}</li>)}</ol>
            {cur.failures?.length ? <div className="mt-1 text-xs text-slate-500">{cur.failures.join(' · ')}</div> : null}
          </details>

          <div className="border-t border-slate-800 pt-3">
            <div className="text-sm font-semibold">{t('rs.write')}</div>
            <div className="mt-2 grid gap-2 md:grid-cols-4">
              <Field label={t('rs.angle')}><Select value={w.angle} onChange={e => setW({ ...w, angle: e.target.value })}><option value="">{t('rs.anyAngle')}</option>{cur.brief.angles.map((a, i) => <option key={i} value={a.title}>{a.title}</option>)}</Select></Field>
              <Field label={t('rs.style')}><Select value={w.style} onChange={e => setW({ ...w, style: e.target.value as (typeof STYLES)[number] })}>{STYLES.map(s => <option key={s} value={s}>{t(`rs.style.${s}` as MessageKey)}</option>)}</Select></Field>
              <Field label={t('rs.count')}><Select value={w.count} onChange={e => setW({ ...w, count: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>
              <Field label={t('news.page')}><Select value={w.pageId} onChange={e => setW({ ...w, pageId: e.target.value })}><option value="">—</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <Field label={t('news.aiWriter')}><Select value={w.writer} onChange={e => setW({ ...w, writer: e.target.value })}><option value="">{t('news.aiDefault')} (content)</option>{modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
              <Field label={t('imp.fallback')}><Select value={w.imageFallback} onChange={e => setW({ ...w, imageFallback: e.target.value as (typeof FALLBACKS)[number] })}>{FALLBACKS.map(x => <option key={x} value={x}>{t(`news.img.${x}` as MessageKey)}</option>)}</Select></Field>
              <Field label={t('rs.focus')}><Input value={w.hint} onChange={e => setW({ ...w, hint: e.target.value })} /></Field>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={w.factCheck} onChange={e => setW({ ...w, factCheck: e.target.checked })} /> {t('rs.factCheck')}</label>
            </div>
            <Button className="mt-2" disabled={!!busy} onClick={write}>{busy === 'write' ? '…' : t('rs.write')}</Button>
            {result && <div className="mt-2 text-sm">
              <p className="text-emerald-400">✔ {t('imp.drafted')} ({result.import.draftCount}/{result.import.postCount}) · {result.model}{result.costUsd != null ? ` · ${t('rs.cost')} $${result.costUsd.toFixed(4)}` : ''}</p>
              {result.factCheck.flagged > 0 && <p className="text-xs text-amber-300">⚠ {t('rs.flagged')}: {result.factCheck.flagged}</p>}
              {result.factCheck.error && <p className="text-xs text-amber-300">⚠ {result.factCheck.error}</p>}
              <ReportView report={result.import.report} />
            </div>}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-3"><summary className="cursor-pointer text-xs text-sky-400">{t('rs.history')} ({history.length})</summary>
          <ul className="mt-1 divide-y divide-slate-800 text-sm">{history.map(h => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 py-1">
              <Pill>{t(`rs.mode.${h.mode}` as MessageKey)}</Pill>
              <button className="text-left hover:underline" onClick={() => { setCur(h); setResult(null); }}>{h.brief.headline}</button>
              <span className="text-xs text-slate-500">{fmt(h.createdAt)} · {h.sources.length} {t('rs.sources')}{h.lastImportId ? ` · ${t('rs.written')}` : ''}</span>
              <Button variant="ghost" disabled={!!busy} onClick={() => remove(h)}>{t('common.delete')}</Button>
            </li>))}</ul>
        </details>
      )}
    </Card>
  );
}
