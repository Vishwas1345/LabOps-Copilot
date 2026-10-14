import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import './globals.css';

export const metadata = { title: 'LabOps Copilot' };

// The badge is in the root layout so no page, login included, can omit it:
// every lab, event and outcome shown here is simulated (CLAUDE.md 1).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <div className="flex items-center justify-center gap-2 border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
          <Badge variant="warning">Simulated data</Badge>
          No live CloudLabs connection. Labs, failures and recoveries are simulated.
        </div>
        {children}
      </body>
    </html>
  );
}
