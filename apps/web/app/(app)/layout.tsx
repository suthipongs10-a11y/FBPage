'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { WorkspaceProvider, useWorkspace } from '@/components/workspace-context';
import { Select } from '@/components/ui';

const NAV: { key: MessageKey; href?: string }[] = [
  { key: 'nav.overview', href: '/' }, { key: 'nav.clients', href: '/clients' }, { key: 'nav.pages', href: '/pages' }, { key: 'nav.ai' },
  { key: 'nav.content' }, { key: 'nav.calendar' }, { key: 'nav.analytics' }, { key: 'nav.comments' }, { key: 'nav.leads' },
  { key: 'nav.reports' }, { key: 'nav.automation' }, { key: 'nav.aiModels' }, { key: 'nav.settings', href: '/settings' },
];

function Shell({ children }: { children: ReactNode }) {
  const { me, ws, setWorkspace } = useWorkspace();
  const path = usePathname(); const router = useRouter();
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); router.replace('/login'); };
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[230px_1fr]">
      <aside className="flex flex-col gap-3 border-b border-slate-800 bg-slate-900 p-4 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="text-base font-semibold text-sky-400">{t('app.name')}</div>
        <Select value={ws.id} onChange={e => setWorkspace(e.target.value)} aria-label="workspace">
          {me.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <nav className="flex flex-wrap gap-1 md:flex-col">
          {NAV.map(n => n.href ? (
            <Link key={n.key} href={n.href} className={`rounded-md px-3 py-2 text-sm ${path === n.href || (n.href !== '/' && path.startsWith(n.href)) ? 'bg-slate-800 text-slate-100 font-semibold' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>{t(n.key)}</Link>
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
