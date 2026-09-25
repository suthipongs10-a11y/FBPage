'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button, ErrorBox, Field, Input, Loading } from '@/components/ui';

export default function ResetPage() {
  const { token } = useParams<{ token: string }>(); const router = useRouter();
  const [info, setInfo] = useState<{ valid: boolean; email?: string; name?: string } | null>(null);
  const [password, setPassword] = useState(''); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  useEffect(() => { api<typeof info>(`/auth/reset/${token}`).then(setInfo).catch(setError); }, [token]);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api(`/auth/reset/${token}`, { method: 'POST', body: { password } }); setDone(true); setTimeout(() => router.replace('/'), 800); } catch (err) { setError(err); } finally { setBusy(false); } };
  if (!info) return <main className="p-6"><ErrorBox error={error} /><Loading /></main>;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="text-xl font-semibold text-sky-400">{t('app.name')}</h1>
      <p className="mb-4 text-sm text-slate-400">{t('reset.title')}{info.valid && ` — ${info.email}`}</p>
      {!info.valid ? <p className="text-sm text-rose-300">{t('reset.invalid')}</p> : done ? <p className="text-sm text-emerald-400">{t('reset.done')}</p> : (
        <form onSubmit={submit} className="space-y-3">
          <Field label={t('reset.newPassword')} hint={t('auth.passwordHint')}><Input type="password" required autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
          <ErrorBox error={error} />
          <Button type="submit" disabled={busy} className="w-full">{t('common.save')}</Button>
        </form>
      )}
    </main>
  );
}
