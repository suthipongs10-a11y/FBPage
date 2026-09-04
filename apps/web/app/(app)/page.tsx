'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Client, type WorkspaceDetail } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Card, Kpi, Loading } from '@/components/ui';

export default function OverviewPage() {
  const { ws } = useWorkspace();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [clients, setClients] = useState<Client[] | null>(null);
  useEffect(() => {
    setDetail(null); setClients(null);
    api<WorkspaceDetail>(`/workspaces/${ws.id}`).then(setDetail).catch(() => setDetail(null));
    api<Client[]>(`/workspaces/${ws.id}/clients`).then(setClients).catch(() => setClients([]));
  }, [ws.id]);
  if (!detail || !clients) return <Loading />;

  const brands = clients.reduce((n, c) => n + c._count.brands, 0);
  const attention: { text: string; href?: string; tone: 'warn' | 'bad' }[] = [];
  if (clients.length === 0) attention.push({ text: t('needsAttention.noClients'), href: '/clients', tone: 'warn' });
  if (ws.automationPaused) attention.push({ text: t('needsAttention.automationPaused'), href: '/settings', tone: 'bad' });
  attention.push({ text: t('needsAttention.noPages'), tone: 'warn' });

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">{t('overview.title')}</h1><p className="text-sm text-slate-400">{ws.name} · {ws.timezone}</p></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi value={detail._count.clients} label={t('overview.clients')} />
        <Kpi value={brands} label={t('overview.brands')} />
        <Kpi value={detail._count.members} label={t('overview.members')} />
        <Kpi value={0} label={t('overview.pages')} />
        <Kpi value={0} label={t('overview.pending')} />
        <Kpi value={0} label={t('overview.leads')} />
      </div>
      <Card title={t('needsAttention.title')}>
        <ul className="space-y-2 text-sm">
          {attention.map((a, i) => (
            <li key={i} className={`rounded-lg border px-3 py-2 ${a.tone === 'bad' ? 'border-rose-900 bg-rose-950/50 text-rose-200' : 'border-amber-900 bg-amber-950/40 text-amber-200'}`}>
              {a.href ? <Link href={a.href} className="hover:underline">{a.text} →</Link> : a.text}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('clients.title')} actions={<Link href="/clients" className="text-sm text-sky-400">{t('clients.new')} →</Link>}>
        {clients.length === 0 ? <p className="text-sm text-slate-500">{t('common.empty')}</p> : (
          <ul className="divide-y divide-slate-800 text-sm">
            {clients.slice(0, 8).map(c => <li key={c.id} className="flex items-center justify-between py-2"><Link href={`/clients/${c.id}`} className="hover:text-sky-400">{c.name}</Link><span className="text-xs text-slate-500">{c._count.brands} {t('clients.brands')}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
