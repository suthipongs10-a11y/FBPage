import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { t, type MessageKey } from '@/lib/i18n';

export const metadata: Metadata = { title: t('app.name'), description: 'AI Marketing Manager for Facebook Pages' };

const NAV: MessageKey[] = [
  'nav.overview', 'nav.clients', 'nav.pages', 'nav.ai', 'nav.content', 'nav.calendar',
  'nav.analytics', 'nav.comments', 'nav.leads', 'nav.reports', 'nav.automation', 'nav.aiModels', 'nav.settings',
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>
        <div className="grid min-h-screen grid-cols-1 md:grid-cols-[220px_1fr]">
          <aside className="border-b border-slate-800 bg-slate-900 p-4 md:border-b-0 md:border-r">
            <div className="mb-4 text-base font-semibold text-sky-400">{t('app.name')}</div>
            <nav className="flex flex-wrap gap-1 md:flex-col">
              {NAV.map(k => (
                <span key={k} className="rounded-md px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-100">{t(k)}</span>
              ))}
            </nav>
          </aside>
          <main className="p-6 md:p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
