'use client';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, type AvailablePage, type BrandLite, type Client, type FbConnection, type PageRow } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Loading, Pill, Select, Textarea } from '@/components/ui';

type BrandOpt = { id: string; label: string };
const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : t('pages.never'));
export const statusTone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (s === 'VALID' ? 'ok' : s === 'INVALID' ? 'bad' : 'muted');
const statusLabel = (s: string) => t(`pages.status.${s}` as MessageKey);

function PagesInner() {
  const { ws, can } = useWorkspace();
  const sp = useSearchParams();
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [conns, setConns] = useState<FbConnection[] | null>(null);
  const [brands, setBrands] = useState<BrandOpt[]>([]);
  const [token, setToken] = useState('');
  const [activeConn, setActiveConn] = useState('');
  const [avail, setAvail] = useState<AvailablePage[] | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, c, clients] = await Promise.all([api<PageRow[]>(`/workspaces/${ws.id}/pages`), api<FbConnection[]>(`/workspaces/${ws.id}/facebook/connections`), api<Client[]>(`/workspaces/${ws.id}/clients`)]);
      setPages(p); setConns(c);
      const lists = await Promise.all(clients.map(cl => api<BrandLite[]>(`/workspaces/${ws.id}/clients/${cl.id}/brands`).then(bs => bs.map(b => ({ id: b.id, label: `${cl.name} › ${b.name}` })))));
      setBrands(lists.flat());
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const connected = sp.get('connected'); const fbError = sp.get('fbError');
    if (connected) { setNotice(t('pages.connectedOk')); setActiveConn(connected); }
    if (fbError) setError(new Error(`${t('pages.oauthError')} (${fbError})`));
  }, [sp]);

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const connectToken = (e: FormEvent) => { e.preventDefault(); void run('token', async () => {
    const r = await api<{ connection: FbConnection; pages: AvailablePage[] }>(`/workspaces/${ws.id}/facebook/connections/token`, { method: 'POST', body: { accessToken: token.trim() } });
    setToken(''); setActiveConn(r.connection.id); setAvail(r.pages); setNotice(t('pages.connectedOk')); await load();
  }); };
  const oauth = () => run('oauth', async () => { const r = await api<{ url: string }>(`/workspaces/${ws.id}/facebook/oauth/start`); window.location.href = r.url; });
  const showPages = (id: string) => run(`show:${id}`, async () => { setActiveConn(id); setAvail(await api<AvailablePage[]>(`/workspaces/${ws.id}/facebook/connections/${id}/pages`)); });
  const revoke = (id: string) => { if (!confirm(t('pages.confirmRevoke'))) return; void run(`revoke:${id}`, async () => { await api(`/workspaces/${ws.id}/facebook/connections/${id}`, { method: 'DELETE' }); if (activeConn === id) { setActiveConn(''); setAvail(null); } await load(); }); };
  const attach = (fbId: string) => { const brandId = pick[fbId] ?? brands[0]?.id; if (!brandId) return; void run(`attach:${fbId}`, async () => {
    const r = await api<PageRow & { initialSync: { ok: boolean; imported?: number; error?: string } }>(`/workspaces/${ws.id}/brands/${brandId}/pages/connect`, { method: 'POST', body: { connectionId: activeConn, facebookPageId: fbId } });
    setNotice(r.initialSync.ok ? `${r.name}: ${t('pages.imported')} ${r.initialSync.imported}` : `${r.name}: ${r.initialSync.error}`);
    await load(); if (activeConn) setAvail(await api<AvailablePage[]>(`/workspaces/${ws.id}/facebook/connections/${activeConn}/pages`));
  }); };
  const sync = (p: PageRow) => run(`sync:${p.id}`, async () => { const r = await api<{ imported: number; updated: number }>(`/workspaces/${ws.id}/pages/${p.id}/sync`, { method: 'POST', body: {} }); setNotice(`${p.name}: ${t('pages.syncDone')} (+${r.imported} / ${r.updated})`); await load(); });

  if (!pages || !conns) return <div><ErrorBox error={error} /><Loading /></div>;
  const canConnect = can('page.connect'); const canManage = can('page.manage');
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">{t('pages.title')}</h1><p className="text-sm text-slate-400">{t('pages.subtitle')}</p></div>
      {notice && <p className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-200">✔ {notice}</p>}
      <ErrorBox error={error} />

      <Card title={t('pages.connectedList')}>
        {pages.length === 0 ? <Empty text={t('pages.none')} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-3">{t('nav.pages')}</th><th className="pr-3">{t('pages.brand')}</th><th className="pr-3">{t('pages.tokenStatus')}</th><th className="pr-3">{t('pages.followers')}</th><th className="pr-3">{t('pages.posts')}</th><th className="pr-3">{t('pages.lastSync')}</th><th /></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {pages.map(p => (
                  <tr key={p.id} className={p.disconnectedAt ? 'opacity-50' : ''}>
                    <td className="py-2 pr-3"><Link href={`/pages/${p.id}`} className="flex items-center gap-2 hover:text-sky-400">{p.pictureUrl && <img src={p.pictureUrl} alt="" className="h-7 w-7 rounded-full" />}<span className="font-medium">{p.name}</span></Link><div className="text-xs text-slate-500">{p.category ?? '—'} · {p.tasks.includes('MANAGE') ? 'MANAGE' : p.tasks.includes('CREATE_CONTENT') ? 'CREATE_CONTENT' : p.tasks[0] ?? '—'}</div></td>
                    <td className="pr-3"><Link href={`/brands/${p.brand.id}`} className="hover:text-sky-400">{p.brand.name}</Link><div className="text-xs text-slate-500">{p.brand.client.name}</div></td>
                    <td className="pr-3"><Pill tone={statusTone(p.tokenStatus)}>{statusLabel(p.tokenStatus)}</Pill>{p.publishingPaused && !p.disconnectedAt && <Pill tone="warn">⏸</Pill>}</td>
                    <td className="pr-3">{p.fanCount ?? '—'}</td>
                    <td className="pr-3">{p._count.posts}</td>
                    <td className="pr-3 text-xs text-slate-400">{fmt(p.lastSyncedAt)}{p.lastSyncError && <div className="text-rose-400">{p.lastSyncError}</div>}</td>
                    <td className="text-right">{canManage && !p.disconnectedAt && <Button variant="ghost" disabled={busy === `sync:${p.id}`} onClick={() => sync(p)}>{t('pages.sync')}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canConnect && (
        <Card title={t('pages.connectTitle')}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Button variant="ghost" disabled={busy === 'oauth'} onClick={oauth}>{t('pages.connectFacebook')}</Button>
              <form onSubmit={connectToken} className="space-y-2">
                <Field label={t('pages.orToken')} hint={t('pages.tokenHint')}><Textarea required value={token} onChange={e => setToken(e.target.value)} placeholder={t('pages.tokenPlaceholder')} autoComplete="off" spellCheck={false} /></Field>
                <Button type="submit" disabled={busy === 'token' || token.trim().length < 20}>{t('pages.connectToken')}</Button>
              </form>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-300">{t('pages.connections')}</h3>
              {conns.length === 0 ? <Empty text={t('pages.noConnections')} /> : (
                <ul className="divide-y divide-slate-800 text-sm">
                  {conns.map(c => (
                    <li key={c.id} className={`py-2 ${c.status !== 'ACTIVE' ? 'opacity-50' : ''}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div><span className="font-medium">{c.providerUserName ?? c.providerUserId}</span> <Pill tone={c.status === 'ACTIVE' ? 'ok' : 'muted'}>{c.status}</Pill> <span className="text-xs text-slate-500">· {c._count.pages} {t('nav.pages')}</span></div>
                        {c.status === 'ACTIVE' && <div className="flex gap-2"><Button variant="ghost" disabled={busy === `show:${c.id}`} onClick={() => showPages(c.id)}>{t('pages.showPages')}</Button>{canManage && <button onClick={() => revoke(c.id)} className="text-xs text-rose-400 hover:underline">{t('pages.revoke')}</button>}</div>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{t('pages.scopes')}: {c.scopes.join(', ') || '—'} · {t('pages.expires')}: {c.tokenExpiresAt ? fmt(c.tokenExpiresAt) : t('pages.neverExpires')}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {avail && (
            <div className="mt-4 rounded-lg border border-slate-800 p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-300">{t('pages.available')} ({avail.length})</h3>
              {brands.length === 0 && <p className="mb-2 text-sm text-amber-300">{t('pages.noBrands')} <Link href="/clients" className="underline">→</Link></p>}
              <ul className="divide-y divide-slate-800 text-sm">
                {avail.map(p => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="flex items-center gap-2">{p.pictureUrl && <img src={p.pictureUrl} alt="" className="h-7 w-7 rounded-full" />}<div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.category ?? '—'} · {p.tasks.join(', ')}</div></div></div>
                    {p.connected ? <Pill tone="ok">{t('pages.alreadyConnected')}: {p.connected.brandName}</Pill> : brands.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Select value={pick[p.id] ?? brands[0]?.id ?? ''} onChange={e => setPick(v => ({ ...v, [p.id]: e.target.value }))} aria-label={t('pages.chooseBrand')} className="w-auto">{brands.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</Select>
                        <Button disabled={busy === `attach:${p.id}`} onClick={() => attach(p.id)}>{t('pages.attach')}</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export default function PagesPage() { return <Suspense fallback={<Loading />}><PagesInner /></Suspense>; }
