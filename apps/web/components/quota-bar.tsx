'use client';
/** แถบโควต้าโพสต์: ส่วนเข้ม = โพสต์แล้ว · ส่วนอ่อน = ตั้งเวลาไว้ในรอบ · ขีด = ควรถึงตามเวลาที่ผ่านไป */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { cycleLabel, type PortfolioRow, type QuotaView } from '@/lib/plans';
import { Card, Pill } from '@/components/ui';

const PACE_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'muted'> = { ON_TRACK: 'ok', FULL: 'ok', BEHIND: 'warn', OVER: 'bad', UNLIMITED: 'muted', NO_PLAN: 'muted' };
export function PacePill({ pace }: { pace: string }) { return <Pill tone={PACE_TONE[pace] ?? 'muted'}>{t(`quota.pace.${pace}` as MessageKey)}</Pill>; }

export function QuotaBar({ q, compact }: { q: QuotaView; compact?: boolean }) {
  const scheduled = q.planned - q.used;
  if (q.limit === null) return (
    <div className="text-sm"><b className="tabular-nums">{q.used}</b> {t('quota.posted')}{scheduled > 0 && <> · <b className="tabular-nums">{scheduled}</b> {t('quota.scheduled')}</>} <span className="text-xs text-slate-500">({q.pace === 'NO_PLAN' ? t('quota.noPlan') : t('quota.unlimited')})</span></div>
  );
  const max = Math.max(q.limit, q.planned, 1); const pct = (n: number) => `${(Math.min(n, max) / max) * 100}%`;
  const over = q.planned > q.limit;
  return (
    <div className="space-y-1" aria-label={`${t('quota.label')} ${q.planned}/${q.limit}`}>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={q.limit} aria-valuenow={q.planned}>
        <div className={`absolute inset-y-0 left-0 ${over ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: pct(q.used) }} />
        <div className={`absolute inset-y-0 ${over ? 'bg-rose-500/40' : 'bg-sky-500/50'}`} style={{ left: pct(q.used), width: pct(scheduled) }} />
        {q.expectedByNow !== null && q.expectedByNow > 0 && q.expectedByNow < q.limit && <div className="absolute inset-y-0 w-0.5 bg-slate-400" style={{ left: pct(q.expectedByNow) }} title={`${t('quota.expected')} ${q.expectedByNow}`} />}
      </div>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-400">
          <span><b className="text-slate-200 tabular-nums">{q.used}</b> {t('quota.posted')} · <b className="text-slate-200 tabular-nums">{scheduled}</b> {t('quota.scheduled')} / <b className="tabular-nums">{q.limit}</b></span>
          <span className={q.remaining !== null && q.remaining < 0 ? 'text-rose-400' : ''}>{q.remaining !== null && q.remaining < 0 ? `${t('quota.over')} ${-q.remaining}` : `${t('quota.remaining')} ${q.remaining}`}</span>
        </div>
      )}
    </div>
  );
}

/** การ์ดโควต้าในหน้าเพจ — ดึงเอง ใช้ซ้ำได้ */
export function PageQuotaCard({ wsId, pageId }: { wsId: string; pageId: string }) {
  const [q, setQ] = useState<(Pick<PortfolioRow, 'cycle' | 'quota' | 'reels' | 'pagePosts' | 'billingDay'> & { plan: { name: string } | null }) | null>(null);
  useEffect(() => { api<typeof q>(`/workspaces/${wsId}/pages/${pageId}/quota`).then(setQ).catch(() => setQ(null)); }, [wsId, pageId]);
  if (!q) return null;
  return (
    <Card title={t('quota.label')} actions={<Link href="/portfolio" className="text-xs text-sky-400 hover:underline">{t('nav.portfolio')} →</Link>}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">{q.plan ? <Pill tone="ok">{q.plan.name}</Pill> : <Pill>{t('quota.noPlan')}</Pill>}<PacePill pace={q.quota.pace} /><span>{t('portfolio.cycle')} {cycleLabel(q.cycle)} · {t('portfolio.daysLeft')} {q.cycle.daysLeft} {t('portfolio.days')}</span></div>
      <QuotaBar q={q.quota} />
      {q.reels.limit !== null && <p className="mt-1 text-xs text-slate-400">Reels {q.reels.planned}/{q.reels.limit}</p>}
    </Card>
  );
}
