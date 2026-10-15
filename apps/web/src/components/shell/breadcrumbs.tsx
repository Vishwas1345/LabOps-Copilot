'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS: Record<string, string> = {
  incidents: 'Incidents',
  audit: 'Audit trail',
  integrations: 'Settings',
};

/** Where the operator is: section, then the open record's id, if any. */
export function Breadcrumbs() {
  const [section, id] = usePathname().split('/').filter(Boolean);
  const crumbs = [{ href: '/', text: 'Overview' }];
  if (section && SECTIONS[section]) crumbs.push({ href: `/${section}`, text: SECTIONS[section] });
  if (id) crumbs.push({ href: '', text: id });

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={crumb.text} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
            {last ? (
              <span className={id && last ? 'truncate font-mono text-xs' : 'font-medium'}>{crumb.text}</span>
            ) : (
              <Link href={crumb.href} className="text-muted-foreground hover:text-foreground">
                {crumb.text}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
