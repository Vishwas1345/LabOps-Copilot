import Link from 'next/link';
import { humanise } from '@/lib/format';
import { cn } from '@/lib/utils';

// Filters are links, so a filtered view is a shareable URL and the page stays
// a server component. Each page checks the value against its own known set.
export function FilterGroup({
  label,
  options,
  active,
  hrefFor,
  withAll = true,
}: {
  label: string;
  options: readonly string[];
  active: string | undefined;
  hrefFor: (value: string | undefined) => string;
  /** An "All" option that clears the filter; off when one value is always set. */
  withAll?: boolean;
}) {
  const pill = (selected: boolean) =>
    cn(
      'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap',
      selected ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
    );
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
        {withAll && (
          <Link href={hrefFor(undefined)} className={pill(!active)}>
            All
          </Link>
        )}
        {options.map((option) => (
          <Link key={option} href={hrefFor(option)} className={pill(active === option)}>
            {humanise(option)}
          </Link>
        ))}
      </div>
    </div>
  );
}
