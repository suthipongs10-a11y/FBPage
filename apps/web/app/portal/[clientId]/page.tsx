'use client';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PORTAL_TABS, PortalView, type PortalTab } from '@/components/portal-view';
import { Loading } from '@/components/ui';

function Inner() {
  const { clientId } = useParams<{ clientId: string }>(); const router = useRouter(); const sp = useSearchParams();
  const q = sp.get('tab'); const tab: PortalTab = (PORTAL_TABS as string[]).includes(q ?? '') ? (q as PortalTab) : 'inbox';
  return <PortalView clientId={clientId} tab={tab} onTab={next => router.replace(`/portal/${clientId}?tab=${next}`, { scroll: false })} />;
}
export default function PortalClientPage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
