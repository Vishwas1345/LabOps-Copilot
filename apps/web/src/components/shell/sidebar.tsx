'use client';

// The app's left navigation. Collapses to icons (always, on small screens);
// the choice is kept in a cookie so the server renders it the same way.

import { Activity, LayoutDashboard, PanelLeft, ScrollText, Settings, Siren } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export const SIDEBAR_COOKIE = 'labops_sidebar';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/incidents', label: 'Incidents', icon: Siren },
  { href: '/audit', label: 'Audit trail', icon: ScrollText },
  { href: '/integrations', label: 'Settings', icon: Settings },
];

const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path.startsWith(href));

// Hidden when collapsed, and always on small screens where the bar is icons only.
const label = 'truncate group-data-[collapsed=true]:hidden max-md:hidden';

export function Sidebar({ initialCollapsed, footer }: { initialCollapsed: boolean; footer: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const path = usePathname();
  const toggle = () => {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? 'open' : 'collapsed'}; path=/; samesite=lax`;
    setCollapsed(!collapsed);
  };

  return (
    <aside
      data-collapsed={collapsed}
      className="group flex w-56 shrink-0 flex-col border-r bg-sidebar transition-[width] data-[collapsed=true]:w-14 max-md:w-14"
    >
      <div className="flex h-12 items-center gap-2 px-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Activity className="size-4" />
        </span>
        <span className={cn('font-semibold tracking-tight', label)}>LabOps Copilot</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2" aria-label="Main">
        {NAV.map(({ href, label: text, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={text}
            aria-current={isActive(path, href) ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
              isActive(path, href) && 'bg-card font-medium text-foreground shadow-sm ring-1 ring-border',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className={label}>{text}</span>
          </Link>
        ))}
      </nav>
      <div className="border-t p-2">{footer}</div>
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="mx-2 mb-2 flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground max-md:hidden"
      >
        <PanelLeft className="size-4 shrink-0" />
        <span className={label}>Collapse</span>
      </button>
    </aside>
  );
}
