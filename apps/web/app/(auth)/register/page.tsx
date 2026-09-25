'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button, ErrorBox, Field, Input } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [f, setF] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api('/auth/register', { method: 'POST', body: { ...f, workspaceName: f.workspaceName || undefined } }); router.replace('/'); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(v => ({ ...v, [k]: e.target.value }));
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="text-xl font-semibold text-sky-400">{t('app.name')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('auth.register')}</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.name')}><Input required value={f.name} onChange={set('name')} /></Field>
        <Field label={t('auth.email')}><Input type="email" autoComplete="email" required value={f.email} onChange={set('email')} /></Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}><Input type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={set('password')} /></Field>
        <Field label={t('auth.workspaceName')}><Input value={f.workspaceName} onChange={set('workspaceName')} /></Field>
        <ErrorBox error={error} />
        <Button type="submit" disabled={busy} className="w-full">{t('auth.register')}</Button>
      </form>
      <p className="mt-4 text-sm text-slate-500">{t('auth.haveAccount')} <Link className="text-sky-400" href="/login">{t('auth.login')}</Link></p>
    </main>
  );
}
