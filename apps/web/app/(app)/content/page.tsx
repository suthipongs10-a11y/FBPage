'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CONTENT_STATUSES } from '@fbpm/shared';
import { api, type ContentItem, type PageRow } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { ContentCard } from '@/components/content-card';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Select, Textarea } from '@/components/ui';

export default function ContentPage() {
  const { ws, can } = useWorkspace();
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [filter, setFilter] = useState({ pageId: '', status: '' });
  const [nf, setNf] = useState({ pageId: '', title: '', caption: '', hashtags: '' });
  const [gf, setGf] = useState({ pageId: '', brief: '', count: 2 });
  const [showNew, setShowNew] = useState(false); const [showGen, setShowGen] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams(); if (filter.pageId) q.set('pageId', filter.pageId); if (filter.status) q.set('status', filter.status);
      const [p, c] = await Promise.all([api<PageRow[]>(`/workspaces/${ws.id}/pages`), api<ContentItem[]>(`/workspaces/${ws.id}/content?${q}`)]);
      setPages(p.filter(x => !x.disconnectedAt)); setItems(c);
    } catch (e) { setError(e); }
  }, [ws.id, filter]);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api(`/workspaces/${ws.id}/content`, { method: 'POST', body: { pageId: nf.pageId || pages?.[0]?.id, title: nf.title || undefined, caption: nf.caption || undefined, hashtags: nf.hashtags.split(/\s+/).filter(Boolean).map(h => h.replace(/^#/, '')) } }); setNf(v => ({ ...v, title: '', caption: '', hashtags: '' })); setShowNew(false); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const generate = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api(`/workspaces/${ws.id}/pages/${gf.pageId || pages?.[0]?.id}/content/generate`, { method: 'POST', body: { brief: gf.brief || undefined, count: gf.count } }); setShowGen(false); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };

  if (!pages || !items) return <div><ErrorBox error={error} /><Loading /></div>;
  const groups = [['READY_FOR_APPROVAL'], ['SCHEDULED', 'APPROVED', 'PUBLISHING'], ['PLANNED', 'IDEA', 'DRAFT', 'NEEDS_REVISION', 'AI_REVIEW', 'PUBLISH_FAILED', 'REJECTED'], ['PUBLISHED', 'ANALYZED'], ['CANCELLED']];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('content.title')}</h1><p className="text-sm text-slate-400">{t('content.subtitle')}</p></div>
        <div className="flex gap-2">{can('content.create') && <Button onClick={() => { setShowNew(v => !v); setShowGen(false); }}>{t('content.new')}</Button>}{can('content.create') && can('ai.use') && <Button variant="ghost" onClick={() => { setShowGen(v => !v); setShowNew(false); }}>{t('content.generateBulk')}</Button>}</div>
      </div>
      <ErrorBox error={error} />
      {pages.length === 0 && <Empty text={t('pages.none')} />}
      {showNew && pages.length > 0 && (
        <Card title={t('content.new')}><form onSubmit={create} className="grid gap-2 sm:grid-cols-2">
          <Field label={t('content.filterPage')}><Select value={nf.pageId || pages[0]!.id} onChange={e => setNf(v => ({ ...v, pageId: e.target.value }))}>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label={t('content.titleField')}><Input value={nf.title} onChange={e => setNf(v => ({ ...v, title: e.target.value }))} /></Field>
          <div className="sm:col-span-2"><Field label={t('content.caption')}><Textarea value={nf.caption} onChange={e => setNf(v => ({ ...v, caption: e.target.value }))} /></Field></div>
          <Field label={t('content.hashtags')}><Input value={nf.hashtags} onChange={e => setNf(v => ({ ...v, hashtags: e.target.value }))} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={busy}>{t('common.create')}</Button></div>
        </form></Card>
      )}
      {showGen && pages.length > 0 && (
        <Card title={t('content.generateBulk')}><form onSubmit={generate} className="grid gap-2 sm:grid-cols-4">
          <Field label={t('content.filterPage')}><Select value={gf.pageId || pages[0]!.id} onChange={e => setGf(v => ({ ...v, pageId: e.target.value }))}>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <div className="sm:col-span-2"><Field label={t('content.brief')}><Input value={gf.brief} onChange={e => setGf(v => ({ ...v, brief: e.target.value }))} placeholder="เช่น โพสต์ให้ความรู้เรื่องไรฝุ่น" /></Field></div>
          <Field label={t('content.count')}><Input type="number" min={1} max={5} value={gf.count} onChange={e => setGf(v => ({ ...v, count: Number(e.target.value) || 1 }))} /></Field>
          <div className="sm:col-span-4"><Button type="submit" disabled={busy}>{busy ? t('ai.thinking') : t('content.generate')}</Button></div>
        </form></Card>
      )}
      <div className="flex flex-wrap gap-2">
        <Select className="w-auto" value={filter.pageId} onChange={e => setFilter(v => ({ ...v, pageId: e.target.value }))}><option value="">{t('content.filterPage')}: {t('content.all')}</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select className="w-auto" value={filter.status} onChange={e => setFilter(v => ({ ...v, status: e.target.value }))}><option value="">{t('content.filterStatus')}: {t('content.all')}</option>{CONTENT_STATUSES.map(s => <option key={s} value={s}>{t(`cs.${s}` as MessageKey)}</option>)}</Select>
      </div>
      {items.length === 0 ? <Empty text={t('content.empty')} /> : groups.map(g => { const list = items.filter(i => g.includes(i.status)); if (!list.length) return null; return (
        <section key={g[0]} className="space-y-2"><h2 className="text-sm font-semibold text-slate-400">{g.map(s => t(`cs.${s}` as MessageKey)).join(' / ')} ({list.length})</h2>{list.map(i => <ContentCard key={i.id} item={i} onChange={load} />)}</section>); })}
    </div>
  );
}
