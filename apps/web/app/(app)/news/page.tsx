'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, type ResearchBriefRow, type AiConnectionsView, type NewsAutomationRow, type NewsItemRow, type NewsSourceRow, type PageRow, type SearchProviderView } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select } from '@/components/ui';
import { ContentImport } from '@/components/content-import';
import { ResearchDesk } from '@/components/research-desk';
import { PageScout } from '@/components/page-scout';

const THEMES = ['dark', 'warm', 'ocean', 'gold', 'forest', 'default'];
const TABS = ['SHORTLISTED', 'NEW', 'DRAFTED'] as const;
const IMAGE_SOURCES = ['stock', 'ai', 'none'] as const;
/** ชุดคำค้นสำเร็จรูปสำหรับเพจข่าวน่าสนใจรอบโลก (ค้นผ่าน Tavily) — ภาษาอังกฤษได้ข่าวต่างประเทศมากกว่า AI เขียนเป็นไทยให้เอง */
const PRESET_QUERIES = [
  { label: 'ข่าวแปลกรอบโลก', query: 'weird news around the world' },
  { label: 'สัตว์น่ารัก/กู้ภัย', query: 'animal rescue heartwarming' },
  { label: 'วิทยาศาสตร์', query: 'new scientific discovery' },
  { label: 'อวกาศ', query: 'space discovery NASA' },
  { label: 'สิ่งประดิษฐ์/เทคโนโลยี', query: 'amazing new invention technology' },
  { label: 'เรื่องดีๆ ชวนอมยิ้ม', query: 'good news inspiring story' },
];
type ImageSource = (typeof IMAGE_SOURCES)[number];
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const pad = (n: number) => String(n).padStart(2, '0');
/** ชั่วโมงถัดไปที่ห่างจากตอนนี้อย่างน้อย 30 นาที ในเวลาเครื่อง — ค่าเริ่มต้นของช่องตั้งเวลา */
/** ISO → ค่า datetime-local ตามเวลาเครื่อง (เวลาที่แพ็กเกจนำเข้าเสนอมา) */
const toLocalInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const suggested = (i: NewsItemRow) => { const s = i.content?.aiNotes?.suggestedAt; return s && Date.parse(s) > Date.now() + 10 * 60_000 ? toLocalInput(s) : ''; };
const nextSlot = () => { const d = new Date(Date.now() + 30 * 60_000); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`; };
/** "connectionId|model" ↔ modelOverride */
const toOverride = (v: string) => { if (!v) return undefined; const [connectionId, model] = v.split('|'); return { connectionId: connectionId!, ...(model && { model }) }; };

export default function NewsPage() { return <Suspense fallback={<Loading />}><NewsInner /></Suspense>; }

function NewsInner() {
  const { ws, can } = useWorkspace();
  // เปิดจากหน้าเพจ: /news?page=<pageId> → เลือกแบรนด์ของเพจนั้น + ผู้ช่วยหาเรื่องเลือกเพจนั้น
  const pageParam = useSearchParams().get('page') ?? undefined;
  const [scoutBrief, setScoutBrief] = useState<{ brief: ResearchBriefRow; pageId: string; seq: number } | null>(null);
  const base = `/workspaces/${ws.id}`;
  const [pages, setPages] = useState<PageRow[] | null>(null); const [brandId, setBrandId] = useState('');
  const [sources, setSources] = useState<NewsSourceRow[]>([]); const [items, setItems] = useState<NewsItemRow[] | null>(null);
  const [conns, setConns] = useState<AiConnectionsView | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('SHORTLISTED');
  const [src, setSrc] = useState({ kind: 'RSS' as 'RSS' | 'SEARCH', label: '', value: '' });
  const [max, setMax] = useState(5); const [aiResearch, setAiResearch] = useState(''); const [aiWriter, setAiWriter] = useState('');
  const [pageFor, setPageFor] = useState<Record<string, string>>({}); const [theme, setTheme] = useState('dark'); const [when, setWhen] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState('');
  const [imageSource, setImageSource] = useState<ImageSource>('stock'); const [aiImageModel, setAiImageModel] = useState('');
  const [slotOf, setSlotOf] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState({ enabled: false, pageId: '', fetchEveryHours: 3, draftsPerDay: 3, minScore: 60, skipHighRisk: true, imageSource: 'none' as ImageSource, theme: 'dark', slots: '09:00, 12:30, 19:00' });
  const [autoRow, setAutoRow] = useState<NewsAutomationRow | null>(null);
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');

  const brands = useMemo(() => { const m = new Map<string, string>(); for (const p of pages ?? []) m.set(p.brand.id, `${p.brand.client.name} / ${p.brand.name}`); return [...m].map(([id, name]) => ({ id, name })); }, [pages]);
  const brandPages = (pages ?? []).filter(p => p.brand.id === brandId);
  const modelOptions = (conns?.connections ?? []).filter(c => c.status !== 'DISABLED').flatMap(c => (c.models.length ? c.models : ['']).map(m => ({ value: `${c.id}|${m}`, label: `${c.label}${m ? ` · ${m}` : ''}` })));

  useEffect(() => {
    Promise.all([api<PageRow[]>(`${base}/pages`), can('ai.use') ? api<AiConnectionsView>(`${base}/ai/connections`) : Promise.resolve(null)])
      .then(([p, c]) => { const live = p.filter(x => !x.disconnectedAt); setPages(live); setConns(c); setBrandId(b => b || live.find(x => x.id === pageParam)?.brand.id || live[0]?.brand.id || ''); })
      .catch(setError);
  }, [base, can, pageParam]);
  const load = useCallback(async () => {
    if (!brandId) return;
    const [s, i, au] = await Promise.all([api<NewsSourceRow[]>(`${base}/brands/${brandId}/news/sources`), api<NewsItemRow[]>(`${base}/news/items?brandId=${brandId}&status=${tab}`), api<NewsAutomationRow | null>(`${base}/brands/${brandId}/news/automation`)]);
    setSources(s); setItems(i); setAutoRow(au);
    if (au) setAuto({ enabled: au.enabled, pageId: au.pageId, fetchEveryHours: au.fetchEveryHours, draftsPerDay: au.draftsPerDay, minScore: au.minScore, skipHighRisk: au.skipHighRisk, imageSource: au.imageSource as ImageSource, theme: au.theme, slots: au.postingSlots.join(', ') });
    // เวลาที่เสนอตอนอนุมัติ = ช่องเวลาว่างถัดไปของแต่ละเพจ
    const pageIds = [...new Set(i.map(x => x.content?.status === 'READY_FOR_APPROVAL' ? x.content.pageId : null).filter((x): x is string => !!x))];
    const slots = await Promise.all(pageIds.map(id => api<{ scheduledLocal: string | null }>(`${base}/news/next-slot?pageId=${id}`).then(r => [id, r.scheduledLocal ?? ''] as const).catch(() => [id, ''] as const)));
    setSlotOf(Object.fromEntries(slots));
  }, [base, brandId, tab]);
  useEffect(() => { setItems(null); void load().catch(setError); }, [load]);
  const run = async (k: string, fn: () => Promise<string | void>) => { setBusy(k); setError(null); setNotice(''); try { const n = await fn(); if (n) setNotice(n); await load(); } catch (e) { setError(e); } finally { setBusy(''); } };

  const suggest = () => run('suggest', async () => { const r = await api<{ added: number; model: string }>(`${base}/brands/${brandId}/news/sources/suggest`, { method: 'POST', body: { count: 5, ...(focus && { focus }) } }); return `AI เพิ่มคำค้น ${r.added} แหล่ง (${r.model}) — กด "ดึงข่าวตอนนี้" ได้เลย`; });
  const addPreset = () => run('preset', async () => {
    const have = new Set(sources.map(x => (x.query ?? '').toLowerCase()));
    let n = 0;
    for (const p of PRESET_QUERIES) { if (have.has(p.query.toLowerCase())) continue; await api(`${base}/brands/${brandId}/news/sources`, { method: 'POST', body: { kind: 'SEARCH', label: p.label, query: p.query } }); n++; }
    return `เพิ่มคำค้นสำเร็จรูป ${n} แหล่ง`;
  });
  const addSource = () => run('src', async () => { await api(`${base}/brands/${brandId}/news/sources`, { method: 'POST', body: src.kind === 'RSS' ? { kind: 'RSS', label: src.label, url: src.value } : { kind: 'SEARCH', label: src.label, query: src.value } }); setSrc({ ...src, label: '', value: '' }); });
  const toggle = (s: NewsSourceRow) => run(`tog:${s.id}`, async () => { await api(`${base}/news/sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } }); });
  const remove = (s: NewsSourceRow) => run(`del:${s.id}`, async () => { await api(`${base}/news/sources/${s.id}`, { method: 'DELETE' }); });
  const fetchNow = () => run('fetch', async () => { const r = await api<{ added: number; sources: { error: string | null }[] }>(`${base}/brands/${brandId}/news/fetch`, { method: 'POST' }); const bad = r.sources.filter(x => x.error).length; setTab('NEW'); return `${t('news.fetched')} +${r.added}${bad ? ` · ${bad} แหล่งมีปัญหา` : ''}`; });
  const shortlist = () => run('short', async () => { const r = await api<{ picked: number; model?: string }>(`${base}/brands/${brandId}/news/shortlist`, { method: 'POST', body: { max, ...(toOverride(aiResearch) && { modelOverride: toOverride(aiResearch) }) } }); setTab('SHORTLISTED'); return `AI คัดได้ ${r.picked} ข่าว${r.model ? ` (${r.model})` : ''}`; });
  const write = (i: NewsItemRow) => run(`w:${i.id}`, async () => {
    const r = await api<{ needsCheck: string[]; risk: string; cardError: string | null; imageError: string | null; model: string }>(`${base}/news/items/${i.id}/draft`, { method: 'POST', body: { pageId: pageFor[i.id] || brandPages[0]?.id, theme, imageSource, ...(toOverride(aiWriter) && { modelOverride: toOverride(aiWriter) }), ...(imageSource === 'ai' && toOverride(aiImageModel) && { imageOverride: toOverride(aiImageModel) }) } });
    setTab('DRAFTED');
    return `เขียนเสร็จ (${r.model}) — รออนุมัติ${r.needsCheck.length ? ` · มี ${r.needsCheck.length} จุดต้องยืนยัน` : ''}${r.imageError ? ` · ${t('news.imageError')}: ${r.imageError}` : ''}${r.cardError ? ` · ${t('news.cardError')}: ${r.cardError}` : ''}`;
  });
  const setStatus = (i: NewsItemRow, status: 'NEW' | 'DISMISSED') => run(`st:${i.id}`, async () => { await api(`${base}/news/items/${i.id}`, { method: 'PATCH', body: { status } }); });
  const slotFor = (i: NewsItemRow) => when[i.id] || suggested(i) || (i.content?.pageId && slotOf[i.content.pageId]) || nextSlot();
  const approve = (i: NewsItemRow) => run(`ap:${i.id}`, async () => {
    // เวลาจากช่องเวลาของเพจ (เขตเวลาเพจ) ส่งไปตามนั้น — ถ้าผู้ใช้แก้เวลาเอง/เวลาที่แพ็กเกจนำเข้าเสนอ ใช้เขตเวลาของเครื่อง
    const own = !!when[i.id] || !!suggested(i);
    await api(`${base}/content/${i.contentId}/approve-schedule`, { method: 'POST', body: { scheduledLocal: slotFor(i), ...(own && { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) } });
    return `${t('news.scheduledAt')} ${slotFor(i).replace('T', ' ')}`;
  });
  const saveAuto = () => run('auto', async () => {
    const slots = auto.slots.split(',').map(x => x.trim()).filter(Boolean);
    await api(`${base}/brands/${brandId}/news/automation`, { method: 'PUT', body: { enabled: auto.enabled, pageId: auto.pageId || brandPages[0]?.id, fetchEveryHours: auto.fetchEveryHours, draftsPerDay: auto.draftsPerDay, minScore: auto.minScore, skipHighRisk: auto.skipHighRisk, imageSource: auto.imageSource, theme: auto.theme, postingSlots: slots } });
    return t('common.save');
  });
  const runAuto = () => run('autorun', async () => { const r = await api<{ fetched: number; shortlisted: number; drafted: number; errors: string[] }>(`${base}/brands/${brandId}/news/automation/run`, { method: 'POST' }); setTab('DRAFTED'); return `+${r.fetched} ข่าว · คัด ${r.shortlisted} · เขียน ${r.drafted}${r.errors.length ? ` · ${r.errors[0]}` : ''}`; });

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

      {brandId && canAi && brandPages.length > 0 && <PageScout base={base} pages={brandPages} initialPageId={pageParam} onBrief={(brief, pageId) => setScoutBrief({ brief, pageId, seq: Date.now() })} />}

      {brandId && canAi && <ResearchDesk base={base} brandId={brandId} pages={brandPages} conns={conns} openBrief={scoutBrief} onDrafted={() => { setTab('DRAFTED'); void load().catch(setError); }} />}

      {brandId && <ContentImport base={base} brandId={brandId} pages={brandPages} canWrite={canWrite} canConfigure={can('ai.configure')} onDrafted={() => { setTab('DRAFTED'); void load().catch(setError); }} />}

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
          {canWrite && (
            <div className="mt-3 space-y-2 rounded-lg border border-slate-800 p-3">
              <div className="text-sm font-semibold">{t('news.quickSources')}</div>
              <p className="text-xs text-slate-400">{t('news.quickSourcesHelp')}</p>
              <div className="flex flex-wrap items-center gap-2">
                {canAi && <><Input className="w-72" placeholder={t('news.suggestFocus')} value={focus} onChange={e => setFocus(e.target.value)} /><Button disabled={!!busy} onClick={suggest}>{busy === 'suggest' ? '…' : t('news.suggest')}</Button></>}
                <Button variant="ghost" disabled={!!busy} onClick={addPreset}>{busy === 'preset' ? '…' : t('news.preset')}</Button>
              </div>
              {sources.some(x => x.kind === 'SEARCH') && <p className="text-xs text-amber-300">{t('news.quotaEstimate')} ≈ {sources.filter(x => x.kind === 'SEARCH' && x.enabled).length * Math.ceil(24 / (autoRow?.enabled ? autoRow.fetchEveryHours : 24)) * 30} {t('news.perMonth')}</p>}
            </div>
          )}
        </Card>
        <div className="space-y-3">
          <ProviderKeyCard base={base} provider="tavily" title={t('news.searchKey')} help={t('news.searchKeyHelp')} placeholder="tvly-…" canConfigure={can('ai.configure')} />
          <ProviderKeyCard base={base} provider="pexels" title={t('news.photoKey')} help={t('news.photoKeyHelp')} placeholder="Pexels API key" canConfigure={can('ai.configure')} />
        </div>
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
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <div className="w-64"><Select value={imageSource} onChange={e => setImageSource(e.target.value as ImageSource)}>{IMAGE_SOURCES.map(x => <option key={x} value={x}>{t(`news.img.${x}` as MessageKey)}</option>)}</Select></div>
            {imageSource === 'ai' && <div className="w-72"><Select value={aiImageModel} onChange={e => setAiImageModel(e.target.value)}><option value="">{t('news.aiImageModel')}: {t('news.aiDefault')}</option>{modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>}
          </div>
        </Card>
      )}

      {canAi && (
        <Card title={t('news.auto')} actions={<div className="flex items-center gap-2">{autoRow?.lastRunAt && <span className="text-xs text-slate-400">{t('news.lastRun')} {fmt(autoRow.lastRunAt)}{autoRow.lastResult ? ` · เขียน ${autoRow.lastResult.drafted}` : ''}</span>}{autoRow && <Button variant="ghost" disabled={busy === 'autorun'} onClick={runAuto}>{busy === 'autorun' ? '…' : t('news.runNow')}</Button>}</div>}>
          <p className="text-xs text-slate-400">{t('news.autoHelp')}</p>
          {autoRow?.lastError && <p className="mt-1 text-xs text-rose-400">{autoRow.lastError}</p>}
          <div className="mt-2 grid items-end gap-2 md:grid-cols-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto.enabled} onChange={e => setAuto({ ...auto, enabled: e.target.checked })} /> {t('news.autoOn')}</label>
            <Field label={t('news.page')}><Select value={auto.pageId || brandPages[0]?.id || ''} onChange={e => setAuto({ ...auto, pageId: e.target.value })}>{brandPages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label={t('news.every')}><Input type="number" min={1} max={24} value={auto.fetchEveryHours} onChange={e => setAuto({ ...auto, fetchEveryHours: Number(e.target.value) })} /></Field>
            <Field label={t('news.perDay')}><Input type="number" min={0} max={20} value={auto.draftsPerDay} onChange={e => setAuto({ ...auto, draftsPerDay: Number(e.target.value) })} /></Field>
            <Field label={t('news.minScore')}><Input type="number" min={0} max={100} value={auto.minScore} onChange={e => setAuto({ ...auto, minScore: Number(e.target.value) })} /></Field>
            <Field label={t('news.slots')}><Input value={auto.slots} onChange={e => setAuto({ ...auto, slots: e.target.value })} /></Field>
            <Field label={t('news.theme')}><Select value={auto.theme} onChange={e => setAuto({ ...auto, theme: e.target.value })}>{THEMES.map(x => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <div className="flex flex-col gap-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={auto.skipHighRisk} onChange={e => setAuto({ ...auto, skipHighRisk: e.target.checked })} /> {t('news.skipHigh')}</label>
              <Select value={auto.imageSource} onChange={e => setAuto({ ...auto, imageSource: e.target.value as ImageSource })}>{IMAGE_SOURCES.map(x => <option key={x} value={x}>{t(`news.img.${x}` as MessageKey)}</option>)}</Select>
            </div>
            <Button disabled={busy === 'auto' || !brandPages.length} onClick={saveAuto}>{t('common.save')}</Button>
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
                {i.angle?.imported && <Pill tone="ok">{t('imp.badge')}</Pill>}
                {i.angle?.category && <Pill>{i.angle.category}</Pill>}
                {risk && <Pill tone={risk === 'HIGH' ? 'bad' : 'ok'}>{t(`news.risk.${risk}` as MessageKey)}</Pill>}
                <span>{i.sourceName ?? '—'} · {fmt(i.publishedAt ?? i.fetchedAt)}</span>
                {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{t('news.source')} ↗</a>}
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
                      <Input type="datetime-local" className="w-56" value={slotFor(i)} onChange={e => setWhen({ ...when, [i.id]: e.target.value })} />
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

/** คีย์ผู้ให้บริการภายนอกของห้องข่าว (Tavily ค้นข่าว / Pexels คลังภาพ) — เข้ารหัสฝั่งเซิร์ฟเวอร์ แสดงแค่ 4 ตัวท้าย */
function ProviderKeyCard({ base, provider, title, help, placeholder, canConfigure }: { base: string; provider: 'tavily' | 'pexels'; title: string; help: string; placeholder: string; canConfigure: boolean }) {
  const [view, setView] = useState<SearchProviderView | null>(null); const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  useEffect(() => { api<SearchProviderView>(`${base}/news/search-provider?provider=${provider}`).then(setView).catch(setError); }, [base, provider]);
  const save = async () => { setBusy(true); setError(null); try { setView(await api<SearchProviderView>(`${base}/news/search-provider`, { method: 'PUT', body: { provider, apiKey: key } })); setKey(''); } catch (e) { setError(e); } finally { setBusy(false); } };
  return (
    <Card title={title}>
      <p className="text-xs text-slate-400">{help}</p>
      <div className="mt-2 text-sm">{view?.configured ? <div className="space-y-1"><Pill tone={view.status === 'OK' ? 'ok' : view.status === 'UNKNOWN' ? 'muted' : 'bad'}>{view.status}</Pill> <span className="text-slate-400">{view.keyHint}</span><div className="text-xs text-slate-500">{t('news.calls')} {view.callCount}</div>{view.lastError && <div className="text-xs text-rose-400">{view.lastError}</div>}</div> : <span className="text-slate-400">{t('news.searchKeyNone')}</span>}</div>
      <ErrorBox error={error} />
      {canConfigure && <div className="mt-2 flex gap-2"><Input type="password" autoComplete="off" placeholder={placeholder} value={key} onChange={e => setKey(e.target.value)} /><Button disabled={busy || key.length < 8} onClick={save}>{t('common.save')}</Button></div>}
    </Card>
  );
}
