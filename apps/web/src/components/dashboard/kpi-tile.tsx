import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CountUp } from './count-up';

const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
} as const;

/** One headline number: what it is, the figure, and an honest caption. */
export function KpiTile({
  label,
  value,
  caption,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  caption: ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="animate-rise rounded-xl border bg-card px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className={cn('rounded-md p-1.5', TONES[tone])}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
        {typeof value === 'number' ? <CountUp value={value} /> : value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}
