'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { Button, ErrorBox, Field, Input, Loading } from '@/components/ui';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>(); const router = useRouter();
  const [info, setInfo] = useState<{ valid: boolean; workspaceName?: string; role?: string; email?: string | null } | null>(null);
  const [f, setF] = useState({ name: '', email: '', password: '' }); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { api<typeof info>(`/auth/invites/${token}`).then(i => { setInfo(i); if (i?.email) setF(v => ({ ...v, email: i.email! })); }).catch(setError); }, [token]);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api(`/auth/invites/${token}/accept`, { method: 'POST', body: { name: f.name || undefined, email: f.email, password: f.password } }); router.replace('/'); } catch (err) { setError(err); } finally { setBusy(false); } };
  if (!info) return <main className="p-6"><ErrorBox error={error} /><Loading /></main>;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="text-xl font-semibold text-sky-400">{t('app.name')}</h1>
      {!info.valid ? <p className="mt-4 text-sm text-rose-300">{t('invite.invalid')}</p> : (
        <>
          <p className="mb-4 mt-2 text-sm text-slate-300">{t('invite.joinAs')} <b>{info.workspaceName}</b> {t('invite.asRole')} <b>{t(`role.${info.role}` as MessageKey)}</b></p>
          <form onSubmit={submit} className="space-y-3">
            <Field label={t('auth.name')} hint={t('common.optional')}><Input value={f.name} onChange={e => setF(v => ({ ...v, name: e.target.value }))} /></Field>
            <Field label={t('auth.email')}><Input type="email" required value={f.email} disabled={!!info.email} onChange={e => setF(v => ({ ...v, email: e.target.value }))} /></Field>
            <Field label={t('auth.password')} hint={t('auth.passwordHint')}><Input type="password" required value={f.password} onChange={e => setF(v => ({ ...v, password: e.target.value }))} /></Field>
            <p className="text-xs text-slate-500">{t('invite.haveAccount')}</p>
            <ErrorBox error={error} />
            <Button type="submit" disabled={busy} className="w-full">{t('invite.accept')}</Button>
          </form>
        </>
      )}
    </main>
  );
}
