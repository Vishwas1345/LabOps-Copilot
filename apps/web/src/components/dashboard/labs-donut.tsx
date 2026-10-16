'use client';

import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';

// Lab states take the status palette, not the category one: a failed lab is
// the same red here as on every badge.
const STATE_COLOURS: Record<string, string> = {
  ready: 'var(--success)',
  failed: 'var(--danger)',
  recovering: 'var(--info)',
  provisioning: 'var(--warning)',
  stopped: 'var(--muted-foreground)',
};

export function LabsDonut({ counts }: { counts: Record<string, number> }) {
  const data = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([state, value]) => ({ state, value }));
  const total = data.reduce((sum, entry) => sum + entry.value, 0);
  // Hovering a slice or its legend row brings that state forward.
  const [focus, setFocus] = useState<string | null>(null);
  const dimmed = (state: string) => focus !== null && focus !== state;
  return (
    <div className="flex items-center gap-6">
      <div className="relative size-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="state"
              innerRadius="68%"
              outerRadius="100%"
              strokeWidth={0}
              paddingAngle={data.length > 1 ? 2 : 0}
              animationDuration={800}
              onMouseEnter={(_, index) => setFocus(data[index]?.state ?? null)}
              onMouseLeave={() => setFocus(null)}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.state}
                  fill={STATE_COLOURS[entry.state] ?? 'var(--muted-foreground)'}
                  opacity={dimmed(entry.state) ? 0.3 : 1}
                  className="transition-opacity"
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              itemStyle={{ color: 'var(--foreground)' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums">{total}</span>
          <span className="text-xs text-muted-foreground">labs</span>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.map((entry) => (
          <li
            key={entry.state}
            onMouseEnter={() => setFocus(entry.state)}
            onMouseLeave={() => setFocus(null)}
            className={cn('flex cursor-default items-center gap-2 transition-opacity', dimmed(entry.state) && 'opacity-40')}
          >
            <span className="size-2.5 rounded-full" style={{ background: STATE_COLOURS[entry.state] }} />
            <span className="text-muted-foreground">{entry.state}</span>
            <span className="ml-auto pl-4 font-medium tabular-nums">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
