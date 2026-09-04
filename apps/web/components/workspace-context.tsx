'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, type Me, type WorkspaceSummary } from '@/lib/api';

interface Ctx { me: Me; ws: WorkspaceSummary; setWorkspace: (id: string) => void; refresh: () => Promise<void>; can: (p: string) => boolean; permissions: string[] }
const WsContext = createContext<Ctx | null>(null);
const KEY = 'fbpm.workspace';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [wsId, setWsId] = useState<string>('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('/auth/me');
      setMe(m);
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
      const pick = m.workspaces.find(w => w.id === stored)?.id ?? m.workspaces[0]?.id ?? '';
      setWsId(pick);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace('/login'); else setFailed(true);
    }
  }, [router]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!wsId) return;
    try { window.localStorage.setItem(KEY, wsId); } catch { /* private mode */ }
    api<{ permissions: string[] }>(`/workspaces/${wsId}`).then(w => setPermissions(w.permissions)).catch(() => setPermissions([]));
  }, [wsId]);

  const ws = me?.workspaces.find(w => w.id === wsId);
  const value = useMemo<Ctx | null>(() => (me && ws ? { me, ws, setWorkspace: setWsId, refresh, permissions, can: p => permissions.includes(p) } : null), [me, ws, refresh, permissions]);

  if (failed) return <p className="p-6 text-sm text-rose-300">ติดต่อ API ไม่ได้ — ตรวจว่า API ทำงานอยู่</p>;
  if (!value) return <p className="p-6 text-sm text-slate-500">กำลังโหลด…</p>;
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

export function useWorkspace(): Ctx {
  const c = useContext(WsContext);
  if (!c) throw new Error('useWorkspace outside WorkspaceProvider');
  return c;
}
