'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, type ClientDetail } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select } from '@/components/ui';

const kbTone = (s: string): 'ok' | 'warn' | 'bad' => (s === 'READY' ? 'ok' : s === 'PARTIAL' ? 'warn' : 'bad');

export default function ClientDetailPage() {
  const { ws, can } = useWorkspace(); const router = useRouter();
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', industry: '', serviceArea: '', preferredLanguage: 'th', primaryCTA: '' });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<ClientDetail>(`/workspaces/${ws.id}/clients/${clientId}`).then(setClient).catch(setError), [ws.id, clientId]);
  useEffect(() => { void load(); }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ''));
    try { await api(`/workspaces/${ws.id}/clients/${clientId}/brands`, { method: 'POST', body }); setOpen(false); setF({ name: '', industry: '', serviceArea: '', preferredLanguage: 'th', primaryCTA: '' }); await load(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(t('common.confirmDelete'))) return;
    try { await api(`/workspaces/${ws.id}/clients/${clientId}`, { method: 'DELETE' }); router.replace('/clients'); } catch (err) { setError(err); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(v => ({ ...v, [k]: e.target.value }));

  if (!client) return <div><ErrorBox error={error} /><Loading /></div>;
  return (
    <div className="space-y-5">
      <Link href="/clients" className="text-sm text-slate-400 hover:text-sky-400">← {t('clients.title')}</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{client.name}</h1><p className="text-sm text-slate-400">{client.contactName ?? '—'} · {client.email ?? '—'} · {client.phone ?? '—'}</p></div>
        {can('client.manage') && <div className="flex gap-2"><Button onClick={() => setOpen(o => !o)}>{open ? t('common.cancel') : t('brands.new')}</Button><Button variant="danger" onClick={remove}>{t('common.delete')}</Button></div>}
      </div>
      {client.notes && <Card><p className="whitespace-pre-wrap text-sm text-slate-300">{client.notes}</p></Card>}
      {open && (
        <Card title={t('brands.new')}>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label={t('brands.name')}><Input required value={f.name} onChange={set('name')} /></Field></div>
            <Field label={t('brands.industry')} hint={t('common.optional')}><Input value={f.industry} onChange={set('industry')} placeholder="เช่น ให้เช่าอุปกรณ์งานพิธี" /></Field>
            <Field label={t('brands.language')}><Select value={f.preferredLanguage} onChange={set('preferredLanguage')}><option value="th">ไทย</option><option value="en">English</option></Select></Field>
            <Field label={t('brands.serviceArea')} hint={t('common.optional')}><Input value={f.serviceArea} onChange={set('serviceArea')} placeholder="ภูเก็ต / พังงา" /></Field>
            <Field label={t('brands.cta')} hint={t('common.optional')}><Input value={f.primaryCTA} onChange={set('primaryCTA')} placeholder="โทร 061-965-6292" /></Field>
            <div className="sm:col-span-2"><ErrorBox error={error} /></div>
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{t('common.create')}</Button></div>
          </form>
        </Card>
      )}
      {!open && <ErrorBox error={error} />}
      <Card title={`${t('brands.title')} (${client.brands.length})`}>
        {client.brands.length === 0 ? <Empty /> : (
          <ul className="divide-y divide-slate-800">
            {client.brands.map(b => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <Link href={`/brands/${b.id}`} className="font-medium hover:text-sky-400">{b.name}<span className="ml-2 text-xs text-slate-500">{b.industry ?? ''}</span></Link>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{b._count.knowledge} {t('knowledge.title').split(' ')[0]}</span>
                  <Pill tone={kbTone(b.knowledgeBaseStatus)}>{t(`brands.kb.${b.knowledgeBaseStatus}` as MessageKey)}</Pill>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
