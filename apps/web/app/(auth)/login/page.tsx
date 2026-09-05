'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button, ErrorBox, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api('/auth/login', { method: 'POST', body: { email, password } }); router.replace('/'); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="text-xl font-semibold text-sky-400">{t('app.name')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('auth.login')}</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.email')}><Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label={t('auth.password')}><Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <Button type="submit" disabled={busy} className="w-full">{t('auth.login')}</Button>
      </form>
      <p className="mt-4 text-sm text-slate-500">{t('auth.noAccount')} <Link className="text-sky-400" href="/register">{t('auth.register')}</Link></p>
      <p className="mt-2 text-xs text-slate-500"><Link className="text-sky-400" href="/forgot">{t('forgot.title')}</Link> · {t('reset.forgot')}</p>
    </main>
  );
}
