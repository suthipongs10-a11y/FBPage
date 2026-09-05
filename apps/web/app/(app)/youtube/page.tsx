'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AUTOMATION_LEVELS } from '@fbpm/shared';
import { api, type BrandLite, type Client, type ClientDetail, type YtChannel, type YtConnection, type YtHealth, type YtQuota, type YtRecommendation } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Pill, Select } from '@/components/ui';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const num = (v: number | null) => (v === null ? '—' : v.toLocaleString('th-TH'));
const quotaTone = (level: string): 'ok' | 'warn' | 'bad' => (level === 'OK' || level === 'ok' ? 'ok' : level === 'EXHAUSTED' || level === 'HARD' ? 'bad' : 'warn');

export default function YoutubePage() {
  const { ws, can } = useWorkspace(); const sp = useSearchParams();
  const [health, setHealth] = useState<YtHealth | null>(null); const [quota, setQuota] = useState<YtQuota | null>(null);
  const [conns, setConns] = useState<YtConnection[]>([]); const [channels, setChannels] = useState<YtChannel[] | null>(null); const [brands, setBrands] = useState<(BrandLite & { clientName: string })[]>([]);
  const [recs, setRecs] = useState<YtRecommendation[]>([]);
  const [form, setForm] = useState({ brandId: '', mode: 'OAUTH', connectionId: '', handle: '' }); const [token, setToken] = useState(''); const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const [h, q, c, ch, cl, r] = await Promise.all([api<YtHealth>(`/workspaces/${ws.id}/youtube/health`), api<YtQuota>(`/workspaces/${ws.id}/youtube/quota`), api<YtConnection[]>(`/workspaces/${ws.id}/youtube/connections`), api<YtChannel[]>(`/workspaces/${ws.id}/youtube/channels`), api<Client[]>(`/workspaces/${ws.id}/clients`), api<YtRecommendation[]>(`/workspaces/${ws.id}/youtube/recommendations`)]);
      setHealth(h); setQuota(q); setConns(c); setChannels(ch); setRecs(r);
      const details = await Promise.all(cl.map(x => api<ClientDetail>(`/workspaces/${ws.id}/clients/${x.id}`)));
      const bs = details.flatMap(d => d.brands.map(b => ({ ...b, clientName: d.name }))); setBrands(bs);
      const active = c.find(x => x.status === 'ACTIVE');
      // โหมดเริ่มต้น: มีบัญชี Google → OAuth; ไม่มีแต่มี API key → อ่านสาธารณะ (ผู้ใช้เปลี่ยนเองได้)
      setForm(f => ({ ...f, brandId: f.brandId || bs[0]?.id || '', connectionId: f.connectionId || active?.id || '', mode: active && f.mode === 'PUBLIC_API_KEY' && !f.handle ? 'OAUTH' : !active && h.apiKeyConfigured ? 'PUBLIC_API_KEY' : f.mode }));
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (sp.get('gConnected')) setNotice(t('yt.connectedOk')); if (sp.get('gError')) setError(new Error(`${t('yt.connectError')}: ${sp.get('gError')}`)); }, [sp]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const oauth = () => run('oauth', async () => { const r = await api<{ url: string }>(`/workspaces/${ws.id}/youtube/connections/oauth/start`, { method: 'POST', body: { features: 'read,analytics,manage,upload' } }); window.location.href = r.url; });
  const paste = () => run('paste', async () => { await api(`/workspaces/${ws.id}/youtube/connections/token`, { method: 'POST', body: { refreshToken: token } }); setToken(''); setShowToken(false); setNotice(t('yt.connectedOk')); });
  const revoke = (id: string) => run(`revoke:${id}`, async () => { await api(`/workspaces/${ws.id}/youtube/connections/${id}`, { method: 'DELETE' }); });
  const connect = () => run('connect', async () => { const r = await api<YtChannel>(`/workspaces/${ws.id}/youtube/channels`, { method: 'POST', body: { brandId: form.brandId, mode: form.mode, ...(form.mode === 'OAUTH' ? { connectionId: form.connectionId } : form.handle.startsWith('UC') && form.handle.length > 20 ? { channelId: form.handle } : { handle: form.handle }) } }); setNotice(`✔ ${r.title}`); });
  const sync = (id: string, stage: string) => run(`sync:${id}:${stage}`, async () => { await api(`/workspaces/${ws.id}/youtube/channels/${id}/sync`, { method: 'POST', body: { stage } }); });
  const patch = (id: string, body: Record<string, unknown>) => run(`patch:${id}`, async () => { await api(`/workspaces/${ws.id}/youtube/channels/${id}`, { method: 'PATCH', body }); });
  const disconnect = (id: string) => { if (!confirm(t('yt.disconnectConfirm'))) return; void run(`dc:${id}`, async () => { await api(`/workspaces/${ws.id}/youtube/channels/${id}`, { method: 'DELETE' }); }); };
  const analyze = (id: string) => run(`an:${id}`, async () => { const r = await api<{ recommendationsCreated: number; result: { summary: string } }>(`/workspaces/${ws.id}/youtube/channels/${id}/analyze`, { method: 'POST', body: { days: 90 } }); setNotice(`${r.result.summary.slice(0, 200)} · ${r.recommendationsCreated} ${t('yt.recommendations')}`); });
  const revival = (id: string) => run(`rv:${id}`, async () => { const r = await api<{ candidates?: unknown[]; created?: number }>(`/workspaces/${ws.id}/youtube/channels/${id}/revival`, { method: 'POST', body: {} }); setNotice(`${t('yt.revival')}: ${r.created ?? r.candidates?.length ?? 0}`); });
  const rec = (id: string, status: string) => run(`rec:${id}`, async () => { await api(`/workspaces/${ws.id}/youtube/recommendations/${id}`, { method: 'PATCH', body: { status } }); });
  const applyRec = (id: string) => run(`apply:${id}`, async () => { const r = await api<{ added: number; createdPlaylist: boolean; skipped: string[] }>(`/workspaces/${ws.id}/youtube/recommendations/${id}/apply`, { method: 'POST', body: {} }); setNotice(`${t('yt.applyRec')} ✔ ${r.createdPlaylist ? 'สร้าง playlist ใหม่ · ' : ''}เพิ่ม ${r.added} วิดีโอ${r.skipped.length ? ` · ข้าม ${r.skipped.length} (อยู่แล้ว)` : ''}`); });
  if (!health || !channels || !quota) return <div><ErrorBox error={error} /><Loading /></div>;
  const manage = can('youtube.connect'); const settings = can('youtube.settings.manage');
  const cfg = (ok: boolean) => <Pill tone={ok ? 'ok' : 'muted'}>{ok ? t('yt.configured') : t('yt.notConfigured')}</Pill>;
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t('yt.title')}</h1><p className="text-sm text-slate-400">{t('yt.subtitle')}</p></div>
      {notice && <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-2 text-sm text-emerald-200">{notice}</p>}
      <ErrorBox error={error} />
      <div className="grid gap-3 md:grid-cols-4">
        <Card title={t('yt.health')} className="md:col-span-2"><div className="space-y-1 text-sm"><div className="flex justify-between"><span>{t('yt.oauthConfigured')}</span>{cfg(health.oauthConfigured)}</div><div className="flex justify-between"><span>{t('yt.apiKeyConfigured')}</span>{cfg(health.apiKeyConfigured)}</div><div className="flex justify-between"><span>{t('yt.uploadEnabled')}</span>{cfg(health.uploadEnabled)}</div></div></Card>
        <Kpi value={<span>{num(quota.used)} <span className="text-xs text-slate-500">/ {num(health.quota.softLimit)}</span></span>} label={`${t('yt.quota')} · ${t('yt.quotaReset')}`} tone={quotaTone(quota.level)} />
        <Kpi value={`${health.quota.calls} / ${health.quota.failed}`} label={`${t('yt.quotaCalls')} / ${t('yt.quotaFailed')}`} tone={health.quota.failed ? 'warn' : 'ok'} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={t('yt.connections')} actions={manage && health.oauthConfigured ? <div className="flex gap-2"><Button variant="ghost" onClick={() => setShowToken(v => !v)}>{t('yt.pasteToken')}</Button><Button disabled={busy === 'oauth'} onClick={oauth}>{t('yt.connectGoogle')}</Button></div> : undefined}>
          {!health.oauthConfigured && <p className="mb-2 text-xs text-amber-300">GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI — {t('yt.notConfigured')}</p>}
          {showToken && <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]"><Input type="password" placeholder="1//0g…" value={token} onChange={e => setToken(e.target.value)} /><Button disabled={busy === 'paste' || token.length < 10} onClick={paste}>{t('common.save')}</Button><p className="text-xs text-slate-500 sm:col-span-2">{t('yt.pasteTokenHint')}</p></div>}
          {conns.length === 0 ? <Empty /> : <div className="space-y-2 text-sm">{conns.map(c => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-2">
              <div><div className="font-medium">{c.email ?? c.providerUserId}</div><div className="text-xs text-slate-500">{c.user?.name} · {c._count.channels} {t('yt.channels')} · {c.scopes.filter(s => s.includes('youtube') || s.includes('yt-')).map(s => s.split('/').pop()).join(', ')}</div>{c.lastError && <div className="text-xs text-rose-300">{c.lastError}</div>}</div>
              <div className="flex items-center gap-2"><Pill tone={c.status === 'ACTIVE' ? 'ok' : 'bad'}>{c.status}</Pill>{manage && <Button variant="ghost" disabled={busy === `revoke:${c.id}`} onClick={() => revoke(c.id)}>{t('yt.revoke')}</Button>}</div>
            </div>))}</div>}
        </Card>
        <Card title={t('yt.connectChannel')}>
          {!manage ? <Empty text={t('yt.needPermission')} /> : brands.length === 0 ? <Empty text={t('yt.needBrand')} /> : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t('yt.brand')}><Select value={form.brandId} onChange={e => setForm(f => ({ ...f, brandId: e.target.value }))}>{brands.map(b => <option key={b.id} value={b.id}>{b.clientName} · {b.name}</option>)}</Select></Field>
              <Field label={t('yt.mode')}><Select value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}><option value="OAUTH" disabled={!conns.length}>{t('yt.modeOauth')}</option><option value="PUBLIC_API_KEY" disabled={!health.apiKeyConfigured}>{t('yt.modeApiKey')}</option></Select></Field>
              {form.mode === 'OAUTH' ? <Field label={t('yt.connections')}><Select value={form.connectionId} onChange={e => setForm(f => ({ ...f, connectionId: e.target.value }))}>{conns.filter(c => c.status === 'ACTIVE').map(c => <option key={c.id} value={c.id}>{c.email ?? c.providerUserId}</option>)}</Select></Field>
                : <Field label={t('yt.handle')}><Input placeholder="@channel หรือ UC…" value={form.handle} onChange={e => setForm(f => ({ ...f, handle: e.target.value }))} /></Field>}
              <div className="flex items-end"><Button disabled={busy === 'connect' || !form.brandId || (form.mode === 'OAUTH' ? !form.connectionId : !form.handle)} onClick={connect}>{busy === 'connect' ? t('common.loading') : t('yt.connectChannel')}</Button></div>
            </div>)}
        </Card>
      </div>
      <Card title={`${t('yt.channels')} (${channels.filter(c => !c.disconnectedAt).length})`}>
        {channels.length === 0 ? <Empty text={t('yt.noChannels')} /> : <div className="space-y-2">{channels.map(c => (
          <div key={c.id} className={`rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm ${c.disconnectedAt ? 'opacity-50' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-3">{c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" className="h-10 w-10 rounded-full" />}<div><div className="font-semibold">{c.title} <span className="text-xs text-slate-500">{c.customUrl ?? c.youtubeChannelId}</span></div><div className="text-xs text-slate-400">{c.brand.client.name} · {c.brand.name} · {t('yt.subscribers')} {num(c.subscriberCount)} · {t('yt.videos')} {c._count.videos}/{num(c.videoCount)} · {t('yt.lastSync')} {fmt(c.lastSyncedAt)}</div></div></div>
              <div className="flex flex-wrap items-center gap-1"><Pill tone={c.accessMode === 'OAUTH' ? 'ok' : 'muted'}>{c.accessMode === 'OAUTH' ? 'OAuth' : 'API key'}</Pill><Pill tone={c.syncStatus === 'OK' ? 'ok' : c.syncStatus === 'ERROR' || c.syncStatus === 'NO_ACCESS' ? 'bad' : 'muted'}>{c.syncStatus}</Pill>{c.uploadsPaused && <Pill tone="bad">{t('yt.uploadsPaused')}</Pill>}{c.disconnectedAt && <Pill tone="muted">{t('yt.disconnect')}</Pill>}</div>
            </div>
            {c.syncError && <p className="mt-1 text-xs text-rose-300">{c.syncError}</p>}
            {!c.disconnectedAt && <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="ghost" disabled={busy.startsWith(`sync:${c.id}`)} onClick={() => sync(c.id, 'all')}>{t('yt.syncAll')}</Button>
              <Button variant="ghost" disabled={busy.startsWith(`sync:${c.id}`)} onClick={() => sync(c.id, 'history')}>{t('yt.syncHistory')}</Button>
              {can('ai.use') && can('youtube.analytics.read') && <Button variant="ghost" disabled={busy === `an:${c.id}`} onClick={() => analyze(c.id)}>{t('yt.analyze')}</Button>}
              {can('youtube.analytics.read') && <Button variant="ghost" disabled={busy === `rv:${c.id}`} onClick={() => revival(c.id)}>{t('yt.revival')}</Button>}
              {settings && <><Select className="w-auto" value={c.automationLevel} onChange={e => patch(c.id, { automationLevel: e.target.value })}>{AUTOMATION_LEVELS.map(l => <option key={l} value={l}>{t(`auto.${l}` as MessageKey)}</option>)}</Select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={c.uploadsPaused} onChange={e => patch(c.id, { uploadsPaused: e.target.checked })} /> {t('yt.uploadsPaused')}</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={c.automationPaused} onChange={e => patch(c.id, { automationPaused: e.target.checked })} /> {t('yt.automationPaused')}</label></>}
              {manage && <Button variant="danger" disabled={busy === `dc:${c.id}`} onClick={() => disconnect(c.id)}>{t('yt.disconnect')}</Button>}
            </div>}
          </div>))}</div>}
      </Card>
      <Card title={`${t('yt.recommendations')} (${recs.length})`}>
        {recs.length === 0 ? <Empty /> : <div className="space-y-2 text-sm">{recs.map(r => (
          <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-800 p-2">
            <div><div className="font-medium"><Pill tone="muted">{r.actionType}</Pill> {r.title}</div><div className="text-xs text-slate-400">{r.why}</div><div className="text-xs text-slate-500">{t('yt.confidence')}: {r.confidence} · P{r.priority}</div></div>
            {can('youtube.content.edit') && <div className="flex gap-1">{['ADD_TO_PLAYLIST', 'CREATE_PLAYLIST'].includes(r.actionType) && can('youtube.playlists.manage') && <Button disabled={busy === `apply:${r.id}`} onClick={() => applyRec(r.id)}>{t('yt.applyRec')}</Button>}<Button variant="ghost" onClick={() => rec(r.id, 'ACCEPTED')}>{t('yt.recAccept')}</Button><Button variant="ghost" onClick={() => rec(r.id, 'DONE')}>{t('yt.recDone')}</Button><Button variant="ghost" onClick={() => rec(r.id, 'IGNORED')}>{t('yt.recIgnore')}</Button></div>}
          </div>))}</div>}
      </Card>
    </div>
  );
}
