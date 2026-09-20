'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BRAND_KNOWLEDGE_TYPES } from '@fbpm/shared';
import { api, type Brand, type KnowledgeItem } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select, Textarea } from '@/components/ui';

const kbTone = (s: string): 'ok' | 'warn' | 'bad' => (s === 'READY' ? 'ok' : s === 'PARTIAL' ? 'warn' : 'bad');
const BRAND_FIELDS = ['name', 'industry', 'description', 'targetAudience', 'toneOfVoice', 'serviceArea', 'primaryCTA', 'website'] as const;
type BrandField = (typeof BRAND_FIELDS)[number];
const LABEL: Record<BrandField, MessageKey> = { name: 'brands.name', industry: 'brands.industry', description: 'brands.description', targetAudience: 'brands.audience', toneOfVoice: 'brands.tone', serviceArea: 'brands.serviceArea', primaryCTA: 'brands.cta', website: 'brands.website' };

export default function BrandPage() {
  const { ws, can } = useWorkspace();
  const { brandId } = useParams<{ brandId: string }>();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [items, setItems] = useState<KnowledgeItem[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [bf, setBf] = useState<Record<BrandField, string>>({ name: '', industry: '', description: '', targetAudience: '', toneOfVoice: '', serviceArea: '', primaryCTA: '', website: '' });
  const [kf, setKf] = useState({ type: 'business_info', title: '', content: '', source: '' });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, k] = await Promise.all([api<Brand>(`/workspaces/${ws.id}/brands/${brandId}`), api<KnowledgeItem[]>(`/workspaces/${ws.id}/brands/${brandId}/knowledge`)]);
      setBrand(b); setItems(k);
      setBf(Object.fromEntries(BRAND_FIELDS.map(f => [f, b[f] ?? ''])) as Record<BrandField, string>);
    } catch (e) { setError(e); }
  }, [ws.id, brandId]);
  useEffect(() => { void load(); }, [load]);

  const saveBrand = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setSaved(false);
    const body = Object.fromEntries(Object.entries(bf).filter(([, v]) => v.trim() !== ''));
    try { await api(`/workspaces/${ws.id}/brands/${brandId}`, { method: 'PATCH', body }); setEditing(false); setSaved(true); await load(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const addItem = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api(`/workspaces/${ws.id}/brands/${brandId}/knowledge`, { method: 'POST', body: { ...kf, source: kf.source || undefined } }); setKf(v => ({ ...v, title: '', content: '', source: '' })); await load(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const toggle = (it: KnowledgeItem) => api(`/workspaces/${ws.id}/brands/${brandId}/knowledge/${it.id}`, { method: 'PATCH', body: { active: !it.active } }).then(load).catch(setError);
  const removeItem = (it: KnowledgeItem) => { if (confirm(t('common.confirmDelete'))) api(`/workspaces/${ws.id}/brands/${brandId}/knowledge/${it.id}`, { method: 'DELETE' }).then(load).catch(setError); };

  if (!brand || !items) return <div><ErrorBox error={error} /><Loading /></div>;
  const manage = can('client.manage');
  return (
    <div className="space-y-5">
      <Link href={`/clients/${brand.clientId}`} className="text-sm text-slate-400 hover:text-sky-400">← {brand.client.name}</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{brand.name}</h1><p className="text-sm text-slate-400">{brand.industry ?? '—'} · {brand.serviceArea ?? '—'}</p></div>
        <div className="flex items-center gap-2"><Pill tone={kbTone(brand.knowledgeBaseStatus)}>{t('brands.kbStatus')}: {t(`brands.kb.${brand.knowledgeBaseStatus}` as MessageKey)}</Pill>{manage && <Button variant="ghost" onClick={() => setEditing(v => !v)}>{editing ? t('common.cancel') : t('common.edit')}</Button>}</div>
      </div>
      <p className="text-xs text-slate-500">{t('brands.kbHint')}</p>
      {saved && <p className="text-sm text-emerald-400">✔ {t('common.saved')}</p>}
      <ErrorBox error={error} />

      {editing ? (
        <Card title={t('common.edit')}>
          <form onSubmit={saveBrand} className="grid gap-3 sm:grid-cols-2">
            {BRAND_FIELDS.map(f => (
              <div key={f} className={['description', 'targetAudience', 'toneOfVoice'].includes(f) ? 'sm:col-span-2' : ''}>
                <Field label={t(LABEL[f])}>{['description', 'targetAudience', 'toneOfVoice'].includes(f) ? <Textarea value={bf[f]} onChange={e => setBf(v => ({ ...v, [f]: e.target.value }))} /> : <Input value={bf[f]} onChange={e => setBf(v => ({ ...v, [f]: e.target.value }))} />}</Field>
              </div>
            ))}
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{t('common.save')}</Button></div>
          </form>
        </Card>
      ) : (
        <Card>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {BRAND_FIELDS.filter(f => f !== 'name').map(f => <div key={f}><dt className="text-xs text-slate-500">{t(LABEL[f])}</dt><dd className="whitespace-pre-wrap">{brand[f] || <span className="text-slate-600">—</span>}</dd></div>)}
          </dl>
        </Card>
      )}

      <Card title={`${t('knowledge.title')} (${items.length})`}>
        {manage && (
          <form onSubmit={addItem} className="mb-4 grid gap-3 rounded-lg border border-slate-800 p-3 sm:grid-cols-2">
            <Field label={t('knowledge.type')}><Select value={kf.type} onChange={e => setKf(v => ({ ...v, type: e.target.value }))}>{BRAND_KNOWLEDGE_TYPES.map(k => <option key={k} value={k}>{t(`kt.${k}` as MessageKey)}</option>)}</Select></Field>
            <Field label={t('knowledge.itemTitle')}><Input required value={kf.title} onChange={e => setKf(v => ({ ...v, title: e.target.value }))} /></Field>
            <div className="sm:col-span-2"><Field label={t('knowledge.content')}><Textarea required value={kf.content} onChange={e => setKf(v => ({ ...v, content: e.target.value }))} /></Field></div>
            <Field label={t('knowledge.source')} hint={t('common.optional')}><Input value={kf.source} onChange={e => setKf(v => ({ ...v, source: e.target.value }))} /></Field>
            <div className="flex items-end"><Button type="submit" disabled={busy}>{t('knowledge.new')}</Button></div>
          </form>
        )}
        {items.length === 0 ? <Empty /> : (
          <ul className="divide-y divide-slate-800">
            {items.map(it => (
              <li key={it.id} className={`py-3 ${it.active ? '' : 'opacity-50'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><Pill>{t(`kt.${it.type}` as MessageKey)}</Pill><span className="font-medium">{it.title}</span></div>
                  {manage && <div className="flex gap-2 text-xs"><button onClick={() => toggle(it)} className="text-slate-400 hover:text-sky-400">{it.active ? t('knowledge.active') + ' ✔' : t('knowledge.active') + ' ✖'}</button><button onClick={() => removeItem(it)} className="text-rose-400 hover:underline">{t('common.delete')}</button></div>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{it.content}</p>
                {it.source && <p className="mt-1 text-xs text-slate-500">{t('knowledge.source')}: {it.source}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
