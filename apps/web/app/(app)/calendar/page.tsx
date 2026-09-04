'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type ContentItem } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { ContentCard } from '@/components/content-card';
import { Button, Empty, ErrorBox, Loading } from '@/components/ui';

const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export default function CalendarPage() {
  const { ws } = useWorkspace();
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [items, setItems] = useState<ContentItem[] | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    const to = new Date(week); to.setDate(to.getDate() + 7);
    try { setItems(await api<ContentItem[]>(`/workspaces/${ws.id}/content/calendar?from=${week.toISOString()}&to=${to.toISOString()}`)); } catch (e) { setError(e); }
  }, [ws.id, week]);
  useEffect(() => { void load(); }, [load]);
  if (!items) return <div><ErrorBox error={error} /><Loading /></div>;
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return d; });
  const dayOf = (it: ContentItem) => new Date(it.scheduledAt ?? it.publishedAt ?? it.updatedAt);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('calendar.title')}</h1><p className="text-sm text-slate-400">{t('calendar.subtitle')}</p></div>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => setWeek(w => { const d = new Date(w); d.setDate(d.getDate() - 7); return d; })}>← {t('calendar.prev')}</Button><Button variant="ghost" onClick={() => setWeek(startOfWeek(new Date()))}>{t('calendar.today')}</Button><Button variant="ghost" onClick={() => setWeek(w => { const d = new Date(w); d.setDate(d.getDate() + 7); return d; })}>{t('calendar.next')} →</Button></div>
      </div>
      <ErrorBox error={error} />
      {items.length === 0 && <Empty text={t('calendar.empty')} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {days.map(d => { const list = items.filter(it => { const x = dayOf(it); return x >= d && x < new Date(d.getTime() + 86_400_000); }); const today = d.toDateString() === new Date().toDateString(); return (
          <div key={d.toISOString()} className={`rounded-xl border p-2 ${today ? 'border-sky-700' : 'border-slate-800'}`}>
            <div className="mb-2 text-xs font-semibold text-slate-400">{d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
            <div className="space-y-2">{list.map(it => <ContentCard key={it.id} item={it} onChange={load} />)}</div>
          </div>); })}
      </div>
    </div>
  );
}
