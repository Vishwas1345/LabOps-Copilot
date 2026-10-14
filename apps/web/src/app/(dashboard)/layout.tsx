import Link from 'next/link';
import type { ReactNode } from 'react';
import { LiveRefresh } from '@/components/live-refresh';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { operatorSchema } from '@/lib/schemas';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/integrations', label: 'Settings' },
  { href: '/audit', label: 'Audit' },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // A 401 here (expired or revoked session) redirects to login.
  const { data: operator } = await apiGet('/api/auth/me', operatorSchema);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between border-b py-4">
        <nav className="flex items-center gap-6">
          <span className="font-semibold">LabOps Copilot</span>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm text-muted-foreground hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={signOut} className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{operator.username}</span>
          <Button variant="outline" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>
      {/* Once here, not per page: one live stream per tab across navigation. */}
      <LiveRefresh />
      <main className="pt-6">{children}</main>
    </div>
  );
}
