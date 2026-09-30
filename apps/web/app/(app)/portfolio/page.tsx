'use client';
/** ภาพรวมทุกเพจ — แพ็กเกจ + โควต้าโพสต์รอบนี้ + งานค้างของแต่ละเพจในหน้าเดียว (docs/PLANS_QUOTA.md) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { baht, cycleLabel, shortDate, type Portfolio, type PortfolioRow, type ServicePlan } from '@/lib/plans';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Input, Kpi, Loading, Pill, Select } from '@/components/ui';
import { PacePill, QuotaBar } from '@/components/quota-bar';
import { PlansManager } from '@/components/plans-manager';

type Filter = 'all' | 'attention' | 'behind' | 'noPlan' | 'over';
type Sort = 'attention' | 'remaining' | 'name' | 'client';
const SERIOUS = ['TOKEN', 'PAUSED', 'FAILED', 'BEHIND', 'OVER', 'REELS_OVER', 'NO_UPCOMING', 'STALE'];
const ATT_TONE: Record<string, 'bad' | 'warn' | 'muted'> = { TOKEN: 'bad', PAUSED: 'bad', FAILED: 'bad', OVER: 'bad', REELS_OVER: 'warn', BEHIND: 'warn', NO_UPCOMING: 'warn', STALE: 'warn', APPROVAL: 'warn', NO_PLAN: 'muted' };
const score = (r: PortfolioRow) => r.attention.reduce((n, a) => n + (ATT_TONE[a] === 'bad' ? 10 : ATT_TONE[a] === 'warn' ? 3 : 1), 0);

function csv(rows: PortfolioRow[], money: boolean): string {
  const head = ['client', 'page', 'plan', ...(money ? ['price_thb'] : []), 'cycle_start', 'cycle_end', 'quota', 'posted', 'scheduled', 'remaining', 'pace', 'reels_planned', 'reels_quota', 'posts_on_page', 'pending_approval', 'comments_pending', 'new_leads', 'last_post'];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map(r => [r.client.name, r.page.name, r.plan?.name ?? '', ...(money ? [r.plan?.priceMonthly ?? ''] : []), r.cycle.startDate, r.cycle.lastDate, r.quota.limit ?? '', r.quota.used, r.quota.planned - r.quota.used, r.quota.remaining ?? '', r.quota.pace, r.reels.planned, r.reels.limit ?? '', r.pagePosts, r.activity.pendingApproval, r.activity.commentsPending, r.activity.newLeads, r.activity.lastPostAt?.slice(0, 10) ?? ''].map(esc).join(','));
  return '﻿' + [head.join(','), ...lines].join('\n');   // BOM ให้ Excel อ่านภาษาไทยถูก
}

export default function PortfolioPage() {
  const { ws, can } = useWorkspace(); const manage = can('client.manage');
  const [tab, setTab] = useState<'pages' | 'plans'>('pages');
  const [pf, setPf] = useState<Portfolio | null>(null); const [plans, setPlans] = useState<ServicePlan[]>([]); const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<Filter>('all'); const [sort, setSort] = useState<Sort>('attention'); const [clientId, setClientId] = useState(''); const [q, setQ] = useState('');
  const load = useCallback(() => Promise.all([api<Portfolio>(`/workspaces/${ws.id}/portfolio`).then(setPf), api<ServicePlan[]>(`/workspaces/${ws.id}/plans`).then(setPlans)]).catch(setError), [ws.id]);
  useEffect(() => { setPf(null); void load(); }, [load]);

  const clients = useMemo(() => [...new Map((pf?.rows ?? []).map(r => [r.client.id, r.client.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'th')), [pf]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (pf?.rows ?? []).filter(r => (!clientId || r.client.id === clientId) && (!needle || `${r.page.name} ${r.client.name} ${r.brand.name}`.toLowerCase().includes(needle))
      && (filter === 'all' || (filter === 'attention' && r.attention.some(a => SERIOUS.includes(a))) || (filter === 'behind' && r.quota.pace === 'BEHIND') || (filter === 'noPlan' && !r.plan) || (filter === 'over' && (r.quota.pace === 'OVER' || r.attention.includes('REELS_OVER')))));
    const by: Record<Sort, (a: PortfolioRow, b: PortfolioRow) => number> = {
      attention: (a, b) => score(b) - score(a) || a.page.name.localeCompare(b.page.name, 'th'),
      remaining: (a, b) => (b.quota.remaining ?? -Infinity) - (a.quota.remaining ?? -Infinity),
      name: (a, b) => a.page.name.localeCompare(b.page.name, 'th'),
      client: (a, b) => a.client.name.localeCompare(b.client.name, 'th') || a.page.name.localeCompare(b.page.name, 'th'),
    };
    return [...list].sort(by[sort]);
  }, [pf, filter, sort, clientId, q]);

  const download = () => {
    if (!pf) return;
    const url = URL.createObjectURL(new Blob([csv(rows, pf.showMoney)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!pf) return <div className="space-y-3"><ErrorBox error={error} />{!error && <Loading />}</div>;
  const s = pf.summary;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('portfolio.title')}</h1><p className="text-sm text-slate-400">{t('portfolio.subtitle')}</p></div>
        <div className="flex gap-2" role="tablist">
          <Button role="tab" aria-selected={tab === 'pages'} variant={tab === 'pages' ? 'primary' : 'ghost'} onClick={() => setTab('pages')}>{t('portfolio.tab.pages')}</Button>
          <Button role="tab" aria-selected={tab === 'plans'} variant={tab === 'plans' ? 'primary' : 'ghost'} onClick={() => setTab('plans')}>{t('portfolio.tab.plans')} ({plans.length})</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t('portfolio.kpi.pages')} value={s.pages} sub={`${s.withPlan} ${t('portfolio.kpi.withPlan')}`} accent="blue" />
        {pf.showMoney && <Kpi label={t('portfolio.kpi.revenue')} value={baht(s.monthlyRevenue ?? 0)} sub={s.byPlan.map(b => `${b.name} ×${b.pages}`).join(' · ') || '—'} accent="emerald" />}
        <Kpi label={t('portfolio.kpi.posts')} value={s.quotaTotal ? `${s.quotaPlannedOfLimited}/${s.quotaTotal}` : s.postsPlanned} sub={`${s.postsUsed} ${t('quota.posted')} · ${s.postsPlanned - s.postsUsed} ${t('quota.scheduled')}`} accent="violet" />
        <Kpi label={t('portfolio.kpi.behind')} value={s.behind} tone={s.behind ? 'warn' : 'ok'} accent="amber" />
        <Kpi label={t('portfolio.kpi.attention')} value={s.needsAttention} tone={s.needsAttention ? 'warn' : 'ok'} accent="rose" />
        <Kpi label={t('portfolio.kpi.approvals')} value={s.pendingApproval} sub={`${t('portfolio.kpi.comments')} ${s.commentsPending} · ${t('portfolio.kpi.leads')} ${s.newLeads}`} accent="teal" />
      </div>

      {tab === 'plans' ? <PlansManager wsId={ws.id} plans={plans} canManage={manage} onChange={() => void load()} /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-full sm:w-56" value={q} onChange={e => setQ(e.target.value)} placeholder={t('portfolio.search')} aria-label={t('portfolio.search')} />
            <Select className="w-auto" value={clientId} onChange={e => setClientId(e.target.value)} aria-label={t('portfolio.client')}><option value="">{t('portfolio.allClients')}</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
            <Select className="w-auto" value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label={t('portfolio.sort')}>{(['attention', 'remaining', 'client', 'name'] as Sort[]).map(k => <option key={k} value={k}>{t(`portfolio.sort.${k}` as MessageKey)}</option>)}</Select>
            <Button variant="ghost" className="ml-auto" onClick={download}>⬇ CSV</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'attention', 'behind', 'over', 'noPlan'] as Filter[]).map(k => (
              <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === k ? 'bg-sky-500 text-white' : 'border border-slate-700 text-slate-300'}`}>{t(`portfolio.filter.${k}` as MessageKey)}</button>
            ))}
          </div>
          <ErrorBox error={error} />
          {pf.rows.length === 0 ? <Empty text={t('portfolio.noPages')} /> : rows.length === 0 ? <Empty text={t('portfolio.noMatch')} /> : (
            <div className="grid gap-3 lg:grid-cols-2">{rows.map(r => <PageCard key={r.page.id} r={r} plans={plans} wsId={ws.id} canManage={manage} money={pf.showMoney} onSaved={() => void load()} />)}</div>
          )}
          {s.withPlan < s.pages && manage && plans.length === 0 && <p className="text-xs text-slate-500">{t('portfolio.hintPlans')}</p>}
        </>
      )}
    </div>
  );
}

function PageCard({ r, plans, wsId, canManage, money, onSaved }: { r: PortfolioRow; plans: ServicePlan[]; wsId: string; canManage: boolean; money: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false); const [planId, setPlanId] = useState(r.plan?.id ?? ''); const [day, setDay] = useState(r.billingDay);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const save = async () => { setBusy(true); setError(null); try { await api(`/workspaces/${wsId}/pages/${r.page.id}/plan`, { method: 'PATCH', body: { servicePlanId: planId || null, billingDay: day } }); setEdit(false); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const a = r.activity;
  return (
    <Card>
      <div className="flex items-start gap-3">
        {r.page.pictureUrl ? <img src={r.page.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : <div className="h-10 w-10 shrink-0 rounded-full bg-slate-800" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><Link href={`/pages/${r.page.id}`} className="truncate font-semibold hover:text-sky-400">{r.page.name}</Link>{r.plan && <PacePill pace={r.quota.pace} />}</div>
          <div className="truncate text-xs text-slate-500"><Link href={`/clients/${r.client.id}`} className="hover:text-sky-400">{r.client.name}</Link> · {r.brand.name}{r.page.fanCount !== null && ` · ${r.page.fanCount.toLocaleString('th-TH')} ${t('portfolio.followers')}`}</div>
        </div>
        {canManage && !edit && <Button variant="ghost" className="shrink-0 px-2 py-1 text-xs" onClick={() => setEdit(true)}>{t('portfolio.setPlan')}</Button>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        {r.plan ? <Pill tone="ok">{r.plan.name}{money && r.plan.priceMonthly ? ` · ${baht(r.plan.priceMonthly)}` : ''}</Pill> : <Pill>{t('quota.noPlan')}</Pill>}
        <span>{t('portfolio.cycle')} {cycleLabel(r.cycle)} · {t('portfolio.daysLeft')} {r.cycle.daysLeft} {t('portfolio.days')}</span>
      </div>
      {edit && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 p-2">
          <label className="text-xs text-slate-400">{t('portfolio.plan')}<Select className="mt-1 w-44" value={planId} onChange={e => setPlanId(e.target.value)}><option value="">{t('quota.noPlan')}</option>{plans.filter(p => p.active || p.id === r.plan?.id).map(p => <option key={p.id} value={p.id}>{p.name}{p.postsPerMonth !== null ? ` (${p.postsPerMonth})` : ''}</option>)}</Select></label>
          <label className="text-xs text-slate-400">{t('portfolio.billingDay')}<Select className="mt-1 w-24" value={day} onChange={e => setDay(Number(e.target.value))}>{Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}</Select></label>
          <Button disabled={busy} onClick={() => void save()}>{t('common.save')}</Button><Button variant="ghost" onClick={() => setEdit(false)}>{t('common.cancel')}</Button>
          {plans.length === 0 && <p className="w-full text-xs text-amber-300">{t('portfolio.noPlansYet')}</p>}
        </div>
      )}
      <ErrorBox error={error} />
      <div className="mt-3"><QuotaBar q={r.quota} /></div>
      {r.reels.limit !== null && <p className={`mt-1 text-xs ${r.reels.remaining !== null && r.reels.remaining < 0 ? 'text-rose-400' : 'text-slate-400'}`}>Reels {r.reels.planned}/{r.reels.limit}</p>}
      {r.pagePosts > r.quota.used && <p className="mt-1 text-[11px] text-slate-500">{t('portfolio.pagePosts')} {r.pagePosts}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {a.pendingApproval > 0 && <Link href="/content"><Pill tone="warn">{t('portfolio.a.approval')} {a.pendingApproval}</Pill></Link>}
        {a.approvedUnscheduled > 0 && <Link href="/content"><Pill>{t('portfolio.a.approved')} {a.approvedUnscheduled}</Pill></Link>}
        {a.commentsPending > 0 && <Link href="/comments"><Pill>{t('portfolio.a.comments')} {a.commentsPending}</Pill></Link>}
        {a.chatsNeedAttention > 0 && <Link href="/messenger"><Pill tone="warn">{t('portfolio.a.chats')} {a.chatsNeedAttention}</Pill></Link>}
        {a.newLeads > 0 && <Link href="/leads"><Pill tone="ok">{t('portfolio.a.leads')} {a.newLeads}</Pill></Link>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
        <div>{t('portfolio.lastPost')}: <span className="text-slate-200">{a.lastPostAt ? `${shortDate(a.lastPostAt)} (${a.daysSinceLastPost} ${t('portfolio.daysAgo')})` : '—'}</span></div>
        <div>{t('portfolio.nextPost')}: <span className="text-slate-200">{a.nextScheduledAt ? new Date(a.nextScheduledAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
      </div>
      {r.attention.some(x => x !== 'APPROVAL' && x !== 'NO_PLAN') && (
        <div className="mt-2 flex flex-wrap gap-1">{r.attention.filter(x => x !== 'APPROVAL' && x !== 'NO_PLAN').map(x => <Pill key={x} tone={ATT_TONE[x] ?? 'muted'}>{t(`portfolio.att.${x}` as MessageKey)}</Pill>)}</div>
      )}
    </Card>
  );
}
