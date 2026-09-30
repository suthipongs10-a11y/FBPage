'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button, ErrorBox, Field, Input, Loading } from '@/components/ui';

/** เจ้าของธุรกิจรับคำเชิญ — สร้างบัญชีใหม่ หรือใช้อีเมล+รหัสผ่านเดิม */
export default function PortalJoinPage() {
  const { token } = useParams<{ token: string }>(); const router = useRouter();
  const [info, setInfo] = useState<{ valid: boolean; clientName?: string; agencyName?: string; email?: string | null } | null>(null);
  const [f, setF] = useState({ name: '', email: '', password: '' }); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { api<NonNullable<typeof info>>(`/portal/invites/${token}`).then(i => { setInfo(i); if (i.email) setF(v => ({ ...v, email: i.email! })); }).catch(setError); }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api<{ clientId: string }>(`/portal/invites/${token}/accept`, { method: 'POST', body: { name: f.name || undefined, email: f.email, password: f.password } }); router.replace(`/portal/${r.clientId}`); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  if (!info) return <main className="p-6"><ErrorBox error={error} /><Loading /></main>;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="brand-gradient text-xl font-semibold">{t('pt.appName')}</h1>
      {!info.valid ? <p className="mt-4 text-sm text-rose-300">{t('invite.invalid')}</p> : (
        <>
          <p className="mb-1 mt-2 text-sm text-slate-300">{t('pt.joinIntro')} <b>{info.clientName}</b></p>
          <p className="mb-4 text-xs text-slate-500">{t('pt.joinWhat')} · {t('pt.managedBy')} {info.agencyName}</p>
          <form onSubmit={submit} className="space-y-3">
            <Field label={t('auth.name')} hint={t('pt.nameHint')}><Input value={f.name} onChange={e => setF(v => ({ ...v, name: e.target.value }))} autoComplete="name" /></Field>
            <Field label={t('auth.email')}><Input type="email" required value={f.email} disabled={!!info.email} onChange={e => setF(v => ({ ...v, email: e.target.value }))} autoComplete="email" /></Field>
            <Field label={t('auth.password')} hint={t('auth.passwordHint')}><Input type="password" required value={f.password} onChange={e => setF(v => ({ ...v, password: e.target.value }))} autoComplete="new-password" /></Field>
            <p className="text-xs text-slate-500">{t('invite.haveAccount')}</p>
            <ErrorBox error={error} />
            <Button type="submit" disabled={busy} className="w-full">{t('pt.join')}</Button>
          </form>
        </>
      )}
    </main>
  );
}
