'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

type Legal = { contactEmail: string | null; operatorName: string | null };
export type LegalSection = { h: string; body: (c: LegalContext) => ReactNode };
export type LegalContext = { operator: string; email: ReactNode; host: string };

/**
 * หน้าสาธารณะสำหรับ Meta App (Privacy Policy / Data deletion) — ไม่ต้องล็อกอิน
 * อีเมลและชื่อผู้ให้บริการมาจาก LEGAL_CONTACT_EMAIL / LEGAL_OPERATOR_NAME ฝั่ง API
 */
export function LegalPage({ title, updated, th, en }: { title: string; updated: string; th: LegalSection[]; en: LegalSection[] }) {
  const [legal, setLegal] = useState<Legal | null>(null); const [host, setHost] = useState('');
  useEffect(() => { setHost(window.location.host); api<Legal>('/public/legal').then(setLegal).catch(() => setLegal({ contactEmail: null, operatorName: null })); }, []);
  const ctx = (lang: 'th' | 'en'): LegalContext => ({
    host: host || 'this service',
    operator: legal?.operatorName ?? (lang === 'th' ? `ผู้ให้บริการระบบ ${host}` : `the operator of ${host}`),
    email: legal?.contactEmail ? <a className="text-sky-600 underline" href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a> : <span>{lang === 'th' ? 'ช่องทางติดต่อของผู้ดูแลระบบ' : 'the administrator contact'}</span>,
  });
  const render = (sections: LegalSection[], lang: 'th' | 'en') => sections.map(s => <section key={s.h} className="space-y-2"><h2 className="text-lg font-semibold">{s.h}</h2><div className="space-y-2 text-sm leading-relaxed text-slate-300">{s.body(ctx(lang))}</div></section>);
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header><h1 className="text-2xl font-bold">{title}</h1><p className="text-xs text-slate-400">{updated}</p></header>
      <div className="space-y-6">{render(th, 'th')}</div>
      <hr className="border-slate-800" />
      <div lang="en" className="space-y-6">{render(en, 'en')}</div>
    </main>
  );
}
