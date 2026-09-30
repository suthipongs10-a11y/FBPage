'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, type Me } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Empty, Loading } from '@/components/ui';

/** รายชื่อธุรกิจที่เข้าได้ — มีรายเดียวพาเข้าเลย */
export default function PortalHome() {
  const router = useRouter(); const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { api<Me>('/auth/me').then(m => { setMe(m); const c = m.portalClients ?? []; if (c.length === 1 && !m.workspaces.length) router.replace(`/portal/${c[0]!.id}`); }).catch(() => undefined); }, [router]);
  if (!me) return <Loading />;
  const clients = me.portalClients ?? [];
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t('pt.yourBusinesses')}</h1>
      {clients.length === 0 ? <Empty text={t('pt.noAccess')} /> : clients.map(c => (
        <Link key={c.id} href={`/portal/${c.id}`} className="block rounded-xl border border-slate-800 bg-slate-900 p-4 font-semibold hover:border-sky-600">{c.name} →</Link>
      ))}
    </div>
  );
}
