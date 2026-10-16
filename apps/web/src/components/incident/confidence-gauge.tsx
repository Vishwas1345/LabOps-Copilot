// The model's own confidence as a ring that fills on load. It is the model's
// estimate, not a measured probability, so the label says so.

import type { CSSProperties } from 'react';
import { formatConfidence } from '@/lib/format';
import { cn } from '@/lib/utils';

const RADIUS = 34;
const LENGTH = 2 * Math.PI * RADIUS;

function tone(confidence: number): string {
  if (confidence >= 0.75) return 'text-success';
  if (confidence >= 0.5) return 'text-warning';
  return 'text-danger';
}

export function ConfidenceGauge({ confidence }: { confidence: number | null }) {
  const value = confidence ?? 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 80 80" className="size-20 shrink-0 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={RADIUS} fill="none" strokeWidth="7" className="stroke-muted" />
        {confidence !== null && (
          <circle
            cx="40"
            cy="40"
            r={RADIUS}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            stroke="currentColor"
            className={cn('animate-gauge', tone(value))}
            strokeDasharray={LENGTH}
            strokeDashoffset={LENGTH * (1 - value)}
            style={{ '--gauge-length': LENGTH } as CSSProperties}
          />
        )}
      </svg>
      <div>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {confidence === null ? '—' : `${Math.round(value * 100)}%`}
        </p>
        <p className="text-xs text-muted-foreground">Confidence: {formatConfidence(confidence)}</p>
      </div>
    </div>
  );
}
