'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { WorkspaceProvider, useWorkspace } from '@/components/workspace-context';
import { Select } from '@/components/ui';
import { NotificationBell } from '@/components/notification-bell';

const NAV: { key: MessageKey; href?: string }[] = [
  { key: 'nav.overview', href: '/' }, { key: 'nav.clients', href: '/clients' }, { key: 'nav.pages', href: '/pages' }, { key: 'nav.ai', href: '/ai' },
  { key: 'nav.content', href: '/content' }, { key: 'nav.calendar', href: '/calendar' }, { key: 'nav.analytics', href: '/analytics' }, { key: 'nav.comments', href: '/comments' }, { key: 'nav.leads', href: '/leads' },
  { key: 'nav.reports', href: '/reports' },
  { key: 'nav.youtube', href: '/youtube' }, { key: 'nav.ytVideos', href: '/youtube/videos' }, { key: 'nav.ytContent', href: '/youtube/content' }, { key: 'nav.ytComments', href: '/youtube/comments' }, { key: 'nav.ytReports', href: '/youtube/reports' },
  { key: 'nav.automation' }, { key: 'nav.aiModels', href: '/ai-models' }, { key: 'nav.settings', href: '/settings' },
];

function Shell({ children }: { children: ReactNode }) {
  const { me, ws, setWorkspace } = useWorkspace();
  const path = usePathname(); const router = useRouter();
  // เมนูที่ active = href ที่ยาวที่สุดซึ่งเป็น prefix ของ path (กัน /youtube สว่างพร้อม /youtube/videos)
  const active = NAV.filter(n => n.href && (path === n.href || (n.href !== '/' && path.startsWith(`${n.href}/`)))).sort((x, y) => (y.href?.length ?? 0) - (x.href?.length ?? 0))[0]?.href;
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); router.replace('/login'); };
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[230px_1fr]">
      <aside className="flex flex-col gap-3 border-b border-slate-800 bg-slate-900 p-4 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="brand-gradient text-base font-bold">{t('app.name')}</div>
        <div className="flex items-center gap-2">
          <Select value={ws.id} onChange={e => setWorkspace(e.target.value)} aria-label="workspace">
            {me.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <NotificationBell />
        </div>
        <nav className="flex flex-wrap gap-1 md:flex-col">
          {NAV.map(n => n.href ? (
            <Link key={n.key} href={n.href} className={`rounded-md px-3 py-2 text-sm ${active === n.href ? 'bg-sky-500/10 text-sky-600 font-semibold' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>{t(n.key)}</Link>
          ) : (
            <span key={n.key} className="rounded-md px-3 py-2 text-sm text-slate-600" title={t('nav.soon')}>{t(n.key)} <span className="text-[10px]">· {t('nav.soon')}</span></span>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-800 pt-3 text-xs text-slate-500">
          <div className="truncate text-slate-300">{me.user.name}</div>
          <div className="truncate">{me.user.email} · {t(`role.${ws.role}` as MessageKey)}</div>
          <button onClick={logout} className="mt-2 text-sky-400 hover:underline">{t('auth.logout')}</button>
        </div>
      </aside>
      <main className="p-5 md:p-8">{children}</main>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return <WorkspaceProvider><Shell>{children}</Shell></WorkspaceProvider>;
}
