'use client';
/** การ์ด "พอร์ทัลลูกค้า" ในหน้าลูกค้า — เชิญเจ้าของธุรกิจเข้ามาดู/ตอบคอมเมนต์ แชท ลีด และอนุมัติโพสต์ของร้านตัวเอง */
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/yt-comment';
import type { PortalTeamView } from '@/lib/portal';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, ErrorBox, Field, Input, Pill } from '@/components/ui';

export function ClientPortalCard({ clientId }: { clientId: string }) {
  const { ws, can } = useWorkspace(); const manage = can('client.manage'); const base = `/workspaces/${ws.id}/clients/${clientId}/portal`;
  const [v, setV] = useState<PortalTeamView | null>(null); const [f, setF] = useState({ email: '', canReply: true, canApprove: true });
  const [link, setLink] = useState(''); const [copied, setCopied] = useState(false); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<PortalTeamView>(base).then(setV).catch(setError), [base]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const invite = (e: FormEvent) => { e.preventDefault(); void run(async () => { const r = await api<{ url: string }>(`${base}/invites`, { method: 'POST', body: { ...(f.email.trim() && { email: f.email.trim() }), canReply: f.canReply, canApprove: f.canApprove } }); setLink(r.url); setCopied(false); setF({ email: '', canReply: true, canApprove: true }); }); };
  const d = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  return (
    <Card title={`👤 ${t('pt.teamCard')}`} actions={<Link href={`/portal/${clientId}`} className="text-xs text-sky-400 hover:underline">{t('pt.viewAsClient')} ↗</Link>}>
      <p className="text-sm text-slate-400">{t('pt.teamCardHint')}</p>
      {v && (
        <ul className="mt-3 divide-y divide-slate-800">
          {v.members.map(m => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <b>{m.user.name}</b><span className="text-xs text-slate-500">{m.user.email}</span>
              {m.lineLinked && <Pill tone="ok">LINE</Pill>}
              {manage ? (
                <span className="ml-auto flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={m.canReply} onChange={e => void run(() => api(`${base}/members/${m.id}`, { method: 'PATCH', body: { canReply: e.target.checked } }))} />{t('pt.permReply')}</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={m.canApprove} onChange={e => void run(() => api(`${base}/members/${m.id}`, { method: 'PATCH', body: { canApprove: e.target.checked } }))} />{t('pt.permApprove')}</label>
                  <button className="text-rose-400" onClick={() => { if (confirm(t('pt.removeConfirm'))) void run(() => api(`${base}/members/${m.id}`, { method: 'DELETE' })); }}>{t('pt.remove')}</button>
                </span>
              ) : <span className="ml-auto text-xs text-slate-500">{[m.canReply && t('pt.permReply'), m.canApprove && t('pt.permApprove')].filter(Boolean).join(' · ')}</span>}
            </li>
          ))}
          {v.invites.map(i => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm text-slate-400">
              <Pill tone="warn">{t('pt.invitePending')}</Pill>{i.email ?? t('pt.anyEmail')}<span className="text-xs">· {t('pt.until')} {d(i.expiresAt)}</span>
              {manage && <button className="ml-auto text-xs text-rose-400" onClick={() => void run(() => api(`${base}/invites/${i.id}`, { method: 'DELETE' }))}>{t('pt.revoke')}</button>}
            </li>
          ))}
          {v.members.length + v.invites.length === 0 && <li className="py-2 text-xs text-slate-500">{t('pt.noMembers')}</li>}
        </ul>
      )}
      {manage && (
        <form onSubmit={invite} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label={t('pt.ownerEmail')} hint={t('common.optional')}><Input type="email" value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} placeholder="owner@example.com" /></Field>
          <Button type="submit" disabled={busy}>{t('pt.createInvite')}</Button>
          <div className="flex flex-wrap gap-4 text-xs sm:col-span-2">
            <label className="flex items-center gap-1"><input type="checkbox" checked={f.canReply} onChange={e => setF(x => ({ ...x, canReply: e.target.checked }))} />{t('pt.permReplyLong')}</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={f.canApprove} onChange={e => setF(x => ({ ...x, canApprove: e.target.checked }))} />{t('pt.permApproveLong')}</label>
          </div>
        </form>
      )}
      {link && (
        <div className="mt-3 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm">
          <p className="text-xs text-emerald-300">{t('pt.linkOnce')}</p>
          <code className="mt-1 block break-all text-xs">{link}</code>
          <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={() => void copyText(link).then(setCopied)}>{copied ? t('line.copied') : t('line.copy')}</Button>
        </div>
      )}
      <ErrorBox error={error} />
    </Card>
  );
}
