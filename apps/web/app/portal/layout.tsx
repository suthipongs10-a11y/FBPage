'use client';
/** พอร์ทัลลูกค้า — หน้าแยกจากแอปของทีม (ไม่มีเมนูทีม) ใช้ session เดียวกัน */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, type Me } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter(); const path = usePathname();
  const joining = path.startsWith('/portal/join/');
  const [me, setMe] = useState<Me | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (joining) return;
    api<Me>('/auth/me').then(setMe).catch(e => { if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(path)}`); else setFailed(true); });
  }, [joining, router, path]);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); router.replace('/login'); };
  if (joining) return <>{children}</>;
  if (failed) return <p className="p-6 text-sm text-rose-300">{t('pt.apiDown')}</p>;
  if (!me) return <p className="p-6 text-sm text-slate-500">{t('common.loading')}</p>;
  const clients = me.portalClients ?? [];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <Link href="/portal" className="brand-gradient text-sm font-bold">{t('pt.appName')}</Link>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {me.workspaces.length > 0 && <Link href="/" className="text-sky-400 hover:underline">{t('pt.backToTeam')}</Link>}
          {clients.length > 1 && <Link href="/portal" className="hover:text-sky-400">{t('pt.switchBusiness')}</Link>}
          <span className="hidden truncate sm:inline">{me.user.name}</span>
          <button onClick={logout} className="text-sky-400 hover:underline">{t('auth.logout')}</button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
