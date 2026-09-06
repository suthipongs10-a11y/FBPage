'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type AiProviderRow, type AiUsage, type Client, type ContentItem, type PageRow, type WorkspaceDetail, type WebOverview, type YtOverview } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Bars, SERIES, type Point } from '@/components/charts';
import { Card, Kpi, Loading, Pill } from '@/components/ui';

interface FbTrends { page: { id: string; name: string; followers: number | null }; weeks: { start: string; posts: number; shares: number | null }[]; available: { shares: boolean } }
interface YtTrends { channel: { id: string; title: string }; weeks: { start: string; videos: number; views: number | null }[] }
const wk = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

/** ภาพรวม (§36) — สรุปทั้งสองแพลตฟอร์มในหน้าเดียว: KPI มีสีประจำหัวข้อ, รายการ "ต้องดู", กราฟ 8 สัปดาห์ล่าสุด, ลูกค้า */
export default function OverviewPage() {
  const { ws, me } = useWorkspace();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [aiReady, setAiReady] = useState(true); const [yt, setYt] = useState<YtOverview | null>(null); const [web, setWeb] = useState<WebOverview | null>(null);
  const [fbTrend, setFbTrend] = useState<FbTrends | null>(null); const [ytTrend, setYtTrend] = useState<YtTrends | null>(null);
  useEffect(() => {
    setDetail(null); setClients(null); setPages(null); setFbTrend(null); setYtTrend(null);
    api<PageRow[]>(`/workspaces/${ws.id}/pages`).then(p => { setPages(p); const first = p.find(x => !x.disconnectedAt); if (first) api<FbTrends>(`/workspaces/${ws.id}/pages/${first.id}/trends?weeks=8`).then(setFbTrend).catch(() => setFbTrend(null)); }).catch(() => setPages([]));
    api<ContentItem[]>(`/workspaces/${ws.id}/content?limit=500`).then(setContent).catch(() => setContent([]));
    api<AiUsage>(`/workspaces/${ws.id}/ai/usage`).then(setUsage).catch(() => setUsage(null));
    api<AiProviderRow[]>(`/workspaces/${ws.id}/ai/providers`).then(p => setAiReady(p.some(x => x.configured || x.platformKey))).catch(() => setAiReady(true));
    api<WorkspaceDetail>(`/workspaces/${ws.id}`).then(setDetail).catch(() => setDetail(null));
    api<Client[]>(`/workspaces/${ws.id}/clients`).then(setClients).catch(() => setClients([]));
    api<WebOverview>(`/workspaces/${ws.id}/web/overview`).then(setWeb).catch(() => setWeb(null));
    api<YtOverview>(`/workspaces/${ws.id}/youtube/overview`).then(o => { setYt(o); if (o.channels > 0) api<{ id: string; disconnectedAt: string | null }[]>(`/workspaces/${ws.id}/youtube/channels`).then(cs => { const c = cs.find(x => !x.disconnectedAt); if (c) api<YtTrends>(`/workspaces/${ws.id}/youtube/channels/${c.id}/trends?weeks=8`).then(setYtTrend).catch(() => setYtTrend(null)); }).catch(() => undefined); }).catch(() => setYt(null));
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
  const fbContent = content.filter(c => (c.platform ?? 'FACEBOOK') === 'FACEBOOK');
  const pending = fbContent.filter(c => c.status === 'READY_FOR_APPROVAL').length;
  const scheduled = fbContent.filter(c => c.status === 'SCHEDULED');
  const failed = fbContent.filter(c => c.status === 'PUBLISH_FAILED').length;
  const publishedMonth = fbContent.filter(c => c.publishedAt && new Date(c.publishedAt) >= monthStart).length;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, 0); const dayAfter = new Date(tomorrow.getTime() + 86_400_000);
  if (pending > 0) attention.push({ text: `${pending} ${t('needsAttention.pendingApprovals')}`, href: '/content', tone: 'warn' });
  if (failed > 0) attention.push({ text: `${failed} ${t('needsAttention.publishFailed')}`, href: '/content', tone: 'bad' });
  if (activePages.length > 0 && !scheduled.some(c => c.scheduledAt && new Date(c.scheduledAt) >= tomorrow && new Date(c.scheduledAt) < dayAfter)) attention.push({ text: t('needsAttention.noTomorrow'), href: '/calendar', tone: 'warn' });
  if (usage?.monthlyBudgetUsd && usage.monthToDate.costUsd / usage.monthlyBudgetUsd >= 0.85) attention.push({ text: `${t('needsAttention.aiBudget')} ${Math.round((usage.monthToDate.costUsd / usage.monthlyBudgetUsd) * 100)}%`, href: '/ai-models', tone: 'warn' });
  if (!aiReady) attention.push({ text: t('needsAttention.noAi'), href: '/ai-models', tone: 'warn' });
  if (yt && yt.channels > 0) {
    if (yt.needReconnect > 0) attention.push({ text: `${yt.needReconnect} ${t('needsAttention.ytReconnect')}`, href: '/youtube', tone: 'bad' });
    if (yt.uploadFailed > 0) attention.push({ text: `${yt.uploadFailed} ${t('needsAttention.ytUploadFailed')}`, href: '/youtube/content', tone: 'bad' });
    if (yt.pendingApproval > 0) attention.push({ text: `${yt.pendingApproval} ${t('needsAttention.ytPending')}`, href: '/youtube/content', tone: 'warn' });
    if (yt.quota.softLimit && yt.quota.used / yt.quota.softLimit >= 0.8) attention.push({ text: `${t('needsAttention.ytQuota')} ${Math.round((yt.quota.used / yt.quota.softLimit) * 100)}%`, href: '/youtube', tone: 'warn' });
    if (yt.unresolvedComments > 0) attention.push({ text: `${yt.unresolvedComments} ${t('needsAttention.ytComments')}`, href: '/youtube/comments', tone: 'warn' });
    if (yt.openRecommendations > 0) attention.push({ text: `${yt.openRecommendations} ${t('needsAttention.ytRecs')}`, href: '/youtube', tone: 'warn' });
  }
  if (web && web.sites > 0) {
    if (web.down > 0) attention.push({ text: `${web.down} ${t('needsAttention.webDown')}`, href: '/web', tone: 'bad' });
    if (web.sslExpiring > 0) attention.push({ text: `${web.sslExpiring} ${t('needsAttention.webSsl')}`, href: '/web', tone: 'bad' });
    if (web.degraded > 0) attention.push({ text: `${web.degraded} ${t('needsAttention.webDegraded')}`, href: '/web', tone: 'warn' });
    if (web.gscNoAccess > 0) attention.push({ text: `${web.gscNoAccess} ${t('needsAttention.webGsc')}`, href: '/web', tone: 'warn' });
  }
  const pts = <T,>(rows: T[], label: (r: T) => string, value: (r: T) => number | null): Point[] => rows.map(r => ({ label: label(r), value: value(r) }));
  const hour = new Date().getHours(); const greet = hour < 12 ? 'สวัสดีตอนเช้า' : hour < 18 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const quotaPct = yt?.quota.softLimit ? Math.min(100, Math.round((yt.quota.used / yt.quota.softLimit) * 100)) : 0;
  return (
    <div className="space-y-6">
      {/* ---- hero ---- */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #2563eb, transparent 70%)' }} />
        <div className="pointer-events-none absolute -bottom-28 right-32 h-64 w-64 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #db2777, transparent 70%)' }} />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-sm text-slate-400">{greet}, {me.user.name}</p><h1 className="brand-gradient text-3xl font-bold">{ws.name}</h1><p className="mt-1 text-sm text-slate-400">{t('overview.title')} · {ws.timezone} · {new Date().toLocaleDateString('th-TH', { dateStyle: 'full' })}</p></div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone={attention.some(a => a.tone === 'bad') ? 'bad' : attention.length ? 'warn' : 'ok'}>{attention.length ? `${attention.length} รายการต้องดู` : 'ทุกอย่างเรียบร้อย'}</Pill>
            {usage && <Pill tone="muted">AI เดือนนี้ ${usage.monthToDate.costUsd.toFixed(2)} · {usage.monthToDate.tasks} งาน</Pill>}
          </div>
        </div>
      </div>

      {/* ---- KPI: workspace + Facebook ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi value={detail._count.clients} label={t('overview.clients')} accent="blue" icon="👥" sub={`${brands} ${t('overview.brands')}`} />
        <Kpi value={activePages.length} label={t('overview.pages')} accent="blue" icon="📘" tone={activePages.length ? undefined : 'warn'} sub={activePages.filter(p => p.tokenStatus !== 'VALID').length ? `${activePages.filter(p => p.tokenStatus !== 'VALID').length} ${t('overview.tokenErrors')}` : 'token ปกติ'} />
        <Kpi value={publishedMonth} label={t('overview.postsMonth')} accent="teal" icon="📝" />
        <Kpi value={scheduled.length} label={t('overview.scheduled')} accent="violet" icon="⏰" />
        <Kpi value={pending} label={t('overview.pending')} accent="amber" icon="✅" tone={pending ? 'warn' : undefined} sub={failed ? `${failed} ${t('overview.publishErrors')}` : undefined} />
      </div>
      {yt && yt.channels > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi value={yt.channels} label={t('yt.overviewChannels')} accent="pink" icon="▶" tone={yt.needReconnect ? 'bad' : undefined} />
          <Kpi value={yt.videosMonth} label={t('yt.overviewVideosMonth')} accent="pink" icon="🎬" />
          <Kpi value={yt.pendingApproval} label={t('yt.overviewPending')} accent="amber" icon="✅" tone={yt.pendingApproval ? 'warn' : undefined} sub={yt.uploadFailed ? `${yt.uploadFailed} ${t('yt.overviewFailed')}` : undefined} />
          <Kpi value={yt.processing + yt.scheduled} label={`${t('yt.overviewProcessing')} / ${t('yts.SCHEDULED')}`} accent="violet" icon="⬆" />
          <Kpi value={yt.unresolvedComments} label={t('yt.overviewComments')} accent="emerald" icon="💬" tone={yt.unresolvedComments ? 'warn' : undefined} sub={<span className="flex items-center gap-2">โควตา API {quotaPct}%<span className="h-1.5 flex-1 rounded-full bg-slate-800"><span className="block h-1.5 rounded-full" style={{ width: `${quotaPct}%`, background: quotaPct >= 80 ? '#d97706' : '#db2777' }} /></span></span>} />
        </div>
      )}

      {web && web.sites > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi value={web.sites} label={t('web.overviewSites')} accent="teal" icon="🌐" tone={web.down ? 'bad' : undefined} />
          <Kpi value={web.down} label={t('web.overviewDown')} accent="rose" icon="⛔" tone={web.down ? 'bad' : 'ok'} />
          <Kpi value={web.openIncidents} label={t('web.overviewIncidents')} accent="amber" icon="⚠" tone={web.openIncidents ? 'warn' : undefined} />
          <Kpi value={web.search.clicks ?? '—'} label={t('web.overviewClicks')} accent="teal" icon="🔎" />
        </div>
      )}
      {/* ---- charts + attention ---- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {fbTrend && <Bars title={`Facebook · ${fbTrend.page.name} · ${t('analytics.postsPerWeek')}`} unit={t('analytics.posts')} color={SERIES.facebook} points={pts(fbTrend.weeks, w => wk(w.start), w => w.posts)} height={120} />}
          {ytTrend && <Bars title={`YouTube · ${ytTrend.channel.title} · ${t('analytics.videosPerWeek')}`} unit={t('yt.videos')} color={SERIES.youtube} points={pts(ytTrend.weeks, w => wk(w.start), w => w.videos)} height={120} />}
          {!fbTrend && !ytTrend && <Card><p className="text-sm text-slate-500">{t('analytics.empty')}</p></Card>}
          <div className="text-right text-xs"><Link href="/analytics" className="text-sky-400 hover:underline">{t('analytics.title')} →</Link></div>
        </div>
        <Card title={t('needsAttention.title')}>
          {attention.length === 0 ? <p className="rounded-lg border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">✔ ไม่มีรายการค้าง</p> : (
            <ul className="space-y-2 text-sm">
              {attention.map((a, i) => (
                <li key={i} className={`rounded-lg border px-3 py-2 ${a.tone === 'bad' ? 'border-rose-900 bg-rose-950 text-rose-300' : 'border-amber-900 bg-amber-950 text-amber-300'}`}>
                  {a.href ? <Link href={a.href} className="hover:underline">{a.text} →</Link> : a.text}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('clients.title')} actions={<Link href="/clients" className="text-sm text-sky-400">{t('clients.new')} →</Link>}>
        {clients.length === 0 ? <p className="text-sm text-slate-500">{t('common.empty')}</p> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {clients.slice(0, 8).map((c, i) => <Link key={c.id} href={`/clients/${c.id}`} className="accent-stripe rounded-lg border border-slate-800 bg-slate-900 p-3 pl-4 text-sm hover:border-sky-700" style={{ ['--accent' as string]: ['#2563eb', '#7c3aed', '#db2777', '#0d9488', '#d97706', '#059669'][i % 6] } as React.CSSProperties}><div className="font-medium">{c.name}</div><div className="text-xs text-slate-500">{c._count.brands} {t('overview.brands')} · {c.status}</div></Link>)}
          </div>
        )}
      </Card>
    </div>
  );
}
