'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, type Client } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Textarea } from '@/components/ui';

export default function ClientsPage() {
  const { ws, can } = useWorkspace();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', contactName: '', email: '', phone: '', notes: '' });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Client[]>(`/workspaces/${ws.id}/clients`).then(setClients).catch(e => { setClients([]); setError(e); }), [ws.id]);
  useEffect(() => { setClients(null); void load(); }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ''));
    try { await api(`/workspaces/${ws.id}/clients`, { method: 'POST', body }); setF({ name: '', contactName: '', email: '', phone: '', notes: '' }); setOpen(false); await load(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(v => ({ ...v, [k]: e.target.value }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{t('clients.title')}</h1>{can('client.manage') && <Button onClick={() => setOpen(o => !o)}>{open ? t('common.cancel') : t('clients.new')}</Button>}</div>
      {open && (
        <Card title={t('clients.new')}>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label={t('clients.name')}><Input required value={f.name} onChange={set('name')} /></Field></div>
            <Field label={t('clients.contact')} hint={t('common.optional')}><Input value={f.contactName} onChange={set('contactName')} /></Field>
            <Field label={t('auth.email')} hint={t('common.optional')}><Input type="email" value={f.email} onChange={set('email')} /></Field>
            <Field label={t('clients.phone')} hint="+66812345678"><Input value={f.phone} onChange={set('phone')} /></Field>
            <div className="sm:col-span-2"><Field label={t('clients.notes')} hint={t('common.optional')}><Textarea value={f.notes} onChange={set('notes')} /></Field></div>
            <div className="sm:col-span-2"><ErrorBox error={error} /></div>
            <div className="sm:col-span-2 flex gap-2"><Button type="submit" disabled={busy}>{t('common.create')}</Button></div>
          </form>
        </Card>
      )}
      {!open && <ErrorBox error={error} />}
      {clients === null ? <Loading /> : clients.length === 0 ? <Empty /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map(c => (
            <Link key={c.id} href={`/clients/${c.id}`} className="rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-sky-700">
              <div className="flex items-start justify-between gap-2"><div className="font-semibold">{c.name}</div><Pill tone={c.status === 'ACTIVE' ? 'ok' : 'muted'}>{c.status}</Pill></div>
              <div className="mt-1 text-xs text-slate-400">{c.contactName ?? '—'} · {c.phone ?? '—'}</div>
              <div className="mt-2 text-xs text-slate-500">{c._count.brands} {t('clients.brands')}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
