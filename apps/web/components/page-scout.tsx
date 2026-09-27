'use client';
/** ผู้ช่วยหาเรื่องโพสต์ต่อเพจ — ① เช็คข้อมูลเพจ ② หาเรื่องที่เหมาะ/เป็นกระแส → ค้นคว้า+เขียนเรื่องที่เลือกในโต๊ะค้นคว้า */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type PageRow, type ResearchBriefRow, type ResearchCaps, type ScoutIdea, type ScoutView } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { Button, Card, ErrorBox, Field, Input, Pill, Select } from '@/components/ui';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('th-TH'));
const KIND_TONE: Record<ScoutIdea['kind'], 'ok' | 'warn' | 'muted'> = { trend: 'warn', seasonal: 'ok', evergreen: 'muted', promo: 'ok' };

export function PageScout({ base, pages, initialPageId, onBrief, onDrafted }: { base: string; pages: PageRow[]; initialPageId?: string; onBrief: (brief: ResearchBriefRow, pageId: string) => void; onDrafted: () => void }) {
  const [pageId, setPageId] = useState(initialPageId && pages.some(p => p.id === initialPageId) ? initialPageId : pages[0]?.id ?? '');
  const [scout, setScout] = useState<ScoutView | null>(null);
  const [caps, setCaps] = useState<ResearchCaps | null>(null);
  const [opt, setOpt] = useState({ mode: 'ai' as 'ai' | 'web', count: 6, focus: '', keywords: '', model: '', image: 'stock' as 'stock' | 'ai' | 'none' });
  const [written, setWritten] = useState<Record<number, { drafted: number; flagged: number; error: string | null }>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null);

  const ids = pages.map(x => x.id).join(',');
  // เปิดจากหน้าเพจ (?page=) → เลือกเพจนั้น · เปลี่ยนแบรนด์แล้วเพจเดิมไม่อยู่ในรายการ → เลือกเพจแรก
  useEffect(() => { if (initialPageId && ids.split(',').includes(initialPageId)) setPageId(initialPageId); }, [initialPageId, ids]);
  useEffect(() => { const list = ids ? ids.split(',') : []; setPageId(cur => (cur && list.includes(cur) ? cur : list[0] ?? '')); }, [ids]);
  const load = useCallback(async () => {
    if (!pageId) return;
    const [s, c] = await Promise.all([api<ScoutView | null>(`${base}/pages/${pageId}/scout`), api<ResearchCaps>(`${base}/news/research/capabilities`)]);
    setScout(s); setCaps(c);
    setOpt(o => ({ ...o, mode: c.webSearch.length || c.researchRoleSearches ? o.mode : c.tavily ? 'web' : o.mode, model: o.model || (c.webSearch[0] ? `${c.webSearch[0].connectionId}|${c.webSearch[0].model}` : '') }));
  }, [base, pageId]);
  useEffect(() => { setScout(null); void load().catch(setError); }, [load]);
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const override = () => { if (opt.mode !== 'ai' || !opt.model) return undefined; const [connectionId, model] = opt.model.split('|'); return { connectionId: connectionId!, ...(model && { model }) }; };

  const check = () => run('check', async () => { setScout(await api<ScoutView>(`${base}/pages/${pageId}/scout/check`, { method: 'POST', body: {} })); });
  const ideas = () => run('ideas', async () => { setWritten({}); setScout(await api<ScoutView>(`${base}/pages/${pageId}/scout/ideas`, { method: 'POST', body: { mode: opt.mode, count: opt.count, ...(opt.keywords.trim() && { keywords: opt.keywords.trim() }), ...(opt.focus && { focus: opt.focus }), ...(override() && { modelOverride: override() }) } })); });
  // ไอเดีย → ค้นคว้า → เขียน + ตรวจข้อเท็จจริง → ร่างรออนุมัติ ในคลิกเดียว
  const writeNow = (i: number) => run(`w:${i}`, async () => {
    const r = await api<{ import: { draftCount: number; postCount: number }; factCheck: { flagged: number; error: string | null }; idea: ScoutIdea }>(`${base}/pages/${pageId}/scout/ideas/${i}/write`, { method: 'POST', body: { imageFallback: opt.image, ...(opt.mode === 'ai' && override() && { searchOverride: override() }) } });
    setScout(s => (s ? { ...s, ideas: s.ideas.map((x, k) => (k === i ? r.idea : x)) } : s));
    setWritten(w => ({ ...w, [i]: { drafted: r.import.draftCount, flagged: r.factCheck.flagged, error: r.factCheck.error } }));
    if (r.import.draftCount) onDrafted();
  });
  const research = (i: number) => run(`r:${i}`, async () => {
    const r = await api<{ brief: ResearchBriefRow; idea: ScoutIdea }>(`${base}/pages/${pageId}/scout/ideas/${i}/research`, { method: 'POST', body: opt.mode === 'ai' && override() ? { searchOverride: override() } : {} });
    setScout(s => (s ? { ...s, ideas: s.ideas.map((x, k) => (k === i ? r.idea : x)) } : s));
    onBrief(r.brief, pageId);
  });

  const f = scout?.facts; const p = scout?.profile;
  const src = (k: number) => scout?.ideaSources.find(s => s.n === k);
  const aiReady = !!caps && (caps.webSearch.length > 0 || caps.researchRoleSearches);

  return (
    <Card title={t('sc.title')}>
      <p className="text-xs text-slate-400">{t('sc.help')}</p>
      <ErrorBox error={error} />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="w-64"><Field label={t('sc.page')}><Select value={pageId} onChange={e => setPageId(e.target.value)}>{pages.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field></div>
        <Button disabled={!pageId || !!busy} onClick={check}>{busy === 'check' ? t('sc.checking') : t('sc.check')}</Button>
        {scout?.profiledAt && <span className="text-xs text-slate-500">{t('sc.checkedAt')} {fmt(scout.profiledAt)}</span>}
      </div>

      {f && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-slate-800 p-3 text-sm">
            <div className="flex flex-wrap gap-3">
              <span><span className="text-slate-400">{t('sc.completeness')}</span> <b className={f.completenessScore >= 80 ? 'text-emerald-400' : 'text-amber-300'}>{f.completenessScore}%</b></span>
              <span><span className="text-slate-400">{t('sc.followers')}</span> <b>{n(f.followers)}</b></span>
              <span><span className="text-slate-400">{t('sc.perWeek')}</span> <b>{f.postsPerWeek}</b></span>
              <span><span className="text-slate-400">{t('sc.lastPost')}</span> <b>{f.lastPostAt ? fmt(f.lastPostAt) : '—'}</b></span>
            </div>
            {f.missing.length > 0 && <div className="text-xs text-amber-300">{t('sc.missing')}: {f.missing.map(m => m.label).join(' · ')} <Link href={`/pages/${pageId}`} className="text-sky-400 hover:underline">→</Link></div>}
            {f.warnings.map((w, i) => <p key={i} className="text-xs text-amber-300">⚠ {w}</p>)}
            <div className="text-xs font-semibold text-slate-300">{t('sc.topPosts')}</div>
            {f.metricsAvailable ? <ul className="space-y-1 text-xs">{f.topPosts.map((x, i) => <li key={i}><Pill tone="ok">{n(x.engagement)}</Pill> {x.permalink ? <a href={x.permalink} target="_blank" rel="noreferrer" className="hover:text-sky-400">{x.message || '(ไม่มีข้อความ)'}</a> : x.message}</li>)}</ul> : <p className="text-xs text-slate-500">{t('sc.noMetrics')}</p>}
          </div>
          {p && (
            <div className="space-y-2 rounded-lg border border-slate-800 p-3 text-sm">
              <div><span className="text-slate-400">{t('sc.profile')}:</span> {p.summary}</div>
              {p.audience && <div><span className="text-slate-400">{t('sc.audience')}:</span> {p.audience}</div>}
              {p.pillars.length > 0 && <div className="flex flex-wrap gap-1"><span className="text-slate-400">{t('sc.pillars')}:</span>{p.pillars.map(x => <Pill key={x.name}>{x.name}</Pill>)}</div>}
              {p.whatWorks.length > 0 && <div className="text-xs"><span className="text-slate-400">{t('sc.works')}:</span> {p.whatWorks.join(' · ')}</div>}
              {p.gaps.length > 0 && <div className="text-xs"><span className="text-slate-400">{t('sc.gaps')}:</span> {p.gaps.join(' · ')}</div>}
              {p.seasonalHooks.length > 0 && <div className="text-xs"><span className="text-slate-400">{t('sc.seasonal')}:</span> {p.seasonalHooks.join(' · ')}</div>}
              {p.avoid.length > 0 && <div className="text-xs"><span className="text-slate-400">{t('sc.avoid')}:</span> {p.avoid.join(' · ')}</div>}
              <div className="text-xs text-slate-500">{t('sc.topics')}: {p.searchTopics.map(x => x.query).join(' · ')}</div>
              {p.dataWarnings.map((w, i) => <p key={i} className="text-xs text-amber-300">⚠ {w}</p>)}
            </div>
          )}
        </div>
      )}

      {scout?.profile && (
        <div className="mt-3 space-y-2">
          <div className="grid items-end gap-2 md:grid-cols-[160px_1fr_110px_180px]">
            <Field label=" "><Select value={opt.mode} onChange={e => setOpt({ ...opt, mode: e.target.value as 'ai' | 'web' })}><option value="ai" disabled={!aiReady}>{t('sc.mode.ai')}</option><option value="web" disabled={!caps?.tavily}>{t('sc.mode.web')}</option></Select></Field>
            {opt.mode === 'ai'
              ? <Field label={t('rs.searchModel')}><Select value={opt.model} onChange={e => setOpt({ ...opt, model: e.target.value })}>{caps?.researchRoleSearches && <option value="">{t('news.aiDefault')} (research)</option>}{(caps?.webSearch ?? []).map(o => <option key={`${o.connectionId}|${o.model}`} value={`${o.connectionId}|${o.model}`}>{o.label} · {o.model}</option>)}</Select></Field>
              : <div />}
            <Field label={t('sc.count')}><Select value={opt.count} onChange={e => setOpt({ ...opt, count: Number(e.target.value) })}>{[3, 6, 9, 12].map(x => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Field label={t('sc.image')}><Select value={opt.image} onChange={e => setOpt({ ...opt, image: e.target.value as 'stock' | 'ai' | 'none' })}>{(['stock', 'ai', 'none'] as const).map(x => <option key={x} value={x}>{t(`news.img.${x}` as MessageKey)}</option>)}</Select></Field>
          </div>
          <div className="grid items-end gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Field label={t('sc.keywords')}><Input value={opt.keywords} placeholder={t('sc.keywordsPh')} onChange={e => setOpt({ ...opt, keywords: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !busy) ideas(); }} /></Field>
            <Field label={t('sc.focus')}><Input value={opt.focus} placeholder="เช่น เน้นลูกค้าต่างชาติ / ช่วงฤดูฝน" onChange={e => setOpt({ ...opt, focus: e.target.value })} /></Field>
            <Button disabled={!!busy || (opt.mode === 'ai' ? !aiReady : !caps?.tavily)} onClick={ideas}>{busy === 'ideas' ? t('sc.searching') : t('sc.ideas')}</Button>
          </div>
          <p className="text-xs text-slate-500">{t('sc.keywordsHelp')}</p>
        </div>
      )}
      {scout?.profile && caps && !aiReady && !caps.tavily && <p className="mt-1 text-xs text-amber-300">{t('rs.noSearchModel')} · {t('rs.noTavily')}</p>}
      {scout?.failures?.length ? <p className="mt-1 text-xs text-slate-500">{scout.failures.join(' · ')}</p> : null}

      {scout && scout.ideas.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-slate-500">{t('sc.ideasAt')} {fmt(scout.scoutedAt)} · {scout.model}</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">{scout.ideas.map((it, i) => (
            <div key={i} className="space-y-1 rounded-lg border border-slate-800 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-1"><Pill tone={KIND_TONE[it.kind]}>{t(`sc.kind.${it.kind}` as MessageKey)}</Pill><Pill>{t(`rs.style.${it.format}` as MessageKey)}</Pill></div>
              <div className="font-semibold">{it.title}</div>
              {it.why && <p className="text-xs text-emerald-300">💡 {it.why}</p>}
              {it.trend && <p className="text-xs text-amber-200">📈 {it.trend}</p>}
              {it.angle && <p className="text-xs text-slate-400">🎯 {it.angle}</p>}
              {it.sources.length > 0 && <div className="text-xs">{it.sources.map(k => { const s = src(k); return s ? <a key={k} href={s.url} target="_blank" rel="noreferrer" className="mr-2 text-sky-400 hover:underline">[{k}] {s.siteName ?? s.title}</a> : null; })}</div>}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button disabled={!!busy} onClick={() => writeNow(i)}>{busy === `w:${i}` ? t('sc.writing') : t('sc.writeNow')}</Button>
                <Button variant="ghost" disabled={!!busy} onClick={() => research(i)}>{busy === `r:${i}` ? t('rs.running') : t('sc.research')}</Button>
              </div>
              {written[i] && <p className="text-xs text-emerald-400">✔ {t('sc.drafted').replace('{n}', String(written[i]!.drafted))}{written[i]!.flagged > 0 ? <span className="text-amber-300"> · ⚠ {t('sc.flagged').replace('{n}', String(written[i]!.flagged))}</span> : null}</p>}
              {!written[i] && (it.drafted ?? 0) > 0 && <p className="text-xs text-emerald-400">✔ {t('sc.drafted').replace('{n}', String(it.drafted))}</p>}
              {!written[i] && !it.drafted && it.briefId && <p className="text-xs text-slate-400">✔ {t('sc.researched')}</p>}
            </div>
          ))}</div>
        </div>
      )}
    </Card>
  );
}
