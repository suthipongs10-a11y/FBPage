'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AUTOMATION_LEVELS } from '@fbpm/shared';
import { api, type MetricCell, type PageDetail, type PagePost, type SyncResult } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Kpi, Loading, Pill, Select } from '@/components/ui';

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : t('pages.never'));
const tone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (s === 'VALID' ? 'ok' : s === 'INVALID' ? 'bad' : 'muted');
const Metric = ({ m }: { m: MetricCell | undefined }) => (m === undefined || m.value === null ? <span className="text-slate-600" title={t('pages.metricHint')}>{t('pages.unavailable')}</span> : <>{m.value}</>);

export default function PageDetailPage() {
  const { ws, can } = useWorkspace();
  const { pageId } = useParams<{ pageId: string }>();
  const router = useRouter();
  const [page, setPage] = useState<PageDetail | null>(null);
  const [posts, setPosts] = useState<PagePost[] | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(''); const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { const [p, ps] = await Promise.all([api<PageDetail>(`/workspaces/${ws.id}/pages/${pageId}`), api<PagePost[]>(`/workspaces/${ws.id}/pages/${pageId}/posts?limit=50`)]); setPage(p); setPosts(ps); }
    catch (e) { setError(e); }
  }, [ws.id, pageId]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const sync = () => run('sync', async () => { const r = await api<SyncResult>(`/workspaces/${ws.id}/pages/${pageId}/sync`, { method: 'POST', body: { days: 90 } }); setNotice(`${t('pages.syncDone')}: +${r.imported} / ${r.updated}`); await load(); });
  const validate = () => run('validate', async () => { const r = await api<{ valid: boolean; error?: string }>(`/workspaces/${ws.id}/pages/${pageId}/validate`, { method: 'POST', body: {} }); setNotice(r.valid ? t('pages.status.VALID') : `${t('pages.status.INVALID')}: ${r.error ?? ''}`); await load(); });
  const patch = (body: Record<string, unknown>) => run('patch', async () => { await api(`/workspaces/${ws.id}/pages/${pageId}`, { method: 'PATCH', body }); await load(); });
  const disconnect = () => { if (!confirm(t('pages.confirmDisconnect'))) return; void run('disc', async () => { await api(`/workspaces/${ws.id}/pages/${pageId}`, { method: 'DELETE' }); router.push('/pages'); }); };

  if (!page || !posts) return <div><ErrorBox error={error} /><Loading /></div>;
  const manage = can('page.manage'); const live = !page.disconnectedAt;
  return (
    <div className="space-y-5">
      <Link href="/pages" className="text-sm text-slate-400 hover:text-sky-400">← {t('pages.title')}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {page.pictureUrl && <img src={page.pictureUrl} alt="" className="h-14 w-14 rounded-full" />}
          <div>
            <h1 className="text-2xl font-semibold">{page.name}</h1>
            <p className="text-sm text-slate-400">{page.category ?? '—'} {page.username && `· @${page.username}`} · <Link href={`/brands/${page.brand.id}`} className="hover:text-sky-400">{page.brand.client.name} › {page.brand.name}</Link></p>
            <p className="text-xs text-slate-500">ID {page.facebookPageId} {page.link && <>· <a href={page.link} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{t('pages.openFb')}</a></>}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={tone(page.tokenStatus)}>{t(`pages.status.${page.tokenStatus}` as MessageKey)}</Pill>
          {live && <Button variant="ghost" disabled={busy === 'validate'} onClick={validate}>{t('pages.validate')}</Button>}
          {manage && live && <Button disabled={busy === 'sync'} onClick={sync}>{t('pages.sync')}</Button>}
          {manage && live && <Button variant="danger" disabled={busy === 'disc'} onClick={disconnect}>{t('pages.disconnect')}</Button>}
        </div>
      </div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      {page.lastSyncError && <p className="text-sm text-rose-300">✖ {page.lastSyncError}</p>}
      <ErrorBox error={error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi value={page.fanCount ?? '—'} label={t('pages.followers')} />
        <Kpi value={page._count.posts} label={t('pages.posts')} />
        <Kpi value={page.stats.posts30d} label={t('pages.posts30d')} />
        <Kpi value={`${page.completeness.score}%`} label={t('pages.completeness')} tone={page.completeness.score >= 80 ? 'ok' : page.completeness.score >= 50 ? 'warn' : 'bad'} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('pages.tasks')}>
          <div className="flex flex-wrap gap-1">{page.tasks.map(x => <Pill key={x} tone={x === 'MANAGE' || x === 'CREATE_CONTENT' ? 'ok' : 'muted'}>{x}</Pill>)}</div>
          {!page.tasks.includes('MANAGE') && <p className="mt-2 text-xs text-amber-300">{t('pages.noManage')}</p>}
          <p className="mt-2 text-xs text-slate-500">{t('pages.lastSync')}: {fmt(page.lastSyncedAt)}</p>
        </Card>
        <Card title={t('pages.settings')}>
          <div className="space-y-3">
            <Field label={t('pages.automation')}><Select value={page.automationLevel} disabled={!manage || busy === 'patch'} onChange={e => patch({ automationLevel: e.target.value })}>{AUTOMATION_LEVELS.map(l => <option key={l} value={l}>{t(`auto.${l}` as MessageKey)}</option>)}</Select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={page.publishingPaused} disabled={!manage || busy === 'patch' || !live} onChange={e => patch({ publishingPaused: e.target.checked })} /> {t('pages.publishingPaused')}</label>
          </div>
        </Card>
      </div>

      <Card title={t('pages.missing')}>
        {page.completeness.missing.length === 0 ? <p className="text-sm text-emerald-400">✔ {t('pages.complete')}</p> : (
          <ul className="grid gap-1 text-sm sm:grid-cols-2">{page.completeness.missing.map(m => <li key={m.key} className="text-slate-300">• {m.label}{m.hint && <span className="text-xs text-slate-500"> — {m.hint}</span>}</li>)}</ul>
        )}
      </Card>

      <Card title={`${t('pages.postsTitle')} (${posts.length})`}>
        <p className="mb-2 text-xs text-slate-500">{t('pages.metricHint')}</p>
        {posts.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-3">{t('pages.date')}</th><th className="pr-3">{t('pages.message')}</th><th className="pr-3">{t('pages.type')}</th><th className="pr-3 text-right">{t('pages.shares')}</th><th className="pr-3 text-right">{t('pages.reactions')}</th><th className="pr-3 text-right">{t('pages.comments')}</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {posts.map(p => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs text-slate-400">{fmt(p.publishedAt)}</td>
                    <td className="pr-3 max-w-md">{p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer" className="hover:text-sky-400">{(p.message ?? '(ไม่มีข้อความ)').slice(0, 120)}</a> : (p.message ?? '').slice(0, 120)}</td>
                    <td className="pr-3 text-xs text-slate-400">{p.mediaType ?? '—'}</td>
                    <td className="pr-3 text-right"><Metric m={p.metrics?.shares} /></td>
                    <td className="pr-3 text-right"><Metric m={p.metrics?.reactions} /></td>
                    <td className="pr-3 text-right"><Metric m={p.metrics?.comments} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
