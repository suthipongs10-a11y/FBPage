'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button, ErrorBox, Field, Input } from '@/components/ui';

export default function ForgotPage() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [result, setResult] = useState<{ ok: boolean; emailEnabled: boolean } | null>(null);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { setResult(await api<{ ok: boolean; emailEnabled: boolean }>('/auth/forgot', { method: 'POST', body: { email } })); } catch (err) { setError(err); } finally { setBusy(false); } };
  return (
    <main className="mx-auto mt-16 max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <h1 className="text-xl font-semibold text-sky-400">{t('app.name')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('forgot.title')}</p>
      {result ? <p className={`text-sm ${result.emailEnabled ? 'text-emerald-300' : 'text-amber-300'}`}>{result.emailEnabled ? t('forgot.sent') : t('forgot.noEmail')}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('auth.email')}><Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
          <ErrorBox error={error} />
          <Button type="submit" disabled={busy} className="w-full">{t('forgot.submit')}</Button>
        </form>)}
      <p className="mt-4 text-sm text-slate-500"><Link className="text-sky-400" href="/login">{t('auth.login')}</Link></p>
    </main>
  );
}
