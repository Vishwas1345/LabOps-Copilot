'use client';

// Failures over event time, stacked by category: the burst on one dependency
// stands out at a glance. Bars, not a smoothed area: a count per bucket has
// no values in between. Data arrives as props from the server; the browser
// never calls the API.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bucketLabel, colourFor } from '@/lib/charts';
import { humanise } from '@/lib/format';
import type { FailureSeries } from '@/lib/schemas';

type TooltipEntry = { dataKey?: unknown; value?: unknown; color?: string };

function TimelineTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: unknown }) {
  const rows = (payload ?? []).filter((entry) => Number(entry.value) > 0);
  if (!active || rows.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card p-3 text-xs shadow-xl">
      <p className="mb-1.5 font-medium">{String(label)}</p>
      {rows.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{humanise(String(entry.dataKey))}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{String(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function FailureTimeline({ series }: { series: FailureSeries }) {
  const categories = Object.keys(series.totals).filter((category) => (series.totals[category] ?? 0) > 0);
  const data = series.buckets.map((bucket) => ({
    label: bucketLabel(bucket.start, series.bucketMs ?? 60_000),
    ...bucket.counts,
  }));
  return (
    <div className="space-y-3">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" minTickGap={24} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
            <Tooltip content={<TimelineTooltip />} cursor={{ fill: 'var(--muted)' }} />
            {categories.map((category, index) => (
              <Bar
                key={category}
                dataKey={category}
                stackId="failures"
                fill={colourFor(category)}
                radius={index === categories.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {categories.map((category) => (
          <li key={category} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: colourFor(category) }} />
            {humanise(category)}
          </li>
        ))}
      </ul>
    </div>
  );
}
