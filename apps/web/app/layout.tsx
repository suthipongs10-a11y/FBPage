import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('app.name'), description: 'AI Marketing Manager for Facebook Pages' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
