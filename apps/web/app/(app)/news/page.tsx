'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, type AiConnectionsView, type NewsItemRow, type NewsSourceRow, type PageRow, type SearchProviderView } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select } from '@/components/ui';

const THEMES = ['dark', 'warm', 'ocean', 'gold', 'forest', 'default'];
const TABS = ['SHORTLISTED', 'NEW', 'DRAFTED'] as const;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const pad = (n: number) => String(n).padStart(2, '0');
/** ชั่วโมงถัดไปที่ห่างจากตอนนี้อย่างน้อย 30 นาที ในเวลาเครื่อง — ค่าเริ่มต้นของช่องตั้งเวลา */
const nextSlot = () => { const d = new Date(Date.now() + 30 * 60_000); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`; };
/** "connectionId|model" ↔ modelOverride */
const toOverride = (v: string) => { if (!v) return undefined; const [connectionId, model] = v.split('|'); return { connectionId: connectionId!, ...(model && { model }) }; };

export default function NewsPage() {
  const { ws, can } = useWorkspace();
  const base = `/workspaces/${ws.id}`;
  const [pages, setPages] = useState<PageRow[] | null>(null); const [brandId, setBrandId] = useState('');
  const [sources, setSources] = useState<NewsSourceRow[]>([]); const [items, setItems] = useState<NewsItemRow[] | null>(null);
  const [provider, setProvider] = useState<SearchProviderView | null>(null); const [conns, setConns] = useState<AiConnectionsView | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('SHORTLISTED');
  const [src, setSrc] = useState({ kind: 'RSS' as 'RSS' | 'SEARCH', label: '', value: '' }); const [key, setKey] = useState('');
  const [max, setMax] = useState(5); const [aiResearch, setAiResearch] = useState(''); const [aiWriter, setAiWriter] = useState('');
  const [pageFor, setPageFor] = useState<Record<string, string>>({}); const [theme, setTheme] = useState('dark'); const [when, setWhen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');

  const brands = useMemo(() => { const m = new Map<string, string>(); for (const p of pages ?? []) m.set(p.brand.id, `${p.brand.client.name} / ${p.brand.name}`); return [...m].map(([id, name]) => ({ id, name })); }, [pages]);
  const brandPages = (pages ?? []).filter(p => p.brand.id === brandId);
  const modelOptions = (conns?.connections ?? []).filter(c => c.status !== 'DISABLED').flatMap(c => (c.models.length ? c.models : ['']).map(m => ({ value: `${c.id}|${m}`, label: `${c.label}${m ? ` · ${m}` : ''}` })));

  useEffect(() => {
    Promise.all([api<PageRow[]>(`${base}/pages`), api<SearchProviderView>(`${base}/news/search-provider`), can('ai.use') ? api<AiConnectionsView>(`${base}/ai/connections`) : Promise.resolve(null)])
      .then(([p, sp, c]) => { const live = p.filter(x => !x.disconnectedAt); setPages(live); setProvider(sp); setConns(c); setBrandId(b => b || live[0]?.brand.id || ''); })
      .catch(setError);
  }, [base, can]);
  const load = useCallback(async () => {
    if (!brandId) return;
    const [s, i] = await Promise.all([api<NewsSourceRow[]>(`${base}/brands/${brandId}/news/sources`), api<NewsItemRow[]>(`${base}/news/items?brandId=${brandId}&status=${tab}`)]);
    setSources(s); setItems(i);
  }, [base, brandId, tab]);
  useEffect(() => { setItems(null); void load().catch(setError); }, [load]);
  const run = async (k: string, fn: () => Promise<string | void>) => { setBusy(k); setError(null); setNotice(''); try { const n = await fn(); if (n) setNotice(n); await load(); } catch (e) { setError(e); } finally { setBusy(''); } };

  const addSource = () => run('src', async () => { await api(`${base}/brands/${brandId}/news/sources`, { method: 'POST', body: src.kind === 'RSS' ? { kind: 'RSS', label: src.label, url: src.value } : { kind: 'SEARCH', label: src.label, query: src.value } }); setSrc({ ...src, label: '', value: '' }); });
  const toggle = (s: NewsSourceRow) => run(`tog:${s.id}`, async () => { await api(`${base}/news/sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } }); });
  const remove = (s: NewsSourceRow) => run(`del:${s.id}`, async () => { await api(`${base}/news/sources/${s.id}`, { method: 'DELETE' }); });
  const fetchNow = () => run('fetch', async () => { const r = await api<{ added: number; sources: { error: string | null }[] }>(`${base}/brands/${brandId}/news/fetch`, { method: 'POST' }); const bad = r.sources.filter(x => x.error).length; setTab('NEW'); return `${t('news.fetched')} +${r.added}${bad ? ` · ${bad} แหล่งมีปัญหา` : ''}`; });
  const saveKey = () => run('key', async () => { setProvider(await api<SearchProviderView>(`${base}/news/search-provider`, { method: 'PUT', body: { apiKey: key } })); setKey(''); });
  const shortlist = () => run('short', async () => { const r = await api<{ picked: number; model?: string }>(`${base}/brands/${brandId}/news/shortlist`, { method: 'POST', body: { max, ...(toOverride(aiResearch) && { modelOverride: toOverride(aiResearch) }) } }); setTab('SHORTLISTED'); return `AI คัดได้ ${r.picked} ข่าว${r.model ? ` (${r.model})` : ''}`; });
  const write = (i: NewsItemRow) => run(`w:${i.id}`, async () => {
    const r = await api<{ needsCheck: string[]; risk: string; cardError: string | null; model: string }>(`${base}/news/items/${i.id}/draft`, { method: 'POST', body: { pageId: pageFor[i.id] || brandPages[0]?.id, theme, ...(toOverride(aiWriter) && { modelOverride: toOverride(aiWriter) }) } });
    setTab('DRAFTED');
    return `เขียนเสร็จ (${r.model}) — รออนุมัติ${r.needsCheck.length ? ` · มี ${r.needsCheck.length} จุดต้องยืนยัน` : ''}${r.cardError ? ` · ${t('news.cardError')}: ${r.cardError}` : ''}`;
  });
  const setStatus = (i: NewsItemRow, status: 'NEW' | 'DISMISSED') => run(`st:${i.id}`, async () => { await api(`${base}/news/items/${i.id}`, { method: 'PATCH', body: { status } }); });
  const approve = (i: NewsItemRow) => run(`ap:${i.id}`, async () => { await api(`${base}/content/${i.contentId}/approve-schedule`, { method: 'POST', body: { scheduledLocal: when[i.id] || nextSlot(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }); return t('news.scheduledAt'); });

  if (!pages) return <div><ErrorBox error={error} /><Loading /></div>;
  if (!brands.length) return <div className="space-y-2"><h1 className="text-2xl font-semibold">{t('news.title')}</h1><Empty text={t('news.noPages')} /></div>;
  const canWrite = can('content.create'); const canAi = can('ai.use') && canWrite; const canApprove = can('content.approve') && can('content.publish');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('news.title')}</h1><p className="text-sm text-slate-400">{t('news.subtitle')}</p></div>
        <div className="w-72"><Field label={t('news.brand')}><Select value={brandId} onChange={e => setBrandId(e.target.value)}>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field></div>
      </div>
      <p className="rounded-lg border border-sky-900/60 bg-sky-950/30 p-2 text-xs text-sky-200">{t('news.rules')}</p>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />

      <div className="grid gap-3 md:grid-cols-3">
        <Card title={t('news.sources')} className="md:col-span-2" actions={canWrite && <Button disabled={busy === 'fetch' || !sources.some(s => s.enabled)} onClick={fetchNow}>{busy === 'fetch' ? '…' : t('news.fetchNow')}</Button>}>
          {sources.length === 0 ? <Empty text={t('news.noSources')} /> : (
            <ul className="divide-y divide-slate-800 text-sm">{sources.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                <Pill tone={s.enabled ? 'ok' : 'muted'}>{t(`news.kind.${s.kind}` as MessageKey)}</Pill>
                <div className="min-w-0 flex-1"><div className="font-medium">{s.label}</div><div className="truncate text-xs text-slate-400">{s.url ?? s.query}</div>
                  <div className="text-xs text-slate-500">{t('news.lastFetched')} {fmt(s.lastFetchedAt)}{s.lastFetchedAt && !s.lastError ? ` · +${s.lastNewCount}` : ''}{s.lastError && <span className="text-rose-400"> · {s.lastError}</span>}</div></div>
                {canWrite && <><Button variant="ghost" disabled={!!busy} onClick={() => toggle(s)}>{s.enabled ? t('news.disabled') : t('news.enabled')}</Button><Button variant="danger" disabled={!!busy} onClick={() => remove(s)}>{t('common.delete')}</Button></>}
              </li>))}</ul>
          )}
          {canWrite && (
            <div className="mt-3 grid gap-2 md:grid-cols-[120px_1fr_2fr_auto]">
              <Select value={src.kind} onChange={e => setSrc({ ...src, kind: e.target.value as 'RSS' | 'SEARCH' })}><option value="RSS">{t('news.kind.RSS')}</option><option value="SEARCH">{t('news.kind.SEARCH')}</option></Select>
              <Input placeholder={t('news.label')} value={src.label} onChange={e => setSrc({ ...src, label: e.target.value })} />
              <Input placeholder={src.kind === 'RSS' ? 'https://…/rss.xml' : t('news.query')} value={src.value} onChange={e => setSrc({ ...src, value: e.target.value })} />
              <Button disabled={busy === 'src' || !src.label || !src.value} onClick={addSource}>{t('news.addSource')}</Button>
            </div>
          )}
        </Card>
        <Card title={t('news.searchKey')}>
          <p className="text-xs text-slate-400">{t('news.searchKeyHelp')}</p>
          <div className="mt-2 text-sm">{provider?.configured ? <div className="space-y-1"><Pill tone={provider.status === 'OK' ? 'ok' : provider.status === 'UNKNOWN' ? 'muted' : 'bad'}>{provider.status}</Pill> <span className="text-slate-400">{provider.keyHint}</span><div className="text-xs text-slate-500">{t('news.calls')} {provider.callCount}</div>{provider.lastError && <div className="text-xs text-rose-400">{provider.lastError}</div>}</div> : <span className="text-slate-400">{t('news.searchKeyNone')}</span>}</div>
          {can('ai.configure') && <div className="mt-2 flex gap-2"><Input type="password" autoComplete="off" placeholder="tvly-…" value={key} onChange={e => setKey(e.target.value)} /><Button disabled={busy === 'key' || key.length < 8} onClick={saveKey}>{t('common.save')}</Button></div>}
        </Card>
      </div>

      {canAi && (
        <Card>
          <div className="grid items-end gap-2 md:grid-cols-[120px_1fr_1fr_120px_auto]">
            <Field label={t('news.shortlistMax')}><Select value={max} onChange={e => setMax(Number(e.target.value))}>{[3, 5, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>
            <Field label={t('news.aiResearch')}><Select value={aiResearch} onChange={e => setAiResearch(e.target.value)}><option value="">{t('news.aiDefault')} (research)</option>{modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
            <Field label={t('news.aiWriter')}><Select value={aiWriter} onChange={e => setAiWriter(e.target.value)}><option value="">{t('news.aiDefault')} (content)</option>{modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
            <Field label={t('news.theme')}><Select value={theme} onChange={e => setTheme(e.target.value)}>{THEMES.map(x => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Button disabled={busy === 'short'} onClick={shortlist}>{busy === 'short' ? '…' : t('news.shortlist')}</Button>
          </div>
        </Card>
      )}

      <div className="flex gap-2">{TABS.map(x => <Button key={x} variant={tab === x ? 'primary' : 'ghost'} onClick={() => setTab(x)}>{t(`news.tab.${x}` as MessageKey)}</Button>)}</div>
      {!items ? <Loading /> : items.length === 0 ? <Empty text={t('news.empty')} /> : (
        <div className="grid gap-3 md:grid-cols-2">{items.map(i => {
          const risk = i.content?.aiNotes?.risk ?? i.angle?.risk; const reasons = i.content?.aiNotes?.riskReasons ?? i.angle?.riskReasons ?? [];
          const needs = i.content?.aiNotes?.needsCheck ?? [];
          return (
            <Card key={i.id}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                {i.score != null && <Pill tone={i.score >= 70 ? 'ok' : 'muted'}>{i.score}</Pill>}
                {i.angle?.category && <Pill>{i.angle.category}</Pill>}
                {risk && <Pill tone={risk === 'HIGH' ? 'bad' : 'ok'}>{t(`news.risk.${risk}` as MessageKey)}</Pill>}
                <span>{i.sourceName ?? '—'} · {fmt(i.publishedAt ?? i.fetchedAt)}</span>
                <a href={i.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{t('news.source')} ↗</a>
              </div>
              <h3 className="mt-2 font-semibold">{i.angle?.headlineTh ?? i.title}</h3>
              {i.angle?.headlineTh && <p className="text-xs text-slate-500">{i.title}</p>}
              {i.angle?.why && <p className="mt-1 text-xs text-emerald-300">💡 {i.angle.why}</p>}
              {risk === 'HIGH' && reasons.length > 0 && <p className="mt-1 text-xs text-rose-300">⚠ {reasons.join(' · ')}</p>}
              {!i.content && i.snippet && <p className="mt-2 line-clamp-3 text-sm text-slate-300">{i.snippet}</p>}

              {i.content ? (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-3">
                    {i.content.imageAssetId && <img src={`/api${base}/media/${i.content.imageAssetId}/file`} alt="" className="h-32 w-32 flex-none rounded-lg object-cover" />}
                    <p className="line-clamp-6 whitespace-pre-line text-sm text-slate-300">{i.content.caption}</p>
                  </div>
                  {needs.length > 0 && <p className="rounded border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200">{t('news.needsCheck')}: {needs.join(' · ')}</p>}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Pill tone={['SCHEDULED', 'PUBLISHED'].includes(i.content.status) ? 'ok' : i.content.status === 'PUBLISH_FAILED' ? 'bad' : 'warn'}>{t(`cs.${i.content.status}` as MessageKey) || i.content.status}</Pill>
                    {i.content.scheduledAt && <span className="text-slate-400">{t('news.scheduledAt')} {fmt(i.content.scheduledAt)}</span>}
                    <Link href="/content" className="text-sky-400 hover:underline">{t('news.editInContent')}</Link>
                  </div>
                  {i.content.status === 'READY_FOR_APPROVAL' && canApprove && (
                    <div className="flex flex-wrap gap-2">
                      <Input type="datetime-local" className="w-56" value={when[i.id] ?? nextSlot()} onChange={e => setWhen({ ...when, [i.id]: e.target.value })} />
                      <Button disabled={busy === `ap:${i.id}` || needs.length > 0} onClick={() => approve(i)}>{t('news.approveSchedule')}</Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canAi && <>
                    <Select className="w-48" value={pageFor[i.id] ?? brandPages[0]?.id ?? ''} onChange={e => setPageFor({ ...pageFor, [i.id]: e.target.value })}>{brandPages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                    <Button disabled={!!busy || !brandPages.length} onClick={() => write(i)}>{busy === `w:${i.id}` ? '…' : t('news.write')}</Button>
                  </>}
                  {canWrite && <Button variant="ghost" disabled={!!busy} onClick={() => setStatus(i, 'DISMISSED')}>{t('news.dismiss')}</Button>}
                </div>
              )}
            </Card>
          );
        })}</div>
      )}
    </div>
  );
}
