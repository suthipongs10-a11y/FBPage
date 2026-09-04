'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type AiProviderRow, type AiUsage, type Client, type ContentItem, type PageRow, type WorkspaceDetail } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Card, Kpi, Loading } from '@/components/ui';

export default function OverviewPage() {
  const { ws } = useWorkspace();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [aiReady, setAiReady] = useState(true);
  useEffect(() => {
    setDetail(null); setClients(null); setPages(null);
    api<PageRow[]>(`/workspaces/${ws.id}/pages`).then(setPages).catch(() => setPages([]));
    api<ContentItem[]>(`/workspaces/${ws.id}/content?limit=500`).then(setContent).catch(() => setContent([]));
    api<AiUsage>(`/workspaces/${ws.id}/ai/usage`).then(setUsage).catch(() => setUsage(null));
    api<AiProviderRow[]>(`/workspaces/${ws.id}/ai/providers`).then(p => setAiReady(p.some(x => x.configured || x.platformKey))).catch(() => setAiReady(true));
    api<WorkspaceDetail>(`/workspaces/${ws.id}`).then(setDetail).catch(() => setDetail(null));
    api<Client[]>(`/workspaces/${ws.id}/clients`).then(setClients).catch(() => setClients([]));
  }, [ws.id]);
  if (!detail || !clients || !pages) return <Loading />;
  const activePages = pages.filter(p => !p.disconnectedAt);

  const brands = clients.reduce((n, c) => n + c._count.brands, 0);
  const attention: { text: string; href?: string; tone: 'warn' | 'bad' }[] = [];
  if (clients.length === 0) attention.push({ text: t('needsAttention.noClients'), href: '/clients', tone: 'warn' });
  if (ws.automationPaused) attention.push({ text: t('needsAttention.automationPaused'), href: '/settings', tone: 'bad' });
  if (activePages.length === 0) attention.push({ text: t('needsAttention.noPages'), href: '/pages', tone: 'warn' });
  if (activePages.some(p => p.tokenStatus === 'INVALID')) attention.push({ text: t('needsAttention.pageTokenInvalid'), href: '/pages', tone: 'bad' });
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const pending = content.filter(c => c.status === 'READY_FOR_APPROVAL').length;
  const scheduled = content.filter(c => c.status === 'SCHEDULED');
  const failed = content.filter(c => c.status === 'PUBLISH_FAILED').length;
  const publishedMonth = content.filter(c => c.publishedAt && new Date(c.publishedAt) >= monthStart).length;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, 0); const dayAfter = new Date(tomorrow.getTime() + 86_400_000);
  if (pending > 0) attention.push({ text: `${pending} ${t('needsAttention.pendingApprovals')}`, href: '/content', tone: 'warn' });
  if (failed > 0) attention.push({ text: `${failed} ${t('needsAttention.publishFailed')}`, href: '/content', tone: 'bad' });
  if (activePages.length > 0 && !scheduled.some(c => c.scheduledAt && new Date(c.scheduledAt) >= tomorrow && new Date(c.scheduledAt) < dayAfter)) attention.push({ text: t('needsAttention.noTomorrow'), href: '/calendar', tone: 'warn' });
  if (usage?.monthlyBudgetUsd && usage.monthToDate.costUsd / usage.monthlyBudgetUsd >= 0.85) attention.push({ text: `${t('needsAttention.aiBudget')} ${Math.round((usage.monthToDate.costUsd / usage.monthlyBudgetUsd) * 100)}%`, href: '/ai-models', tone: 'warn' });
  if (!aiReady) attention.push({ text: t('needsAttention.noAi'), href: '/ai-models', tone: 'warn' });

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">{t('overview.title')}</h1><p className="text-sm text-slate-400">{ws.name} · {ws.timezone}</p></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi value={detail._count.clients} label={t('overview.clients')} />
        <Kpi value={brands} label={t('overview.brands')} />
        <Kpi value={activePages.length} label={t('overview.pages')} tone={activePages.length ? undefined : 'warn'} />
        <Kpi value={publishedMonth} label={t('overview.postsMonth')} />
        <Kpi value={scheduled.length} label={t('overview.scheduled')} />
        <Kpi value={pending} label={t('overview.pending')} tone={pending ? 'warn' : undefined} />
        <Kpi value={failed} label={t('overview.publishErrors')} tone={failed ? 'bad' : undefined} />
        <Kpi value={activePages.filter(p => p.tokenStatus !== 'VALID').length} label={t('overview.tokenErrors')} tone={activePages.some(p => p.tokenStatus !== 'VALID') ? 'bad' : undefined} />
        <Kpi value={usage ? `$${usage.monthToDate.costUsd.toFixed(2)}` : '—'} label={t('overview.aiSpend')} />
        <Kpi value={detail._count.members} label={t('overview.members')} />
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
