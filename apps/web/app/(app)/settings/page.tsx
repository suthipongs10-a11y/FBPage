'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { WORKSPACE_ROLES } from '@fbpm/shared';
import { api, type AuditRow, type InviteRow, type Member, type WorkspaceDetail } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select } from '@/components/ui';

export default function SettingsPage() {
  const { ws, me, can, refresh, setWorkspace } = useWorkspace();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [f, setF] = useState({ name: '', timezone: '' });
  const [mf, setMf] = useState({ email: '', role: 'editor' });
  const [newWs, setNewWs] = useState('');
  const [invites, setInvites] = useState<InviteRow[]>([]); const [inviteRole, setInviteRole] = useState('editor'); const [lastLink, setLastLink] = useState('');
  const [hook, setHook] = useState<{ configured: boolean; hint: string | null } | null>(null); const [hookUrl, setHookUrl] = useState(''); const [hookMsg, setHookMsg] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' }); const [pwMsg, setPwMsg] = useState('');
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const manage = can('workspace.manage');

  const load = useCallback(async () => {
    try {
      const d = await api<WorkspaceDetail>(`/workspaces/${ws.id}`); setDetail(d); setF({ name: d.name, timezone: d.timezone });
      setMembers(await api<Member[]>(`/workspaces/${ws.id}/members`));
      if (d.permissions.includes('workspace.manage')) { setAudit(await api<AuditRow[]>(`/workspaces/${ws.id}/audit?limit=40`)); setInvites(await api<InviteRow[]>(`/workspaces/${ws.id}/invites`)); setHook(await api<{ configured: boolean; hint: string | null }>(`/workspaces/${ws.id}/notifications/webhook`)); } else setAudit([]);
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);

  const save = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); setSaved(false); try { await api(`/workspaces/${ws.id}`, { method: 'PATCH', body: f }); setSaved(true); await refresh(); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const togglePause = async () => { if (!detail) return; if (!detail.automationPaused && !confirm(t('settings.automationPaused') + '?')) return; setBusy(true); try { await api(`/workspaces/${ws.id}`, { method: 'PATCH', body: { automationPaused: !detail.automationPaused } }); await refresh(); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const addMember = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api(`/workspaces/${ws.id}/members`, { method: 'POST', body: mf }); setMf({ email: '', role: 'editor' }); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const setRole = (userId: string, role: string) => api(`/workspaces/${ws.id}/members/${userId}`, { method: 'PATCH', body: { role } }).then(load).catch(setError);
  const removeMember = (userId: string) => { if (confirm(t('common.confirmDelete'))) api(`/workspaces/${ws.id}/members/${userId}`, { method: 'DELETE' }).then(load).catch(setError); };
  const createInvite = async () => { setBusy(true); setError(null); try { const r = await api<{ url: string }>(`/workspaces/${ws.id}/invites`, { method: 'POST', body: { role: inviteRole } }); setLastLink(r.url); await load(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const revokeInvite = (id: string) => api(`/workspaces/${ws.id}/invites/${id}`, { method: 'DELETE' }).then(load).catch(setError);
  const resetLink = async (userId: string) => { setError(null); try { const r = await api<{ url: string }>(`/workspaces/${ws.id}/members/${userId}/reset-link`, { method: 'POST', body: {} }); setLastLink(r.url); } catch (err) { setError(err); } };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ } };
  const saveHook = async (url: string | null) => { setBusy(true); setHookMsg(''); try { const r = await api<{ configured: boolean; hint: string | null }>(`/workspaces/${ws.id}/notifications/webhook`, { method: 'PUT', body: { url } }); setHook(r); setHookUrl(''); } catch (err) { setError(err); } finally { setBusy(false); } };
  const testHook = async () => { setHookMsg(''); try { const r = await api<{ ok: boolean }>(`/workspaces/${ws.id}/notifications/webhook/test`, { method: 'POST', body: {} }); setHookMsg(r.ok ? t('notif.testOk') : t('notif.testFail')); } catch (err) { setError(err); } };
  const changePw = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setPwMsg(''); setError(null); try { await api('/auth/password', { method: 'POST', body: pw }); setPw({ current: '', next: '' }); setPwMsg(t('password.changed')); } catch (err) { setError(err); } finally { setBusy(false); } };
  const createWs = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { const w = await api<{ id: string }>('/workspaces', { method: 'POST', body: { name: newWs } }); setNewWs(''); await refresh(); setWorkspace(w.id); } catch (err) { setError(err); } finally { setBusy(false); } };

  if (!detail || !members) return <div><ErrorBox error={error} /><Loading /></div>;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <ErrorBox error={error} />
      {saved && <p className="text-sm text-emerald-400">✔ {t('common.saved')}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={detail.name}>
          <form onSubmit={save} className="space-y-3">
            <Field label={t('settings.name')}><Input value={f.name} onChange={e => setF(v => ({ ...v, name: e.target.value }))} disabled={!manage} /></Field>
            <Field label={t('settings.timezone')}><Input value={f.timezone} onChange={e => setF(v => ({ ...v, timezone: e.target.value }))} disabled={!manage} placeholder="Asia/Bangkok" /></Field>
            {manage && <Button type="submit" disabled={busy}>{t('common.save')}</Button>}
          </form>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-sm">
            <span>{t('settings.automationPaused')}</span>
            {manage ? <Button variant={detail.automationPaused ? 'ghost' : 'danger'} onClick={togglePause} disabled={busy}>{detail.automationPaused ? 'เปิดอัตโนมัติ' : 'หยุดทั้งหมด'}</Button> : <Pill tone={detail.automationPaused ? 'bad' : 'ok'}>{detail.automationPaused ? 'PAUSED' : 'RUNNING'}</Pill>}
          </div>
        </Card>
        <Card title={t('settings.newWorkspace')}>
          <form onSubmit={createWs} className="flex gap-2"><Input required value={newWs} onChange={e => setNewWs(e.target.value)} placeholder={t('settings.name')} /><Button type="submit" disabled={busy}>{t('common.create')}</Button></form>
          <p className="mt-2 text-xs text-slate-500">{me.workspaces.length} workspace</p>
        </Card>
      </div>

      <Card title={`${t('settings.members')} (${members.length})`}>
        {manage && (
          <form onSubmit={addMember} className="mb-3 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
            <Input type="email" required placeholder={t('auth.email')} value={mf.email} onChange={e => setMf(v => ({ ...v, email: e.target.value }))} />
            <Select value={mf.role} onChange={e => setMf(v => ({ ...v, role: e.target.value }))}>{WORKSPACE_ROLES.filter(r => r !== 'owner').map(r => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}</Select>
            <Button type="submit" disabled={busy}>{t('settings.addMember')}</Button>
            <p className="text-xs text-slate-500 sm:col-span-3">{t('settings.memberHint')}</p>
          </form>
        )}
        <ul className="divide-y divide-slate-800 text-sm">
          {members.map(m => (
            <li key={m.user.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><span className="font-medium">{m.user.name}</span> <span className="text-xs text-slate-500">{m.user.email}</span></div>
              {manage && m.role !== 'owner' ? (
                <div className="flex items-center gap-2"><Select value={m.role} onChange={e => setRole(m.user.id, e.target.value)} className="w-40">{WORKSPACE_ROLES.filter(r => r !== 'owner').map(r => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}</Select><button onClick={() => resetLink(m.user.id)} className="text-xs text-sky-400 hover:underline">{t('reset.link')}</button><button onClick={() => removeMember(m.user.id)} className="text-xs text-rose-400 hover:underline">{t('common.delete')}</button></div>
              ) : <Pill tone={m.role === 'owner' ? 'ok' : 'muted'}>{t(`role.${m.role}` as MessageKey)}</Pill>}
            </li>
          ))}
        </ul>
      </Card>

      {lastLink && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-900 bg-sky-950/40 p-3 text-sm"><code className="break-all text-xs text-sky-200">{lastLink}</code><Button variant="ghost" onClick={() => copy(lastLink)}>{t('invite.copy')}</Button></div>}
      {manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('invite.title')}>
            <p className="mb-2 text-xs text-slate-500">{t('invite.hint')}</p>
            <div className="flex gap-2"><Select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="w-44">{WORKSPACE_ROLES.filter(r => r !== 'owner').map(r => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}</Select><Button disabled={busy} onClick={createInvite}>{t('invite.create')}</Button></div>
            {invites.length > 0 && <div className="mt-3 text-xs"><div className="mb-1 text-slate-500">{t('invite.pending')}</div><ul className="divide-y divide-slate-800">{invites.map(i => <li key={i.id} className="flex items-center justify-between py-1"><span>{t(`role.${i.role}` as MessageKey)}{i.email && ` · ${i.email}`} · หมดอายุ {new Date(i.expiresAt).toLocaleDateString('th-TH')}</span><button onClick={() => revokeInvite(i.id)} className="text-rose-400 hover:underline">{t('invite.revoke')}</button></li>)}</ul></div>}
          </Card>
          <Card title={t('notif.title')}>
            <p className="mb-2 text-xs text-slate-500">{t('notif.webhook')} — {t('notif.webhookHint')}</p>
            <div className="flex items-center gap-2 text-sm">{hook?.configured ? <Pill tone="ok">{hook.hint}</Pill> : <Pill>—</Pill>}{hook?.configured && <><Button variant="ghost" onClick={testHook}>{t('notif.test')}</Button><button onClick={() => saveHook(null)} className="text-xs text-rose-400 hover:underline">{t('common.delete')}</button></>}{hookMsg && <span className="text-xs text-emerald-400">{hookMsg}</span>}</div>
            <div className="mt-2 flex gap-2"><Input placeholder="https://discord.com/api/webhooks/…" value={hookUrl} onChange={e => setHookUrl(e.target.value)} /><Button disabled={busy || !hookUrl} onClick={() => saveHook(hookUrl)}>{t('common.save')}</Button></div>
          </Card>
        </div>
      )}
      <Card title={t('password.title')}>
        <form onSubmit={changePw} className="grid gap-2 sm:grid-cols-3">
          <Field label={t('password.current')}><Input type="password" required autoComplete="current-password" value={pw.current} onChange={e => setPw(v => ({ ...v, current: e.target.value }))} /></Field>
          <Field label={t('password.next')} hint={t('auth.passwordHint')}><Input type="password" required autoComplete="new-password" value={pw.next} onChange={e => setPw(v => ({ ...v, next: e.target.value }))} /></Field>
          <div className="flex items-end gap-2"><Button type="submit" disabled={busy}>{t('common.save')}</Button>{pwMsg && <span className="text-sm text-emerald-400">✔ {pwMsg}</span>}</div>
        </form>
      </Card>
      {manage && (
        <Card title={t('settings.audit')}>
          {!audit || audit.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500"><th className="py-1 pr-3">เวลา</th><th className="py-1 pr-3">ผู้ทำ</th><th className="py-1 pr-3">การกระทำ</th><th className="py-1 pr-3">ทรัพยากร</th><th className="py-1">รายละเอียด</th></tr></thead>
                <tbody>{audit.map(a => <tr key={a.id} className="border-t border-slate-800 align-top"><td className="py-1.5 pr-3 whitespace-nowrap text-slate-400">{new Date(a.createdAt).toLocaleString('th-TH')}</td><td className="py-1.5 pr-3">{a.user?.name ?? '—'}</td><td className="py-1.5 pr-3 font-mono">{a.action}</td><td className="py-1.5 pr-3 text-slate-400">{a.resourceType}</td><td className="py-1.5 font-mono text-slate-500 break-all">{a.after ? JSON.stringify(a.after).slice(0, 120) : ''}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
