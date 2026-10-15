import { LogOut, UserRound } from 'lucide-react';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { LiveRefresh } from '@/components/live-refresh';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { SIDEBAR_COOKIE, Sidebar } from '@/components/shell/sidebar';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { apiGet } from '@/lib/api';
import { operatorSchema } from '@/lib/schemas';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';

// Only the content column scrolls; the sidebar and header stay put.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // A 401 here (expired or revoked session) redirects to login.
  const [{ data: operator }, jar] = await Promise.all([apiGet('/api/auth/me', operatorSchema), cookies()]);
  const footer = (
    <form action={signOut} className="space-y-0.5">
      <div className="flex h-8 items-center gap-2.5 px-2 text-sm" title={operator.username}>
        <UserRound className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate group-data-[collapsed=true]:hidden max-md:hidden">{operator.username}</span>
      </div>
      <button
        type="submit"
        title="Sign out"
        className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <LogOut className="size-4 shrink-0" />
        <span className="group-data-[collapsed=true]:hidden max-md:hidden">Sign out</span>
      </button>
    </form>
  );

  return (
    <div className="flex h-full">
      <Sidebar initialCollapsed={jar.get(SIDEBAR_COOKIE)?.value === 'collapsed'} footer={footer} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <Breadcrumbs />
          <div className="flex items-center gap-3">
            {/* Once here, not per page: one live stream per tab across navigation. */}
            <LiveRefresh />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-7xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
