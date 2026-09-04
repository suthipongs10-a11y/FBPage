'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type NotificationRow } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';

const fmt = (d: string) => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
export function NotificationBell() {
  const { ws } = useWorkspace();
  const [items, setItems] = useState<NotificationRow[]>([]); const [unread, setUnread] = useState(0); const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { try { const r = await api<{ items: NotificationRow[]; unread: number }>(`/workspaces/${ws.id}/notifications?limit=30`); setItems(r.items); setUnread(r.unread); } catch { /* เงียบ */ } }, [ws.id]);
  useEffect(() => { void load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const read = (n: NotificationRow) => { if (!n.readAt) void api(`/workspaces/${ws.id}/notifications/${n.id}/read`, { method: 'POST', body: {} }).then(load); setOpen(false); };
  const readAll = () => void api(`/workspaces/${ws.id}/notifications/read-all`, { method: 'POST', body: {} }).then(load);
  const tone = (s: string) => (s === 'bad' ? 'text-rose-300' : s === 'warn' ? 'text-amber-300' : 'text-slate-200');
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} aria-label={t('notif.title')} className="relative rounded-lg border border-slate-700 px-2 py-1.5 text-sm hover:bg-slate-800">🔔{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}</button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-80 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-xl md:left-auto md:right-0">
          <div className="mb-1 flex items-center justify-between px-1 text-xs"><span className="font-semibold">{t('notif.title')}</span>{unread > 0 && <button onClick={readAll} className="text-sky-400 hover:underline">{t('notif.readAll')}</button>}</div>
          {items.length === 0 ? <p className="p-2 text-xs text-slate-500">{t('notif.empty')}</p> : (
            <ul className="max-h-96 space-y-1 overflow-y-auto">{items.map(n => (
              <li key={n.id} className={`rounded-lg p-2 text-xs ${n.readAt ? 'opacity-60' : 'bg-slate-800/60'}`}>
                {n.href ? <Link href={n.href} onClick={() => read(n)} className={`block font-medium ${tone(n.severity)}`}>{n.title}</Link> : <button onClick={() => read(n)} className={`block text-left font-medium ${tone(n.severity)}`}>{n.title}</button>}
                {n.body && <div className="text-slate-400">{n.body}</div>}
                <div className="text-[10px] text-slate-500">{fmt(n.createdAt)}</div>
              </li>))}</ul>
          )}
        </div>
      )}
    </div>
  );
}
