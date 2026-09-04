'use client';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const v = { primary: 'bg-sky-500 text-slate-950 hover:bg-sky-400', ghost: 'border border-slate-700 text-slate-200 hover:bg-slate-800', danger: 'bg-rose-500/90 text-white hover:bg-rose-500' }[variant];
  return <button {...p} className={cx('rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-50', v, className)} />;
}
export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx('w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500', p.className)} />;
}
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx('min-h-24 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500', p.className)} />;
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx('w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500', p.className)} />;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-slate-400">{label}{hint ? <span className="ml-1 text-xs text-slate-500">— {hint}</span> : null}</span>{children}</label>;
}
export function Card({ title, children, actions, className }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-slate-800 bg-slate-900 p-4', className)}>
      {(title || actions) && <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{actions}</div>}
      {children}
    </section>
  );
}
export function Kpi({ value, label, tone }: { value: ReactNode; label: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const c = tone === 'bad' ? 'text-rose-400' : tone === 'warn' ? 'text-amber-400' : tone === 'ok' ? 'text-emerald-400' : '';
  return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className={cx('text-2xl font-bold', c)}>{value}</div><div className="text-xs text-slate-400">{label}</div></div>;
}
export function Pill({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const c = { ok: 'bg-emerald-950 text-emerald-300', warn: 'bg-amber-950 text-amber-300', bad: 'bg-rose-950 text-rose-300', muted: 'bg-slate-800 text-slate-400' }[tone ?? 'muted'];
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', c)}>{children}</span>;
}
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError | Error;
  const issues = e instanceof ApiError ? e.issues : [];
  return (
    <div className="rounded-lg border border-rose-900 bg-rose-950/60 p-3 text-sm text-rose-200">
      <div>✖ {e.message || t('common.error')}</div>
      {issues.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{issues.map(i => <li key={i.path}>{i.path}: {i.message}</li>)}</ul>}
    </div>
  );
}
export function Empty({ text }: { text?: string }) { return <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">{text ?? t('common.empty')}</p>; }
export function Loading() { return <p className="text-sm text-slate-500">{t('common.loading')}</p>; }
