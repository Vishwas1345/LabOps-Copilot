import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

// Self-hosted by next/font at build time: the browser never calls Google.
const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata = { title: 'LabOps Copilot' };

// The badge is in the root layout so no page, login included, can omit it:
// every lab, event and outcome shown here is simulated (CLAUDE.md 1).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${theme ?? ''}`}>
      <body className="flex h-dvh flex-col font-sans">
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-warning-border bg-warning-bg px-4 py-1 text-xs text-warning">
          <Badge variant="warning">Simulated data</Badge>
          No live lab platform connection. Labs, failures and recoveries are simulated.
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </body>
    </html>
  );
}
